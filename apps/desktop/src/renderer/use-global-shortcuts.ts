import { useEffect, useRef } from 'react'
import { matchShortcut, type ShortcutAction } from './shortcuts-ui.js'

/**
 * Gắn bảng phím tắt toàn cục (`shortcuts-ui.ts`) vào cửa sổ.
 *
 * `handler` được giữ trong ref để listener chỉ gắn một lần: App tạo lại các hàm như
 * `createConversation` ở mỗi lần render, và gỡ ra gắn lại listener theo từng render là thừa.
 */
export function useGlobalShortcuts(
  handler: (action: ShortcutAction) => void,
  baEnabled: boolean,
): void {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const action = matchShortcut(e, {
        // Dialog modal (xác nhận tool, xoá) tự quản phím của nó; phím tắt điều hướng mà chạy
        // lúc đó sẽ đổi màn hình ngay sau lưng một câu hỏi chưa trả lời.
        modalOpen: document.querySelector('[aria-modal="true"]') !== null,
        baEnabled,
      })
      if (action === null) return
      e.preventDefault()
      handlerRef.current(action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [baEnabled])
}
