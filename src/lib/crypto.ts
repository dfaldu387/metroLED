import crypto from 'node:crypto'
import { env } from './env'

/**
 * Credential encryption for integration tokens stored in the database.
 *
 * AES-256-GCM with a random 12-byte IV per record. The envelope is stored as
 * JSON so the key version can be rotated later without a schema change.
 *
 * Integration credentials are NEVER returned by an API route or rendered in
 * the UI. They are decrypted inside the sync service only.
 */

export interface SealedEnvelope {
  v: 1
  alg: 'aes-256-gcm'
  iv: string
  tag: string
  data: string
}

function key(): Buffer {
  const raw = env().CREDENTIAL_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is not set. Integration credentials cannot be stored or read without it.',
    )
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${buf.length}). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    )
  }
  return buf
}

export function credentialEncryptionConfigured(): boolean {
  try {
    key()
    return true
  } catch {
    return false
  }
}

export function seal(plain: unknown): SealedEnvelope {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const json = Buffer.from(JSON.stringify(plain), 'utf8')
  const data = Buffer.concat([cipher.update(json), cipher.final()])
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

export function open<T>(envelope: unknown): T {
  const e = envelope as SealedEnvelope
  if (!e || e.v !== 1 || e.alg !== 'aes-256-gcm' || !e.iv || !e.tag || !e.data) {
    throw new Error('Stored credential envelope is malformed or was written by a different version.')
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(e.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(e.tag, 'base64'))
  const plain = Buffer.concat([decipher.update(Buffer.from(e.data, 'base64')), decipher.final()])
  return JSON.parse(plain.toString('utf8')) as T
}

/** Opaque session / API token. 32 bytes of CSPRNG output, hex encoded. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex')
}

/** Only the hash of a session token is stored, so the table is not replayable. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Constant-time comparison for secrets supplied in a request. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/** HMAC-SHA256, base64 - the shape Shopify uses for webhook signatures. */
export function hmacBase64(secret: string, body: string | Buffer): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64')
}
