/** Kiểu tương thích OpenAI mà LiteLLM nhận (§9.1 `POST /v1/chat/completions`). */

export interface ChatToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

/**
 * Một mảnh nội dung trong message đa phương thức.
 *
 * Chỉ hai loại, vì đó là hai loại mà giao thức OpenAI-compatible định nghĩa và LiteLLM chuyển
 * tiếp được tới mọi provider phía sau. Ảnh đi dưới dạng data URL `data:image/png;base64,…` —
 * KHÔNG dùng URL mạng, vì URL mạng sẽ khiến provider tự đi tải file, tức là mở một đường ra
 * ngoài mà Nexa không kiểm soát được (§11.2).
 */
export type ChatContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image_url'
      readonly image_url: { readonly url: string; readonly detail?: 'auto' | 'low' | 'high' }
    }

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  /**
   * Chuỗi thuần cho message chỉ có chữ, hoặc mảng mảnh khi có ảnh kèm theo.
   *
   * Giữ dạng chuỗi làm mặc định có chủ ý: tuyệt đại đa số message không có ảnh, và một số
   * gateway cũ chỉ chấp nhận chuỗi. Chỉ khi thật sự có ảnh mới chuyển sang dạng mảng.
   */
  readonly content: string | readonly ChatContentPart[]
  /** Bắt buộc với role='tool' — phải echo lại id model đã sinh. */
  readonly tool_call_id?: string
  /** Chỉ với assistant message đã đề xuất tool. */
  readonly tool_calls?: readonly ChatToolCall[]
}

/**
 * Phần CHỮ của một message, bỏ qua ảnh.
 *
 * Dùng cho những chỗ chỉ quan tâm tới văn bản: đếm token, ghi log, khẳng định trong test. Ảnh
 * cố ý không có biểu diễn văn bản ở đây — nơi nào cần ảnh thì phải xử lý `content` dạng mảng
 * một cách tường minh, thay vì vô tình nhận một chuỗi rỗng rồi tưởng là không có gì.
 */
export function messageText(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content
  return message.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
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
