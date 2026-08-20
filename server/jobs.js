import fs from 'node:fs'
import path from 'node:path'
import { db, databasePath, nowIso } from './db.js'
import { systemActor } from './audit.js'
import { createSchedule, currentMonth, shanghaiParts } from './scheduleService.js'

function notify(type, message, details) {
  const duplicate = db.prepare(`
    SELECT id FROM notifications WHERE type = ? AND message = ? AND resolved_at IS NULL LIMIT 1
  `).get(type, message)
  if (duplicate) return duplicate.id
  db.prepare(`
    INSERT INTO notifications (type, message, details_json, created_at) VALUES (?, ?, ?, ?)
  `).run(type, message, details ? JSON.stringify(details) : null, nowIso())
}

export function runMonthlySchedules() {
  const current = currentMonth()
  const groups = db.prepare('SELECT id, name FROM groups WHERE archived = 0 ORDER BY id').all()
  for (const group of groups) {
    const exists = db.prepare('SELECT id FROM schedules WHERE group_id = ? AND year = ? AND month = ?').get(
      group.id,
      current.year,
      current.month,
    )
    if (exists) continue
    try {
      createSchedule({
        groupId: group.id,
        year: current.year,
        month: current.month,
        actor: systemActor,
        enforceManualRange: false,
      })
    } catch (error) {
      notify('schedule_failed', `${group.name} 的本月自动排班未生成：${error.message}`, {
        groupId: group.id,
        year: current.year,
        month: current.month,
      })
    }
  }
}

export function runBackup() {
  const backupDir = path.resolve(process.env.BACKUP_DIR || './backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('-', '').replace('T', '-').slice(0, 15)
  const destination = path.join(backupDir, `schedule-${stamp}.sqlite`)
  try {
    const escaped = destination.replaceAll("'", "''")
    db.exec(`VACUUM INTO '${escaped}'`)
    db.prepare('INSERT INTO backup_runs (file_path, status, created_at) VALUES (?, ?, ?)').run(
      destination,
      'success',
      nowIso(),
    )
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
    for (const file of fs.readdirSync(backupDir)) {
      if (!file.startsWith('schedule-') || !file.endsWith('.sqlite')) continue
      const filePath = path.join(backupDir, file)
      if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath)
    }
    return destination
  } catch (error) {
    db.prepare('INSERT INTO backup_runs (file_path, status, error, created_at) VALUES (?, ?, ?, ?)').run(
      destination,
      'failed',
      error.message,
      nowIso(),
    )
    notify('backup_failed', `数据备份失败：${error.message}`, { databasePath })
    throw error
  }
}

function maybeBackup() {
  const parts = shanghaiParts()
  if (parts.hour !== 2 || parts.minute !== 0) return
  const last = db.prepare("SELECT created_at FROM backup_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1").get()
  if (!last || Date.now() - new Date(last.created_at).getTime() >= 47 * 60 * 60 * 1000) runBackup()
}

export function startJobs() {
  runMonthlySchedules()
  let monthlyStamp = ''
  setInterval(() => {
    const parts = shanghaiParts()
    const stamp = `${parts.year}-${parts.month}`
    if (parts.day === 1 && parts.hour === 0 && parts.minute === 5 && monthlyStamp !== stamp) {
      monthlyStamp = stamp
      runMonthlySchedules()
    }
    try {
      maybeBackup()
    } catch (error) {
      console.error(error)
    }
  }, 30_000).unref()
}
