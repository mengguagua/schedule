import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { decryptPassword, getPasswordEncryptionKey } from '../server/security.js'

test('password transport encrypts with the published key and decrypts only on the server', () => {
  const key = getPasswordEncryptionKey()
  const plaintext = '护士密码-123456-🔒'
  const ciphertext = crypto.publicEncrypt({
    key: key.publicKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, Buffer.from(plaintext)).toString('base64')

  assert.notEqual(ciphertext, plaintext)
  assert.equal(decryptPassword({ keyId: key.keyId, ciphertext }), plaintext)
})

test('password transport rejects an unknown key and plaintext payloads', () => {
  assert.throws(() => decryptPassword({ keyId: 'old-key', ciphertext: 'not-valid' }))
  assert.throws(() => decryptPassword('123456'))
})
