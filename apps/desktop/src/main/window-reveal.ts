import type { NavigateView } from '@nexa/shared-types'

/**
 * Đánh thức cửa sổ rồi điều hướng (openspec `add-os-checkin-notifications`).
 *
 * Đường đi chung cho hai lối vào: bấm vào thông báo OS và chọn "Mở Nexa" từ menu tray. Cả hai
 * phải kết thúc ở cùng một chỗ — cửa sổ hiện, được focus, đang ở màn Hôm nay — kể cả khi người
 * dùng đã đóng hết cửa sổ và tiến trình còn sống nhờ tray.
 *
 * Tách ra khỏi `index.ts` vì `index.ts` chạy `app.whenReady()` ngay lúc import nên không nạp
 * được trong vitest; logic ở đây là chỗ dễ sai (thứ tự restore/show/focus, cửa sổ chưa load
 * xong) nên nó phải kiểm chứng được.
 */

/** `BrowserWindow` hẹp đúng bằng phần cần cho việc đánh thức. */
export interface RevealWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  restore(): void
  show(): void
  focus(): void
  /** Renderer chưa nạp xong thì event `navigate` gửi lúc này sẽ rơi vào hư không. */
  isLoading(): boolean
  onceLoaded(listener: () => void): void
  sendNavigate(view: NavigateView): void
}

export interface RevealPorts {
  readonly getWindow: () => RevealWindow | null
  readonly openWindow: () => RevealWindow | null
}

export function revealAndNavigate(ports: RevealPorts, view: NavigateView = 'today'): void {
  const existing = ports.getWindow()
  const window = existing === null || existing.isDestroyed() ? ports.openWindow() : existing
  if (window === null) return

  // Thứ tự có ý nghĩa: một cửa sổ thu nhỏ phải được restore trước, vì `focus()` trên cửa sổ
  // đang minimize không đưa nó lên trên ở mọi window manager.
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()

  if (!window.isLoading()) {
    window.sendNavigate(view)
    return
  }
  window.onceLoaded(() => {
    if (window.isDestroyed()) return
    window.sendNavigate(view)
  })
}
