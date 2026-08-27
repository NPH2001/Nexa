import { describe, expect, it } from 'vitest'
import { contentToText, parseToolResult } from './protocol.js'

describe('MCP tool result content', () => {
  it('keeps text and explicitly reports non-text blocks instead of dropping them silently', () => {
    const result = parseToolResult({
      content: [
        { type: 'text', text: 'Kết quả dạng chữ' },
        { type: 'image', mimeType: 'image/png' },
        { type: 'resource', uri: 'mcp://document/42' },
        { type: 'audio', data: 'ignored' },
      ],
      isError: false,
    })

    expect(contentToText(result)).toBe(
      [
        '[KẾT QUẢ CÔNG CỤ CHƯA ĐẦY ĐỦ]',
        'Kết quả dạng chữ',
        '[Công cụ còn trả về hình ảnh image/png; nội dung hình ảnh chưa được đọc.]',
        '[Công cụ còn trả về tài nguyên mcp://document/42; nội dung tài nguyên chưa được đọc.]',
        '[Công cụ còn trả về một loại nội dung chưa được hỗ trợ.]',
      ].join('\n'),
    )
  })

  it('returns a useful explanation when the tool result contains only an image', () => {
    const result = parseToolResult({
      content: [{ type: 'image', mimeType: 'image/jpeg' }],
      isError: false,
    })

    expect(contentToText(result)).toContain('hình ảnh image/jpeg')
    expect(contentToText(result)).toContain('chưa được đọc')
  })
})
