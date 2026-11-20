import { describe, expect, it, vi } from 'vitest'
import {
  applyResolvedTheme,
  parseThemePreference,
  readCachedTheme,
  resolveTheme,
  writeCachedTheme,
} from './theme.js'

describe('theme preference', () => {
  it('lựa chọn tường minh thắng cài đặt của hệ điều hành', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('`system` đi theo hệ điều hành', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('chỉ nhận đúng ba giá trị đã khai báo', () => {
    expect(parseThemePreference('dark')).toBe('dark')
    expect(parseThemePreference('DARK')).toBeNull()
    expect(parseThemePreference('')).toBeNull()
    expect(parseThemePreference(null)).toBeNull()
    expect(parseThemePreference(1)).toBeNull()
  })

  it('sơn theme đã phân giải lên phần tử gốc', () => {
    const root = { dataset: {} } as unknown as HTMLElement
    applyResolvedTheme(root, 'dark')
    expect(root.dataset.theme).toBe('dark')
    applyResolvedTheme(root, 'light')
    expect(root.dataset.theme).toBe('light')
  })
})

describe('theme cache', () => {
  it('bỏ qua giá trị rác còn sót trong storage', () => {
    expect(readCachedTheme({ getItem: () => 'midnight' })).toBeNull()
    expect(readCachedTheme({ getItem: () => null })).toBeNull()
    expect(readCachedTheme({ getItem: () => 'light' })).toBe('light')
  })

  // Storage bị chặn không được làm chết renderer: mất cache chỉ là mất một nhịp không nháy sáng.
  it('storage ném lỗi thì coi như chưa có cache và ghi vẫn im lặng', () => {
    const throwing = {
      getItem: () => {
        throw new Error('storage bị chặn')
      },
      setItem: () => {
        throw new Error('storage bị chặn')
      },
    }
    expect(readCachedTheme(throwing)).toBeNull()
    expect(() => writeCachedTheme(throwing, 'dark')).not.toThrow()
  })

  it('không có storage thì không ghi gì', () => {
    expect(readCachedTheme(null)).toBeNull()
    expect(() => writeCachedTheme(null, 'dark')).not.toThrow()
  })

  it('ghi lại đúng lựa chọn để lần mở sau sơn ngay', () => {
    const setItem = vi.fn()
    writeCachedTheme({ setItem }, 'dark')
    expect(setItem).toHaveBeenCalledWith('nexa.theme.v1', 'dark')
  })
})
