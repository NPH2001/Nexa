/**
 * Bảng phím tắt toàn cục của cửa sổ chính.
 *
 * Tách khỏi hook để luật "phím nào làm gì, khi nào thì không làm" test được mà không cần DOM.
 * Chỉ dùng Ctrl+phím, không dùng phím đơn: người dùng gõ tiếng Việt bằng Telex/VNI suốt, và một
 * phím đơn bị bắt toàn cục sẽ nuốt mất chữ.
 */

export type ShortcutAction =
  | { kind: 'new-conversation' }
  | { kind: 'focus-search' }
  | { kind: 'open-settings' }
  | { kind: 'view'; view: 'today' | 'goals' | 'activity' | 'ba' }

export interface ShortcutKey {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  /** Đang gõ dở trong bộ gõ (IME): phím thuộc về bộ gõ, không phải về app. */
  isComposing: boolean
}

interface ShortcutContext {
  /** Có dialog modal đang mở: mọi phím tắt điều hướng phải chờ dialog đóng. */
  modalOpen: boolean
  baEnabled: boolean
}

/** Thứ tự Ctrl+1…4 đúng thứ tự trên thanh bên. */
const VIEW_KEYS: Record<string, 'today' | 'goals' | 'activity' | 'ba'> = {
  '1': 'today',
  '2': 'goals',
  '3': 'activity',
  '4': 'ba',
}

export function matchShortcut(e: ShortcutKey, ctx: ShortcutContext): ShortcutAction | null {
  if (e.isComposing || ctx.modalOpen) return null
  const mod = e.ctrlKey || e.metaKey
  if (!mod || e.altKey || e.shiftKey) return null
  const key = e.key.toLowerCase()
  if (key === 'n') return { kind: 'new-conversation' }
  if (key === 'k') return { kind: 'focus-search' }
  if (key === ',') return { kind: 'open-settings' }
  const view = VIEW_KEYS[key]
  if (view === undefined) return null
  if (view === 'ba' && !ctx.baEnabled) return null
  return { kind: 'view', view }
}

/** Nhãn hiển thị cho gợi ý (title) và giá trị `aria-keyshortcuts` tương ứng. */
export const SHORTCUT_HINTS = {
  newConversation: { label: 'Ctrl+N', aria: 'Control+N' },
  focusSearch: { label: 'Ctrl+K', aria: 'Control+K' },
  settings: { label: 'Ctrl+,', aria: 'Control+Comma' },
  today: { label: 'Ctrl+1', aria: 'Control+1' },
  goals: { label: 'Ctrl+2', aria: 'Control+2' },
  activity: { label: 'Ctrl+3', aria: 'Control+3' },
  ba: { label: 'Ctrl+4', aria: 'Control+4' },
} as const
