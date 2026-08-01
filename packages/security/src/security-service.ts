import { ERROR_CODES, NexaError, type ConnectionType, type ErrorCode } from '@nexa/shared-types'
import { SECURITY_EVENTS, type Logger, globalRedactor, type Redactor } from '@nexa/observability'
import {
  MASTER_KEY_REF,
  credentialRef,
  refFingerprint,
  type SecureStorageBackend,
} from './secure-storage.js'
import {
  assertMasterKey,
  decryptField,
  encryptField,
  generateMasterKey,
  wipe,
  type MasterKey,
} from './crypto.js'

export interface SecurityServiceOptions {
  readonly backend: SecureStorageBackend
  readonly logger: Logger
  readonly redactor?: Redactor
  /**
   * Bật ở bản build phát hành: từ chối khởi động nếu backend không phải loại an toàn
   * (§3 Fail closed). Dev/test để false.
   */
  readonly requireProductionGrade?: boolean
}

/**
 * Mã lỗi khi thiếu credential, theo từng loại kết nối.
 *
 * Bảng tra thay vì chuỗi if: thêm provider mới thì TypeScript bắt buộc điền mã cho nó, không
 * thể lặng lẽ rơi vào nhánh `else` sai.
 */
const MISSING_CREDENTIAL_CODE: Readonly<Record<ConnectionType, ErrorCode>> = {
  litellm: ERROR_CODES.LITELLM_CONFIG_REQUIRED,
  openai: ERROR_CODES.OPENAI_CONFIG_REQUIRED,
  jira: ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED,
  confluence: ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED,
}

/**
 * Security Service (§5.2).
 *
 * Trách nhiệm: master key, lưu/đọc/xoá LiteLLM key và PAT, mã hoá trường cho local store,
 * và đăng ký mọi secret đã giải mã vào Redactor để không lọt vào log.
 *
 * CHỈ chạy trong Electron main process. Renderer không có đường nào chạm tới class này (§11.1).
 */
export class SecurityService {
  private readonly backend: SecureStorageBackend
  private readonly log: Logger
  private readonly redactor: Redactor
  private masterKey: MasterKey | null = null

  constructor(opts: SecurityServiceOptions) {
    this.backend = opts.backend
    this.log = opts.logger.child({ module: 'security' })
    this.redactor = opts.redactor ?? globalRedactor

    if (opts.requireProductionGrade === true && !this.backend.productionGrade) {
      throw new NexaError(ERROR_CODES.SECRET_UNAVAILABLE, {
        safeDetail: `secure storage backend "${this.backend.name}" is not production grade`,
      })
    }
    if (!this.backend.isAvailable()) {
      this.log.security(SECURITY_EVENTS.masterKeyUnavailable, { backend: this.backend.name }, 'error')
      throw new NexaError(ERROR_CODES.SECRET_UNAVAILABLE, {
        safeDetail: `secure storage backend "${this.backend.name}" unavailable`,
      })
    }
  }

  get backendName(): string {
    return this.backend.name
  }

  get isProductionGrade(): boolean {
    return this.backend.productionGrade
  }

  /**
   * Lấy master key, tạo mới ở lần chạy đầu tiên (§8.2 "Tạo master key ngẫu nhiên cho mỗi
   * profile người dùng").
   *
   * Không derive từ username/password Windows — §8.2 cấm rõ điều đó.
   */
  getMasterKey(): MasterKey {
    if (this.masterKey !== null) return this.masterKey

    const existing = this.backend.get(MASTER_KEY_REF)
    if (existing !== null) {
      this.masterKey = assertMasterKey(Buffer.from(existing, 'base64'))
      return this.masterKey
    }

    const fresh = generateMasterKey()
    this.backend.set(MASTER_KEY_REF, fresh.toString('base64'))
    this.masterKey = fresh
    this.log.security(SECURITY_EVENTS.masterKeyCreated, { backend: this.backend.name }, 'warn')
    return fresh
  }

  /** Mã hoá một trường cho local store. `context` dạng `table.column`. */
  encrypt(context: string, plaintext: string): string {
    return encryptField(this.getMasterKey(), context, plaintext)
  }

  decrypt(context: string, ciphertext: string): string {
    return decryptField(this.getMasterKey(), context, ciphertext)
  }

  // ── Credential của người dùng ──────────────────────────────────────────

  /**
   * Lưu API key/PAT.
   *
   * Giá trị được đăng ký vào Redactor ngay lập tức: kể từ giây phút này, nếu nó lọt vào bất kỳ
   * log nào thì đã bị thay bằng [REDACTED] (§11.1).
   */
  saveCredential(type: ConnectionType, secret: string): void {
    const trimmed = secret.trim()
    if (trimmed.length === 0) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, { safeDetail: 'empty credential' })
    }
    const ref = credentialRef(type)
    this.backend.set(ref, trimmed)
    this.redactor.registerSecret(trimmed)
    this.log.security(SECURITY_EVENTS.credentialSaved, {
      connectionType: type,
      ref: refFingerprint(ref),
    })
  }

  hasCredential(type: ConnectionType): boolean {
    try {
      return this.backend.get(credentialRef(type)) !== null
    } catch {
      return false
    }
  }

  /**
   * Đọc credential để tạo kết nối.
   *
   * KHÔNG bao giờ trả giá trị này ra khỏi main process (§4.2: "renderer không nhận username/PAT").
   * Nơi gọi phải dùng ngay rồi bỏ tham chiếu.
   */
  readCredential(type: ConnectionType): string {
    let value: string | null
    try {
      value = this.backend.get(credentialRef(type))
    } catch (cause) {
      this.log.security(
        SECURITY_EVENTS.credentialReadFailed,
        { connectionType: type },
        'error',
      )
      throw NexaError.wrap(cause, ERROR_CODES.SECRET_UNAVAILABLE)
    }
    if (value === null) {
      throw new NexaError(MISSING_CREDENTIAL_CODE[type], {
        safeDetail: `no credential stored for ${type}`,
      })
    }
    this.redactor.registerSecret(value)
    return value
  }

  /**
   * §8.2: "Khi xóa profile hoặc xóa kết nối, phải xóa cả credential tương ứng khỏi secure storage."
   */
  deleteCredential(type: ConnectionType): void {
    const ref = credentialRef(type)
    let previous: string | null = null
    try {
      previous = this.backend.get(ref)
    } catch {
      // Không đọc được thì vẫn cứ xoá.
    }
    this.backend.delete(ref)
    if (previous !== null) this.redactor.unregisterSecret(previous)
    this.log.security(SECURITY_EVENTS.credentialDeleted, {
      connectionType: type,
      ref: refFingerprint(ref),
    })
  }

  /**
   * Nạp mọi credential đang có vào Redactor lúc khởi động.
   *
   * Cần thiết vì redaction dựa trên "biết giá trị nào là secret" — nếu chờ tới lần đọc đầu tiên
   * thì một secret vô tình bị log trước đó sẽ lọt.
   */
  primeRedactor(): void {
    for (const type of ['litellm', 'openai', 'jira', 'confluence'] as const) {
      try {
        const v = this.backend.get(credentialRef(type))
        if (v !== null) this.redactor.registerSecret(v)
      } catch {
        // Backend hỏng — getMasterKey() sẽ báo lỗi rõ ràng hơn ở luồng chính.
      }
    }
  }

  /**
   * Xoá sạch: master key + toàn bộ credential (§11.1).
   * Sau lệnh này, dữ liệu đã mã hoá trong SQLite thành rác không thể phục hồi — đúng ý đồ.
   */
  purgeAllSecrets(): void {
    for (const key of this.backend.listKeys()) {
      this.backend.delete(key)
    }
    // Ghi đè buffer khoá trước khi bỏ tham chiếu. V8 không đảm bảo bộ nhớ được trả về ngay,
    // nhưng nó rút ngắn khoảng thời gian khoá còn nằm trong heap — rẻ và không có lý do bỏ qua.
    if (this.masterKey !== null) wipe(this.masterKey)
    this.masterKey = null
    this.redactor.clearSecrets()
    this.log.security(SECURITY_EVENTS.dataPurged, { scope: 'secrets' }, 'warn')
  }
}
