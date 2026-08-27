import { describe, expect, it } from 'vitest'
import { greetingForHour } from './TodayView.js'

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
})
