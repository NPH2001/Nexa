import type {
  ChatRequest,
  ChatStreamEvent,
  ChatToolCall,
  LiteLlmClient,
} from '@nexa/llm-client'

/** Một lượt trả lời đã kịch bản hoá. */
export interface ScriptedTurn {
  readonly text?: string
  readonly toolCalls?: readonly { name: string; args: unknown }[]
  /** Ném lỗi thay vì trả lời — để test đường lỗi của runtime. */
  readonly throws?: unknown
}

/**
 * LLM giả, phát lại một kịch bản cố định.
 *
 * Cần thiết vì AgentRuntime là một máy trạng thái: muốn test "vòng 1 gọi tool, vòng 2 trả lời"
 * thì phải điều khiển được model trả gì ở từng vòng. Ghi lại `requests` để test khẳng định
 * được cả những gì KHÔNG được gửi đi.
 */
export class FakeLlmClient {
  readonly requests: ChatRequest[] = []
  private turn = 0

  constructor(private readonly script: readonly ScriptedTurn[]) {}

  get turnsConsumed(): number {
    return this.turn
  }

  async *streamChat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    this.requests.push(request)
    const step = this.script[this.turn] ?? { text: '' }
    this.turn++

    if (step.throws !== undefined) throw step.throws

    if (step.text !== undefined && step.text !== '') {
      // Chia nhỏ để giống stream thật, và để test nhận được nhiều delta.
      for (const piece of chunk(step.text, 5)) {
        yield { type: 'text', delta: piece }
      }
    }

    if (step.toolCalls !== undefined && step.toolCalls.length > 0) {
      const toolCalls: ChatToolCall[] = step.toolCalls.map((c, i) => ({
        id: `call_${String(this.turn)}_${String(i)}`,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      }))
      yield { type: 'tool-calls', toolCalls }
      yield { type: 'finish', reason: 'tool_calls' }
      return
    }

    yield { type: 'usage', usage: { promptTokens: 10, completionTokens: 5 } }
    yield { type: 'finish', reason: 'stop' }
  }

  asClient(): LiteLlmClient {
    return this as unknown as LiteLlmClient
  }
}

function chunk(text: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}
