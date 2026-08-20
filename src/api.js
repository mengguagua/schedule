export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

function pemToArrayBuffer(pem) {
  const base64 = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
  return btoa(binary)
}

export async function encryptPassword(password) {
  const response = await fetch('/api/auth/encryption-key', {
    credentials: 'same-origin',
    cache: 'no-store',
  })
  const keyData = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(keyData.error || '无法获取密码加密密钥', response.status, keyData)
  if (keyData.algorithm !== 'RSA-OAEP-256' || !keyData.keyId || !keyData.publicKey) {
    throw new ApiError('服务器返回的密码加密密钥无效', 500, keyData)
  }

  const publicKey = await crypto.subtle.importKey(
    'spki',
    pemToArrayBuffer(keyData.publicKey),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    new TextEncoder().encode(password),
  )

  return { keyId: keyData.keyId, ciphertext: arrayBufferToBase64(ciphertext) }
}

export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
    ...options,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(data.error || '请求失败', response.status, data)
  return data
}
