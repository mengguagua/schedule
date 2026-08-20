import assert from 'node:assert/strict'
import crypto from 'node:crypto'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3137'

async function request(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}

async function login(username, password) {
  const key = await request('/api/auth/encryption-key')
  assert.equal(key.response.status, 200, `encryption key failed: ${JSON.stringify(key.data)}`)
  const encryptedPassword = {
    keyId: key.data.keyId,
    ciphertext: crypto.publicEncrypt({
      key: key.data.publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    }, Buffer.from(password)).toString('base64'),
  }
  const result = await request('/api/auth/login', { method: 'POST', body: { username, encryptedPassword } })
  assert.equal(result.response.status, 200, `login failed: ${JSON.stringify(result.data)}`)
  return result.cookie
}

const adminCookie = await login('admin', 'test-admin-password')

let result = await request('/api/groups', { method: 'POST', cookie: adminCookie, body: { name: '内科一组' } })
if (result.response.status === 409) {
  result = await request('/api/groups', { cookie: adminCookie })
  result.data.id = result.data.groups.find((group) => group.name === '内科一组').id
}
assert.ok([200, 201].includes(result.response.status))
const groupId = result.data.id

const nurses = [
  ['nurse01', '王芳'],
  ['nurse02', '李静'],
  ['nurse03', '张敏'],
  ['nurse04', '陈雪'],
  ['nurse05', '赵琳'],
]

for (const [username, name] of nurses) {
  const create = await request('/api/users', { method: 'POST', cookie: adminCookie, body: { username, name } })
  assert.ok([201, 409].includes(create.response.status), JSON.stringify(create.data))
}

result = await request('/api/users', { cookie: adminCookie })
assert.equal(result.response.status, 200)
const users = result.data.users.filter((user) => nurses.some(([username]) => username === user.username))
assert.equal(users.length, nurses.length)

for (const user of users) {
  const update = await request(`/api/users/${user.id}`, {
    method: 'PATCH', cookie: adminCookie,
    body: { groupId, name: user.name, active: true, canManageSchedule: false },
  })
  assert.equal(update.response.status, 200, JSON.stringify(update.data))
}

const manager = users.find((user) => user.username === 'nurse01')
result = await request(`/api/users/${manager.id}`, {
  method: 'PATCH', cookie: adminCookie,
  body: { groupId, name: manager.name, active: true, canManageSchedule: true },
})
assert.equal(result.response.status, 200, JSON.stringify(result.data))

let nurseCookie = await login(manager.username, '123456')
result = await request(`/api/groups/${groupId}`, {
  method: 'PATCH', cookie: nurseCookie, body: { dailyRestTarget: 1, monthlyRestDays: 4 },
})
assert.equal(result.response.status, 200, JSON.stringify(result.data))

result = await request(`/api/users/${manager.id}/reset-password`, {
  method: 'POST', cookie: adminCookie,
})
assert.equal(result.response.status, 200, JSON.stringify(result.data))
result = await request('/api/users', { cookie: adminCookie })
assert.equal(result.data.users.find((user) => user.id === manager.id).canManageSchedule, true)
nurseCookie = await login(manager.username, '123456')

result = await request(`/api/groups/${groupId}`, {
  method: 'PATCH', cookie: adminCookie, body: { dailyRestTarget: 1, monthlyRestDays: 4 },
})
assert.equal(result.response.status, 200, JSON.stringify(result.data))

const current = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const [year, month] = current.split('-').map(Number)
result = await request('/api/schedules', {
  method: 'POST', cookie: adminCookie, body: { groupId, year, month },
})
assert.ok([201, 409].includes(result.response.status), JSON.stringify(result.data))
if (result.response.status === 409) {
  result = await request(`/api/schedules/${groupId}/${year}/${month}`, { cookie: adminCookie })
}
const schedule = result.data.schedule
assert.equal(schedule.members.length, 5)
for (const member of schedule.members) {
  assert.equal(Object.values(member.entries).filter((status) => status === 'rest').length, 2)
}
assert.ok(schedule.warnings.some((warning) => warning.code === 'daily-rest-target'))

const editable = schedule.members[0]
const editDate = Object.keys(editable.entries).find((date) => editable.entries[date] === 'day')
result = await request(`/api/schedules/${schedule.id}/entries`, {
  method: 'PATCH', cookie: adminCookie,
  body: { version: schedule.version, changes: [{ memberId: editable.id, date: editDate, status: 'rest' }] },
})
assert.equal(result.response.status, 200, JSON.stringify(result.data))

const conflict = await request(`/api/schedules/${schedule.id}/entries`, {
  method: 'PATCH', cookie: adminCookie,
  body: { version: schedule.version, changes: [{ memberId: editable.id, date: editDate, status: 'day' }] },
})
assert.equal(conflict.response.status, 409)

const ordinary = users.find((user) => user.username === 'nurse02')
const ordinaryCookie = await login(ordinary.username, '123456')
const view = await request(`/api/schedules/${groupId}/${year}/${month}`, { cookie: ordinaryCookie })
assert.equal(view.response.status, 200)
const forbidden = await request(`/api/schedules/${schedule.id}/entries`, {
  method: 'PATCH', cookie: ordinaryCookie,
  body: { version: view.data.schedule.version, changes: [{ memberId: view.data.schedule.members[0].id, date: editDate, status: 'day' }] },
})
assert.equal(forbidden.response.status, 403)

const logs = await request('/api/audit-logs?page=1&pageSize=100', { cookie: adminCookie })
assert.equal(logs.response.status, 200)
assert.ok(logs.data.logs.some((log) => log.entityType === 'schedule'))
assert.ok(logs.data.logs.some((log) => log.entityType === 'schedule_entries'))

console.log(JSON.stringify({
  groupId,
  scheduleId: schedule.id,
  memberCount: schedule.members.length,
  warningCount: schedule.warnings.length,
  auditLogCount: logs.data.total,
  checks: 'passed',
}, null, 2))
