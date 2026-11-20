import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownText } from './MarkdownText.js'

const render = (text: string): string => renderToStaticMarkup(createElement(MarkdownText, { text }))

describe('MarkdownText', () => {
  it('render bảng GFM thành <table> trong khung cuộn ngang', () => {
    const html = render('| ID | Task |\n|---|---|\n| #1 | Làm A |')
    expect(html).toContain('<div class="md-table-wrap"><table>')
    expect(html).toContain('<th>ID</th>')
    expect(html).toContain('<td>Làm A</td>')
  })

  it('render in đậm và danh sách', () => {
    const html = render('Có **3 task**:\n\n- một\n- hai')
    expect(html).toContain('<strong>3 task</strong>')
    expect(html).toContain('<li>hai</li>')
  })

  it('HTML thô không thành element', () => {
    const html = render('<script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('link https mở ngoài, link javascript: chỉ còn chữ', () => {
    const ok = render('[Nexa](https://example.com)')
    expect(ok).toContain('href="https://example.com"')
    expect(ok).toContain('target="_blank"')
    expect(ok).toContain('rel="noopener noreferrer"')

    const bad = render('[bấm](javascript:alert(1))')
    expect(bad).not.toContain('href')
    expect(bad).toContain('bấm')
  })

  it('ảnh chỉ còn alt text', () => {
    const html = render('![sơ đồ](https://example.com/a.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('sơ đồ')
  })
})
