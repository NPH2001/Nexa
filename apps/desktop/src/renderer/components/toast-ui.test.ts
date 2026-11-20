import { describe, expect, it } from 'vitest'
import type { Toast } from './Toasts.js'
import { MAX_VISIBLE_TOASTS, appendToast, toastLifetimeMs } from './toast-ui.js'

const toast = (id: number, kind: Toast['kind']): Toast => ({ id, kind, title: `t${String(id)}` })

describe('toastLifetimeMs', () => {
  it('lỗi không tự tắt', () => {
    expect(toastLifetimeMs('error')).toBeNull()
  })

  it('thông báo khác tự tắt, cảnh báo ở lâu hơn', () => {
    const info = toastLifetimeMs('info')
    const warning = toastLifetimeMs('warning')
    expect(info).toBeGreaterThan(0)
    expect(warning).toBeGreaterThan(info ?? 0)
    expect(toastLifetimeMs('success')).toBe(info)
  })
})

describe('appendToast', () => {
  it('giữ nguyên khi chưa vượt giới hạn', () => {
    expect(appendToast([toast(1, 'info')], toast(2, 'error')).map((t) => t.id)).toEqual([1, 2])
  })

  it('quá giới hạn thì bỏ thông báo không phải lỗi cũ nhất trước', () => {
    const list = [toast(1, 'error'), toast(2, 'info'), toast(3, 'error'), toast(4, 'success')]
    const next = appendToast(list, toast(5, 'error'))
    expect(next).toHaveLength(MAX_VISIBLE_TOASTS)
    expect(next.map((t) => t.id)).toEqual([1, 3, 4, 5])
  })

  it('toast trùng nội dung thay cho cái đang hiện', () => {
    const saved = (id: number): Toast => ({ id, kind: 'success', title: 'Đã lưu' })
    expect(appendToast([saved(1), toast(2, 'info')], saved(3)).map((t) => t.id)).toEqual([2, 3])
  })

  it('cùng tiêu đề nhưng khác chi tiết thì vẫn là hai toast', () => {
    const a: Toast = { id: 1, kind: 'error', title: 'Lỗi', detail: 'Mã yêu cầu: a' }
    const b: Toast = { id: 2, kind: 'error', title: 'Lỗi', detail: 'Mã yêu cầu: b' }
    expect(appendToast([a], b)).toHaveLength(2)
  })

  it('toàn lỗi thì bỏ lỗi cũ nhất', () => {
    const list = [1, 2, 3, 4].map((id) => toast(id, 'error'))
    expect(appendToast(list, toast(5, 'error')).map((t) => t.id)).toEqual([2, 3, 4, 5])
  })
})
