export function pad(value) {
  return String(value).padStart(2, '0')
}

export function formatDate(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function listDates(start, end) {
  const dates = []
  let cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor = new Date(cursor.getTime() + 86400000)
  }
  return dates
}

export function weekday(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

export function isWorkday(date) {
  const day = weekday(date)
  return day >= 1 && day <= 5
}

export function workdaysInRange(start, end) {
  return listDates(start, end).filter(isWorkday)
}

export function expectedRestDays(monthlyRestDays, memberStart, memberEnd, year, month) {
  const activeWorkdays = workdaysInRange(memberStart, memberEnd).length
  const fullStart = formatDate(year, month, 1)
  const fullEnd = formatDate(year, month, daysInMonth(year, month))
  const fullWorkdays = workdaysInRange(fullStart, fullEnd).length
  return Math.round((monthlyRestDays * activeWorkdays) / fullWorkdays)
}

export function evaluateSchedule(schedule, rulesOverride) {
  if (!schedule) return []
  const rules = rulesOverride || schedule.rules
  const warnings = []
  const dates = listDates(schedule.periodStart, schedule.periodEnd)
  const previousRestIds = new Set(schedule.previousRestUserIds || [])

  for (const date of dates.filter(isWorkday)) {
    const active = schedule.members.filter((member) => member.periodStart <= date && member.periodEnd >= date)
    const rest = active.filter((member) => member.entries?.[date] === 'rest')
    if (rest.length !== rules.dailyRestTarget) {
      warnings.push({
        code: 'daily-rest-target',
        date,
        message: `${date} 休息 ${rest.length} 人，不符合每日目标 ${rules.dailyRestTarget} 人。`,
      })
    }
  }

  for (const member of schedule.members) {
    const memberDates = listDates(member.periodStart, member.periodEnd)
    const restDates = memberDates.filter((date) => member.entries?.[date] === 'rest')
    const expected = expectedRestDays(
      rules.monthlyRestDays,
      member.periodStart,
      member.periodEnd,
      schedule.year,
      schedule.month,
    )
    if (restDates.length !== expected) {
      warnings.push({
        code: 'monthly-rest-days',
        userId: member.userId,
        message: `${member.name} 实际休息 ${restDates.length} 天，应休 ${expected} 天。`,
      })
    }

    for (const date of restDates.filter((value) => !isWorkday(value))) {
      warnings.push({
        code: 'weekend-rest',
        userId: member.userId,
        date,
        message: `${member.name} 在周末 ${date} 被安排休息。`,
      })
    }

    const workdays = memberDates.filter(isWorkday)
    let previousWasRest = previousRestIds.has(member.userId) && member.periodStart.endsWith('-01')
    let previousDate = '上月最后一个工作日'
    for (const date of workdays) {
      const isRest = member.entries?.[date] === 'rest'
      if (previousWasRest && isRest) {
        warnings.push({
          code: 'consecutive-rest',
          userId: member.userId,
          date,
          message: `${member.name} 在 ${previousDate} 与 ${date} 连续两个工作日休息。`,
        })
      }
      previousWasRest = isRest
      previousDate = date
    }
  }

  return warnings
}
