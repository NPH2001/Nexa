import { describe, expect, it } from 'vitest'
import { truncateField } from './shared.js'

describe('truncateField', () => {
  it('giữ nguyên trường ngắn mà không nhân đôi dữ liệu', () => {
    expect(truncateField('Tiêu đề', 'Ngắn', 10)).toEqual({ label: 'Tiêu đề', value: 'Ngắn' })
  })

  it('giữ giá trị đầy đủ để UI mở rộng preview thật', () => {
    expect(truncateField('Mô tả', 'Nội dung rất dài', 8)).toEqual({
      label: 'Mô tả',
      value: 'Nội dung…',
      truncated: true,
      fullValue: 'Nội dung rất dài',
    })
  })
})
