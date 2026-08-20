import crypto from 'node:crypto'

const SESSION_DAYS = 7
const PASSWORD_ENCRYPTION_ALGORITHM = 'RSA-OAEP-256'
const passwordEncryptionKeys = crypto.generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicExponent: 0x10001,
})
const passwordEncryptionPublicKey = passwordEncryptionKeys.publicKey.export({
  type: 'spki',
  format: 'pem',
})
const passwordEncryptionKeyId = crypto.createHash('sha256')
  .update(passwordEncryptionKeys.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('base64url')

export function getPasswordEncryptionKey() {
  return {
    keyId: passwordEncryptionKeyId,
    algorithm: PASSWORD_ENCRYPTION_ALGORITHM,
    publicKey: passwordEncryptionPublicKey,
  }
}

export function decryptPassword(payload) {
  if (!payload || payload.keyId !== passwordEncryptionKeyId || typeof payload.ciphertext !== 'string') {
    throw new Error('invalid encrypted password')
  }

  const encrypted = Buffer.from(payload.ciphertext, 'base64')
  if (encrypted.length !== 384) throw new Error('invalid encrypted password')

  return crypto.privateDecrypt({
    key: passwordEncryptionKeys.privateKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, encrypted).toString('utf8')
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyPassword(password, encoded) {
  const [algorithm, saltHex, hashHex] = String(encoded).split('$')
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return crypto.timingSafeEqual(expected, actual)
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf('=')
      return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))]
    }),
  )
}

export function sessionCookie(token) {
  const secure = String(process.env.COOKIE_SECURE).toLowerCase() === 'true'
  return `sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`
}

export function clearSessionCookie() {
  const secure = String(process.env.COOKIE_SECURE).toLowerCase() === 'true'
  return `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`
}

export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 64
}
