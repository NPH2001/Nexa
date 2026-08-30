import { describe, expect, it } from 'vitest'
import { splitSections } from './sections.js'

describe('cắt theo heading', () => {
  it('tách theo heading markdown và giữ đường dẫn mục', () => {
    const sections = splitSections(
      ['# US-01', 'Mở đầu', '## 1. Luồng chính', 'Bước một', '## 2. Ngoại lệ', 'Lỗi E001'].join(
        '\n',
      ),
    )
    expect(sections.map((section) => section.anchor)).toEqual([
      'US-01',
      'US-01 > 1. Luồng chính',
      'US-01 > 2. Ngoại lệ',
    ])
  })

  it('nhận heading đánh số kiểu tài liệu Việt', () => {
    const sections = splitSections(['3. Luồng nghiệp vụ', 'Nội dung', '3.2 Ngoại lệ', 'Lỗi'].join('\n'))
    expect(sections.map((section) => section.anchor)).toEqual([
      '3 Luồng nghiệp vụ',
      '3 Luồng nghiệp vụ > 3.2 Ngoại lệ',
    ])
  })

  it('không nhầm một câu văn có số thành heading', () => {
    const sections = splitSections('3. Đơn trên 500k được miễn phí giao hàng.')
    expect(sections).toHaveLength(1)
    expect(sections[0]?.anchor).toBe('')
  })

  it('phần mở đầu trước heading đầu tiên không có anchor', () => {
    const sections = splitSections(['Tài liệu mô tả nghiệp vụ.', '# 1. Phạm vi', 'Nội dung'].join('\n'))
    expect(sections[0]?.anchor).toBe('')
    expect(sections[1]?.anchor).toBe('1. Phạm vi')
  })

  it('cắt tiếp section quá dài theo ranh giới đoạn văn', () => {
    const long = ['# Mục', 'a'.repeat(90), '', 'b'.repeat(90)].join('\n')
    const sections = splitSections(long, 100)
    expect(sections.length).toBeGreaterThan(1)
    for (const section of sections) expect(section.text.length).toBeLessThanOrEqual(100)
    expect(sections.every((section) => section.anchor === 'Mục')).toBe(true)
  })

  it('cắt cứng khi một đoạn văn dài hơn giới hạn', () => {
    const sections = splitSections('x'.repeat(250), 100)
    expect(sections.map((section) => section.text.length)).toEqual([100, 100, 50])
  })

  it('bỏ qua section rỗng', () => {
    expect(splitSections('\n\n   \n')).toEqual([])
  })
})
