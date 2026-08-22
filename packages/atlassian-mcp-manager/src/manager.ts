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
import { SECURITY_EVENTS, type Logger } from '@nexa/observability'
import {
  McpHttpClient,
  McpStdioClient,
  contentToText,
  type McpToolDescriptor,
  type McpToolResult,
} from '@nexa/mcp-client'
import { buildToolRegistry } from './tool-registry.js'
import { buildCredentialEnv, buildGatewayHeaders, type AtlassianCredentials } from './server-spec.js'

/** Bề mặt chung mà cả hai transport (stdio, http) phải thoả — manager không quan tâm bên dưới là gì. */
interface McpTransportClient {
  readonly isReady: boolean
  start(): Promise<void>
  stop(): Promise<void>
  listTools(): Promise<McpToolDescriptor[]>
  callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<McpToolResult>
}

export interface AtlassianMcpManagerOptions {
  /** Transport stdio — spawn `uvx mcp-atlassian` cục bộ (ADR-0004, mặc định). */
  readonly spec?: McpServerSpec
  /**
   * Transport HTTP remote — gọi một gateway MCP có sẵn thay vì tự spawn process (ADR-0005).
   * Dùng khi hạ tầng tổ chức chỉ cung cấp một endpoint HTTP (ví dụ MCP gateway của LiteLLM).
   */
  readonly gateway?: {
    /** Đã qua `validateBaseUrl` (HTTPS, allowlist domain) trước khi tới đây. */
    readonly url: string
    /** Đọc bearer token ngay trước khi dùng — cùng nguyên tắc với `credentials`. */
    readonly token: () => string
    readonly requestTimeoutMs?: number
    /** CHỈ dùng trong test với mock server cục bộ. services.ts không bao giờ truyền cờ này. */
    readonly allowInsecureLoopback?: boolean
    /**
     * Bỏ qua xác thực TLS ở chặng gateway → Jira/Confluence (`mcpGatewaySkipAtlassianTlsVerify`).
     *
     * Callback chứ không phải boolean, cùng lý do như `credentials`/`features`: người dùng tích
     * vào Settings là có hiệu lực ở request kế tiếp, không phải đợi restart app.
     */
    readonly skipAtlassianTlsVerify?: () => boolean
  }
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

/**
 * Giới hạn độ dài text lỗi được ghi log. Đủ dài để chứa nguyên câu lỗi của `mcp-atlassian`
 * (thường < 200 ký tự), đủ ngắn để một lỗi có kèm dữ liệu nghiệp vụ không bị đổ trọn vào log.
 */
const MAX_LOGGED_ERROR_CHARS = 300

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
  private client: McpTransportClient | null = null
  private serverTools = new Map<string, McpToolDescriptor>()
  /**
   * `definition.mcpToolName` → tên tool THẬT trên server (ADR-0005).
   *
   * Một gateway đứng giữa (LiteLLM MCP gateway) có thể đặt lại tên tool để tránh đụng độ giữa
   * nhiều MCP server nó gộp lại — ví dụ `jira_get_issue` của package `mcp-atlassian` xuất hiện
   * thành `atlassian-jira_get_issue`. Gọi thẳng transport stdio thì hai tên trùng nhau; qua
   * gateway thì lệch một tiền tố. `resolveServerToolName` xử lý cả hai mà không cần biết trước
   * gateway nào thêm tiền tố gì.
   */
  private resolvedToolNames = new Map<string, string>()
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

    // Mỗi lần khởi chạy có cờ bật ⇒ một dòng security log. Cố ý ghi ở `start()` chứ không ở
    // `buildGatewayHeaders`: chỗ đó chạy mỗi request, sẽ làm ngập log và trôi mất chính nó.
    // Ghi kèm host để ATTT biết chặng nào đang không được xác thực chứng chỉ, không chỉ biết
    // "có ai đó đã tắt".
    if (this.opts.gateway?.skipAtlassianTlsVerify?.() === true) {
      this.log.security(SECURITY_EVENTS.atlassianTlsVerifySkipped, {
        jiraHost: safeHost(this.opts.jiraBaseUrl),
        confluenceHost: safeHost(this.opts.confluenceBaseUrl),
      })
    }

    const client = this.buildClient(credentials)

    try {
      await client.start()
      const tools = await client.listTools()
      this.serverTools = new Map(tools.map((t) => [t.name, t]))
      this.resolvedToolNames = new Map()
      for (const d of this.registry) {
        const real = resolveServerToolName(d.mcpToolName, this.serverTools)
        if (real !== null) this.resolvedToolNames.set(d.mcpToolName, real)
      }
      this.client = client
      this.setState('ready')

      const missing = this.registry
        .filter((d) => !this.resolvedToolNames.has(d.mcpToolName))
        .map((d) => d.name)
      if (missing.length > 0) {
        // §22.1 "MCP tool schema thay đổi → lỗi runtime". Phát hiện sớm ở đây thay vì để
        // người dùng gặp lỗi khó hiểu giữa cuộc hội thoại.
        //
        // `serverToolNamesJira/Confluence` (chẩn đoán tạm thời, OPEN-QUESTIONS A4): tên tool
        // KHÔNG phải secret — an toàn để ghi log — và là cách duy nhất để biết convention đặt
        // tên thật của một server/gateway chưa xác nhận, thay vì đoán. Tách theo hệ thống thay
        // vì gộp một mảng: Redactor cắt mảng log ở 50 phần tử, và danh sách Jira một mình đã
        // gần chạm mức đó, sẽ cắt mất hoàn toàn tên Confluence nếu gộp chung.
        this.log.warn('mcp-tools-missing-on-server', {
          missingCount: missing.length,
          missing,
          serverToolCount: tools.length,
          serverToolNamesJira: tools.map((t) => t.name).filter((n) => n.includes('jira')),
          serverToolNamesConfluence: tools.map((t) => t.name).filter((n) => n.includes('confluence')),
          serverToolNamesOther: tools
            .map((t) => t.name)
            .filter((n) => !n.includes('jira') && !n.includes('confluence')),
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

  /**
   * Chọn transport theo cấu hình được tiêm (ADR-0005: additive, không thay ADR-0004).
   * Đúng một trong `gateway`/`spec` phải có — kiểm ở đây thay vì ở constructor để lỗi cấu hình
   * lộ ra ngay lần start() đầu tiên với mã lỗi rõ ràng, thay vì một exception mơ hồ lúc dựng.
   */
  private buildClient(credentials: AtlassianCredentials): McpTransportClient {
    if (this.opts.gateway !== undefined) {
      const gateway = this.opts.gateway
      return new McpHttpClient({
        url: gateway.url,
        headers: () =>
          buildGatewayHeaders({
            gatewayToken: gateway.token(),
            jira: credentials.jira,
            confluence: credentials.confluence,
            skipTlsVerify: gateway.skipAtlassianTlsVerify?.() === true,
          }),
        logger: this.opts.logger,
        requestTimeoutMs: gateway.requestTimeoutMs ?? this.opts.toolTimeoutMs,
        ...(gateway.allowInsecureLoopback === true ? { allowInsecureLoopback: true } : {}),
      })
    }
    if (this.opts.spec !== undefined) {
      const spec = this.opts.spec
      return new McpStdioClient({
        command: spec.command,
        args: spec.args,
        env: buildCredentialEnv(spec, credentials),
        ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}),
        logger: this.opts.logger,
        startupTimeoutMs: spec.startupTimeoutMs,
        requestTimeoutMs: this.opts.toolTimeoutMs ?? 60_000,
      })
    }
    throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
      safeDetail: 'neither stdio spec nor http gateway is configured',
    })
  }

  async stop(): Promise<void> {
    const client = this.client
    this.client = null
    this.serverTools.clear()
    this.resolvedToolNames.clear()
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
   * §10.1 gốc nói DESTRUCTIVE "không bật trong MVP" và trước đây bị loại cứng ở đây bất kể
   * cấu hình. Theo yêu cầu 2026-08-22 "full quyền dùng cả 98 tool", chốt chặn đó đã bị gỡ —
   * DESTRUCTIVE giờ chỉ còn bị kiểm soát bằng `requiredFeature` như mọi tool WRITE khác, và
   * vẫn bắt buộc đi qua Confirmation Guard (preview + xác nhận) trước khi thực thi. Xem
   * OPEN-QUESTIONS.md mục G1 để biết lý do và hệ quả.
   */
  availableTools(): ToolDefinition[] {
    const features = this.opts.features()
    return this.registry.filter((definition) => {
      if (features[definition.requiredFeature] !== true) return false
      return this.resolvedToolNames.has(definition.mcpToolName)
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
    if (this.opts.features()[definition.requiredFeature] !== true) {
      throw new NexaError(ERROR_CODES.TOOL_NOT_ALLOWED, {
        safeDetail: `feature "${definition.requiredFeature}" is disabled`,
      })
    }
    if (!this.resolvedToolNames.has(definition.mcpToolName)) {
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

    // Gọi bằng tên THẬT trên server, không phải tên quy ước của Nexa — hai tên có thể lệch nhau
    // qua gateway (xem JSDoc `resolvedToolNames`). `resolveCallable` ở trên đã đảm bảo có entry.
    const realToolName = this.resolvedToolNames.get(definition.mcpToolName)
    if (realToolName === undefined) {
      throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
        safeDetail: `server does not expose "${definition.mcpToolName}"`,
      })
    }

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
      // Chẩn đoán tạm thời (OPEN-QUESTIONS A4/C2): MCP server báo lỗi bằng TEXT, không bằng mã, và
      // `classifyToolError` chỉ là heuristic chuỗi. Khi text không khớp mẫu nào, mọi thứ dồn vào
      // UPSTREAM_UNAVAILABLE — người dùng thấy đúng một mã lỗi cho "PAT sai", "cert nội bộ không
      // tin cậy", "header credential không tới được server", và không có gì trong log phân biệt
      // được ba trường hợp đó. Ghi lại text (đã qua Redactor, cắt ngắn) là cách duy nhất để hiệu
      // chỉnh heuristic bằng server thật thay vì đoán.
      //
      // `serverToolName`: xác nhận gateway đã đặt lại tên tool như thế nào — không phải secret.
      this.log.warn('mcp-tool-error-detail', {
        toolName: definition.name,
        serverToolName: realToolName,
        errorText: rawText.slice(0, MAX_LOGGED_ERROR_CHARS),
        errorChars: rawText.length,
      })
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
      this.resolvedToolNames.has(definition.mcpToolName)
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

/** Chỉ lấy hostname để ghi log — bỏ path/query, và không ném khi URL rỗng hoặc không parse được. */
function safeHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).host
  } catch {
    return 'unknown'
  }
}

/**
 * Khớp tên tool quy ước của Nexa (`mcpToolName`, ví dụ `jira_get_issue`) với tên THẬT server
 * công bố (ADR-0005). Thử khớp đúng tuyệt đối trước (transport stdio, package cài cục bộ); nếu
 * không có, thử khớp tên server nào tận cùng bằng `-${mcpToolName}` (gateway thêm tiền tố
 * namespace, ví dụ `atlassian-jira_get_issue`).
 *
 * Nhiều tên cùng khớp hậu tố ⇒ trả `null` thay vì đoán bừa — mơ hồ về việc gọi tool nào là một
 * lỗi cấu hình cần biết, không phải thứ nên tự động chọn một trong số đó.
 */
function resolveServerToolName(
  mcpToolName: string,
  serverTools: ReadonlyMap<string, McpToolDescriptor>,
): string | null {
  if (serverTools.has(mcpToolName)) return mcpToolName

  const suffix = `-${mcpToolName}`
  let found: string | null = null
  for (const name of serverTools.keys()) {
    if (!name.endsWith(suffix)) continue
    if (found !== null) return null
    found = name
  }
  return found
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
    lower.includes('authentication') ||
    // Nguyên văn quan sát được từ gateway thật (`mcp-atlassian` qua LiteLLM, 2026-08-03):
    //   "Invalid header-based Jira token or configuration: Unable to get current user account ID:"
    // Không chứa mã HTTP, không chứa từ "authentication" — nên năm mẫu ở trên bỏ sót hoàn toàn và
    // nó rơi xuống UPSTREAM_UNAVAILABLE ("Không kết nối được tới dịch vụ. Kiểm tra kết nối mạng"),
    // chỉ sai hướng cho người dùng: mạng vẫn tốt, chính credential mới là thứ bị từ chối.
    (lower.includes('invalid') && lower.includes('token')) ||
    lower.includes('current user')
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
