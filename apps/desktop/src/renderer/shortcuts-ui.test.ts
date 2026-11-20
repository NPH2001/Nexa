import { describe, expect, it } from 'vitest'
import { matchShortcut, type ShortcutKey } from './shortcuts-ui.js'

const key = (k: string, extra: Partial<ShortcutKey> = {}): ShortcutKey => ({
  key: k,
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  ...extra,
})
const ctx = { modalOpen: false, baEnabled: true }

describe('matchShortcut', () => {
  it('nhận các phím tắt chính', () => {
    expect(matchShortcut(key('n'), ctx)).toEqual({ kind: 'new-conversation' })
    expect(matchShortcut(key('K'), ctx)).toEqual({ kind: 'focus-search' })
    expect(matchShortcut(key(','), ctx)).toEqual({ kind: 'open-settings' })
    expect(matchShortcut(key('1'), ctx)).toEqual({ kind: 'view', view: 'today' })
    expect(matchShortcut(key('3'), ctx)).toEqual({ kind: 'view', view: 'activity' })
  })

  it('bỏ qua phím không có Ctrl, để không nuốt chữ khi gõ', () => {
    expect(matchShortcut(key('n', { ctrlKey: false }), ctx)).toBeNull()
  })

  it('bỏ qua khi đang gõ dở trong bộ gõ tiếng Việt', () => {
    expect(matchShortcut(key('n', { isComposing: true }), ctx)).toBeNull()
  })

  it('không điều hướng khi có dialog đang mở', () => {
    expect(matchShortcut(key('1'), { ...ctx, modalOpen: true })).toBeNull()
  })

  it('không chiếm tổ hợp có Shift/Alt', () => {
    expect(matchShortcut(key('n', { shiftKey: true }), ctx)).toBeNull()
    expect(matchShortcut(key('n', { altKey: true }), ctx)).toBeNull()
  })

  it('Ctrl+4 chỉ có tác dụng khi Nghiệp vụ đang bật', () => {
    expect(matchShortcut(key('4'), ctx)).toEqual({ kind: 'view', view: 'ba' })
    expect(matchShortcut(key('4'), { ...ctx, baEnabled: false })).toBeNull()
  })
})
