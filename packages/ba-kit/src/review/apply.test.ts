import { describe, expect, it } from 'vitest'
import { LIMITS } from '../model.js'
import { makeErrorCode, makeModel, makeRule, makeUseCase } from '../testing.js'
import { applyItemText } from './apply.js'

describe('áp dụng câu chữ đã sửa', () => {
  it('sửa đúng item đó và không đụng item khác', () => {
    const model = makeModel(
      [
        makeRule({ id: 'r-1', statement: 'Đơn hàng phải có sản phẩm' }),
        makeRule({ id: 'r-2', statement: 'Mã giảm giá hết hạn sau ba mươi ngày' }),
      ],
      [{ from: 'r-1', to: 'f-1', kind: 'validates' }],
    )

    const result = applyItemText(model, {
      itemId: 'r-1',
      field: 'statement',
      value: 'Đơn hàng phải có ít nhất một sản phẩm',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.items[0]).toMatchObject({
      id: 'r-1',
      statement: 'Đơn hàng phải có ít nhất một sản phẩm',
    })
    expect(result.model.items[1]).toEqual(model.items[1])
    expect(result.model.links).toEqual(model.links)
  })

  it('điền được một ô tuỳ chọn còn trống', () => {
    const result = applyItemText(makeModel([makeErrorCode({ id: 'ec-1' })]), {
      itemId: 'ec-1',
      field: 'meaning',
      value: 'Người dùng bấm đặt đơn khi giỏ hàng chưa có sản phẩm nào.',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.item).toMatchObject({ meaning: expect.any(String) })
  })

  it('từ chối ô không thuộc kiểu item — không im lặng bỏ qua', () => {
    const result = applyItemText(makeModel([makeUseCase({ id: 'uc-1' })]), {
      itemId: 'uc-1',
      field: 'message',
      value: 'Đơn hàng rỗng',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('use_case')
  })

  it('vẫn áp giới hạn độ dài của schema — sửa tay không phải cửa sau', () => {
    const result = applyItemText(makeModel([makeRule({ id: 'r-1' })]), {
      itemId: 'r-1',
      field: 'statement',
      value: 'x'.repeat(LIMITS.statement + 1),
    })
    expect(result.ok).toBe(false)
  })

  it('báo rõ khi item không tồn tại', () => {
    const result = applyItemText(makeModel([makeRule({ id: 'r-1' })]), {
      itemId: 'r-9',
      field: 'statement',
      value: 'Bất kỳ',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('not found')
  })
})
