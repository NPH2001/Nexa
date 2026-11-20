import {
  ERROR_CODES,
  NexaError,
  isWriteRisk,
  type ErrorCode,
  type FeatureFlags,
  type McpStatusEvent,
  type McpTargetSystem,
  type McpToolCallOutcome,
  type McpToolSource,
  type ToolDefinition,
  type ToolResultSummary,
} from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'
import {
  McpHttpClient,
  contentToText,
  resolveServerToolName,
  type McpToolDescriptor,
  type McpToolResult,
} from '@nexa/mcp-client'

/** Bề mặt transport mà server cần — trùng với `McpHttpClient`, tách ra để test tiêm client giả. */
export interface RemoteMcpTransport {
  readonly isReady: boolean
  start(): Promise<void>
  stop(): Promise<void>
  listTools(): Promise<McpToolDescriptor[]>
  callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<McpToolResult>
}

/** Gọi một tool THEO TÊN TRÊN SERVER lúc khởi chạy (trước khi registry được mở cho model). */
export type IdentifyCall = (mcpToolName: string, args: Record<string, unknown>) => Promise<string>

export interface RemoteMcpServerOptions {
  readonly system: Extract<McpTargetSystem, 'redmine' | 'xwiki'>
  /** Tên hiển thị trong lỗi và log, ví dụ "Redmine". */
  readonly label: string
  /** Endpoint MCP — đã qua `validateBaseUrl` (HTTPS + allowlist domain) trước khi tới đây. */
  readonly url: string
  /**
   * Header cho mỗi request, dựng lại từ secure storage NGAY trước khi gửi (ADR-0008 biện pháp 3).
   * Callback chứ không phải object: không có field nào giữ secret.
   */
  readonly headers: () => Record<string, string>
  readonly registry: readonly ToolDefinition[]
  readonly features: () => FeatureFlags
  readonly logger: Logger
  /** URL web của hệ thống đích — dòng "hệ thống đích" trong preview. */
  readonly targetSystemUrl: string
  readonly toolTimeoutMs?: number
  /** Phân loại text lỗi của tool thành mã Nexa (mỗi hệ thống có câu lỗi riêng). */
  readonly classifyError: (rawText: string, toolName: string) => NexaError
  /**
   * Mã lỗi khi CHÍNH endpoint từ chối xác thực (HTTP 401/403 ở bước initialize).
   * Redmine: endpoint là gateway ⇒ `MCP_GATEWAY_AUTH_FAILED`. XWiki: `XWIKI_AUTH_FAILED`.
   */
  readonly transportAuthFailedCode: ErrorCode
  /**
   * Chạy ngay sau `tools/list`: xác nhận credential thật sự dùng được và lấy tài khoản hành động
   * (Redmine: `get_current_user`). Ném ⇒ khởi chạy thất bại với đúng mã đó.
   */
  readonly identify?: (call: IdentifyCall) => Promise<string | undefined>
  /** Tài khoản hiển thị trong preview khi `identify` không trả về gì. */
  readonly actingAccountFallback: string
  readonly onStatus?: (event: McpStatusEvent) => void
  /**
   * Gọi đúng URL đã cấu hình, không tự thêm "/" cuối (xem `HttpClientOptions.exactUrl`).
   * XWiki cần `true`; gateway (Redmine) giữ mặc định.
   */
  readonly exactUrl?: boolean
  /** CHỈ test. services.ts không bao giờ truyền. */
  readonly allowInsecureLoopback?: boolean
  /** CHỈ test: thay transport HTTP bằng client giả. */
  readonly createTransport?: () => RemoteMcpTransport
}

const MAX_LOGGED_ERROR_CHARS = 300

/**
 * Một MCP server HTTP remote với danh mục tool viết tay (ADR 0010).
 *
 * Cùng hợp đồng với `AtlassianMcpManager` — registry ∧ feature flag ∧ server công bố, cổng
 * `resolveCallable` duy nhất, không kiểm tra approval ở đây — nhưng không có nhánh stdio và chỉ
 * phục vụ đúng một hệ thống. Atlassian giữ class riêng vì nó gánh hai hệ thống trên một server và
 * còn transport stdio.
 */
export class RemoteMcpServer implements McpToolSource {
  private client: RemoteMcpTransport | null = null
  /** `definition.mcpToolName` → tên tool THẬT trên server (gateway có thể thêm tiền tố). */
  private resolvedToolNames = new Map<string, string>()
  private state: 'stopped' | 'starting' | 'ready' | 'error' = 'stopped'
  private lastErrorCode: ErrorCode | undefined
  private account: string | undefined
  private startInFlight: Promise<void> | null = null
  private activeToolCallCount = 0
  private restarting = false
  private readonly opts: RemoteMcpServerOptions
  private readonly log: Logger

  constructor(opts: RemoteMcpServerOptions) {
    this.opts = opts
    this.log = opts.logger.child({ module: `${opts.system}-mcp` })
  }

  get system(): RemoteMcpServerOptions['system'] {
    return this.opts.system
  }

  get label(): string {
    return this.opts.label
  }

  get isReady(): boolean {
    return this.state === 'ready' && this.client?.isReady === true
  }

  get isLifecycleBusy(): boolean {
    return this.restarting || this.startInFlight !== null || this.activeToolCallCount > 0
  }

  /** Mã lỗi lần khởi chạy gần nhất — router trả mã này khi model gọi tool lúc server đang hỏng. */
  get unavailableCode(): ErrorCode | undefined {
    return this.state === 'ready' ? undefined : this.lastErrorCode
  }

  get statusSnapshot(): McpStatusEvent {
    return {
      system: this.opts.system,
      state: this.state,
      ...(this.lastErrorCode !== undefined ? { errorCode: this.lastErrorCode } : {}),
      toolCount: this.state === 'ready' ? this.availableTools().length : 0,
    }
  }

  async start(): Promise<void> {
    if (this.isReady) return
    if (this.startInFlight !== null) return this.startInFlight
    this.startInFlight = this.doStart().finally(() => {
      this.startInFlight = null
    })
    return this.startInFlight
  }

  private async doStart(): Promise<void> {
    this.setState('starting')
    const client = this.buildTransport()
    try {
      try {
        await client.start()
      } catch (error) {
        throw this.mapTransportError(error)
      }
      const tools = await client.listTools()
      const serverTools = new Map(tools.map((t) => [t.name, t]))
      const resolved = new Map<string, string>()
      for (const d of this.opts.registry) {
        const real = resolveServerToolName(d.mcpToolName, serverTools)
        if (real !== null) resolved.set(d.mcpToolName, real)
      }

      const account =
        this.opts.identify === undefined
          ? undefined
          : await this.opts.identify(async (mcpToolName, args) => {
              const real = resolveServerToolName(mcpToolName, serverTools)
              if (real === null) {
                throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
                  safeDetail: `${this.opts.label} does not expose "${mcpToolName}"`,
                })
              }
              const result = await client.callTool(real, args, this.opts.toolTimeoutMs)
              const text = contentToText(result)
              if (result.isError) throw this.opts.classifyError(text, mcpToolName)
              return text
            })

      this.client = client
      this.resolvedToolNames = resolved
      this.account = account
      this.setState('ready')

      const missing = this.opts.registry
        .filter((d) => !resolved.has(d.mcpToolName))
        .map((d) => d.name)
      if (missing.length > 0) {
        // Tên tool không phải secret — ghi để biết server đổi danh mục thay vì đoán.
        this.log.warn('mcp-tools-missing-on-server', {
          system: this.opts.system,
          missingCount: missing.length,
          missing,
          serverToolCount: tools.length,
        })
      }
    } catch (error) {
      await client.stop().catch(() => undefined)
      this.client = null
      const nexa = NexaError.wrap(error, ERROR_CODES.MCP_SERVER_UNAVAILABLE)
      this.setState('error', nexa.code)
      throw nexa
    }
  }

  private buildTransport(): RemoteMcpTransport {
    if (this.opts.createTransport !== undefined) return this.opts.createTransport()
    return new McpHttpClient({
      url: this.opts.url,
      headers: this.opts.headers,
      logger: this.opts.logger,
      ...(this.opts.toolTimeoutMs !== undefined ? { requestTimeoutMs: this.opts.toolTimeoutMs } : {}),
      ...(this.opts.allowInsecureLoopback === true ? { allowInsecureLoopback: true } : {}),
      ...(this.opts.exactUrl === true ? { exactUrl: true } : {}),
    })
  }

  /**
   * `McpHttpClient` gộp mọi HTTP lỗi vào `MCP_SERVER_UNAVAILABLE` kèm "http <status>" trong
   * `safeDetail`. 401/403 ở bước initialize là credential của chính endpoint bị từ chối — báo đúng
   * mã đó để UI chỉ người dùng tới đúng ô cần sửa, thay vì khuyên "kiểm tra mạng".
   */
  private mapTransportError(error: unknown): NexaError {
    const nexa = NexaError.wrap(error, ERROR_CODES.MCP_SERVER_UNAVAILABLE)
    if (/\bhttp 40[13]\b/.test(nexa.safeDetail ?? '')) {
      return new NexaError(this.opts.transportAuthFailedCode, {
        safeDetail: `${this.opts.label} endpoint rejected the credential`,
      })
    }
    return nexa
  }

  async stop(): Promise<void> {
    const client = this.client
    this.client = null
    this.resolvedToolNames = new Map()
    this.account = undefined
    this.setState('stopped')
    await client?.stop()
  }

  async restart(): Promise<void> {
    if (this.isLifecycleBusy) {
      throw new NexaError(ERROR_CODES.OPERATION_ALREADY_RUNNING, {
        safeDetail: `cannot restart ${this.opts.label} while a tool call or restart is active`,
      })
    }
    this.restarting = true
    try {
      await this.stop()
      await this.start()
    } finally {
      this.restarting = false
    }
  }

  availableTools(): ToolDefinition[] {
    const features = this.opts.features()
    return this.opts.registry.filter(
      (d) => features[d.requiredFeature] === true && this.resolvedToolNames.has(d.mcpToolName),
    )
  }

  findTool(name: string): ToolDefinition | null {
    return this.opts.registry.find((d) => d.name === name) ?? null
  }

  resolveCallable(name: string): ToolDefinition {
    const definition = this.findTool(name)
    if (definition === null) {
      throw new NexaError(ERROR_CODES.TOOL_NOT_ALLOWED, {
        safeDetail: `"${name}" is not in the Nexa tool registry`,
      })
    }
    if (this.opts.features()[definition.requiredFeature] !== true) {
      throw new NexaError(ERROR_CODES.TOOL_NOT_ALLOWED, {
        safeDetail: `feature "${definition.requiredFeature}" is disabled`,
      })
    }
    if (!this.resolvedToolNames.has(definition.mcpToolName)) {
      throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
        safeDetail: `${this.opts.label} does not expose "${definition.mcpToolName}"`,
      })
    }
    return definition
  }

  validateInput(definition: ToolDefinition, rawArgs: unknown): Record<string, unknown> {
    const parsed = definition.inputSchema.safeParse(rawArgs)
    if (!parsed.success) {
      // Chỉ giữ tên trường sai, không giữ giá trị (§11.3).
      const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: `invalid arguments for ${definition.name}: ${fields}`,
      })
    }
    return parsed.data as Record<string, unknown>
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallOutcome> {
    if (this.restarting) {
      throw new NexaError(ERROR_CODES.OPERATION_ALREADY_RUNNING, {
        safeDetail: `${this.opts.label} restart is active`,
      })
    }
    const definition = this.resolveCallable(name)
    const client = this.client
    const realToolName = this.resolvedToolNames.get(definition.mcpToolName)
    if (client === null || !client.isReady || realToolName === undefined) {
      throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
        safeDetail: `${this.opts.label} client not running`,
      })
    }

    this.activeToolCallCount += 1
    try {
      const started = Date.now()
      const result = await client.callTool(realToolName, args, this.opts.toolTimeoutMs)
      const rawText = contentToText(result)
      this.log.tool('mcp-tool-called', {
        toolName: definition.name,
        phase: result.isError ? 'failed' : 'done',
        riskLevel: definition.riskLevel,
        durationMs: Date.now() - started,
        resultChars: rawText.length,
      })
      if (result.isError) {
        this.log.warn('mcp-tool-error-detail', {
          toolName: definition.name,
          serverToolName: realToolName,
          errorText: rawText.slice(0, MAX_LOGGED_ERROR_CHARS),
          errorChars: rawText.length,
        })
        throw this.opts.classifyError(rawText, definition.name)
      }
      const summary =
        definition.summarizeResult?.(rawText) ??
        ({ forModel: rawText, forUser: 'Đã thực hiện' } satisfies ToolResultSummary)
      return { summary, rawText }
    } finally {
      this.activeToolCallCount -= 1
    }
  }

  canCallReadTool(name: string): boolean {
    const definition = this.findTool(name)
    return (
      definition !== null &&
      !isWriteRisk(definition.riskLevel) &&
      this.isReady &&
      this.resolvedToolNames.has(definition.mcpToolName)
    )
  }

  targetSystemUrl(system: McpTargetSystem): string {
    return system === this.opts.system ? this.opts.targetSystemUrl : ''
  }

  actingAccount(system: McpTargetSystem): string | undefined {
    if (system !== this.opts.system) return undefined
    return this.account ?? this.opts.actingAccountFallback
  }

  private setState(state: typeof this.state, errorCode?: ErrorCode): void {
    this.state = state
    this.lastErrorCode = errorCode
    this.opts.onStatus?.(this.statusSnapshot)
  }
}
