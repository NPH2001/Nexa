import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { windowBackgroundColor } from './window.js'

const nativeTheme = vi.hoisted(() => ({ shouldUseDarkColors: false }))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  nativeTheme,
  session: {},
  shell: {},
}))

describe('windowBackgroundColor', () => {
  it('chọn thẳng màu của chủ đề người dùng đặt, không hỏi hệ điều hành', () => {
    nativeTheme.shouldUseDarkColors = true
    expect(windowBackgroundColor('light')).toBe('#f5f9fe')
    nativeTheme.shouldUseDarkColors = false
    expect(windowBackgroundColor('dark')).toBe('#0d1220')
  })

  it('theo hệ điều hành khi người dùng chọn "system"', () => {
    nativeTheme.shouldUseDarkColors = true
    expect(windowBackgroundColor('system')).toBe('#0d1220')
    nativeTheme.shouldUseDarkColors = false
    expect(windowBackgroundColor('system')).toBe('#f5f9fe')
  })

  it('khớp `--bg` sáng rồi tối trong styles.css, để mở app không loé màu khác', () => {
    const css = readFileSync(join(import.meta.dirname, '../renderer/styles.css'), 'utf8')
    const backgrounds = [...css.matchAll(/--bg:\s*(#[0-9a-f]{6});/gi)].map((m) => m[1])
    expect(backgrounds).toEqual([windowBackgroundColor('light'), windowBackgroundColor('dark')])
  })
})
