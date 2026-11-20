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
      message: `Bạn đang có ${String(activeCount)} ghi nhớ đang dùng. Nên dọn bớt để phần ngữ cảnh gửi kèm mỗi câu hỏi không phình quá.`,
    }
  }
  if (activeCount >= MEMORY_WARNING_THRESHOLD) {
    return {
      tone: 'warning',
      message: `Bạn đã dùng ${String(activeCount)}/${String(MEMORY_LIMIT)} ghi nhớ đang dùng. Nên gộp hoặc lưu trữ các mục cũ.`,
    }
  }
  return {
    tone: 'normal',
    message:
      'Nexa chỉ gửi kèm các ghi nhớ đủ điều kiện ở những lượt hỏi tiếp theo. Không có mục nào được lưu tự động.',
  }
}

export function validateMemoryDraft(draft: MemoryDraftShape): string | null {
  if (draft.content.trim() === '') return 'Nội dung ghi nhớ không được để trống.'
  if (draft.content.trim().length > 500) return 'Mỗi ghi nhớ tối đa 500 ký tự.'
  if (draft.scope === 'conversation' && draft.sourceConversationId === '') {
    return 'Ghi nhớ theo hội thoại cần chọn đúng hội thoại nguồn.'
  }
  return null
}
