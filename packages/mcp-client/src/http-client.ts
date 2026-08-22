import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'
import {
  MCP_PROTOCOL_VERSION,
  parseToolResult,
  parseToolsList,
  type McpToolDescriptor,
  type McpToolResult,
} from './protocol.js'

export interface HttpClientOptions {
  /**
   * Endpoint MCP remote. Phải là kết quả của `validateBaseUrl` (HTTPS, không nhúng credential,
   * đã qua allowlist domain tổ chức nếu có) — client này KHÔNG tự validate lại URL, nhưng vẫn
   * khẳng định lại scheme ở dòng dưới như một lớp phòng thủ thứ hai.
   */
  readonly url: string
  /**
   * Dựng lại header MỖI request, không phải một object tĩnh.
   *
   * Đây là điểm mấu chốt về an toàn (ADR-0005): bearer token của gateway và PAT của Jira/
   * Confluence chỉ tồn tại trong bộ nhớ đúng khoảnh khắc gọi `fetch`, không nằm cache ở đâu
   * trong instance này. Không có child process nào khác giữ bản sao — khác với transport
   * stdio, nơi biến môi trường sống suốt vòng đời của process con.
   */
  readonly headers: () => Record<string, string>
  readonly logger: Logger
  readonly startupTimeoutMs?: number
  readonly requestTimeoutMs?: number
  /** Chặn server trả về payload khổng lồ chiếm bộ nhớ. Mặc định 10 MiB. */
  readonly maxResponseBytes?: number
  /**
   * Cho phép `http://` tới loopback. CHỈ dùng trong test với mock server cục bộ — cùng quy ước
   * với `UrlPolicy.allowInsecureLoopback` của `@nexa/security`. Bản phát hành không có đường
   * nào bật cờ này (services.ts không bao giờ truyền nó).
   */
  readonly allowInsecureLoopback?: boolean
}

const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Giới hạn cho thân response LỖI (status không 2xx, hoặc JSON-RPC `error.message`).
 *
 * Đọc tối đa 4 KiB rồi cắt còn 300 ký tự — cùng lý do như `MAX_LOGGED_ERROR_CHARS` của
 * `AtlassianMcpManager`: đủ để chứa nguyên câu lỗi của gateway, đủ ngắn để một lỗi có kèm dữ liệu
 * không đổ trọn vào log. Snippet đi qua Redactor như mọi field log khác (bearer token và PAT đều
 * đã `registerSecret` từ `SecurityService`), nên gateway có echo lại header cũng không lọt.
 */
const ERROR_BODY_READ_BYTES = 4 * 1024
const ERROR_BODY_MAX_CHARS = 300

/**
 * MCP Client (§5.2) trên transport HTTP remote — "Streamable HTTP" theo đặc tả MCP
 * (2025-03-26): mỗi message JSON-RPC là một POST riêng, phản hồi là `application/json` (một
 * response) hoặc `text/event-stream` (SSE khung `data: <json>`).
 *
 * Bổ sung cho ADR-0004 (xem ADR-0005): Nexa vẫn KHÔNG mở cổng nghe nào — class này chỉ là một
 * HTTP client gọi RA NGOÀI. Vì vậy mối lo của ADR-0004 ("tiến trình khác trên máy gọi được cổng
 * loopback đang giữ PAT") không áp dụng ở đây theo cách tương tự: không có cổng nào để tiến
 * trình khác kết nối vào. Rủi ro còn lại là rò rỉ secret ra khỏi tiến trình Nexa (đĩa, log, bộ
 * nhớ) — bốn biện pháp bù dưới đây nhắm thẳng vào rủi ro đó:
 *
 *   1. HTTPS bắt buộc + xác thực chứng chỉ mặc định của Node (không có cờ nào tắt được ở đây).
 *   2. KHÔNG follow redirect — một gateway bị chiếm quyền hoặc DNS bị đầu độc không thể điều
 *      hướng Authorization header sang một host khác.
 *   3. Header (bearer token, PAT) dựng lại mỗi request từ closure, không cache thành field.
 *   4. Không bao giờ log object header hay body — chỉ log host/method/status/thời gian.
 */
export class McpHttpClient {
  private ready = false
  private closedReason: string | null = null
  private serverName = 'unknown'
  private sessionId: string | null = null
  private nextId = 1
  private readonly opts: HttpClientOptions
  private readonly log: Logger
  private readonly origin: string

  /** URL thật sự dùng để gọi — có `/` cuối, xem lý do ở constructor. */
  private readonly url: string

  constructor(opts: HttpClientOptions) {
    this.opts = opts
    this.log = opts.logger.child({ module: 'mcp-http-client' })

    const parsed = new URL(opts.url)
    const loopbackHttpAllowed =
      opts.allowInsecureLoopback === true && LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopbackHttpAllowed)) {
      throw new NexaError(ERROR_CODES.INVALID_URL, {
        safeDetail: `mcp gateway scheme "${parsed.protocol}" not allowed; https required`,
      })
    }
    this.origin = parsed.host

    // `validateBaseUrl` (dùng khi lưu connection) luôn bỏ dấu "/" cuối — hợp lý cho URL sẽ được
    // nối thêm path (Jira/Confluence/LiteLLM qua `joinUrl`). Nhưng URL gateway ở đây là điểm
    // cuối THẬT SỰ, gọi thẳng không qua `joinUrl`, và nhiều gateway (ASGI/FastAPI phía sau, ví
    // dụ có middleware "append slash") trả 307 redirect thêm "/" nếu thiếu — redirect đó còn có
    // thể hạ cấp xuống http://, đúng thứ `McpHttpClient` cố tình từ chối follow (xem JSDoc lớp).
    // Tự thêm "/" ở đây để không bao giờ đi vào redirect đó ngay từ đầu.
    this.url = parsed.pathname.endsWith('/') ? opts.url : `${opts.url}/`
  }

  get isReady(): boolean {
    return this.ready
  }

  get name(): string {
    return this.serverName
  }

  async start(): Promise<void> {
    if (this.ready) return
    try {
      const result = await this.request(
        'initialize',
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          // Giống stdio: cố ý không khai báo sampling/roots — không cấp cho gateway quyền gọi
          // ngược Nexa.
          capabilities: {},
          clientInfo: { name: 'Nexa', version: '0.1.0' },
        },
        this.opts.startupTimeoutMs ?? 30_000,
      )
      this.serverName = readServerName(result)
      await this.notify('notifications/initialized')
      this.ready = true
      this.log.info('mcp-http-initialized', { server: this.serverName, host: this.origin })
    } catch (error) {
      this.ready = false
      throw NexaError.wrap(error, ERROR_CODES.MCP_SERVER_UNAVAILABLE)
    }
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    this.assertReady()
    return parseToolsList(
      await this.request('tools/list', {}, this.opts.requestTimeoutMs ?? 60_000),
    )
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<McpToolResult> {
    this.assertReady()
    const result = await this.request(
      'tools/call',
      { name, arguments: args },
      timeoutMs ?? this.opts.requestTimeoutMs ?? 60_000,
    )
    return parseToolResult(result)
  }

  async stop(): Promise<void> {
    this.ready = false
    this.sessionId = null
  }

  // ── Nội bộ ──────────────────────────────────────────────────────────────

  private assertReady(): void {
    if (!this.ready) {
      throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
        safeDetail: this.closedReason ?? 'client not initialised',
      })
    }
  }

  /**
   * Ghi log lý do lỗi — đối xứng với `McpStdioClient.fail()`, thứ ghi `mcp-server-down` kèm
   * `reason` mỗi khi process con chết. Thiếu dòng log này (lỗi ban đầu của bản vá này) là lý do
   * transport HTTP thất bại HOÀN TOÀN im lặng: lỗi bị nuốt ở `ConnectionService.test()` thành
   * mỗi `MCP_SERVER_UNAVAILABLE`, không còn dấu vết nào để biết là DNS sai, TLS bị từ chối, hay
   * gateway trả 401. `reason` ở đây LUÔN được dựng từ mã lỗi/status — không bao giờ chứa
   * header hay body — nên an toàn để ghi thẳng vào log.
   *
   * `path` + `headerNames`: TÊN header và path, không bao giờ GIÁ TRỊ. Cần thiết vì hai nguyên
   * nhân rất khác nhau lại cho cùng một status từ gateway thật (LiteLLM trả 500
   * `{"error":"MCP request failed"}` cả khi thiếu `Authorization` lẫn khi chính nó lỗi), và
   * "POST tới path nào, có mang những header nào" là thứ duy nhất phân biệt được mà không phải
   * ghi secret ra log.
   */
  private fail(reason: string, extra: Record<string, unknown> = {}): void {
    this.closedReason = reason
    this.ready = false
    this.log.warn('mcp-http-down', { reason, host: this.origin, ...extra })
  }

  /**
   * Mỗi POST tương ứng đúng một response — không cần pending map như bên stdio.
   *
   * `isNotification`: JSON-RPC notification KHÔNG được có trường `id` (khác request) — gộp hai
   * trường hợp vào một object literal thay vì luôn set `id` là lỗi thật đã gặp: gateway coi một
   * "notification" có `id` là request cần trả lời đúng chỗ và có thể từ chối vì tham số không
   * khớp kỳ vọng của nó cho method đó. Server cũng không bắt buộc trả JSON-RPC response cho
   * notification (có thể chỉ trả 202 rỗng) — nên không cố parse `result`/`error` trong trường
   * hợp này.
   */
  private async request(
    method: string,
    params: unknown,
    timeoutMs: number,
    isNotification = false,
  ): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const started = Date.now()
    // Chỉ TÊN header, không giá trị — để nhánh catch dưới có thể nói "request này có mang
    // authorization không" mà không cần giữ tham chiếu tới chính header object sau khi fetch xong.
    let headerNames: readonly string[] = []

    try {
      // Header dựng NGAY TRƯỚC lúc gửi — không giữ tham chiếu sau khi request kết thúc.
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': MCP_PROTOCOL_VERSION,
        ...(this.sessionId !== null ? { 'mcp-session-id': this.sessionId } : {}),
        ...this.opts.headers(),
      }
      headerNames = Object.keys(headers).sort()
      const payload = isNotification
        ? { jsonrpc: '2.0' as const, method, params }
        : { jsonrpc: '2.0' as const, id: this.nextId++, method, params }

      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
        // Không bao giờ follow redirect (xem JSDoc lớp) — một gateway compromised không thể
        // điều hướng Authorization header sang host khác.
        redirect: 'manual',
      })

      if (isRedirectResponse(response)) {
        throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
          safeDetail: 'gateway attempted a redirect — refused for safety',
        })
      }
      if (!response.ok) {
        // Chỉ ghi status là KHÔNG đủ để chẩn đoán (lỗi thật đã gặp: mọi `initialize` trả 500 và
        // log không có gì hơn "http 500" — không biết là gateway mất kết nối tới MCP server
        // "atlassian", key hết hạn, hay chính gateway crash). Thân response của gateway là câu
        // giải thích duy nhất tồn tại, nên đọc một đoạn có giới hạn và ghi kèm.
        const snippet = await readErrorSnippet(response)
        throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
          safeDetail:
            snippet === ''
              ? `gateway responded with http ${String(response.status)}`
              : `gateway responded with http ${String(response.status)}: ${snippet}`,
        })
      }

      const sessionHeader = response.headers.get('mcp-session-id')
      if (sessionHeader !== null) this.sessionId = sessionHeader

      const body = await readBoundedBody(
        response,
        this.opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      )

      this.log.debug('mcp-http-request', {
        method,
        status: response.status,
        durationMs: Date.now() - started,
        // Không log body/headers — chỉ độ dài để chẩn đoán mà không lộ nội dung.
        bodyBytes: body.length,
      })

      // Notification: không đợi/không đòi hỏi JSON-RPC result/error hợp lệ trong response.
      if (isNotification) return undefined

      const message = parseResponseBody(response.headers.get('content-type'), body)
      if (message === null) return undefined
      if (message.error !== undefined) {
        // Cùng lý do như nhánh `!response.ok`: mã JSON-RPC một mình không nói được vì sao (một
        // `-32602` từ gateway có thể là "notification mang id", "thiếu header cấu hình", hay
        // "tham số tool sai"). `error.message` là chỗ duy nhất phân biệt được.
        const detail = clampErrorText(message.error.message)
        throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
          safeDetail:
            detail === ''
              ? `${method} failed with rpc code ${String(message.error.code)}`
              : `${method} failed with rpc code ${String(message.error.code)}: ${detail}`,
        })
      }
      return message.result
    } catch (cause) {
      const reason = `request "${method}" failed: ${describeFetchError(cause)}`
      this.fail(reason, { path: safePath(this.url), headerNames })
      throw NexaError.is(cause)
        ? cause
        : new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, { cause, safeDetail: reason })
    } finally {
      clearTimeout(timer)
    }
  }

  private async notify(method: string): Promise<void> {
    await this.request(method, undefined, this.opts.startupTimeoutMs ?? 30_000, true)
  }
}

/**
 * Rút ra lý do lỗi có ích để chẩn đoán từ một `fetch()` thất bại.
 *
 * Node (undici) bọc lỗi mạng thật (DNS, TLS, connection refused) thành `TypeError: fetch
 * failed` với lỗi gốc nằm trong `.cause` — nếu chỉ log `error.name` thì mọi lỗi mạng đều hiện
 * ra giống hệt nhau là "TypeError", vô dụng cho việc chẩn đoán. Đào vào `.cause.code`/
 * `.cause.message` để phân biệt được "sai tên miền" khỏi "chứng chỉ không hợp lệ" khỏi "bị từ
 * chối kết nối" — không có secret nào nằm trong các trường này.
 */
function describeFetchError(cause: unknown): string {
  if (NexaError.is(cause)) return cause.safeDetail ?? cause.message
  if (cause instanceof Error && cause.name === 'AbortError') return 'timed out'
  if (cause instanceof Error) {
    const nested = (cause as Error & { cause?: unknown }).cause
    if (nested instanceof Error) {
      const code = (nested as NodeJS.ErrnoException).code
      return code !== undefined ? `${code} (${nested.message})` : nested.message
    }
    return cause.message
  }
  return 'unknown error'
}

/**
 * Đọc một đoạn có giới hạn của thân response lỗi để ghi log.
 *
 * Không bao giờ ném: nó chạy trên đường xử lý lỗi, và một lỗi ở đây sẽ che mất lỗi thật (status
 * của gateway) — thứ quan trọng hơn snippet. Không đọc được thì trả chuỗi rỗng và người gọi chỉ
 * ghi status như trước.
 */
async function readErrorSnippet(response: Response): Promise<string> {
  try {
    const reader = response.body?.getReader()
    if (reader === undefined) return clampErrorText(await response.text())

    const decoder = new TextDecoder()
    let out = ''
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      out += decoder.decode(value, { stream: true })
      if (total >= ERROR_BODY_READ_BYTES) {
        await reader.cancel()
        break
      }
    }
    out += decoder.decode()
    return clampErrorText(out)
  } catch {
    return ''
  }
}

/**
 * Path (không query, không host) để ghi log.
 *
 * Sai path là một nguyên nhân thật của lỗi cấu hình gateway — `/mcp` và `/mcp/` là hai route khác
 * nhau ở nhiều gateway ASGI — nhưng query string thì có thể mang token, nên bỏ hẳn.
 */
function safePath(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname
  } catch {
    return 'unknown'
  }
}

/** Gộp mọi khoảng trắng về một dấu cách (log là một dòng JSON) rồi cắt ngắn. */
function clampErrorText(raw: string | undefined): string {
  if (raw === undefined) return ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, ERROR_BODY_MAX_CHARS)
}

function isRedirectResponse(response: Response): boolean {
  // `redirect: 'manual'`: trình duyệt/undici trả `type: 'opaqueredirect'`, status 0, không đọc
  // được thân/hearder. Một số polyfill lại trả thẳng status 3xx — kiểm cả hai cho chắc.
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)
}

/** Đọc thân response nhưng bỏ ngang nếu vượt giới hạn — chặn server trả payload khổng lồ. */
async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) return response.text()

  const decoder = new TextDecoder()
  let total = 0
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
        safeDetail: `gateway response exceeded ${String(maxBytes)} bytes`,
      })
    }
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

interface RpcMessage {
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string }
}

/** `application/json`: một response duy nhất. `text/event-stream`: lấy khung `data:` cuối cùng. */
function parseResponseBody(contentType: string | null, body: string): RpcMessage | null {
  const trimmed = body.trim()
  if (trimmed === '') return null

  if (contentType !== null && contentType.includes('text/event-stream')) {
    let last: RpcMessage | null = null
    for (const line of trimmed.split('\n')) {
      const l = line.trim()
      if (!l.startsWith('data:')) continue
      try {
        last = JSON.parse(l.slice('data:'.length).trim()) as RpcMessage
      } catch {
        // Dòng SSE không parse được (comment/keep-alive) — bỏ qua.
      }
    }
    return last
  }

  try {
    return JSON.parse(trimmed) as RpcMessage
  } catch {
    throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
      safeDetail: 'gateway response was not valid json',
    })
  }
}

function readServerName(initializeResult: unknown): string {
  if (typeof initializeResult !== 'object' || initializeResult === null) return 'unknown'
  const info = (initializeResult as Record<string, unknown>)['serverInfo']
  if (typeof info !== 'object' || info === null) return 'unknown'
  return String((info as Record<string, unknown>)['name'] ?? 'unknown')
}
