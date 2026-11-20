/**
 * Luật "khi nào được bấm Gửi" của composer, cùng câu giải thích khi không được.
 *
 * Tách khỏi `ChatView.tsx` vì nút bị khoá mà không nói lý do là điều DESIGN.md cấm ("explain the
 * prerequisite"). Điều kiện khoá và câu giải thích phải đi cùng một chỗ, để không có điều kiện
 * nào khoá nút mà không kèm lý do.
 */

export interface SendState {
  busy: boolean
  draft: string
  /** Chưa chọn được model nào, kể cả khi model đã lưu không còn trong danh sách. */
  modelMissing: boolean
  /** Có đính kèm tài liệu mà chính sách provider không cho gửi. */
  documentBlocked: boolean
  /** Có ảnh đính kèm mà model đang chọn không nhận ảnh. */
  imageBlocked: boolean
}

/**
 * Trả về lý do nút Gửi bị khoá, hoặc `null` khi gửi được. Thứ tự là thứ tự người dùng cần xử lý:
 * đang chờ trả lời thì những lý do khác chưa quan trọng.
 */
export function sendBlockedReason(state: SendState): string | null {
  if (state.busy) return 'Nexa đang xử lý câu trước. Chờ một chút rồi gửi tiếp.'
  if (state.modelMissing) return 'Chọn một model ở đầu cuộc trò chuyện để gửi.'
  if (state.documentBlocked) return 'Model này không được nhận tài liệu đính kèm. Gỡ tài liệu hoặc đổi model.'
  if (state.imageBlocked) return 'Model này không đọc được ảnh. Gỡ ảnh hoặc đổi model.'
  if (state.draft.trim() === '') return 'Nhập nội dung câu hỏi để gửi.'
  return null
}
