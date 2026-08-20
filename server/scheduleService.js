import { db, nowIso, transaction } from './db.js'
import { writeAudit } from './audit.js'
import {
  daysInMonth,
  evaluateSchedule,
  expectedRestDays,
  formatDate,
  isWorkday,
  listDates,
  workdaysInRange,
} from '../src/lib/scheduleRules.js'

export class DomainError extends Error {
  constructor(message, status = 400, code = 'domain_error') {
    super(message)
    this.status = status
    this.code = code
  }
}

export function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
}

export function currentMonth() {
  const current = shanghaiParts()
  return { year: current.year, month: current.month, day: current.day }
}

export function monthOffset(year, month, offset) {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }
}

function compareMonth(aYear, aMonth, bYear, bMonth) {
  return aYear * 12 + aMonth - (bYear * 12 + bMonth)
}

export function assertManualMonth(year, month) {
  const current = currentMonth()
  const difference = compareMonth(year, month, current.year, current.month)
  if (difference < 0 || difference > 1) {
    throw new DomainError('只能为当前月或下一个月执行一键排班')
  }
}

function distributeDailyCounts(total, weekdayCount, target, memberCount, seed) {
  const counts = Array(weekdayCount).fill(target)
  let delta = total - target * weekdayCount
  const order = Array.from({ length: weekdayCount }, (_, index) => (index * 2 + seed) % weekdayCount)
  const uniqueOrder = [...new Set(order), ...Array.from({ length: weekdayCount }, (_, index) => index)].filter(
    (value, index, values) => values.indexOf(value) === index,
  )
  while (delta !== 0) {
    let changed = false
    for (const index of uniqueOrder) {
      if (delta > 0 && counts[index] < memberCount) {
        counts[index] += 1
        delta -= 1
        changed = true
      } else if (delta < 0 && counts[index] > 0) {
        counts[index] -= 1
        delta += 1
        changed = true
      }
      if (delta === 0) break
    }
    if (!changed) throw new DomainError('当前规则无法分配每日休息人数')
  }
  return counts
}

function allocateRestDays(members, weekdays, dailyCounts, quota, previousRestIds, seed) {
  const state = members.map((member, index) => ({
    ...member,
    order: (index - seed + members.length) % members.length,
    remaining: quota,
    assigned: new Set(),
    lastRestIndex: previousRestIds.has(member.id) ? -1 : -999,
  }))

  weekdays.forEach((date, dayIndex) => {
    const count = dailyCounts[dayIndex]
    for (let slot = 0; slot < count; slot += 1) {
      const remainingDays = weekdays.length - dayIndex
      const candidates = state.filter((member) => member.remaining > 0 && !member.assigned.has(date))
      candidates.sort((a, b) => {
        const aForced = a.remaining >= remainingDays ? 1 : 0
        const bForced = b.remaining >= remainingDays ? 1 : 0
        if (aForced !== bForced) return bForced - aForced
        const aConsecutive = a.lastRestIndex === dayIndex - 1 ? 1 : 0
        const bConsecutive = b.lastRestIndex === dayIndex - 1 ? 1 : 0
        if (aConsecutive !== bConsecutive) return aConsecutive - bConsecutive
        if (a.remaining !== b.remaining) return b.remaining - a.remaining
        if (a.lastRestIndex !== b.lastRestIndex) return a.lastRestIndex - b.lastRestIndex
        return a.order - b.order
      })
      const selected = candidates[0]
      if (!selected) throw new DomainError('当前规则无法完成休息日分配')
      selected.assigned.add(date)
      selected.remaining -= 1
      selected.lastRestIndex = dayIndex
    }
  })

  if (state.some((member) => member.remaining !== 0)) {
    throw new DomainError('当前规则无法保证每名护士的月休天数')
  }
  return new Map(state.map((member) => [member.id, member.assigned]))
}

function previousRestUserIds(groupId, year, month) {
  const previous = monthOffset(year, month, -1)
  const schedule = db.prepare('SELECT id FROM schedules WHERE group_id = ? AND year = ? AND month = ?').get(
    groupId,
    previous.year,
    previous.month,
  )
  if (!schedule) return new Set()
  const lastWorkday = workdaysInRange(
    formatDate(previous.year, previous.month, 1),
    formatDate(previous.year, previous.month, daysInMonth(previous.year, previous.month)),
  ).at(-1)
  const rows = db.prepare(`
    SELECT sm.user_id
    FROM schedule_members sm
    JOIN schedule_entries se ON se.schedule_member_id = sm.id
    WHERE sm.schedule_id = ? AND se.date = ? AND se.status = 'rest' AND sm.user_id IS NOT NULL
  `).all(schedule.id, lastWorkday)
  return new Set(rows.map((row) => row.user_id))
}

export function createSchedule({ groupId, year, month, actor, enforceManualRange = true }) {
  year = Number(year)
  month = Number(month)
  if (enforceManualRange) assertManualMonth(year, month)
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId)
  if (!group || group.archived) throw new DomainError('护士组不存在或已归档', 404)
  if (db.prepare('SELECT id FROM schedules WHERE group_id = ? AND year = ? AND month = ?').get(groupId, year, month)) {
    throw new DomainError('该月已经存在排班，请先删除排班', 409, 'schedule_exists')
  }
  const members = db.prepare(`
    SELECT id, username, name
    FROM users
    WHERE group_id = ? AND active = 1 AND role = 'user'
    ORDER BY created_at, id
  `).all(groupId)
  if (!members.length) throw new DomainError('护士组没有可排班成员')
  if (group.daily_rest_target > members.length) throw new DomainError('每日休息人数超过当前组员人数')

  const current = currentMonth()
  const isCurrent = year === current.year && month === current.month
  const start = formatDate(year, month, isCurrent ? current.day : 1)
  const end = formatDate(year, month, daysInMonth(year, month))
  const weekdays = workdaysInRange(start, end)
  const quota = expectedRestDays(group.monthly_rest_days, start, end, year, month)
  if (quota > weekdays.length) throw new DomainError('折算后的月休天数超过剩余工作日，不能自动排班')

  const totalRest = quota * members.length
  const seed = (year * 12 + month) % Math.max(1, members.length)
  const dailyCounts = distributeDailyCounts(
    totalRest,
    weekdays.length,
    group.daily_rest_target,
    members.length,
    seed,
  )
  const previous = previousRestUserIds(groupId, year, month)
  const assignments = allocateRestDays(members, weekdays, dailyCounts, quota, previous, seed)
  const allDates = listDates(start, end)
  const now = nowIso()

  return transaction(() => {
    const scheduleResult = db.prepare(`
      INSERT INTO schedules (
        group_id, year, month, period_start, period_end,
        rule_daily_rest_target, rule_monthly_rest_days,
        version, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      groupId,
      year,
      month,
      start,
      end,
      group.daily_rest_target,
      group.monthly_rest_days,
      actor?.id || null,
      now,
      now,
    )
    const scheduleId = Number(scheduleResult.lastInsertRowid)
    const insertMember = db.prepare(`
      INSERT INTO schedule_members (
        schedule_id, user_id, username_snapshot, name_snapshot, period_start, period_end
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    const insertEntry = db.prepare(`
      INSERT INTO schedule_entries (schedule_member_id, date, status) VALUES (?, ?, ?)
    `)
    for (const member of members) {
      const memberResult = insertMember.run(scheduleId, member.id, member.username, member.name, start, end)
      const memberId = Number(memberResult.lastInsertRowid)
      const restDates = assignments.get(member.id)
      for (const date of allDates) insertEntry.run(memberId, date, restDates.has(date) ? 'rest' : 'day')
    }
    writeAudit({
      actor,
      groupId,
      action: 'create',
      entityType: 'schedule',
      entityId: scheduleId,
      after: { year, month, periodStart: start, periodEnd: end, memberCount: members.length },
      summary: `生成 ${year} 年 ${month} 月排班`,
    })
    return loadScheduleById(scheduleId)
  })
}

export function loadSchedule(groupId, year, month) {
  const row = db.prepare('SELECT id FROM schedules WHERE group_id = ? AND year = ? AND month = ?').get(
    groupId,
    Number(year),
    Number(month),
  )
  return row ? loadScheduleById(row.id) : null
}

export function loadScheduleById(scheduleId) {
  const schedule = db.prepare(`
    SELECT s.*, g.name AS group_name, g.daily_rest_target AS current_daily_rest_target,
           g.monthly_rest_days AS current_monthly_rest_days
    FROM schedules s JOIN groups g ON g.id = s.group_id WHERE s.id = ?
  `).get(scheduleId)
  if (!schedule) return null
  const members = db.prepare(`
    SELECT * FROM schedule_members WHERE schedule_id = ? ORDER BY id
  `).all(scheduleId)
  const entries = db.prepare(`
    SELECT se.schedule_member_id, se.date, se.status
    FROM schedule_entries se
    JOIN schedule_members sm ON sm.id = se.schedule_member_id
    WHERE sm.schedule_id = ? ORDER BY se.date
  `).all(scheduleId)
  const entryMap = new Map()
  for (const entry of entries) {
    if (!entryMap.has(entry.schedule_member_id)) entryMap.set(entry.schedule_member_id, {})
    entryMap.get(entry.schedule_member_id)[entry.date] = entry.status
  }
  const current = currentMonth()
  const past = compareMonth(schedule.year, schedule.month, current.year, current.month) < 0
  const result = {
    id: schedule.id,
    groupId: schedule.group_id,
    groupName: schedule.group_name,
    year: schedule.year,
    month: schedule.month,
    periodStart: schedule.period_start,
    periodEnd: schedule.period_end,
    version: schedule.version,
    readOnly: past,
    rules: {
      dailyRestTarget: past ? schedule.rule_daily_rest_target : schedule.current_daily_rest_target,
      monthlyRestDays: past ? schedule.rule_monthly_rest_days : schedule.current_monthly_rest_days,
    },
    ruleSnapshot: {
      dailyRestTarget: schedule.rule_daily_rest_target,
      monthlyRestDays: schedule.rule_monthly_rest_days,
    },
    previousRestUserIds: [...previousRestUserIds(schedule.group_id, schedule.year, schedule.month)],
    members: members.map((member) => ({
      id: member.id,
      userId: member.user_id,
      username: member.username_snapshot,
      name: member.name_snapshot,
      periodStart: member.period_start,
      periodEnd: member.period_end,
      entries: entryMap.get(member.id) || {},
    })),
  }
  result.warnings = evaluateSchedule(result)
  return result
}
