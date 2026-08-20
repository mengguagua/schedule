import express from 'express'
import {
  clearSessionCookie,
  createSessionToken,
  decryptPassword,
  getPasswordEncryptionKey,
  hashPassword,
  hashToken,
  parseCookies,
  sessionCookie,
  sessionExpiry,
  validatePassword,
  verifyPassword,
} from './security.js'
import { db, nowIso, publicUser, transaction } from './db.js'
import { writeAudit } from './audit.js'
import {
  assertManualMonth,
  createSchedule,
  currentMonth,
  DomainError,
  loadSchedule,
  loadScheduleById,
  monthOffset,
  shanghaiParts,
} from './scheduleService.js'
import { evaluateSchedule, isWorkday, listDates } from '../src/lib/scheduleRules.js'

export const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

function asUser(row) {
  return publicUser(row)
}

function loadAuthUser(token) {
  if (!token) return null
  return db.prepare(`
    SELECT u.*, g.name AS group_name, s.id AS session_id
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN groups g ON g.id = u.group_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
  `).get(hashToken(token), nowIso())
}

app.use((req, _res, next) => {
  const sid = parseCookies(req.headers.cookie).sid
  req.authRow = loadAuthUser(sid)
  req.user = asUser(req.authRow)
  req.sessionToken = sid
  next()
})

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' })
  next()
}

function requireSuper(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' })
  if (req.user.role !== 'super') return res.status(403).json({ error: '仅超级用户可执行此操作' })
  next()
}

function canManageGroup(user, groupId) {
  return user?.role === 'super' || (user?.canManageSchedule && Number(user.groupId) === Number(groupId))
}

function canViewGroup(user, groupId) {
  return user?.role === 'super' || Number(user?.groupId) === Number(groupId)
}

function assertManageGroup(req, groupId) {
  if (!canManageGroup(req.user, groupId)) throw new DomainError('没有该护士组的管理权限', 403)
}

function actorFrom(req) {
  return { id: req.user.id, name: req.user.name, username: req.user.username, role: req.user.role }
}

function shanghaiDateFromIso(iso) {
  const parts = shanghaiParts(new Date(iso))
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function previousDate(date) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
}

const loginAttempts = new Map()
app.get('/api/auth/encryption-key', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(getPasswordEncryptionKey())
})

app.post('/api/auth/login', (req, res) => {
  const key = req.ip || 'unknown'
  const state = loginAttempts.get(key) || { count: 0, since: Date.now() }
  if (Date.now() - state.since > 15 * 60 * 1000) {
    state.count = 0
    state.since = Date.now()
  }
  if (state.count >= 20) return res.status(429).json({ error: '登录尝试过多，请稍后再试' })
  const username = String(req.body?.username || '').trim()
  let password = ''
  try {
    password = decryptPassword(req.body?.encryptedPassword)
  } catch {
    return res.status(400).json({ error: '密码加密数据无效，请刷新页面后重试' })
  }
  const row = db.prepare(`
    SELECT u.*, g.name AS group_name FROM users u LEFT JOIN groups g ON g.id = u.group_id
    WHERE u.username = ? AND u.active = 1
  `).get(username)
  if (!row || !verifyPassword(password, row.password_hash)) {
    state.count += 1
    loginAttempts.set(key, state)
    return res.status(401).json({ error: '账号或密码错误' })
  }
  loginAttempts.delete(key)
  const token = createSessionToken()
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    row.id,
    sessionExpiry(),
    nowIso(),
  )
  res.setHeader('Set-Cookie', sessionCookie(token))
  res.json({ user: asUser(row) })
})

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }))

app.post('/api/auth/logout', requireAuth, (req, res) => {
  if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(req.sessionToken))
  res.setHeader('Set-Cookie', clearSessionCookie())
  res.json({ ok: true })
})

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  let currentPassword = ''
  let newPassword = ''
  try {
    currentPassword = decryptPassword(req.body?.encryptedCurrentPassword)
    newPassword = decryptPassword(req.body?.encryptedNewPassword)
  } catch {
    return res.status(400).json({ error: '密码加密数据无效，请刷新页面后重试' })
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  if (!verifyPassword(currentPassword, row.password_hash)) return res.status(400).json({ error: '当前密码错误' })
  if (!validatePassword(newPassword)) return res.status(400).json({ error: '密码长度必须为 6–64 个字符' })
  const before = { usesDefaultPassword: Boolean(row.uses_default_password) }
  transaction(() => {
    db.prepare(`
      UPDATE users SET password_hash = ?, uses_default_password = ?, updated_at = ? WHERE id = ?
    `).run(hashPassword(newPassword), newPassword === '123456' ? 1 : 0, nowIso(), row.id)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id)
    writeAudit({
      actor: actorFrom(req),
      groupId: row.group_id,
      action: 'update',
      entityType: 'account_password',
      entityId: row.id,
      before,
      after: { usesDefaultPassword: newPassword === '123456' },
      summary: `${row.name} 修改了自己的密码`,
    })
  })
  res.setHeader('Set-Cookie', clearSessionCookie())
  res.json({ ok: true, relogin: true })
})

app.get('/api/dashboard', requireAuth, (req, res) => {
  const current = currentMonth()
  const groupCondition = req.user.role === 'super' ? '' : ' WHERE id = ?'
  const groupParams = req.user.role === 'super' ? [] : [req.user.groupId || -1]
  const groups = db.prepare(`SELECT id, name, archived FROM groups${groupCondition} ORDER BY archived, name`).all(...groupParams)
  const activeUsers = req.user.role === 'super'
    ? db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'user' AND active = 1").get().count
    : db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'user' AND active = 1 AND group_id = ?").get(req.user.groupId || -1).count
  const schedules = groups.map((group) => ({
    ...group,
    generated: Boolean(db.prepare('SELECT id FROM schedules WHERE group_id = ? AND year = ? AND month = ?').get(
      group.id,
      current.year,
      current.month,
    )),
  }))
  const unread = req.user.role === 'super'
    ? db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL AND resolved_at IS NULL').get().count
    : 0
  res.json({ current, groupCount: groups.length, activeUsers, schedules, unreadNotifications: unread })
})

app.get('/api/groups', requireAuth, (req, res) => {
  const rows = req.user.role === 'super'
    ? db.prepare(`
        SELECT g.*, COUNT(u.id) AS member_count,
          SUM(CASE WHEN u.can_manage_schedule = 1 AND u.active = 1 THEN 1 ELSE 0 END) AS manager_count
        FROM groups g LEFT JOIN users u ON u.group_id = g.id AND u.active = 1
        GROUP BY g.id ORDER BY g.archived, g.created_at
      `).all()
    : db.prepare(`
        SELECT g.*, COUNT(u.id) AS member_count,
          SUM(CASE WHEN u.can_manage_schedule = 1 AND u.active = 1 THEN 1 ELSE 0 END) AS manager_count
        FROM groups g LEFT JOIN users u ON u.group_id = g.id AND u.active = 1
        WHERE g.id = ? GROUP BY g.id
      `).all(req.user.groupId || -1)
  res.json({ groups: rows.map((row) => ({
    id: row.id,
    name: row.name,
    dailyRestTarget: row.daily_rest_target,
    monthlyRestDays: row.monthly_rest_days,
    archived: Boolean(row.archived),
    memberCount: Number(row.member_count || 0),
    managerCount: Number(row.manager_count || 0),
  })) })
})

app.post('/api/groups', requireSuper, (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name || name.length > 40) return res.status(400).json({ error: '护士组名称长度必须为 1–40 个字符' })
  const now = nowIso()
  try {
    const id = transaction(() => {
      const result = db.prepare(`
        INSERT INTO groups (name, daily_rest_target, monthly_rest_days, created_at, updated_at)
        VALUES (?, 1, 4, ?, ?)
      `).run(name, now, now)
      const groupId = Number(result.lastInsertRowid)
      writeAudit({
        actor: actorFrom(req), groupId, action: 'create', entityType: 'group', entityId: groupId,
        after: { name, dailyRestTarget: 1, monthlyRestDays: 4 }, summary: `创建护士组“${name}”`,
      })
      return groupId
    })
    res.status(201).json({ id })
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: '护士组名称已存在' })
    throw error
  }
})

app.patch('/api/groups/:id', requireAuth, (req, res) => {
  const groupId = Number(req.params.id)
  const before = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId)
  if (!before) return res.status(404).json({ error: '护士组不存在' })
  const changingIdentity = req.body.name !== undefined || req.body.archived !== undefined
  if (changingIdentity && req.user.role !== 'super') return res.status(403).json({ error: '仅超级用户可修改护士组本身' })
  if (!changingIdentity) assertManageGroup(req, groupId)
  const name = req.body.name === undefined ? before.name : String(req.body.name).trim()
  const daily = req.body.dailyRestTarget === undefined ? before.daily_rest_target : Number(req.body.dailyRestTarget)
  const monthly = req.body.monthlyRestDays === undefined ? before.monthly_rest_days : Number(req.body.monthlyRestDays)
  const archived = req.body.archived === undefined ? before.archived : req.body.archived ? 1 : 0
  const memberCount = db.prepare('SELECT COUNT(*) AS count FROM users WHERE group_id = ? AND active = 1').get(groupId).count
  if (!name || name.length > 40) return res.status(400).json({ error: '护士组名称长度必须为 1–40 个字符' })
  if (req.body.dailyRestTarget !== undefined && (!Number.isInteger(daily) || daily < 0 || daily > memberCount)) {
    return res.status(400).json({ error: `每日休息人数必须是 0–${memberCount} 的整数` })
  }
  if (req.body.monthlyRestDays !== undefined && (!Number.isInteger(monthly) || monthly < 0 || monthly > 31)) {
    return res.status(400).json({ error: '每人月休天数必须是 0–31 的整数' })
  }
  try {
    transaction(() => {
      db.prepare(`
        UPDATE groups SET name = ?, daily_rest_target = ?, monthly_rest_days = ?, archived = ?, updated_at = ? WHERE id = ?
      `).run(name, daily, monthly, archived, nowIso(), groupId)
      writeAudit({
        actor: actorFrom(req), groupId, action: 'update', entityType: 'group', entityId: groupId,
        before: { name: before.name, dailyRestTarget: before.daily_rest_target, monthlyRestDays: before.monthly_rest_days, archived: Boolean(before.archived) },
        after: { name, dailyRestTarget: daily, monthlyRestDays: monthly, archived: Boolean(archived) },
        summary: `修改护士组“${before.name}”`,
      })
    })
    res.json({ ok: true })
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: '护士组名称已存在' })
    throw error
  }
})

app.delete('/api/groups/:id', requireSuper, (req, res) => {
  const groupId = Number(req.params.id)
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId)
  if (!group) return res.status(404).json({ error: '护士组不存在' })
  const members = db.prepare('SELECT COUNT(*) AS count FROM users WHERE group_id = ?').get(groupId).count
  const schedules = db.prepare('SELECT COUNT(*) AS count FROM schedules WHERE group_id = ?').get(groupId).count
  const logs = db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE group_id = ? AND entity_type != 'group'").get(groupId).count
  if (members || schedules || logs) return res.status(400).json({ error: '该组已有成员或历史，只能归档' })
  transaction(() => {
    db.prepare('DELETE FROM groups WHERE id = ?').run(groupId)
    writeAudit({
      actor: actorFrom(req), action: 'delete', entityType: 'group', entityId: groupId,
      before: { name: group.name }, summary: `删除空护士组“${group.name}”`,
    })
  })
  res.json({ ok: true })
})

app.get('/api/users', requireAuth, (req, res) => {
  if (req.user.role !== 'super' && !req.user.canManageSchedule) return res.status(403).json({ error: '没有账户列表权限' })
  const rows = req.user.role === 'super'
    ? db.prepare(`
        SELECT u.*, g.name AS group_name FROM users u LEFT JOIN groups g ON g.id = u.group_id
        WHERE u.role = 'user' ORDER BY u.active DESC, u.created_at
      `).all()
    : db.prepare(`
        SELECT u.*, g.name AS group_name FROM users u LEFT JOIN groups g ON g.id = u.group_id
        WHERE u.role = 'user' AND u.active = 1 AND (u.group_id = ? OR u.group_id IS NULL)
        ORDER BY CASE WHEN u.group_id = ? THEN 0 ELSE 1 END, u.created_at
      `).all(req.user.groupId, req.user.groupId)
  res.json({ users: rows.map(publicUser) })
})

app.post('/api/users', requireSuper, (req, res) => {
  const username = String(req.body?.username || '').trim()
  const name = String(req.body?.name || '').trim()
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: '登录账号需为 3–32 位字母、数字、点、横线或下划线' })
  }
  if (!name || name.length > 30) return res.status(400).json({ error: '护士姓名长度必须为 1–30 个字符' })
  const now = nowIso()
  try {
    const id = transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (
          username, name, password_hash, role, uses_default_password, active, created_at, updated_at
        ) VALUES (?, ?, ?, 'user', 1, 1, ?, ?)
      `).run(username, name, hashPassword('123456'), now, now)
      const userId = Number(result.lastInsertRowid)
      writeAudit({
        actor: actorFrom(req), action: 'create', entityType: 'account', entityId: userId,
        after: { username, name, active: true }, summary: `创建账户“${name}（${username}）”`,
      })
      return userId
    })
    res.status(201).json({ id, initialPassword: '123456' })
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: '登录账号已存在' })
    throw error
  }
})

app.patch('/api/users/:id', requireSuper, (req, res) => {
  const userId = Number(req.params.id)
  const before = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (!before || before.role === 'super') return res.status(404).json({ error: '普通账户不存在' })
  const name = req.body.name === undefined ? before.name : String(req.body.name).trim()
  const active = req.body.active === undefined ? before.active : req.body.active ? 1 : 0
  let groupId = req.body.groupId === undefined ? before.group_id : req.body.groupId == null ? null : Number(req.body.groupId)
  let canManage = req.body.canManageSchedule === undefined ? before.can_manage_schedule : req.body.canManageSchedule ? 1 : 0
  if (!name || name.length > 30) return res.status(400).json({ error: '护士姓名长度必须为 1–30 个字符' })
  if (!active) groupId = null
  if (groupId != null) {
    const group = db.prepare('SELECT id FROM groups WHERE id = ? AND archived = 0').get(groupId)
    if (!group) return res.status(400).json({ error: '目标护士组不存在或已归档' })
  }
  const groupChanged = Number(before.group_id || 0) !== Number(groupId || 0)
  const now = nowIso()
  transaction(() => {
    db.prepare(`
      UPDATE users SET name = ?, active = ?, group_id = ?, group_joined_at = ?,
        can_manage_schedule = ?, updated_at = ? WHERE id = ?
    `).run(
      name,
      active,
      groupId,
      groupChanged && groupId != null ? now : groupId == null ? null : before.group_joined_at,
      canManage,
      now,
      userId,
    )
    if (name !== before.name) {
      const current = currentMonth()
      db.prepare(`
        UPDATE schedule_members SET name_snapshot = ?
        WHERE user_id = ? AND schedule_id IN (
          SELECT id FROM schedules WHERE year > ? OR (year = ? AND month >= ?)
        )
      `).run(name, userId, current.year, current.year, current.month)
    }
    if (!active || canManage !== before.can_manage_schedule) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    }
    writeAudit({
      actor: actorFrom(req), groupId: groupId || before.group_id, action: 'update', entityType: 'account', entityId: userId,
      before: { name: before.name, active: Boolean(before.active), groupId: before.group_id, canManageSchedule: Boolean(before.can_manage_schedule) },
      after: { name, active: Boolean(active), groupId, canManageSchedule: Boolean(canManage) },
      summary: `修改账户“${before.name}（${before.username}）”`,
    })
  })
  res.json({ ok: true })
})

app.post('/api/users/:id/reset-password', requireSuper, (req, res) => {
  const userId = Number(req.params.id)
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(userId)
  if (!user) return res.status(404).json({ error: '普通账户不存在' })
  transaction(() => {
    db.prepare(`
      UPDATE users SET password_hash = ?, uses_default_password = 1,
        updated_at = ? WHERE id = ?
    `).run(hashPassword('123456'), nowIso(), userId)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    writeAudit({
      actor: actorFrom(req), groupId: user.group_id, action: 'update', entityType: 'account_password', entityId: userId,
      before: { usesDefaultPassword: Boolean(user.uses_default_password) },
      after: { resetToDefault: true },
      summary: `将“${user.name}（${user.username}）”的密码重置为默认值`,
    })
  })
  res.json({ ok: true, initialPassword: '123456' })
})

app.post('/api/groups/:id/members/:userId', requireAuth, (req, res) => {
  const groupId = Number(req.params.id)
  const userId = Number(req.params.userId)
  assertManageGroup(req, groupId)
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user' AND active = 1").get(userId)
  if (!user) return res.status(404).json({ error: '账户不存在或已停用' })
  if (user.group_id) return res.status(400).json({ error: '该账户已经属于其他护士组' })
  if (req.user.role !== 'super' && user.can_manage_schedule) {
    return res.status(403).json({ error: '排班管理员的组归属只能由超级用户修改' })
  }
  const group = db.prepare('SELECT * FROM groups WHERE id = ? AND archived = 0').get(groupId)
  if (!group) return res.status(404).json({ error: '护士组不存在或已归档' })
  transaction(() => {
    db.prepare('UPDATE users SET group_id = ?, group_joined_at = ?, updated_at = ? WHERE id = ?').run(
      groupId, nowIso(), nowIso(), userId,
    )
    writeAudit({
      actor: actorFrom(req), groupId, action: 'create', entityType: 'group_member', entityId: userId,
      after: { userId, name: user.name, groupId }, summary: `将“${user.name}”加入“${group.name}”`,
    })
  })
  res.json({ ok: true })
})

app.delete('/api/groups/:id/members/:userId', requireAuth, (req, res) => {
  const groupId = Number(req.params.id)
  const userId = Number(req.params.userId)
  assertManageGroup(req, groupId)
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user' AND group_id = ?").get(userId, groupId)
  if (!user) return res.status(404).json({ error: '该账户不在本组' })
  if (userId === req.user.id) return res.status(400).json({ error: '排班管理员不能将自己移出护士组' })
  if (req.user.role !== 'super' && user.can_manage_schedule) {
    return res.status(403).json({ error: '其他排班管理员只能由超级用户移组' })
  }
  const group = db.prepare('SELECT name FROM groups WHERE id = ?').get(groupId)
  transaction(() => {
    db.prepare('UPDATE users SET group_id = NULL, group_joined_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), userId)
    writeAudit({
      actor: actorFrom(req), groupId, action: 'delete', entityType: 'group_member', entityId: userId,
      before: { userId, name: user.name, groupId }, summary: `将“${user.name}”移出“${group.name}”`,
    })
  })
  res.json({ ok: true })
})

app.get('/api/schedules', requireAuth, (req, res) => {
  const groupId = Number(req.query.groupId || req.user.groupId)
  if (!canViewGroup(req.user, groupId)) return res.status(403).json({ error: '没有该护士组的查看权限' })
  const rows = db.prepare(`
    SELECT id, group_id, year, month, period_start, period_end, version, created_at, updated_at
    FROM schedules WHERE group_id = ? ORDER BY year DESC, month DESC
  `).all(groupId)
  res.json({ schedules: rows.map((row) => ({
    id: row.id, groupId: row.group_id, year: row.year, month: row.month,
    periodStart: row.period_start, periodEnd: row.period_end, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at,
  })) })
})

app.get('/api/schedules/:groupId/:year/:month', requireAuth, (req, res) => {
  const groupId = Number(req.params.groupId)
  if (!canViewGroup(req.user, groupId)) return res.status(403).json({ error: '没有该护士组的查看权限' })
  const schedule = loadSchedule(groupId, req.params.year, req.params.month)
  if (!schedule) return res.status(404).json({ error: '该月尚未生成排班', missing: true })
  res.json({ schedule })
})

app.post('/api/schedules', requireAuth, (req, res) => {
  const groupId = Number(req.body?.groupId)
  assertManageGroup(req, groupId)
  const schedule = createSchedule({
    groupId,
    year: req.body?.year,
    month: req.body?.month,
    actor: actorFrom(req),
    enforceManualRange: true,
  })
  res.status(201).json({ schedule })
})

app.patch('/api/schedules/:id/entries', requireAuth, (req, res) => {
  const scheduleId = Number(req.params.id)
  const schedule = loadScheduleById(scheduleId)
  if (!schedule) return res.status(404).json({ error: '排班不存在' })
  assertManageGroup(req, schedule.groupId)
  if (schedule.readOnly) return res.status(400).json({ error: '过去月份的排班只读' })
  const version = Number(req.body?.version)
  const changes = Array.isArray(req.body?.changes) ? req.body.changes : []
  if (!changes.length) return res.status(400).json({ error: '没有需要保存的修改' })
  const before = []
  transaction(() => {
    const versionResult = db.prepare(`
      UPDATE schedules SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?
    `).run(nowIso(), scheduleId, version)
    if (!versionResult.changes) throw new DomainError('班表已被其他人更新，请刷新后重新修改', 409, 'version_conflict')
    for (const change of changes) {
      const member = schedule.members.find((item) => item.id === Number(change.memberId))
      if (!member || change.date < member.periodStart || change.date > member.periodEnd) {
        throw new DomainError('包含不在护士排班区间内的修改')
      }
      if (!['day', 'rest'].includes(change.status)) throw new DomainError('班次状态无效')
      const oldStatus = member.entries[change.date]
      before.push({ memberId: member.id, userId: member.userId, name: member.name, date: change.date, status: oldStatus })
      db.prepare('UPDATE schedule_entries SET status = ? WHERE schedule_member_id = ? AND date = ?').run(
        change.status, member.id, change.date,
      )
    }
    writeAudit({
      actor: actorFrom(req), groupId: schedule.groupId, action: 'update', entityType: 'schedule_entries', entityId: scheduleId,
      before, after: changes, summary: `批量修改 ${schedule.year} 年 ${schedule.month} 月排班（${changes.length} 项）`,
    })
  })
  res.json({ schedule: loadScheduleById(scheduleId) })
})

app.delete('/api/schedules/:id', requireAuth, (req, res) => {
  const scheduleId = Number(req.params.id)
  const schedule = loadScheduleById(scheduleId)
  if (!schedule) return res.status(404).json({ error: '排班不存在' })
  assertManageGroup(req, schedule.groupId)
  assertManualMonth(schedule.year, schedule.month)
  const snapshot = {
    year: schedule.year,
    month: schedule.month,
    periodStart: schedule.periodStart,
    periodEnd: schedule.periodEnd,
    members: schedule.members,
  }
  transaction(() => {
    db.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId)
    writeAudit({
      actor: actorFrom(req), groupId: schedule.groupId, action: 'delete', entityType: 'schedule', entityId: scheduleId,
      before: snapshot, summary: `删除 ${schedule.year} 年 ${schedule.month} 月排班`,
    })
  })
  res.json({ ok: true })
})

app.post('/api/schedules/:id/members', requireAuth, (req, res) => {
  const scheduleId = Number(req.params.id)
  const userId = Number(req.body?.userId)
  const schedule = loadScheduleById(scheduleId)
  if (!schedule) return res.status(404).json({ error: '排班不存在' })
  assertManageGroup(req, schedule.groupId)
  const current = currentMonth()
  if (schedule.year !== current.year || schedule.month !== current.month) {
    return res.status(400).json({ error: '只能向当前月排班添加中途入组成员' })
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND group_id = ? AND active = 1 AND role = 'user'").get(
    userId, schedule.groupId,
  )
  if (!user) return res.status(404).json({ error: '该账户不是本组启用成员' })
  if (schedule.members.some((member) => member.userId === userId)) return res.status(409).json({ error: '该护士已在本月排班中' })
  const joined = user.group_joined_at ? shanghaiDateFromIso(user.group_joined_at) : schedule.periodStart
  const today = `${current.year}-${String(current.month).padStart(2, '0')}-${String(current.day).padStart(2, '0')}`
  const start = [joined, today, schedule.periodStart].sort().at(-1)
  const now = nowIso()
  transaction(() => {
    const result = db.prepare(`
      INSERT INTO schedule_members (
        schedule_id, user_id, username_snapshot, name_snapshot, period_start, period_end
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(scheduleId, user.id, user.username, user.name, start, schedule.periodEnd)
    const memberId = Number(result.lastInsertRowid)
    const insert = db.prepare('INSERT INTO schedule_entries (schedule_member_id, date, status) VALUES (?, ?, ?)')
    for (const date of listDates(start, schedule.periodEnd)) insert.run(memberId, date, 'day')
    db.prepare('UPDATE schedules SET version = version + 1, updated_at = ? WHERE id = ?').run(now, scheduleId)
    writeAudit({
      actor: actorFrom(req), groupId: schedule.groupId, action: 'create', entityType: 'schedule_member', entityId: memberId,
      after: { userId, name: user.name, periodStart: start, periodEnd: schedule.periodEnd },
      summary: `将“${user.name}”添加到本月排班`,
    })
  })
  res.status(201).json({ schedule: loadScheduleById(scheduleId) })
})

app.patch('/api/schedule-members/:id/end', requireAuth, (req, res) => {
  const memberId = Number(req.params.id)
  const row = db.prepare(`
    SELECT sm.*, s.group_id, s.year, s.month, s.id AS schedule_id
    FROM schedule_members sm JOIN schedules s ON s.id = sm.schedule_id WHERE sm.id = ?
  `).get(memberId)
  if (!row) return res.status(404).json({ error: '排班成员不存在' })
  assertManageGroup(req, row.group_id)
  const current = currentMonth()
  if (row.year !== current.year || row.month !== current.month) {
    return res.status(400).json({ error: '只能结束当前月成员排班' })
  }
  const departureDate = String(req.body?.departureDate || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate) || departureDate <= row.period_start || departureDate > row.period_end) {
    return res.status(400).json({ error: '离组日期必须在该护士当前排班区间内且晚于开始日期' })
  }
  const newEnd = previousDate(departureDate)
  transaction(() => {
    db.prepare('DELETE FROM schedule_entries WHERE schedule_member_id = ? AND date >= ?').run(memberId, departureDate)
    db.prepare('UPDATE schedule_members SET period_end = ? WHERE id = ?').run(newEnd, memberId)
    db.prepare('UPDATE schedules SET version = version + 1, updated_at = ? WHERE id = ?').run(nowIso(), row.schedule_id)
    writeAudit({
      actor: actorFrom(req), groupId: row.group_id, action: 'update', entityType: 'schedule_member', entityId: memberId,
      before: { periodEnd: row.period_end }, after: { periodEnd: newEnd, departureDate },
      summary: `结束“${row.name_snapshot}”的本月排班`,
    })
  })
  res.json({ schedule: loadScheduleById(row.schedule_id) })
})

app.get('/api/audit-logs', requireAuth, (req, res) => {
  if (req.user.role !== 'super' && !req.user.canManageSchedule) return res.status(403).json({ error: '没有日志查看权限' })
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 30))
  const groupId = req.user.role === 'super' ? (req.query.groupId ? Number(req.query.groupId) : null) : req.user.groupId
  const where = groupId ? 'WHERE a.group_id = ?' : ''
  const params = groupId ? [groupId] : []
  const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_logs a ${where}`).get(...params).count
  const rows = db.prepare(`
    SELECT a.*, g.name AS group_name FROM audit_logs a LEFT JOIN groups g ON g.id = a.group_id
    ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize)
  res.json({
    total,
    page,
    pageSize,
    logs: rows.map((row) => ({
      id: row.id, actorName: row.actor_name, actorUsername: row.actor_username,
      groupId: row.group_id, groupName: row.group_name, action: row.action,
      entityType: row.entity_type, entityId: row.entity_id,
      before: row.before_json ? JSON.parse(row.before_json) : null,
      after: row.after_json ? JSON.parse(row.after_json) : null,
      summary: row.summary, createdAt: row.created_at,
    })),
  })
})

app.get('/api/system', requireSuper, (_req, res) => {
  const backup = db.prepare('SELECT * FROM backup_runs ORDER BY id DESC LIMIT 1').get()
  const notifications = db.prepare(`
    SELECT * FROM notifications WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 50
  `).all().map((row) => ({
    id: row.id, type: row.type, message: row.message,
    details: row.details_json ? JSON.parse(row.details_json) : null,
    readAt: row.read_at, createdAt: row.created_at,
  }))
  res.json({
    backup: backup ? {
      status: backup.status, filePath: backup.file_path, error: backup.error, createdAt: backup.created_at,
    } : null,
    notifications,
  })
})

app.patch('/api/notifications/:id/read', requireSuper, (req, res) => {
  db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?').run(nowIso(), Number(req.params.id))
  res.json({ ok: true })
})

app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }))

app.use((error, _req, res, _next) => {
  if (error instanceof DomainError) return res.status(error.status).json({ error: error.message, code: error.code })
  console.error(error)
  res.status(500).json({ error: '服务器内部错误' })
})
