import type { ChatStreamEvent, ChatToolCall, FinishReason, TokenUsage } from './types.js'

/**
 * Bộ ghép SSE cho `chat/completions` dạng stream.
 *
 * Tách khỏi client HTTP để test được bằng chuỗi thuần — luồng SSE là chỗ dễ sai nhất và cũng
 * là chỗ chưa được kiểm chứng với LiteLLM thật (xem docs/OPEN-QUESTIONS.md B10).
 *
 * Hai điểm cần cẩn thận:
 *  1. Một chunk TCP có thể cắt ngang giữa một sự kiện SSE ⇒ phải giữ phần dư (`buffer`).
 *  2. `tool_calls` đến từng mảnh: `function.arguments` được nối dần qua nhiều delta, và các
 *     tool call khác nhau phân biệt bằng `index` chứ không phải `id` (id chỉ có ở mảnh đầu).
 */
export class SseAccumulator {
  private buffer = ''
  private text = ''
  private finishReason: FinishReason = 'unknown'
  private usage: TokenUsage | undefined
  private readonly toolCalls = new Map<number, MutableToolCall>()
  private finished = false

  /** Nạp một chunk thô, trả về các sự kiện đã hoàn chỉnh trong chunk đó. */
  push(chunk: string): ChatStreamEvent[] {
    this.buffer += chunk
    const events: ChatStreamEvent[] = []

    // SSE phân tách sự kiện bằng dòng trống. Chấp nhận cả CRLF.
    let sep: number
    while ((sep = findSeparator(this.buffer)) >= 0) {
      const rawEvent = this.buffer.slice(0, sep)
      this.buffer = this.buffer.slice(sep).replace(/^(\r?\n){2}/, '')
      this.handleEvent(rawEvent, events)
    }
    return events
  }

  /** Gọi khi stream đóng. Xả phần dư và phát sự kiện kết thúc. */
  end(): ChatStreamEvent[] {
    const events: ChatStreamEvent[] = []
    if (this.buffer.trim() !== '') {
      this.handleEvent(this.buffer, events)
      this.buffer = ''
    }
    if (!this.finished) {
      this.emitTerminal(events)
      this.finished = true
    }
    return events
  }

  get result(): { text: string; toolCalls: ChatToolCall[]; finishReason: FinishReason; usage?: TokenUsage } {
    return {
      text: this.text,
      toolCalls: this.collectToolCalls(),
      finishReason: this.finishReason,
      ...(this.usage !== undefined ? { usage: this.usage } : {}),
    }
  }

  private handleEvent(rawEvent: string, events: ChatStreamEvent[]): void {
    for (const line of rawEvent.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue // bỏ qua `event:`, `id:`, comment `:`
      const payload = line.slice(5).trim()
      if (payload === '') continue

      if (payload === '[DONE]') {
        if (!this.finished) {
          this.emitTerminal(events)
          this.finished = true
        }
        continue
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(payload)
      } catch {
        // Một chunk JSON hỏng không nên giết cả câu trả lời — bỏ qua và đi tiếp.
        continue
      }
      this.applyChunk(parsed, events)
    }
  }

  private applyChunk(parsed: unknown, events: ChatStreamEvent[]): void {
    if (typeof parsed !== 'object' || parsed === null) return
    const obj = parsed as Record<string, unknown>

    // LiteLLM có thể trả lỗi ngay trong stream thay vì bằng HTTP status.
    const err = obj['error']
    if (typeof err === 'object' && err !== null) {
      const message = String((err as Record<string, unknown>)['message'] ?? 'upstream error')
      throw new SseStreamError(message)
    }

    const usageRaw = obj['usage']
    if (typeof usageRaw === 'object' && usageRaw !== null) {
      const u = usageRaw as Record<string, unknown>
      this.usage = {
        promptTokens: Number(u['prompt_tokens'] ?? 0),
        completionTokens: Number(u['completion_tokens'] ?? 0),
      }
      events.push({ type: 'usage', usage: this.usage })
    }

    const choices = obj['choices']
    if (!Array.isArray(choices) || choices.length === 0) return
    const choice = choices[0] as Record<string, unknown>

    const finish = choice['finish_reason']
    if (typeof finish === 'string' && finish !== '') {
      this.finishReason = normalizeFinish(finish)
    }

    const delta = choice['delta']
    if (typeof delta !== 'object' || delta === null) return
    const d = delta as Record<string, unknown>

    const content = d['content']
    if (typeof content === 'string' && content !== '') {
      this.text += content
      events.push({ type: 'text', delta: content })
    }

    const toolCallsRaw = d['tool_calls']
    if (Array.isArray(toolCallsRaw)) {
      for (const [position, entry] of toolCallsRaw.entries()) {
        if (typeof entry !== 'object' || entry === null) continue
        const t = entry as Record<string, unknown>
        // `index` là thứ ổn định giữa các delta. Một số gateway bỏ qua nó khi chỉ có một
        // tool call — khi đó lấy vị trí trong mảng làm thay.
        const index = typeof t['index'] === 'number' ? t['index'] : position
        const existing = this.toolCalls.get(index) ?? { id: '', name: '', args: '' }

        if (typeof t['id'] === 'string' && t['id'] !== '') existing.id = t['id']
        const fn = t['function']
        if (typeof fn === 'object' && fn !== null) {
          const f = fn as Record<string, unknown>
          if (typeof f['name'] === 'string' && f['name'] !== '') existing.name = f['name']
          if (typeof f['arguments'] === 'string') existing.args += f['arguments']
        }
        this.toolCalls.set(index, existing)
      }
    }
  }

  private emitTerminal(events: ChatStreamEvent[]): void {
    const calls = this.collectToolCalls()
    if (calls.length > 0) {
      // Một số gateway quên đặt finish_reason khi có tool call; suy ra cho nhất quán.
      if (this.finishReason === 'unknown') this.finishReason = 'tool_calls'
      events.push({ type: 'tool-calls', toolCalls: calls })
    }
    if (this.finishReason === 'unknown' && this.text !== '') this.finishReason = 'stop'
    events.push({ type: 'finish', reason: this.finishReason })
  }

  private collectToolCalls(): ChatToolCall[] {
    return [...this.toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, c]) => c.name !== '')
      .map(([index, c]) => ({
        // id rỗng vẫn phải có giá trị: role='tool' bắt buộc `tool_call_id`, và model sẽ từ chối
        // message không khớp id.
        id: c.id !== '' ? c.id : `call_${String(index)}`,
        type: 'function' as const,
        function: { name: c.name, arguments: c.args },
      }))
  }
}

/** Lỗi do payload SSE báo, phân biệt với lỗi mạng. */
export class SseStreamError extends Error {}

interface MutableToolCall {
  id: string
  name: string
  args: string
}

function findSeparator(buffer: string): number {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf < 0) return crlf
  if (crlf < 0) return lf
  return Math.min(lf, crlf)
}

function normalizeFinish(raw: string): FinishReason {
  switch (raw) {
    case 'stop':
    case 'length':
    case 'tool_calls':
    case 'content_filter':
      return raw
    case 'function_call':
      return 'tool_calls'
    default:
      return 'unknown'
  }
}

/** Phân tích một response non-stream (khi tắt streaming hoặc khi test kết nối). */
export function parseNonStreamResponse(body: unknown): {
  text: string
  toolCalls: ChatToolCall[]
  finishReason: FinishReason
  usage?: TokenUsage
} {
  const acc = { text: '', toolCalls: [] as ChatToolCall[], finishReason: 'unknown' as FinishReason }
  if (typeof body !== 'object' || body === null) return acc

  const obj = body as Record<string, unknown>
  let usage: TokenUsage | undefined
  const usageRaw = obj['usage']
  if (typeof usageRaw === 'object' && usageRaw !== null) {
    const u = usageRaw as Record<string, unknown>
    usage = {
      promptTokens: Number(u['prompt_tokens'] ?? 0),
      completionTokens: Number(u['completion_tokens'] ?? 0),
    }
  }

  const choices = obj['choices']
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0] as Record<string, unknown>
    const finish = choice['finish_reason']
    if (typeof finish === 'string') acc.finishReason = normalizeFinish(finish)

    const message = choice['message']
    if (typeof message === 'object' && message !== null) {
      const m = message as Record<string, unknown>
      if (typeof m['content'] === 'string') acc.text = m['content']
      const tc = m['tool_calls']
      if (Array.isArray(tc)) {
        acc.toolCalls = tc.flatMap((entry, i) => {
          if (typeof entry !== 'object' || entry === null) return []
          const t = entry as Record<string, unknown>
          const fn = t['function']
          if (typeof fn !== 'object' || fn === null) return []
          const f = fn as Record<string, unknown>
          const name = typeof f['name'] === 'string' ? f['name'] : ''
          if (name === '') return []
          return [
            {
              id: typeof t['id'] === 'string' && t['id'] !== '' ? t['id'] : `call_${String(i)}`,
              type: 'function' as const,
              function: {
                name,
                arguments: typeof f['arguments'] === 'string' ? f['arguments'] : '{}',
              },
            },
          ]
        })
      }
    }
  }

  return { ...acc, ...(usage !== undefined ? { usage } : {}) }
}
