import { describe, expect, it } from 'vitest'
import { describeCheckInReason, greetingForHour } from './TodayView.js'

describe('TodayView helpers', () => {
  it.each([
    [0, 'Chào buổi sáng'],
    [10, 'Chào buổi sáng'],
    [11, 'Chào buổi chiều'],
    [17, 'Chào buổi chiều'],
    [18, 'Chào buổi tối'],
    [23, 'Chào buổi tối'],
  ] as const)('chọn lời chào phù hợp lúc %i giờ', (hour, expected) => {
    expect(greetingForHour(hour)).toBe(expected)
  })

  it('giải thích lý do check-in theo trigger kind', () => {
    expect(describeCheckInReason('due', '2026-08-27T09:00:00.000Z')).toContain('Đến hạn')
    expect(describeCheckInReason('check_in', '2026-08-27T09:00:00.000Z')).toContain('check-in')
  })
})
