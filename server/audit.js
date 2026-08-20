import { db, nowIso } from './db.js'

function clean(value) {
  if (value === undefined) return null
  return JSON.stringify(value, (key, item) => {
    if (key.toLowerCase().includes('password')) return undefined
    return item
  })
}

export function writeAudit({ actor, groupId = null, action, entityType, entityId = null, before, after, summary }) {
  db.prepare(`
    INSERT INTO audit_logs (
      actor_user_id, actor_name, actor_username, group_id, action,
      entity_type, entity_id, before_json, after_json, summary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    actor?.id || null,
    actor?.name || '系统',
    actor?.username || 'system',
    groupId,
    action,
    entityType,
    entityId == null ? null : String(entityId),
    clean(before),
    clean(after),
    summary,
    nowIso(),
  )
}

export const systemActor = Object.freeze({ id: null, name: '系统', username: 'system', role: 'system' })
