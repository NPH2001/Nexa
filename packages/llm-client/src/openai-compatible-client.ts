import { ERROR_CODES, NexaError, type ErrorCode, type LlmProvider } from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'
import { joinUrl } from '@nexa/security'
import { SseAccumulator, SseStreamError, parseNonStreamResponse } from './sse-parser.js'
import type { ChatRequest, ChatResult, ChatStreamEvent } from './types.js'

/** Đủ chứa nguyên câu lỗi của gateway (`{"error":{"message":...}}`), không đủ để đổ trọn payload. */
const MAX_LOGGED_ERROR_BODY_CHARS = 300

/**
 * Loại lỗi mà gateway báo NGAY TRONG stream, thay vì bằng HTTP status.
 *
 * Vì sao phải có enum này: khi lỗi tới bằng đường SSE thì không có status nào để dựa vào, và tất
 * cả đều rơi vào `UPSTREAM_UNAVAILABLE` — "context length exceeded", "model không nhận ảnh" và
 * "upstream provider lỗi" hiện ra giống hệt nhau, dù ba cái cần ba cách sửa khác nhau.
 *
 * Vì sao là enum chứ không phải chính câu lỗi: câu lỗi của gateway là error body của một POST, và
 * repo này có một bất biến có test rằng error body của POST KHÔNG BAO GIỜ được ghi log vì nó có
 * thể echo prompt về (§11.1). Ảnh làm điều đó cụ thể hơn — OpenAI/LiteLLM trả những câu kiểu
 * `Invalid 'messages[1].content[1].image_url.url': data:image/png;base64,iVBORw0KG...`. Phân loại
 * giữ được giá trị chẩn đoán mà không đưa một byte nội dung nào vào log.
 */
export const UPSTREAM_ERROR_CLASSES = [
  'context_length',
  'image_unsupported',
  'image_invalid',
  'rate_limited',
  'auth',
  'content_filter',
  'model_unavailable',
  'upstream_error',
  'unclassified',
] as const

export type UpstreamErrorClass = (typeof UPSTREAM_ERROR_CLASSES)[number]

/**
 * Mẫu nhận dạng, xét theo thứ tự. Mẫu hẹp đứng trước mẫu rộng: một câu vừa có "image" vừa có
 * "not supported" phải ra `image_unsupported`, không phải `upstream_error`.
 */
const UPSTREAM_ERROR_PATTERNS: readonly (readonly [UpstreamErrorClass, RegExp])[] = [
  ['context_length', /context[\s_-]*length|maximum context|too many tokens|context window/],
  [
    'image_unsupported',
    /(image|vision|multimodal)[^.]{0,40}(not support|unsupported|not enabled)|does not support image/,
  ],
  [
    'image_invalid',
    /invalid image|image_url|failed to (download|process|decode) image|corrupt.{0,10}image/,
  ],
  ['rate_limited', /rate limit|too many requests|quota|429/],
  ['auth', /api key|unauthorized|authentication|invalid_api_key|permission denied|401|403/],
  ['content_filter', /content[\s_-]*(filter|policy)|safety|responsible ?ai/],
  ['model_unavailable', /model not found|no deployment|does not exist|unknown model|not available/],
  [
    'upstream_error',
    /overloaded|internal server error|bad gateway|service unavailable|upstream|timeout|5\d\d/,
  ],
]

/**
 * Phân loại câu lỗi in-stream. Hàm thuần, KHÔNG giữ lại câu lỗi gốc ở bất kỳ đâu.
 *
 * `unclassified` là một kết quả hợp lệ, không phải thất bại: nó nói "gateway có báo lỗi, nhưng
 * không khớp mẫu nào đã biết", và bước tiếp theo khi đó là đối chiếu request id với log LiteLLM
 * (§15.2) — đúng cơ chế mà thiết kế đã định cho những gì Nexa cố ý không ghi lại.
 */
export function classifyUpstreamStreamError(message: string): UpstreamErrorClass {
  const normalized = message.toLowerCase()
  for (const [errorClass, pattern] of UPSTREAM_ERROR_PATTERNS) {
    if (pattern.test(normalized)) return errorClass
  }
  return 'unclassified'
}

export interface OpenAiCompatibleClientOptions {
  readonly baseUrl: string
  /**
   * Provider nào đứng sau baseUrl này.
   *
   * Chỉ dùng để chọn mã lỗi: `LITELLM_AUTH_FAILED` và `OPENAI_AUTH_FAILED` dẫn người dùng tới
   * hai màn hình Cài đặt khác nhau, nên không được trộn.
   */
  readonly provider: LlmProvider
  /**
   * Lấy API key ngay trước khi gửi request.
   *
   * Là callback chứ không phải string vì §6 yêu cầu "Secret chỉ được giải mã tại Electron main
   * process ngay trước khi tạo kết nối" — client không giữ key sống trong field của mình.
   */
  readonly getApiKey: () => string
  readonly logger: Logger
  readonly timeoutMs?: number
  /** Cho phép bơm fetch giả trong test. */
  readonly fetchImpl?: typeof fetch
}

export interface RequestContext {
  readonly requestId: string
  /** Huỷ từ UI (§9.3 "hỗ trợ cancel từ UI"). */
  readonly signal?: AbortSignal
}

/**
 * LLM Client (§5.2): streaming, cancellation, timeout, test kết nối và chuẩn hoá lỗi.
 *
 * Tên gọi là "OpenAI-compatible" chứ không phải "LiteLLM" vì client này chỉ nói đúng giao thức
 * đó — `POST /v1/chat/completions`, `GET /v1/models`, `Authorization: Bearer`. LiteLLM là một
 * hiện thực của giao thức ấy; api.openai.com là một hiện thực khác. Không có gì trong file này
 * riêng cho LiteLLM.
 *
 * Client này KHÔNG biết gì về hội thoại hay tool — nó chỉ nói HTTP. Việc dựng context và
 * vòng lặp tool nằm ở @nexa/agent-runtime.
 */
export class OpenAiCompatibleClient {
  private readonly baseUrl: string
  private readonly provider: LlmProvider
  private readonly getApiKey: () => string
  private readonly log: Logger
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(opts: OpenAiCompatibleClientOptions) {
    this.baseUrl = opts.baseUrl
    this.provider = opts.provider
    this.getApiKey = opts.getApiKey
    this.log = opts.logger.child({ module: 'llm-client', provider: opts.provider })
    this.timeoutMs = opts.timeoutMs ?? 120_000
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  /** §9.1 `GET /v1/models` — "nếu được bật". Trả danh sách model id. */
  async listModels(ctx: RequestContext): Promise<string[]> {
    const response = await this.send('GET', '/v1/models', undefined, ctx)
    const body: unknown = await response.json().catch(() => null)
    if (typeof body !== 'object' || body === null) return []
    const data = (body as Record<string, unknown>)['data']
    if (!Array.isArray(data)) return []
    return data
      .map((entry) =>
        typeof entry === 'object' && entry !== null
          ? String((entry as Record<string, unknown>)['id'] ?? '')
          : '',
      )
      .filter((id) => id !== '')
  }

  /**
   * Kiểm tra endpoint + API key.
   *
   * Thử `GET /v1/models` trước. Nếu gateway không bật endpoint đó (404/405) thì rơi xuống một
   * chat completion cực nhỏ — vì mục tiêu là xác thực KEY, và 404 không nói được key đúng hay sai.
   * Xem docs/OPEN-QUESTIONS.md A1: chưa biết LiteLLM nội bộ bật endpoint nào.
   */
  async testConnection(
    ctx: RequestContext,
    probeModel?: string,
  ): Promise<{ ok: true; detail: string } | never> {
    try {
      const models = await this.listModels(ctx)
      return { ok: true, detail: `${String(models.length)} model khả dụng` }
    } catch (error) {
      const isMissingEndpoint =
        NexaError.is(error) && error.code === ERROR_CODES.UPSTREAM_UNAVAILABLE
      if (!isMissingEndpoint || probeModel === undefined) throw error
    }

    await this.complete(
      { model: probeModel, messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 },
      ctx,
    )
    return { ok: true, detail: 'Key hợp lệ (xác thực bằng một yêu cầu chat tối thiểu)' }
  }

  /** Gọi chat không streaming. Dùng cho test kết nối và cho vòng tool không cần hiển thị dần. */
  async complete(request: ChatRequest, ctx: RequestContext): Promise<ChatResult> {
    const started = Date.now()
    const response = await this.send('POST', '/v1/chat/completions', this.buildBody(request, false), ctx)
    const body: unknown = await response.json().catch(() => null)
    const parsed = parseNonStreamResponse(body)
    this.log.perf('llm-request-completed', {
      requestId: ctx.requestId,
      durationMs: Date.now() - started,
      model: request.model,
      streaming: false,
      finishReason: parsed.finishReason,
    })
    return parsed
  }

  /**
   * Gọi chat có streaming (§2.1 "nhận phản hồi theo streaming").
   *
   * Trả AsyncGenerator để nơi gọi vừa đẩy được từng token lên UI vừa dừng được giữa chừng
   * bằng `break` — generator sẽ chạy `finally` và đóng kết nối.
   */
  async *streamChat(request: ChatRequest, ctx: RequestContext): AsyncGenerator<ChatStreamEvent> {
    const started = Date.now()
    const response = await this.send('POST', '/v1/chat/completions', this.buildBody(request, true), ctx)

    const body = response.body
    if (body === null) {
      throw new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
        requestId: ctx.requestId,
        safeDetail: 'streaming response had no body',
      })
    }

    const decoder = new TextDecoder()
    const accumulator = new SseAccumulator()
    const reader = body.getReader()

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        let events: ChatStreamEvent[]
        try {
          events = accumulator.push(decoder.decode(value, { stream: true }))
        } catch (error) {
          throw this.mapStreamError(error, ctx)
        }
        for (const event of events) yield event
      }
      for (const event of accumulator.end()) yield event
    } finally {
      // Huỷ reader để socket được trả về ngay khi người dùng bấm Dừng.
      await reader.cancel().catch(() => undefined)
      this.log.perf('llm-request-completed', {
        requestId: ctx.requestId,
        durationMs: Date.now() - started,
        model: request.model,
        streaming: true,
        finishReason: accumulator.result.finishReason,
      })
    }
  }

  // ── Nội bộ ──────────────────────────────────────────────────────────────

  private buildBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    return {
      model: request.model,
      messages: request.messages,
      stream,
      // Xin usage kèm theo stream; gateway nào không hỗ trợ sẽ bỏ qua field này.
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(request.tools !== undefined && request.tools.length > 0
        ? { tools: request.tools, tool_choice: 'auto' }
        : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    }
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, unknown> | undefined,
    ctx: RequestContext,
  ): Promise<Response> {
    const url = joinUrl(this.baseUrl, path)
    const timeout = new AbortController()
    const timer = setTimeout(() => {
      timeout.abort(new NexaError(ERROR_CODES.LLM_TIMEOUT, { requestId: ctx.requestId }))
    }, this.timeoutMs)

    const signal = combineSignals(timeout.signal, ctx.signal)

    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method,
        signal,
        headers: {
          // §9.3: "main process thêm Authorization: Bearer <API key>; renderer không được
          // đọc hoặc tự tạo header này."
          Authorization: `Bearer ${this.getApiKey()}`,
          'Content-Type': 'application/json',
          Accept: body !== undefined ? 'text/event-stream, application/json' : 'application/json',
          'X-Request-ID': ctx.requestId,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (error) {
      throw this.mapTransportError(error, ctx)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      throw await this.mapHttpError(response, ctx, method)
    }
    return response
  }

  /** §9.3 "Error code ổn định". Ánh xạ HTTP → mã lỗi Phụ lục B. */
  private async mapHttpError(
    response: Response,
    ctx: RequestContext,
    method: 'GET' | 'POST',
  ): Promise<NexaError> {
    // Đọc body để ghi độ dài vào log nhưng KHÔNG đưa nội dung vào safeDetail — body lỗi của
    // gateway thường echo lại nguyên request, tức là cả prompt (§11.1).
    const raw = await response.text().catch(() => '')
    this.log.warn('llm-http-error', {
      requestId: ctx.requestId,
      status: response.status,
      bodyLength: raw.length,
      // Chỉ với GET: request không mang prompt nào nên body lỗi KHÔNG THỂ echo prompt về — mối lo
      // của §11.1 ở trên không áp dụng. Cần thiết vì lỗi thật đã gặp là `GET /v1/models` trả 400
      // và log chỉ có `bodyLength:149`: không biết là model id sai, key mất quyền, hay cấu hình
      // proxy hỏng, mà cả ba đều dồn vào MODEL_NOT_CONFIGURED. Vẫn qua Redactor như mọi field.
      ...(method === 'GET' && raw !== ''
        ? { errorBody: raw.replace(/\s+/g, ' ').trim().slice(0, MAX_LOGGED_ERROR_BODY_CHARS) }
        : {}),
    })

    const detail = `HTTP ${String(response.status)}`
    switch (response.status) {
      case 401:
      case 403:
        return new NexaError(
          this.provider === 'openai'
            ? ERROR_CODES.OPENAI_AUTH_FAILED
            : ERROR_CODES.LITELLM_AUTH_FAILED,
          { requestId: ctx.requestId, safeDetail: detail },
        )
      case 404:
      case 405:
        // Không phải lỗi key — endpoint không tồn tại. testConnection dựa vào đúng mã này
        // để quyết định có fallback hay không.
        return new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
          requestId: ctx.requestId,
          safeDetail: detail,
        })
      case 408:
      case 504:
        return new NexaError(ERROR_CODES.LLM_TIMEOUT, {
          requestId: ctx.requestId,
          safeDetail: detail,
        })
      case 429:
        return new NexaError(
          this.provider === 'openai'
            ? ERROR_CODES.OPENAI_RATE_LIMITED
            : ERROR_CODES.LITELLM_RATE_LIMITED,
          { requestId: ctx.requestId, safeDetail: detail },
        )
      case 400:
      case 422:
        // Model id sai là nguyên nhân phổ biến nhất của 400 ở cả hai provider.
        return new NexaError(ERROR_CODES.MODEL_NOT_CONFIGURED, {
          requestId: ctx.requestId,
          safeDetail: detail,
        })
      case 413:
        // Body quá lớn — gần như luôn là ảnh base64. Trước đây rơi vào `default` và thành
        // UPSTREAM_UNAVAILABLE, tức là người dùng được bảo đi kiểm tra mạng trong khi mạng
        // không có lỗi gì. Đây là mã duy nhất trong bảng này mà người dùng tự sửa được ngay.
        return new NexaError(ERROR_CODES.UPSTREAM_PAYLOAD_TOO_LARGE, {
          requestId: ctx.requestId,
          safeDetail: detail,
        })
      default:
        return new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
          requestId: ctx.requestId,
          safeDetail: detail,
          retryable: response.status >= 500,
        })
    }
  }

  private mapTransportError(error: unknown, ctx: RequestContext): NexaError {
    if (NexaError.is(error)) return error

    if (error instanceof Error && error.name === 'AbortError') {
      // Phân biệt "hết giờ" với "người dùng bấm huỷ": timeout thì retry được, huỷ thì không
      // phải lỗi (§16 "Mất mạng khi chat → giữ draft, cho phép retry").
      const cause = (error as { cause?: unknown }).cause
      if (NexaError.is(cause)) return cause
      if (ctx.signal?.aborted === true) {
        return new NexaError(ERROR_CODES.LLM_CANCELLED, { requestId: ctx.requestId })
      }
      return new NexaError(ERROR_CODES.LLM_TIMEOUT, { requestId: ctx.requestId })
    }

    return new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
      requestId: ctx.requestId,
      cause: error,
    })
  }

  private mapStreamError(error: unknown, ctx: RequestContext): NexaError {
    if (NexaError.is(error)) return error
    if (error instanceof SseStreamError) {
      // Trước đây cả nhánh này chỉ để lại đúng một chuỗi cố định, nên khi lỗi xảy ra thì log
      // không phân biệt được nguyên nhân nào trong số nhiều nguyên nhân rất khác nhau. Giờ ghi
      // LOẠI lỗi (enum), không ghi câu lỗi — xem `UPSTREAM_ERROR_CLASSES` về lý do.
      const errorClass = classifyUpstreamStreamError(error.message)
      this.log.warn('llm-stream-error', {
        requestId: ctx.requestId,
        errorClass,
        // Độ dài thôi cũng có ích: một message rỗng nghĩa là gateway trả `error` không kèm chữ.
        messageLength: error.message.length,
      })
      // Loại lỗi phải quyết định MÃ LỖI, không chỉ nằm trong log: `safeDetail` không rời main
      // process (xem `fail()` trong result.ts), nên thứ duy nhất tới được người dùng là
      // message/hint mà catalog gắn với mã. Gộp tất cả vào UPSTREAM_UNAVAILABLE là lý do một
      // lượt gửi ảnh cho model không-vision lại hiện ra thành "kiểm tra kết nối mạng".
      return new NexaError(this.codeForStreamErrorClass(errorClass), {
        requestId: ctx.requestId,
        safeDetail: `stream error: ${errorClass}`,
      })
    }
    return NexaError.wrap(error, ERROR_CODES.UPSTREAM_UNAVAILABLE)
  }

  /**
   * Loại lỗi in-stream → mã lỗi.
   *
   * Phần lớn dùng lại mã đã có, và đó là điểm chính: một lỗi tới bằng HTTP status hay tới bằng SSE
   * thì với người dùng vẫn là cùng một vấn đề, nên phải hiện ra cùng một thông điệp và cùng một
   * gợi ý. `unclassified` giữ `UPSTREAM_UNAVAILABLE` một cách có chủ ý — khi không biết thì nói
   * không biết, và mã yêu cầu là đường đi tiếp (§15.2).
   *
   * Một ngoại lệ có chủ ý với luật đối xứng trên: `upstream_error`. HTTP 500 vẫn ra
   * `UPSTREAM_UNAVAILABLE` (`mapHttpError`), còn cùng nguyên nhân đó tới trong stream thì ra
   * `UPSTREAM_PROVIDER_FAILED`. Hai đường KHÔNG tương đương ở đúng điểm người dùng cần: tới được
   * trong stream nghĩa là mạng chắc chắn đang chạy, nên lời khuyên "kiểm tra kết nối" phải biến
   * mất. Nếu sau này nhánh 5xx của `mapHttpError` cũng đổi sang mã mới thì xoá đoạn này đi.
   */
  private codeForStreamErrorClass(errorClass: UpstreamErrorClass): ErrorCode {
    switch (errorClass) {
      case 'context_length':
        return ERROR_CODES.CONTEXT_LENGTH_EXCEEDED
      case 'image_unsupported':
        return ERROR_CODES.MODEL_DOES_NOT_SUPPORT_IMAGES
      case 'image_invalid':
        return ERROR_CODES.IMAGE_REJECTED_BY_UPSTREAM
      case 'content_filter':
        return ERROR_CODES.CONTENT_FILTERED
      case 'rate_limited':
        return this.provider === 'openai'
          ? ERROR_CODES.OPENAI_RATE_LIMITED
          : ERROR_CODES.LITELLM_RATE_LIMITED
      case 'auth':
        return this.provider === 'openai'
          ? ERROR_CODES.OPENAI_AUTH_FAILED
          : ERROR_CODES.LITELLM_AUTH_FAILED
      case 'model_unavailable':
        return ERROR_CODES.MODEL_NOT_CONFIGURED
      case 'upstream_error':
        // KHÔNG dùng `UPSTREAM_UNAVAILABLE`: lỗi này chỉ tới được sau khi kết nối đã mở và gateway
        // đã bắt đầu trả dòng SSE, nên "kiểm tra kết nối mạng nội bộ" là lời khuyên sai — mạng
        // đang chạy. Lỗi thật gặp phải: một lượt chat kèm ảnh chết sau ~40 giây với câu lỗi loại
        // này, trong khi lượt ngay trước đó không kèm ảnh chạy xong trong 5 giây.
        return ERROR_CODES.UPSTREAM_PROVIDER_FAILED
      case 'unclassified':
        return ERROR_CODES.UPSTREAM_UNAVAILABLE
    }
  }
}

/**
 * Gộp signal timeout với signal huỷ của người dùng.
 * `AbortSignal.any` có từ Node 20; giữ nhánh dự phòng cho môi trường cũ hơn.
 */
function combineSignals(a: AbortSignal, b: AbortSignal | undefined): AbortSignal {
  if (b === undefined) return a
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
  if (typeof anyFn === 'function') return anyFn([a, b])

  const controller = new AbortController()
  const forward = (source: AbortSignal): void => {
    if (source.aborted) controller.abort(source.reason)
    else source.addEventListener('abort', () => controller.abort(source.reason), { once: true })
  }
  forward(a)
  forward(b)
  return controller.signal
}
