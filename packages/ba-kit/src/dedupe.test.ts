import { describe, expect, it } from 'vitest'
import {
  NEAR_DUPLICATE_THRESHOLD,
  analyzeSimilarity,
  findNearDuplicates,
  fingerprint,
} from './dedupe.js'
import { makeErrorCode, makeRule, makeUseCase } from './testing.js'

describe('khoá trùng khít', () => {
  it('bỏ qua khác biệt về dấu và hoa thường', () => {
    const a = makeUseCase({ id: 'uc-1', name: 'Khách hàng đặt đơn' })
    const b = makeUseCase({ id: 'uc-2', name: 'KHACH HANG DAT DON' })
    expect(fingerprint(a)).toBe(fingerprint(b))
  })

  it('phân biệt hai kiểu item có cùng text', () => {
    const rule = makeRule({ id: 'r-1', statement: 'Đơn hàng rỗng' })
    const error = makeErrorCode({ id: 'e-1', code: 'Đơn hàng rỗng' })
    expect(fingerprint(rule)).not.toBe(fingerprint(error))
  })

  it('không gộp hai mệnh đề ngược nghĩa nhau', () => {
    const allow = makeRule({ id: 'r-1', statement: 'Cho phép sửa đơn hàng' })
    const deny = makeRule({ id: 'r-2', statement: 'Không cho phép sửa đơn hàng' })
    expect(fingerprint(allow)).not.toBe(fingerprint(deny))
  })
})

describe('gần-trùng', () => {
  it('gắn cờ hai rule cùng ý diễn đạt khác nhau', () => {
    const pairs = findNearDuplicates([
      makeRule({ id: 'r-1', statement: 'Đơn hàng phải có ít nhất một sản phẩm' }),
      makeRule({ id: 'r-2', statement: 'Đơn hàng cần có ít nhất một sản phẩm' }),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.similarity).toBeGreaterThanOrEqual(NEAR_DUPLICATE_THRESHOLD)
  })

  it('không báo lại cặp vốn đã trùng khít', () => {
    const pairs = findNearDuplicates([
      makeRule({ id: 'r-1', statement: 'Đơn hàng phải có sản phẩm' }),
      makeRule({ id: 'r-2', statement: 'ĐƠN HÀNG PHẢI CÓ SẢN PHẨM' }),
    ])
    expect(pairs).toEqual([])
  })

  it('không so sánh chéo hai kiểu item khác nhau', () => {
    const pairs = findNearDuplicates([
      makeRule({ id: 'r-1', statement: 'Đơn hàng rỗng bị từ chối' }),
      makeErrorCode({ id: 'e-1', code: 'Đơn hàng rỗng bị từ chối' }),
    ])
    expect(pairs).toEqual([])
  })

  it('bỏ qua cặp dưới ngưỡng', () => {
    const pairs = findNearDuplicates([
      makeRule({ id: 'r-1', statement: 'Đơn hàng phải có ít nhất một sản phẩm' }),
      makeRule({ id: 'r-2', statement: 'Người dùng đổi mật khẩu mỗi chín mươi ngày' }),
    ])
    expect(pairs).toEqual([])
  })

  const similarRules = [
    makeRule({ id: 'r-3', statement: 'Đơn hàng phải có ít nhất một sản phẩm' }),
    makeRule({ id: 'r-1', statement: 'Đơn hàng cần có ít nhất một sản phẩm' }),
    makeRule({ id: 'r-2', statement: 'Đơn hàng nên có ít nhất một sản phẩm' }),
  ]

  it('cùng đầu vào cho ra cùng kết quả, kể cả thứ tự', () => {
    expect(findNearDuplicates(similarRules)).toEqual(findNearDuplicates(similarRules))
  })

  it('không đề xuất gộp hai mệnh đề chỉ khác nhau ở phủ định', () => {
    const items = [
      makeRule({ id: 'r-1', statement: 'Cho phép sửa đơn hàng' }),
      makeRule({ id: 'r-2', statement: 'Không cho phép sửa đơn hàng' }),
    ]
    const report = analyzeSimilarity(items)

    // Vẫn phải đủ giống để lọt ngưỡng — nếu không, test này tự đúng một cách rỗng tuếch.
    expect(report.potentialContradictions).toHaveLength(1)
    expect(report.potentialContradictions[0]?.similarity).toBeGreaterThanOrEqual(
      NEAR_DUPLICATE_THRESHOLD,
    )
    expect(report.nearDuplicates).toEqual([])
  })

  it('vẫn coi là trùng khi cả hai cùng phủ định', () => {
    const report = analyzeSimilarity([
      makeRule({ id: 'r-1', statement: 'Không cho phép sửa đơn hàng' }),
      makeRule({ id: 'r-2', statement: 'Không được phép sửa đơn hàng' }),
    ])
    expect(report.potentialContradictions).toEqual([])
    expect(report.nearDuplicates).toHaveLength(1)
  })

  it('tìm ra cùng tập cặp bất kể thứ tự đầu vào', () => {
    const keys = (items: typeof similarRules): string[] =>
      findNearDuplicates(items)
        .map((pair) => [pair.a, pair.b].sort().join('|'))
        .sort()
    expect(keys(similarRules)).toEqual(keys([...similarRules].reverse()))
  })
})
