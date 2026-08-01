import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, createDecipheriv, createCipheriv, randomBytes } from 'node:crypto'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'

/**
 * §8.2 / §11.1: secret không bao giờ nằm dạng rõ trên đĩa.
 *
 * Backend được TIÊM VÀO chứ không import `electron` ở đây — nhờ vậy toàn bộ package này chạy
 * được trong vitest thuần Node, và renderer không thể vô tình kéo `electron` vào bundle.
 */
export interface SecureStorageBackend {
  /** Tên hiển thị trong log và trong màn hình chẩn đoán. */
  readonly name: string
  /** true = an toàn cho môi trường thật. DevFileBackend trả false. */
  readonly productionGrade: boolean
  isAvailable(): boolean
  set(key: string, value: string): void
  get(key: string): string | null
  delete(key: string): void
  listKeys(): string[]
}

/** Bề mặt tối thiểu của `electron.safeStorage` mà chúng ta dùng. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Chỉ có trên Linux. Windows/macOS luôn dùng backend của hệ điều hành. */
  getSelectedStorageBackend?(): string
}

/**
 * Trên Linux, khi không tìm thấy keyring nào, Electron rơi xuống backend `basic_text`:
 * `isEncryptionAvailable()` VẪN trả true nhưng dữ liệu chỉ được xáo bằng một khoá cố định,
 * ai cũng giải được. Đây là cái bẫy im lặng — phải coi nó là KHÔNG đạt chuẩn.
 *
 * Windows luôn dùng DPAPI nên không dính; guard này bảo vệ môi trường dev và trường hợp
 * sau này có port sang Linux.
 */
const INSECURE_LINUX_BACKENDS = new Set(['basic_text'])

/**
 * Backend chính cho Windows.
 *
 * `safeStorage` chỉ mã hoá/giải mã, không tự lưu — nên ta ghi blob đã mã hoá xuống một file
 * trong userData. Trên Windows, safeStorage dùng DPAPI gắn với tài khoản người dùng hiện tại,
 * đúng yêu cầu §8.2 "Bảo vệ master key bằng Windows DPAPI theo CurrentUser".
 *
 * CHƯA ĐƯỢC KIỂM CHỨNG BẰNG TAY TRÊN WINDOWS — xem docs/OPEN-QUESTIONS.md C1.
 */
export class SafeStorageBackend implements SecureStorageBackend {
  private readonly file: string
  private cache: Record<string, string> | null = null

  constructor(
    private readonly safeStorage: SafeStorageLike,
    private readonly dir: string,
  ) {
    this.file = join(dir, 'credentials.bin')
  }

  get name(): string {
    const backend = this.selectedBackend()
    return backend === null ? 'electron-safeStorage' : `electron-safeStorage (${backend})`
  }

  /** false khi Electron rơi xuống backend giả — xem INSECURE_LINUX_BACKENDS. */
  get productionGrade(): boolean {
    const backend = this.selectedBackend()
    return backend === null || !INSECURE_LINUX_BACKENDS.has(backend)
  }

  private selectedBackend(): string | null {
    try {
      return this.safeStorage.getSelectedStorageBackend?.() ?? null
    } catch {
      return null
    }
  }

  isAvailable(): boolean {
    try {
      return this.safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private load(): Record<string, string> {
    if (this.cache !== null) return this.cache
    if (!existsSync(this.file)) {
      this.cache = {}
      return this.cache
    }
    try {
      const blob = readFileSync(this.file)
      const json = this.safeStorage.decryptString(blob)
      const parsed: unknown = JSON.parse(json)
      this.cache = isStringRecord(parsed) ? parsed : {}
    } catch (cause) {
      // DPAPI không giải mã được: profile Windows đổi, file bị copy từ máy khác, hoặc hỏng.
      // Fail closed (§3) — KHÔNG tự xoá file, người dùng có thể phục hồi bằng cách đăng nhập
      // đúng tài khoản Windows cũ.
      throw new NexaError(ERROR_CODES.SECRET_UNAVAILABLE, { cause })
    }
    return this.cache
  }

  private persist(data: Record<string, string>): void {
    mkdirSync(this.dir, { recursive: true })
    const blob = this.safeStorage.encryptString(JSON.stringify(data))
    // Ghi qua file tạm rồi rename: mất điện giữa chừng không làm hỏng credential đang có.
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, blob, { mode: 0o600 })
    renameSync(tmp, this.file)
    try {
      chmodSync(this.file, 0o600)
    } catch {
      // NTFS không có POSIX mode; ACL mặc định của userData đã giới hạn theo user.
    }
    this.cache = data
  }

  set(key: string, value: string): void {
    const data = { ...this.load(), [key]: value }
    this.persist(data)
  }

  get(key: string): string | null {
    return this.load()[key] ?? null
  }

  delete(key: string): void {
    const data = { ...this.load() }
    if (!(key in data)) return
    delete data[key]
    this.persist(data)
  }

  listKeys(): string[] {
    return Object.keys(this.load())
  }

  /** Xoá toàn bộ credential (§11.1 "cho phép xóa toàn bộ dữ liệu cục bộ"). */
  purge(): void {
    this.cache = {}
    if (existsSync(this.file)) rmSync(this.file, { force: true })
  }
}

/**
 * Backend cho dev/test trên máy KHÔNG phải Windows.
 *
 * Mã hoá bằng một khoá ngẫu nhiên nằm ngay cạnh dữ liệu — nghĩa là ai đọc được thư mục thì
 * đọc được secret. Nó tồn tại chỉ để chạy được test và dev trên Linux/macOS; `productionGrade`
 * = false và `SecureStorage` sẽ từ chối dùng nó khi `requireProductionGrade` bật.
 */
export class DevFileBackend implements SecureStorageBackend {
  readonly name = 'dev-file (KHÔNG AN TOÀN — chỉ dùng để phát triển)'
  readonly productionGrade = false
  private readonly file: string
  private readonly keyFile: string

  constructor(private readonly dir: string) {
    this.file = join(dir, 'credentials.dev.bin')
    this.keyFile = join(dir, 'credentials.dev.key')
  }

  isAvailable(): boolean {
    return true
  }

  private key(): Buffer {
    mkdirSync(this.dir, { recursive: true })
    if (!existsSync(this.keyFile)) {
      writeFileSync(this.keyFile, randomBytes(32), { mode: 0o600 })
    }
    return readFileSync(this.keyFile)
  }

  private load(): Record<string, string> {
    if (!existsSync(this.file)) return {}
    try {
      const raw = readFileSync(this.file)
      const iv = raw.subarray(0, 12)
      const tag = raw.subarray(12, 28)
      const body = raw.subarray(28)
      const d = createDecipheriv('aes-256-gcm', this.key(), iv)
      d.setAuthTag(tag)
      const json = Buffer.concat([d.update(body), d.final()]).toString('utf8')
      const parsed: unknown = JSON.parse(json)
      return isStringRecord(parsed) ? parsed : {}
    } catch (cause) {
      throw new NexaError(ERROR_CODES.SECRET_UNAVAILABLE, { cause })
    }
  }

  private persist(data: Record<string, string>): void {
    mkdirSync(this.dir, { recursive: true })
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.key(), iv)
    const body = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()])
    writeFileSync(this.file, Buffer.concat([iv, c.getAuthTag(), body]), { mode: 0o600 })
  }

  set(key: string, value: string): void {
    this.persist({ ...this.load(), [key]: value })
  }
  get(key: string): string | null {
    return this.load()[key] ?? null
  }
  delete(key: string): void {
    const d = { ...this.load() }
    delete d[key]
    this.persist(d)
  }
  listKeys(): string[] {
    return Object.keys(this.load())
  }
  purge(): void {
    rmSync(this.file, { force: true })
    rmSync(this.keyFile, { force: true })
  }
}

/** Backend trong RAM — cho unit test, không chạm đĩa. */
export class MemoryBackend implements SecureStorageBackend {
  readonly name = 'memory'
  readonly productionGrade = false
  private data = new Map<string, string>()
  isAvailable(): boolean {
    return true
  }
  set(key: string, value: string): void {
    this.data.set(key, value)
  }
  get(key: string): string | null {
    return this.data.get(key) ?? null
  }
  delete(key: string): void {
    this.data.delete(key)
  }
  listKeys(): string[] {
    return [...this.data.keys()]
  }
  purge(): void {
    this.data.clear()
  }
}

/**
 * Quy ước khoá lưu trữ. Trùng với `credentialRef` trong Phụ lục A (`secure://litellm/default`)
 * để cấu hình xuất ra và secure storage nói cùng một ngôn ngữ.
 */
export function credentialRef(kind: 'litellm' | 'jira' | 'confluence', name = 'default'): string {
  return `secure://${kind}/${name}`
}

export const MASTER_KEY_REF = 'secure://nexa/master-key.v1'

/** Hash không đảo ngược của một ref — dùng khi cần log "đã lưu credential nào" mà không lộ gì. */
export function refFingerprint(ref: string): string {
  return createHash('sha256').update(ref).digest('hex').slice(0, 12)
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'string')
  )
}
