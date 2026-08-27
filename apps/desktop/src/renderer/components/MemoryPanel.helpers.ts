export interface MemoryDraftShape {
  readonly content: string
  readonly scope: 'global' | 'conversation'
  readonly sourceConversationId: string
  readonly kind?: string
  readonly allowExternal?: boolean
}

const MEMORY_LIMIT = 50
const MEMORY_WARNING_THRESHOLD = 45

export function getMemoryLimitState(activeCount: number): {
  readonly tone: 'normal' | 'warning' | 'danger'
  readonly message: string
} {
  if (activeCount >= MEMORY_LIMIT) {
    return {
      tone: 'danger',
      message: `Bạn đang có ${String(activeCount)} memory active. Nên dọn bớt để tránh phình system prompt.`,
    }
  }
  if (activeCount >= MEMORY_WARNING_THRESHOLD) {
    return {
      tone: 'warning',
      message: `Bạn đã dùng ${String(activeCount)}/${String(MEMORY_LIMIT)} memory active. Nên gộp hoặc archive các mục cũ.`,
    }
  }
  return {
    tone: 'normal',
    message:
      'Nexa chỉ gửi các memory đủ điều kiện vào những lượt hỏi tiếp theo. Không có mục nào được lưu tự động.',
  }
}

export function validateMemoryDraft(draft: MemoryDraftShape): string | null {
  if (draft.content.trim() === '') return 'Nội dung memory không được để trống.'
  if (draft.content.trim().length > 500) return 'Mỗi memory tối đa 500 ký tự.'
  if (draft.scope === 'conversation' && draft.sourceConversationId === '') {
    return 'Memory theo hội thoại cần chọn đúng hội thoại nguồn.'
  }
  return null
}
