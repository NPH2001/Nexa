import {
  ERROR_CODES,
  NexaError,
  isWriteRisk,
  type FeatureFlags,
  type McpServerSpec,
  type McpStatusEvent,
  type ToolDefinition,
  type ToolResultSummary,
} from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'
import { McpStdioClient, contentToText, type McpToolDescriptor } from '@nexa/mcp-client'
import { buildToolRegistry } from './tool-registry.js'
import { buildCredentialEnv, type AtlassianCredentials } from './server-spec.js'

export interface AtlassianMcpManagerOptions {
  readonly spec: McpServerSpec
  readonly logger: Logger
  /**
   * Giải mã credential ngay tại thời điểm khởi chạy.
   *
   * Callback chứ không phải giá trị: manager không giữ PAT trong field của mình, và mỗi lần
   * restart sẽ đọc lại — nên người dùng đổi PAT trong Settings là có hiệu lực ngay (§11.2).
   */
  readonly credentials: () => AtlassianCredentials
  readonly features: () => FeatureFlags
  readonly jiraBaseUrl: string
  readonly confluenceBaseUrl: string
  readonly onStatus?: (event: McpStatusEvent) => void
  readonly toolTimeoutMs?: number
}

export interface ToolCallOutcome {
  readonly summary: ToolResultSummary
  /** Text thô từ server — chỉ dùng nội bộ, không log. */
  readonly rawText: string
}

/**
 * Atlassian MCP Manager (§5.2): khởi chạy hoặc kết nối MCP Atlassian, truyền credential từ
 * main process, tools/list, tools/call và quản lý lifecycle.
 *
 * Một tiến trình MCP phục vụ cả Jira lẫn Confluence — vì package Atlassian MCP thông dụng nhận
 * cả hai bộ credential cùng lúc. Nếu tổ chức chốt hai server riêng thì chỗ cần sửa là class này
 * (tách thành hai client), không phải danh mục tool.
 */
export class AtlassianMcpManager {
  private client: McpStdioClient | null = null
  private serverTools = new Map<string, McpToolDescriptor>()
  private registry: ToolDefinition[]
  private state: 'stopped' | 'starting' | 'ready' | 'error' = 'stopped'
  private lastErrorCode: string | undefined
  private readonly opts: AtlassianMcpManagerOptions
  private readonly log: Logger
  private startInFlight: Promise<void> | null = null

  constructor(opts: AtlassianMcpManagerOptions) {
    this.opts = opts
    this.log = opts.logger.child({ module: 'atlassian-mcp' })
    this.registry = buildToolRegistry({
      jiraBaseUrl: opts.jiraBaseUrl,
      confluenceBaseUrl: opts.confluenceBaseUrl,
    })
  }

  get isReady(): boolean {
    return this.state === 'ready' && this.client?.isReady === true
  }

  get statusSnapshot(): McpStatusEvent {
    return {
      system: 'jira',
      state: this.state,
      ...(this.lastErrorCode !== undefined ? { errorCode: this.lastErrorCode } : {}),
      toolCount: this.availableTools().length,
    }
  }

  /** Khởi chạy. Gọi nhiều lần đồng thời chỉ tạo đúng một tiến trình. */
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

    const credentials = this.opts.credentials()
    if (credentials.jira === undefined && credentials.confluence === undefined) {
      this.setState('error', ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED)
      throw new NexaError(ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED, {
        safeDetail: 'neither Jira nor Confluence is configured',
      })
    }

    const client = new McpStdioClient({
      command: this.opts.spec.command,
      args: this.opts.spec.args,
      env: buildCredentialEnv(this.opts.spec, credentials),
      ...(this.opts.spec.cwd !== undefined ? { cwd: this.opts.spec.cwd } : {}),
      logger: this.opts.logger,
      startupTimeoutMs: this.opts.spec.startupTimeoutMs,
      requestTimeoutMs: this.opts.toolTimeoutMs ?? 60_000,
    })

    try {
      await client.start()
      const tools = await client.listTools()
      this.serverTools = new Map(tools.map((t) => [t.name, t]))
      this.client = client
      this.setState('ready')

      const missing = this.registry
        .filter((d) => !this.serverTools.has(d.mcpToolName))
        .map((d) => d.name)
      if (missing.length > 0) {
        // §22.1 "MCP tool schema thay đổi → lỗi runtime". Phát hiện sớm ở đây thay vì để
        // người dùng gặp lỗi khó hiểu giữa cuộc hội thoại.
        this.log.warn('mcp-tools-missing-on-server', {
          missingCount: missing.length,
          missing,
          serverToolCount: tools.length,
        })
      }
    } catch (error) {
      await client.stop()
      this.client = null
      const code = NexaError.is(error) ? error.code : ERROR_CODES.MCP_SERVER_UNAVAILABLE
      this.setState('error', code)
      throw NexaError.wrap(error, ERROR_CODES.MCP_SERVER_UNAVAILABLE)
    }
  }

  async stop(): Promise<void> {
    const client = this.client
    this.client = null
    this.serverTools.clear()
    this.setState('stopped')
    await client?.stop()
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  /** Base URL đổi (người dùng sửa Settings) ⇒ phải dựng lại danh mục vì preview nhúng URL. */
  reconfigure(jiraBaseUrl: string, confluenceBaseUrl: string): void {
    this.registry = buildToolRegistry({ jiraBaseUrl, confluenceBaseUrl })
  }

  /**
   * Tool khả dụng = có trong danh mục Nexa ∧ feature flag bật ∧ server thật sự công bố.
   *
   * Ba điều kiện đều bắt buộc. §10.1 nói DESTRUCTIVE "không bật trong MVP", nên nó bị loại
   * ở đây bằng code chứ không bằng cấu hình — cấu hình có thể bị sửa, code thì không.
   */
  availableTools(): ToolDefinition[] {
    const features = this.opts.features()
    return this.registry.filter((definition) => {
      if (definition.riskLevel === 'DESTRUCTIVE') return false
      if (features[definition.requiredFeature] !== true) return false
      return this.serverTools.has(definition.mcpToolName)
    })
  }

  findTool(name: string): ToolDefinition | null {
    return this.registry.find((d) => d.name === name) ?? null
  }

  /**
   * Tra cứu tool đã được phép gọi.
   *
   * Tách khỏi `findTool` có chủ ý: `findTool` dùng để tra metadata (ví dụ dựng preview),
   * còn hàm này là cổng duy nhất trước khi thực thi.
   */
  resolveCallable(name: string): ToolDefinition {
    const definition = this.findTool(name)
    if (definition === null) {
      throw new NexaError(ERROR_CODES.TOOL_NOT_ALLOWED, {
        safeDetail: `"${name}" is not in the Nexa tool registry`,
      })
    }
    if (definition.riskLevel === 'DESTRUCTIVE') {
      throw new NexaError(ERROR_CODES.TOOL_NOT_ALLOWED, { safeDetail: 'destructive tools are off' })
    }
    if (this.opts.features()[definition.requiredFeature] !== true) {
      throw new NexaError(ERROR_CODES.TOOL_NOT_ALLOWED, {
        safeDetail: `feature "${definition.requiredFeature}" is disabled`,
      })
    }
    if (!this.serverTools.has(definition.mcpToolName)) {
      throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
        safeDetail: `server does not expose "${definition.mcpToolName}"`,
      })
    }
    return definition
  }

  /** Validate input theo schema của Nexa. Trả về giá trị đã parse (có default đã điền). */
  validateInput(definition: ToolDefinition, rawArgs: unknown): Record<string, unknown> {
    const parsed = definition.inputSchema.safeParse(rawArgs)
    if (!parsed.success) {
      // §11.3: "không coi LLM output là dữ liệu tin cậy". Chỉ giữ tên trường sai, không giữ
      // giá trị — giá trị là nội dung nghiệp vụ.
      const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: `invalid arguments for ${definition.name}: ${fields}`,
      })
    }
    return parsed.data as Record<string, unknown>
  }

  /**
   * Thực thi tool.
   *
   * KHÔNG kiểm tra approval ở đây — đó là việc của ConfirmationGuard, và việc tách bạch là cố ý:
   * một lớp lo "được phép gọi tool nào", một lớp lo "người dùng đã đồng ý chưa". Gộp lại thì
   * dễ có đường vòng bỏ qua xác nhận.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
    const definition = this.resolveCallable(name)
    const client = this.client
    if (client === null || !client.isReady) {
      throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, { safeDetail: 'client not running' })
    }

    const started = Date.now()
    const result = await client.callTool(definition.mcpToolName, args, this.opts.toolTimeoutMs)
    const rawText = contentToText(result)

    this.log.tool('mcp-tool-called', {
      toolName: definition.name,
      phase: result.isError ? 'failed' : 'done',
      riskLevel: definition.riskLevel,
      durationMs: Date.now() - started,
      resultChars: rawText.length,
    })

    if (result.isError) {
      throw classifyToolError(rawText, definition.name)
    }

    const summary =
      definition.summarizeResult?.(rawText) ??
      ({ forModel: rawText, forUser: 'Đã thực hiện' } satisfies ToolResultSummary)

    return { summary, rawText }
  }

  /** Tool READ có gọi được ngay không (dùng khi dựng preview cho WRITE_HIGH). */
  canCallReadTool(name: string): boolean {
    const definition = this.findTool(name)
    return (
      definition !== null &&
      !isWriteRisk(definition.riskLevel) &&
      this.isReady &&
      this.serverTools.has(definition.mcpToolName)
    )
  }

  private setState(state: typeof this.state, errorCode?: string): void {
    this.state = state
    this.lastErrorCode = errorCode
    for (const system of ['jira', 'confluence'] as const) {
      this.opts.onStatus?.({
        system,
        state,
        ...(errorCode !== undefined ? { errorCode } : {}),
        toolCount: state === 'ready' ? this.availableTools().length : 0,
      })
    }
  }
}

/**
 * MCP server báo lỗi nghiệp vụ bằng `isError: true` + text, không phải bằng mã.
 * Phải suy ra mã lỗi Nexa từ text để UI hiển thị đúng hướng dẫn (§9.3).
 *
 * Đây là heuristic dựa trên chuỗi và sẽ cần hiệu chỉnh khi có server thật
 * (docs/OPEN-QUESTIONS.md A4/C2).
 */
export function classifyToolError(rawText: string, toolName: string): NexaError {
  const lower = rawText.toLowerCase()

  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('permission') ||
    lower.includes('authentication')
  ) {
    return new NexaError(ERROR_CODES.ATLASSIAN_AUTH_FAILED, {
      safeDetail: `${toolName} rejected by target system`,
    })
  }
  if (lower.includes('missing') && lower.includes('credential')) {
    return new NexaError(ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED, {
      safeDetail: `${toolName}: server reports missing credentials`,
    })
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
      safeDetail: `${toolName} timed out at the target system`,
    })
  }
  // Mọi thứ còn lại (404, validation của Jira, …) là lỗi nghiệp vụ mà model có thể tự xử lý.
  return new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
    safeDetail: `${toolName} failed at the target system`,
    retryable: false,
  })
}
