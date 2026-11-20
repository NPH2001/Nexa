import { describe, expect, it } from 'vitest'
import { formatDateTime } from './datetime-ui.js'

describe('formatDateTime', () => {
  it('hiển thị đủ giờ phút và ngày tháng năm, có số 0 đứng đầu, theo giờ máy', () => {
    const local = new Date(2026, 10, 9, 9, 5).toISOString()
    expect(formatDateTime(local)).toBe('09:05 09/11/2026')
  })
})
