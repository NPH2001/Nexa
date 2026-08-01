import {
  ERROR_CODES,
  NexaError,
  isLlmConnection,
  type Connection,
  type ConnectionSaveInput,
  type ConnectionTestResult,
  type ConnectionType,
  type LlmProvider,
  type OrgPolicy,
} from '@nexa/shared-types'
import { AUDIT_EVENTS, type AuditRepository, type ConfigRepository } from '@nexa/local-store'
import { SECURITY_EVENTS, newRequestId, type Logger } from '@nexa/observability'
import { credentialRef, validateBaseUrl, type SecurityService } from '@nexa/security'
import { OpenAiCompatibleClient } from '@nexa/llm-client'

export interface ConnectionServiceOptions {
  readonly repo: ConfigRepository
  readonly audit: AuditRepository
  readonly security: SecurityService
  readonly profileId: string
  readonly policy: OrgPolicy
  readonly logger: Logger
  /** Chỉ bật trong integration test với mock server HTTP. Bản phát hành để false. */
  readonly allowInsecureLoopback?: boolean
  /** Kiểm tra kết nối Atlassian — cần MCP nên host tiêm vào để tránh phụ thuộc vòng. */
  readonly testAtlassian?: (type: 'jira' | 'confluence') => Promise<ConnectionTestResult>
}

/**
 * Quản lý kết nối và credential (EPIC-02).
 *
 * Đây là nơi duy nhất trong hệ thống nhận secret từ renderer đi vào. Ba việc bắt buộc theo
 * đúng thứ tự này:
 *   1. validate URL trước (§11.2) — không được lưu PAT gắn với một URL chưa kiểm tra
 *   2. ghi metadata + credential_ref vào DB
 *   3. ghi secret vào secure storage
 *
 * Nếu bước 1 hỏng thì chưa có gì được lưu. Nếu bước 3 hỏng thì bước 2 bị rollback.
 */
/** Mã lỗi khi chưa có kết nối. Bảng tra để thêm provider mới là lỗi biên dịch nếu quên điền. */
const MISSING_CONNECTION_CODE: Readonly<Record<ConnectionType, string>> = {
  litellm: ERROR_CODES.LITELLM_CONFIG_REQUIRED,
  openai: ERROR_CODES.OPENAI_CONFIG_REQUIRED,
  jira: ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED,
  confluence: ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED,
}

export class ConnectionService {
  private readonly opts: ConnectionServiceOptions
  private readonly log: Logger

  constructor(opts: ConnectionServiceOptions) {
    this.opts = opts
    this.log = opts.logger.child({ module: 'connection-service' })
  }

  list(): Connection[] {
    return this.opts.repo.listConnections(this.opts.profileId)
  }

  get(type: ConnectionType): Connection | null {
    return this.opts.repo.findConnection(this.opts.profileId, type)
  }

  /**
   * Lưu kết nối.
   *
   * `input.secret` bỏ trống nghĩa là "giữ nguyên credential đang có" — cần thiết để người dùng
   * sửa URL mà không phải gõ lại PAT (và không phải nhìn thấy PAT cũ, thứ ta không bao giờ
   * gửi ra renderer).
   */
  save(input: ConnectionSaveInput): Connection {
    const baseUrl = this.validateUrl(input.baseUrl, input.type)

    // Chỉ Atlassian cần username; provider LLM xác thực bằng API key.
    if (!isLlmConnection(input.type) && (input.username === null || input.username.trim() === '')) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'Atlassian connections require a username',
      })
    }

    const hasNewSecret = input.secret !== undefined && input.secret.trim() !== ''
    const existing = this.get(input.type)
    if (!hasNewSecret && existing?.hasCredential !== true) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'a credential is required the first time a connection is saved',
      })
    }

    const connection = this.opts.repo.upsertConnection(this.opts.profileId, {
      type: input.type,
      baseUrl,
      username: isLlmConnection(input.type) ? null : (input.username?.trim() ?? null),
      enabled: input.enabled,
      credentialRef: credentialRef(input.type),
    })

    if (hasNewSecret) {
      try {
        this.opts.security.saveCredential(input.type, input.secret as string)
      } catch (error) {
        // Secure storage hỏng: gỡ metadata vừa ghi để không để lại kết nối "có credential"
        // mà thực ra không đọc được.
        if (existing === null) this.opts.repo.deleteConnection(this.opts.profileId, input.type)
        throw error
      }
    }

    this.opts.audit.record({
      profileId: this.opts.profileId,
      eventType: AUDIT_EVENTS.connectionSaved,
      status: 'ok',
    })
    return connection
  }

  /**
   * Xoá kết nối VÀ credential tương ứng (§8.2).
   *
   * Với provider LLM, xoá luôn mọi model của nó: model trỏ tới provider không còn cấu hình sẽ
   * làm lần chat sau báo lỗi mà người dùng không hiểu vì sao.
   *
   * Xoá secret trước: nếu tiến trình chết giữa chừng, để lại metadata không có secret thì chỉ
   * bất tiện; để lại secret không có metadata thì là secret mồ côi không ai xoá được nữa.
   */
  delete(type: ConnectionType): void {
    this.opts.security.deleteCredential(type)
    if (isLlmConnection(type)) {
      this.opts.repo.removeModelsByProvider(this.opts.profileId, type)
    }
    this.opts.repo.deleteConnection(this.opts.profileId, type)
    this.opts.audit.record({
      profileId: this.opts.profileId,
      eventType: AUDIT_EVENTS.connectionDeleted,
      status: 'ok',
    })
    this.log.security(SECURITY_EVENTS.credentialDeleted, { connectionType: type })
  }

  /** §9.1 `connection.test`. Không bao giờ ném — trả kết quả để UI hiển thị trạng thái. */
  async test(type: ConnectionType): Promise<ConnectionTestResult> {
    const connection = this.get(type)
    if (connection === null) {
      return this.record(type, {
        ok: false,
        checkedAt: new Date().toISOString(),
        errorCode: MISSING_CONNECTION_CODE[type],
      })
    }

    try {
      const result = isLlmConnection(type)
        ? await this.testLlmProvider(type)
        : await this.testAtlassian(type)
      return this.record(type, result)
    } catch (error) {
      const nexa = NexaError.wrap(error)
      this.log.security(SECURITY_EVENTS.connectionTestFailed, {
        connectionType: type,
        errorCode: nexa.code,
      })
      return this.record(type, {
        ok: false,
        checkedAt: new Date().toISOString(),
        errorCode: nexa.code,
      })
    }
  }

  private async testLlmProvider(provider: LlmProvider): Promise<ConnectionTestResult> {
    // Dùng một model CỦA CHÍNH provider này làm mẫu thử, không phải model mặc định chung —
    // nếu không, thử kết nối OpenAI bằng một model id của LiteLLM sẽ báo lỗi sai nguyên nhân.
    const probe = this.opts.repo.listModelsByProvider(this.opts.profileId, provider)[0]

    const outcome = await this.buildLlmClient(provider, 20_000).testConnection(
      { requestId: newRequestId() },
      probe?.modelId,
    )
    return { ok: true, checkedAt: new Date().toISOString(), detail: outcome.detail }
  }

  private async testAtlassian(type: 'jira' | 'confluence'): Promise<ConnectionTestResult> {
    const tester = this.opts.testAtlassian
    if (tester === undefined) {
      throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
        safeDetail: 'no Atlassian tester wired',
      })
    }
    return tester(type)
  }

  /**
   * Dựng client cho một provider cụ thể.
   *
   * Secret được đọc trong closure `getApiKey`, không phải lúc dựng client — §6 yêu cầu
   * "Secret chỉ được giải mã ngay trước khi tạo kết nối".
   */
  buildLlmClient(provider: LlmProvider, timeoutMs: number): OpenAiCompatibleClient {
    const connection = this.get(provider)
    if (connection === null || !connection.enabled) {
      throw new NexaError(
        provider === 'openai'
          ? ERROR_CODES.OPENAI_CONFIG_REQUIRED
          : ERROR_CODES.LITELLM_CONFIG_REQUIRED,
      )
    }
    return new OpenAiCompatibleClient({
      baseUrl: connection.baseUrl,
      provider,
      getApiKey: () => this.opts.security.readCredential(provider),
      logger: this.opts.logger,
      timeoutMs,
    })
  }

  private validateUrl(raw: string, type: ConnectionType): string {
    try {
      return validateBaseUrl(raw, {
        allowedDomains: this.opts.policy.allowedDomains,
        ...(this.opts.allowInsecureLoopback === true ? { allowInsecureLoopback: true } : {}),
      })
    } catch (error) {
      const nexa = NexaError.wrap(error)
      this.log.security(
        nexa.code === ERROR_CODES.DOMAIN_NOT_ALLOWED
          ? SECURITY_EVENTS.domainNotAllowed
          : SECURITY_EVENTS.urlRejected,
        { connectionType: type, errorCode: nexa.code },
      )
      throw nexa
    }
  }

  private record(type: ConnectionType, result: ConnectionTestResult): ConnectionTestResult {
    this.opts.repo.recordConnectionTest(this.opts.profileId, type, result)
    this.opts.audit.record({
      profileId: this.opts.profileId,
      eventType: AUDIT_EVENTS.connectionTested,
      status: result.ok ? 'ok' : 'error',
      ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
    })
    return result
  }
}
