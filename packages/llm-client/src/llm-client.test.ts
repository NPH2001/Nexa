import { describe, expect, it } from 'vitest'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import {
  OpenAiCompatibleClient,
  SseAccumulator,
  classifyUpstreamStreamError,
  parseNonStreamResponse,
  type ChatStreamEvent,
} from './index.js'
import { testLogger } from '../../../tests/support/factories.js'

function collect(acc: SseAccumulator, chunks: string[]): ReturnType<SseAccumulator['push']> {
  const events = chunks.flatMap((c) => acc.push(c))
  return [...events, ...acc.end()]
}

describe('SseAccumulator', () => {
  it('assembles text deltas into one message', () => {
    const acc = new SseAccumulator()
    collect(acc, [
      'data: {"choices":[{"delta":{"content":"Xin "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"chào"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ])
    expect(acc.result.text).toBe('Xin chào')
    expect(acc.result.finishReason).toBe('stop')
  })

  it('survives an event split across TCP chunks', () => {
    const acc = new SseAccumulator()
    collect(acc, ['data: {"choices":[{"delta":{"con', 'tent":"nửa sau"}}]}\n\n', 'data: [DONE]\n\n'])
    expect(acc.result.text).toBe('nửa sau')
  })

  it('handles CRLF line endings', () => {
    const acc = new SseAccumulator()
    collect(acc, ['data: {"choices":[{"delta":{"content":"ok"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'])
    expect(acc.result.text).toBe('ok')
  })

  it('joins tool call arguments streamed in fragments', () => {
    const acc = new SseAccumulator()
    collect(acc, [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"jira_create_issue","arguments":"{\\"sum"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"mary\\":\\"Lỗi A\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ])

    const calls = acc.result.toolCalls
    expect(calls).toHaveLength(1)
    expect(calls[0]?.function.name).toBe('jira_create_issue')
    expect(JSON.parse(calls[0]!.function.arguments)).toEqual({ summary: 'Lỗi A' })
  })

  it('keeps two parallel tool calls apart by index', () => {
    const acc = new SseAccumulator()
    collect(acc, [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"jira_get_issue","arguments":"{}"}},{"index":1,"id":"b","function":{"name":"confluence_get_page","arguments":"{}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ])
    expect(acc.result.toolCalls.map((c) => c.function.name)).toEqual([
      'jira_get_issue',
      'confluence_get_page',
    ])
  })

  it('infers finish_reason=tool_calls when the gateway omits it', () => {
    const acc = new SseAccumulator()
    collect(acc, [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","function":{"name":"jira_get_issue","arguments":"{}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ])
    expect(acc.result.finishReason).toBe('tool_calls')
  })

  it('ignores a malformed JSON chunk instead of losing the whole answer', () => {
    const acc = new SseAccumulator()
    collect(acc, [
      'data: {"choices":[{"delta":{"content":"phần 1"}}]}\n\n',
      'data: {not json\n\n',
      'data: {"choices":[{"delta":{"content":" phần 2"}}]}\n\n',
      'data: [DONE]\n\n',
    ])
    expect(acc.result.text).toBe('phần 1 phần 2')
  })

  it('throws when the gateway reports an error inside the stream', () => {
    const acc = new SseAccumulator()
    expect(() => acc.push('data: {"error":{"message":"budget exceeded"}}\n\n')).toThrow()
  })

  it('captures usage when stream_options.include_usage is honoured', () => {
    const acc = new SseAccumulator()
    collect(acc, [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":11,"completion_tokens":3},"choices":[]}\n\n',
      'data: [DONE]\n\n',
    ])
    expect(acc.result.usage).toEqual({ promptTokens: 11, completionTokens: 3 })
  })
})

describe('parseNonStreamResponse', () => {
  it('reads content and tool calls from a normal completion', () => {
    const parsed = parseNonStreamResponse({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: '',
            tool_calls: [
              { id: 'c1', function: { name: 'jira_get_issue', arguments: '{"key":"ABC-1"}' } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 7 },
    })
    expect(parsed.toolCalls[0]?.function.name).toBe('jira_get_issue')
    expect(parsed.usage).toEqual({ promptTokens: 5, completionTokens: 7 })
  })

  it('returns empty values for a garbage body rather than throwing', () => {
    expect(parseNonStreamResponse('nonsense').text).toBe('')
    expect(parseNonStreamResponse(null).toolCalls).toEqual([])
  })
})

describe('classifyUpstreamStreamError', () => {
  it.each([
    ["This model's maximum context length is 128000 tokens", 'context_length'],
    ['This model does not support image input', 'image_unsupported'],
    ['Vision is not enabled for this deployment', 'image_unsupported'],
    ["Invalid 'messages[1].content[1].image_url.url'", 'image_invalid'],
    ['Failed to download image from url', 'image_invalid'],
    ['Rate limit reached for gpt-4o', 'rate_limited'],
    ['Incorrect API key provided', 'auth'],
    ['The response was filtered by the content filter', 'content_filter'],
    ['The model `gpt-9` does not exist', 'model_unavailable'],
    ['The engine is currently overloaded', 'upstream_error'],
  ])('phân loại %j thành %s', (message, expected) => {
    expect(classifyUpstreamStreamError(message)).toBe(expected)
  })

  it('mẫu hẹp thắng mẫu rộng khi câu lỗi khớp cả hai', () => {
    // Câu này có cả "image ... not supported" lẫn "upstream"; ảnh mới là thứ người dùng sửa được.
    expect(classifyUpstreamStreamError('upstream: image input not supported by model')).toBe(
      'image_unsupported',
    )
  })

  it('không khớp mẫu nào là một kết quả hợp lệ, không phải lỗi', () => {
    expect(classifyUpstreamStreamError('something nobody has seen before')).toBe('unclassified')
    expect(classifyUpstreamStreamError('')).toBe('unclassified')
  })
})

/** Chạy hết generator để lỗi trong stream được ném ra — `streamChat` là lazy. */
async function drainStream(
  client: OpenAiCompatibleClient,
  requestId: string,
): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = []
  for await (const event of client.streamChat(
    { model: 'm', messages: [{ role: 'user', content: 'xem ảnh này' }] },
    { requestId },
  )) {
    events.push(event)
  }
  return events
}

function makeClient(fetchImpl: typeof fetch, timeoutMs = 5_000): OpenAiCompatibleClient {
  const { logger } = testLogger()
  return new OpenAiCompatibleClient({
    baseUrl: 'https://litellm.internal',
    provider: 'litellm',
    getApiKey: () => 'sk-test-key-abcdefghijklmnop',
    logger,
    timeoutMs,
    fetchImpl,
  })
}

describe('OpenAiCompatibleClient', () => {
  it('sends the bearer token and X-Request-ID, and never puts the key in the URL', async () => {
    let seen: { url: string; headers: Headers } | null = null
    const client = makeClient(async (url, init) => {
      seen = { url: String(url), headers: new Headers(init?.headers) }
      return new Response(JSON.stringify({ data: [{ id: 'model-a' }] }), { status: 200 })
    })

    await client.listModels({ requestId: 'req_1' })

    expect(seen!.url).toBe('https://litellm.internal/v1/models')
    expect(seen!.url).not.toContain('sk-test')
    expect(seen!.headers.get('authorization')).toBe('Bearer sk-test-key-abcdefghijklmnop')
    expect(seen!.headers.get('x-request-id')).toBe('req_1')
  })

  it.each([
    [401, ERROR_CODES.LITELLM_AUTH_FAILED],
    [403, ERROR_CODES.LITELLM_AUTH_FAILED],
    [429, ERROR_CODES.LITELLM_RATE_LIMITED],
    [400, ERROR_CODES.MODEL_NOT_CONFIGURED],
    [504, ERROR_CODES.LLM_TIMEOUT],
    [500, ERROR_CODES.UPSTREAM_UNAVAILABLE],
    // 413 phải có mã riêng: gộp vào UPSTREAM_UNAVAILABLE là bảo người dùng đi kiểm tra mạng
    // trong khi mạng không có lỗi gì và chính yêu cầu mới là thứ quá lớn.
    [413, ERROR_CODES.UPSTREAM_PAYLOAD_TOO_LARGE],
  ])('maps HTTP %i to %s', async (status, expected) => {
    const client = makeClient(async () => new Response('{"error":"x"}', { status }))
    await expect(client.listModels({ requestId: 'req_2' })).rejects.toMatchObject({
      code: expected,
    })
  })

  it('never leaks the api key into the error thrown to the caller', async () => {
    const client = makeClient(
      async () => new Response('{"error":"invalid key sk-test-key-abcdefghijklmnop"}', { status: 401 }),
    )
    const error = await client.listModels({ requestId: 'req_3' }).catch((e: unknown) => e)
    expect(NexaError.is(error)).toBe(true)
    expect(JSON.stringify(error)).not.toContain('sk-test-key')
    expect((error as NexaError).safeDetail).toBe('HTTP 401')
  })

  it('logs the gateway error body for GET — a bodyLength alone is not diagnosable', async () => {
    // Lỗi thật: `GET /v1/models` trả 400 và log chỉ có `bodyLength:149`, trong khi 400 gộp cả
    // "model id sai", "key mất quyền" và "cấu hình proxy hỏng" vào một mã MODEL_NOT_CONFIGURED.
    const { logger, sink } = testLogger()
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://litellm.internal',
      provider: 'litellm',
      getApiKey: () => 'sk-test-key-abcdefghijklmnop',
      logger,
      fetchImpl: async () =>
        new Response('{"error":{"message":"Invalid model list for key","code":"400"}}', { status: 400 }),
    })

    await expect(client.listModels({ requestId: 'req_body' })).rejects.toMatchObject({
      code: ERROR_CODES.MODEL_NOT_CONFIGURED,
    })
    expect(sink.asText()).toContain('Invalid model list for key')
    expect(sink.asText()).not.toContain('sk-test-key')
  })

  it('never logs the error body of a POST — it can echo the prompt back (§11.1)', async () => {
    const { logger, sink } = testLogger()
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://litellm.internal',
      provider: 'litellm',
      getApiKey: () => 'sk-test-key-abcdefghijklmnop',
      logger,
      fetchImpl: async () =>
        new Response('{"error":{"message":"echo: bí mật của người dùng trong prompt"}}', { status: 400 }),
    })

    await expect(
      client.complete({ model: 'm', messages: [{ role: 'user', content: 'bí mật' }] }, { requestId: 'req_post' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.MODEL_NOT_CONFIGURED })
    expect(sink.asText()).not.toContain('echo:')
    expect(sink.asText()).toContain('bodyLength')
  })

  it('classifies an in-stream gateway error instead of losing it', async () => {
    // Lỗi thật người dùng gặp: gửi câu hỏi kèm ảnh và chỉ nhận được "Không kết nối được tới dịch
    // vụ. Kiểm tra kết nối mạng nội bộ." — trong khi mạng không có lỗi gì.
    const { logger, sink } = testLogger()
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://litellm.internal',
      provider: 'litellm',
      getApiKey: () => 'sk-test-key-abcdefghijklmnop',
      logger,
      fetchImpl: async () =>
        new Response(
          'data: {"error":{"message":"This model does not support image input"}}\n\n',
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    })

    const error = await drainStream(client, 'req_stream').catch((e: unknown) => e)

    expect(NexaError.is(error)).toBe(true)
    // Mã lỗi mới là thứ quyết định người dùng thấy gì: `safeDetail` không rời main process, nên
    // gộp vào UPSTREAM_UNAVAILABLE đồng nghĩa với hiện ra "kiểm tra kết nối mạng nội bộ".
    expect((error as NexaError).code).toBe(ERROR_CODES.MODEL_DOES_NOT_SUPPORT_IMAGES)
    expect(sink.asText()).toContain('llm-stream-error')
    expect(sink.asText()).toContain('image_unsupported')
  })

  it('không bảo người dùng đi kiểm tra mạng khi lỗi tới TỪ TRONG stream', async () => {
    // Lỗi thật (req_c1287bae…, 2026-09-03): lượt chat kèm ảnh chết sau 40s với
    // `errorClass=upstream_error`, hiện ra thành "Không kết nối được tới dịch vụ. Kiểm tra kết nối
    // mạng nội bộ." — trong khi lượt ngay trước đó, không kèm ảnh, chạy xong trong 5 giây.
    // Một lỗi in-stream chứng minh mạng ĐANG chạy: kết nối đã mở và gateway đã trả dữ liệu.
    const { logger, sink } = testLogger()
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://litellm.internal',
      provider: 'litellm',
      getApiKey: () => 'sk-test-key-abcdefghijklmnop',
      logger,
      fetchImpl: async () =>
        new Response('data: {"error":{"message":"The engine is currently overloaded"}}\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    })

    const error = await drainStream(client, 'req_upstream').catch((e: unknown) => e)

    expect(NexaError.is(error)).toBe(true)
    expect((error as NexaError).code).toBe(ERROR_CODES.UPSTREAM_PROVIDER_FAILED)
    expect(sink.asText()).toContain('upstream_error')
  })

  it('reuses the same error code whether a cause arrives by HTTP status or inside the stream', async () => {
    // Với người dùng, "hết hạn mức" là một vấn đề duy nhất; nó tới bằng đường nào là chuyện của
    // gateway. Hai đường phải hiện ra cùng một thông điệp và cùng một gợi ý.
    const { logger } = testLogger()
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://litellm.internal',
      provider: 'litellm',
      getApiKey: () => 'sk-test-key-abcdefghijklmnop',
      logger,
      fetchImpl: async () =>
        new Response('data: {"error":{"message":"Rate limit reached for this key"}}\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    })

    const error = await drainStream(client, 'req_stream_429').catch((e: unknown) => e)

    expect((error as NexaError).code).toBe(ERROR_CODES.LITELLM_RATE_LIMITED)
  })

  it('never logs the in-stream message itself — it is a POST error body (§11.1)', async () => {
    const { logger, sink } = testLogger()
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://litellm.internal',
      provider: 'litellm',
      getApiKey: () => 'sk-test-key-abcdefghijklmnop',
      logger,
      fetchImpl: async () =>
        new Response(
          `data: {"error":{"message":"Invalid 'messages[1].content[1].image_url.url': data:image/png;base64,iVBORw0KGgoSECRET"}}\n\n`,
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    })

    const error = await drainStream(client, 'req_stream_echo').catch((e: unknown) => e)

    expect((error as NexaError).code).toBe(ERROR_CODES.IMAGE_REJECTED_BY_UPSTREAM)
    const logged = sink.asText()
    expect(logged).toContain('image_invalid')
    expect(logged).not.toContain('base64')
    expect(logged).not.toContain('iVBORw0KGgo')
    expect(logged).not.toContain('SECRET')
    expect(JSON.stringify(error)).not.toContain('iVBORw0KGgo')
  })

  it('falls back to a minimal completion when /v1/models is not enabled', async () => {
    const calls: string[] = []
    const client = makeClient(async (url) => {
      const u = String(url)
      calls.push(u)
      if (u.endsWith('/v1/models')) return new Response('not found', { status: 404 })
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'pong' } }] }),
        { status: 200 },
      )
    })

    const result = await client.testConnection({ requestId: 'req_4' }, 'model-a')
    expect(result.ok).toBe(true)
    expect(calls).toEqual([
      'https://litellm.internal/v1/models',
      'https://litellm.internal/v1/chat/completions',
    ])
  })

  it('reports auth failure from /v1/models without attempting the fallback', async () => {
    const calls: string[] = []
    const client = makeClient(async (url) => {
      calls.push(String(url))
      return new Response('unauthorized', { status: 401 })
    })

    await expect(client.testConnection({ requestId: 'req_5' }, 'model-a')).rejects.toMatchObject({
      code: ERROR_CODES.LITELLM_AUTH_FAILED,
    })
    expect(calls).toHaveLength(1)
  })

  it('streams text deltas to the caller', async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"Chào "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"bạn"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ].join('')

    const client = makeClient(
      async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )

    const chunks: string[] = []
    for await (const event of client.streamChat(
      { model: 'model-a', messages: [{ role: 'user', content: 'hi' }] },
      { requestId: 'req_6' },
    )) {
      if (event.type === 'text') chunks.push(event.delta)
    }
    expect(chunks.join('')).toBe('Chào bạn')
  })

  it('maps a user cancellation to LLM_CANCELLED, not to a timeout', async () => {
    const controller = new AbortController()
    const client = makeClient(async (_url, init) => {
      controller.abort()
      // Mô phỏng fetch phản ứng với signal đã abort.
      const err = new Error('aborted')
      err.name = 'AbortError'
      void init
      throw err
    })

    await expect(
      client.complete(
        { model: 'model-a', messages: [{ role: 'user', content: 'hi' }] },
        { requestId: 'req_7', signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.LLM_CANCELLED })
  })

  it('maps its own timeout to LLM_TIMEOUT', async () => {
    const client = makeClient(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            Object.defineProperty(err, 'cause', { value: init.signal?.reason })
            reject(err)
          })
        }),
      20,
    )

    await expect(
      client.complete({ model: 'model-a', messages: [{ role: 'user', content: 'hi' }] }, { requestId: 'req_8' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.LLM_TIMEOUT })
  })

  it('requests tools only when the caller supplies them', async () => {
    const bodies: unknown[] = []
    const client = makeClient(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
      })
    })

    await client.complete({ model: 'm', messages: [{ role: 'user', content: 'a' }] }, { requestId: 'r' })
    await client.complete(
      {
        model: 'm',
        messages: [{ role: 'user', content: 'a' }],
        tools: [
          {
            type: 'function',
            function: { name: 'jira_get_issue', description: 'd', parameters: { type: 'object' } },
          },
        ],
      },
      { requestId: 'r' },
    )

    expect(bodies[0]).not.toHaveProperty('tools')
    expect(bodies[1]).toHaveProperty('tool_choice', 'auto')
  })
})
