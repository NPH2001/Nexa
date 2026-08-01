/** Kiểu tương thích OpenAI mà LiteLLM nhận (§9.1 `POST /v1/chat/completions`). */

export interface ChatToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string
  /** Bắt buộc với role='tool' — phải echo lại id model đã sinh. */
  readonly tool_call_id?: string
  /** Chỉ với assistant message đã đề xuất tool. */
  readonly tool_calls?: readonly ChatToolCall[]
}

export interface ChatToolSpec {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description: string
    readonly parameters: Record<string, unknown>
  }
}

export interface ChatRequest {
  readonly model: string
  readonly messages: readonly ChatMessage[]
  readonly tools?: readonly ChatToolSpec[]
  readonly temperature?: number
  readonly maxTokens?: number
}

export interface TokenUsage {
  readonly promptTokens: number
  readonly completionTokens: number
}

/** Sự kiện phát ra trong lúc stream. */
export type ChatStreamEvent =
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'tool-calls'; readonly toolCalls: readonly ChatToolCall[] }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | { readonly type: 'finish'; readonly reason: FinishReason }

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown'

export interface ChatResult {
  readonly text: string
  readonly toolCalls: readonly ChatToolCall[]
  readonly finishReason: FinishReason
  readonly usage?: TokenUsage
}
