import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'

/**
 * AES-256-GCM mã hoá từng trường (§8.2).
 *
 * Chọn per-field thay vì SQLCipher — xem docs/OPEN-QUESTIONS.md A2. Điểm mấu chốt của §8.2:
 * "Mỗi bản ghi hoặc nhóm bản ghi cần nonce/IV riêng; lưu authentication tag."
 *
 * Định dạng trên đĩa (base64 của):
 *   [0]      version (1 byte)
 *   [1..12]  IV 96-bit ngẫu nhiên
 *   [13..28] GCM auth tag 128-bit
 *   [29..]   ciphertext
 *
 * AAD = `${version}:${context}` với `context` là "bảng.cột" — buộc ciphertext gắn với đúng chỗ
 * nó thuộc về, nên không thể đem ciphertext của `messages.content` dán sang `settings.value`.
 */

const VERSION = 1
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const HEADER_LEN = 1 + IV_LEN + TAG_LEN

export type MasterKey = Buffer & { readonly __brand: 'MasterKey' }

export function assertMasterKey(buf: Buffer): MasterKey {
  if (buf.length !== KEY_LEN) {
    throw new NexaError(ERROR_CODES.SECRET_UNAVAILABLE, {
      safeDetail: `master key length ${buf.length}, expected ${KEY_LEN}`,
    })
  }
  return buf as MasterKey
}

export function generateMasterKey(): MasterKey {
  return randomBytes(KEY_LEN) as MasterKey
}

/**
 * `context` phải ổn định theo thời gian — đổi nó là làm hỏng toàn bộ dữ liệu cũ.
 * Dùng đúng dạng `table.column`.
 */
export function encryptField(key: MasterKey, context: string, plaintext: string): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${VERSION}:${context}`, 'utf8'))
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, body]).toString('base64')
}

export function decryptField(key: MasterKey, context: string, encoded: string): string {
  let raw: Buffer
  try {
    raw = Buffer.from(encoded, 'base64')
  } catch {
    throw new NexaError(ERROR_CODES.LOCAL_DB_LOCKED, { safeDetail: 'ciphertext not base64' })
  }
  if (raw.length < HEADER_LEN) {
    throw new NexaError(ERROR_CODES.LOCAL_DB_LOCKED, { safeDetail: 'ciphertext too short' })
  }
  const version = raw[0]
  if (version !== VERSION) {
    throw new NexaError(ERROR_CODES.LOCAL_DB_LOCKED, {
      safeDetail: `unsupported ciphertext version ${String(version)}`,
    })
  }

  const iv = raw.subarray(1, 1 + IV_LEN)
  const tag = raw.subarray(1 + IV_LEN, HEADER_LEN)
  const body = raw.subarray(HEADER_LEN)

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(`${VERSION}:${context}`, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    // Sai khoá, sai context, hoặc dữ liệu bị sửa. Không phân biệt được — và cũng không nên,
    // vì phân biệt được là một oracle.
    throw new NexaError(ERROR_CODES.LOCAL_DB_LOCKED, {
      safeDetail: 'authentication failed while decrypting a local field',
    })
  }
}

/** So sánh chuỗi bí mật không lộ thời gian. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Ghi đè buffer chứa khoá trước khi bỏ tham chiếu. Không đảm bảo tuyệt đối trong V8, nhưng rẻ. */
export function wipe(buf: Buffer): void {
  buf.fill(0)
}
