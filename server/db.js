import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { hashPassword } from './security.js'

const dataDir = path.resolve(process.env.DATA_DIR || './data')
fs.mkdirSync(dataDir, { recursive: true })

export const databasePath = path.join(dataDir, 'schedule.sqlite')
export const db = new DatabaseSync(databasePath)

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    daily_rest_target INTEGER NOT NULL DEFAULT 1 CHECK (daily_rest_target >= 0),
    monthly_rest_days INTEGER NOT NULL DEFAULT 4 CHECK (monthly_rest_days >= 0 AND monthly_rest_days <= 31),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('super', 'user')),
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    group_joined_at TEXT,
    can_manage_schedule INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_schedule IN (0, 1)),
    uses_default_password INTEGER NOT NULL DEFAULT 0 CHECK (uses_default_password IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id),
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    rule_daily_rest_target INTEGER NOT NULL,
    rule_monthly_rest_days INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (group_id, year, month)
  );

  CREATE TABLE IF NOT EXISTS schedule_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username_snapshot TEXT NOT NULL,
    name_snapshot TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    UNIQUE (schedule_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS schedule_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_member_id INTEGER NOT NULL REFERENCES schedule_members(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('day', 'rest')),
    UNIQUE (schedule_member_id, date)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name TEXT NOT NULL,
    actor_username TEXT NOT NULL,
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    before_json TEXT,
    after_json TEXT,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    read_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS backup_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_group ON users(group_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_schedules_group_month ON schedules(group_id, year, month);
  CREATE INDEX IF NOT EXISTS idx_schedule_members_schedule ON schedule_members(schedule_id);
  CREATE INDEX IF NOT EXISTS idx_entries_member ON schedule_entries(schedule_member_id);
  CREATE INDEX IF NOT EXISTS idx_audit_group_time ON audit_logs(group_id, created_at DESC);
`)

export function nowIso() {
  return new Date().toISOString()
}

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function ensureAdmin(initialPassword) {
  const existing = db.prepare("SELECT id FROM users WHERE role = 'super'").get()
  if (existing) return existing.id
  if (!initialPassword) {
    throw new Error('首次启动必须设置 ADMIN_PASSWORD 环境变量')
  }
  const now = nowIso()
  const result = db.prepare(`
    INSERT INTO users (
      username, name, password_hash, role, can_manage_schedule,
      uses_default_password, active, created_at, updated_at
    ) VALUES ('admin', '超级用户', ?, 'super', 1, 0, 1, ?, ?)
  `).run(hashPassword(initialPassword), now, now)
  return Number(result.lastInsertRowid)
}

export function publicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    groupId: row.group_id,
    groupName: row.group_name || null,
    groupJoinedAt: row.group_joined_at,
    canManageSchedule: Boolean(row.can_manage_schedule),
    usesDefaultPassword: Boolean(row.uses_default_password),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
