import type { Toast } from './Toasts.js'

/**
 * Thời gian sống của toast.
 *
 * Lỗi KHÔNG tự tắt: toast lỗi thường mang mã yêu cầu mà người dùng cần chép lại khi báo lỗi
 * (§9.3), và một lỗi biến mất sau 8 giây khi người dùng đang nhìn chỗ khác thì coi như chưa
 * từng được báo (DESIGN.md "Error"). Thông báo khác chỉ xác nhận việc vừa làm nên tự tắt.
 */
export function toastLifetimeMs(kind: Toast['kind']): number | null {
  switch (kind) {
    case 'error':
      return null
    case 'warning':
      return 12_000
    default:
      return 6_000
  }
}

/** Số toast hiện cùng lúc; quá số này thì bỏ cái cũ nhất, ưu tiên bỏ thông báo không phải lỗi. */
export const MAX_VISIBLE_TOASTS = 4

/**
 * Thêm toast. Toast trùng nội dung với một cái đang hiện thì THAY cái cũ (lưu hai lần liền
 * nhau không cần hai dòng "Đã lưu"), và được đưa xuống cuối như mới.
 */
export function appendToast(list: readonly Toast[], toast: Toast): Toast[] {
  const next = [
    ...list.filter(
      (t) => !(t.kind === toast.kind && t.title === toast.title && t.detail === toast.detail),
    ),
    toast,
  ]
  while (next.length > MAX_VISIBLE_TOASTS) {
    const dropIndex = next.findIndex((t) => t.kind !== 'error')
    next.splice(dropIndex === -1 ? 0 : dropIndex, 1)
  }
  return next
}
