import { describe, expect, it } from 'vitest'
import { resolveCommitmentTimestamp } from './commitment-time.js'

/**
 * Mọi ca đều neo vào một `now` cố định. Thứ 4, 2026-09-02, 10:00 giờ máy — chọn giữa tuần để
 * "tuần này"/"tuần sau" phân biệt được, và giữa tháng để biên tháng không tự trùng.
 */
const NOW = new Date(2026, 8, 2, 10, 0, 0, 0)

/** So sánh theo giờ máy, vì đó chính là thứ người dùng nhìn thấy trong preview. */
const local = (iso: string): string => {
  const date = new Date(iso)
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const pad = (value: number): string => String(value).padStart(2, '0')

describe('resolveCommitmentTimestamp', () => {
  it('passes ISO input through unchanged', () => {
    expect(resolveCommitmentTimestamp('2026-09-10T08:30:00.000Z', NOW)).toBe(
      '2026-09-10T08:30:00.000Z',
    )
  })

  it('gives a date-only ISO the default end-of-workday time', () => {
    expect(local(resolveCommitmentTimestamp('2026-09-10', NOW))).toBe('2026-09-10 17:00')
  })

  it.each([
    ['hôm nay', '2026-09-02 17:00'],
    ['ngày mai', '2026-09-03 17:00'],
    ['ngày kia', '2026-09-04 17:00'],
    ['3 ngày nữa', '2026-09-05 17:00'],
    ['sau 2 tuần', '2026-09-16 17:00'],
    ['1 tháng nữa', '2026-10-02 17:00'],
    ['tuần sau', '2026-09-09 17:00'],
    ['tháng sau', '2026-10-02 17:00'],
  ])('resolves relative offset %s', (input, expected) => {
    expect(local(resolveCommitmentTimestamp(input, NOW))).toBe(expected)
  })

  it.each([
    // Now là thứ 4. "thứ 6" = thứ 6 sắp tới trong tuần này.
    ['thứ 6', '2026-09-04 17:00'],
    ['thu 6', '2026-09-04 17:00'],
    // Thứ 2 đã trôi qua trong tuần này ⇒ lần xuất hiện kế tiếp là tuần sau.
    ['thứ 2', '2026-09-07 17:00'],
    ['thứ 6 tuần sau', '2026-09-11 17:00'],
    ['thứ 2 tuần sau', '2026-09-07 17:00'],
    ['thứ 2 tuần này', '2026-08-31 17:00'],
    ['chủ nhật', '2026-09-06 17:00'],
  ])('resolves weekday %s', (input, expected) => {
    expect(local(resolveCommitmentTimestamp(input, NOW))).toBe(expected)
  })

  it.each([
    ['cuối tuần', '2026-09-06 17:00'],
    ['đầu tuần sau', '2026-09-07 17:00'],
    ['cuối tháng', '2026-09-30 17:00'],
    ['cuối tháng sau', '2026-10-31 17:00'],
    ['đầu tháng sau', '2026-10-01 17:00'],
  ])('resolves boundary %s', (input, expected) => {
    expect(local(resolveCommitmentTimestamp(input, NOW))).toBe(expected)
  })

  it.each([
    ['ngày mai lúc 9h', '2026-09-03 09:00'],
    ['thứ 6 lúc 15:30', '2026-09-04 15:30'],
    ['ngày mai 3h chiều', '2026-09-03 15:00'],
    ['cuối tháng lúc 18h', '2026-09-30 18:00'],
  ])('applies an explicit time of day for %s', (input, expected) => {
    expect(local(resolveCommitmentTimestamp(input, NOW))).toBe(expected)
  })

  it('treats a bare time as today, or tomorrow when it has already passed', () => {
    expect(local(resolveCommitmentTimestamp('16h', NOW))).toBe('2026-09-02 16:00')
    expect(local(resolveCommitmentTimestamp('8h', NOW))).toBe('2026-09-03 08:00')
  })

  it.each([
    ['20/9', '2026-09-20 17:00'],
    ['20/09/2027', '2027-09-20 17:00'],
    ['ngày 20 tháng 9', '2026-09-20 17:00'],
  ])('resolves explicit date %s', (input, expected) => {
    expect(local(resolveCommitmentTimestamp(input, NOW))).toBe(expected)
  })

  it('rolls a bare day/month forward when it already passed this year', () => {
    expect(local(resolveCommitmentTimestamp('20/1', NOW))).toBe('2027-01-20 17:00')
  })

  it('clamps month arithmetic instead of overflowing into the next month', () => {
    const endOfJanuary = new Date(2027, 0, 31, 10, 0, 0, 0)
    expect(local(resolveCommitmentTimestamp('1 tháng nữa', endOfJanuary))).toBe('2027-02-28 17:00')
  })

  it('crosses the year boundary for weekday and month offsets', () => {
    const lateDecember = new Date(2026, 11, 30, 10, 0, 0, 0) // thứ 4
    expect(local(resolveCommitmentTimestamp('thứ 6', lateDecember))).toBe('2027-01-01 17:00')
    expect(local(resolveCommitmentTimestamp('cuối tháng', lateDecember))).toBe('2026-12-31 17:00')
    expect(local(resolveCommitmentTimestamp('tháng sau', lateDecember))).toBe('2027-01-30 17:00')
  })

  it.each([
    'khi nào rảnh',
    'sớm thôi',
    '',
    'ngày 32 tháng 9',
    '25h',
  ])('refuses to guess for %s', (input) => {
    // Fail-closed: model phải hỏi lại người dùng, không được để hệ thống chọn đại một mốc.
    expect(() => resolveCommitmentTimestamp(input, NOW)).toThrow()
  })
})
