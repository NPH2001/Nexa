import { describe, expect, it } from 'vitest'
import { labelForActivityAction, labelForActivityType } from './ActivityTimelineView.js'

describe('ActivityTimelineView helpers', () => {
  it('dịch action thành nhãn tiếng Việt ổn định', () => {
    expect(labelForActivityAction('generated')).toBe('Đã gợi ý')
    expect(labelForActivityAction('became_uncertain')).toContain('Chưa xác nhận')
  })

  it('dịch type thành nhãn ngắn gọn cho bộ lọc và timeline', () => {
    expect(labelForActivityType('suggestion')).toBe('Gợi ý check-in')
    expect(labelForActivityType('tool_result')).toBe('Kết quả tool')
  })
})
