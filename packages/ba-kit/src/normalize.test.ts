import { describe, expect, it } from 'vitest'
import { LIMITS } from './model.js'
import { normalizeRule, normalizeUseCase, suggestRuleSplit } from './normalize.js'

const validUseCase = {
  itemType: 'use_case',
  id: 'uc-1',
  ordinal: 0,
  name: 'Khách hàng đặt đơn',
  actor: 'Khách hàng',
  precondition: 'Đã đăng nhập',
  mainFlow: ['Chọn sản phẩm'],
  postcondition: 'Đơn được tạo',
  role: 'customer',
  dataEffects: ['create'],
}

describe('chuẩn hoá use case', () => {
  it('chấp nhận use case hợp lệ', () => {
    const result = normalizeUseCase(validUseCase)
    expect(result.ok).toBe(true)
  })

  it('luồng chính quá dài thì khuyên TÁCH, không khuyên rút gọn', () => {
    const result = normalizeUseCase({
      ...validUseCase,
      mainFlow: Array.from({ length: LIMITS.mainFlowSteps + 1 }, (_, i) => `Bước ${String(i)}`),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    const problem = result.problems.find((entry) => entry.field === 'mainFlow')
    expect(problem?.suggestion).toContain('TÁCH')
    expect(problem?.suggestion).toContain('đừng rút gọn')
  })

  it('thiếu trường bắt buộc thì khuyên để người soát bổ sung, không khuyên đoán', () => {
    const { actor: _actor, ...withoutActor } = validUseCase
    const result = normalizeUseCase(withoutActor)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.some((entry) => entry.suggestion.includes('đừng đoán'))).toBe(true)
  })

  it('nêu đúng đường dẫn trường bị lỗi', () => {
    const result = normalizeUseCase({ ...validUseCase, name: 'x'.repeat(LIMITS.name + 1) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map((entry) => entry.field)).toContain('name')
  })
})

describe('đề xuất tách rule ghép', () => {
  it('tách khi có dấu chấm phẩy', () => {
    const suggestion = suggestRuleSplit('Đơn phải có sản phẩm; đơn phải có địa chỉ giao')
    expect(suggestion.shouldSplit).toBe(true)
    expect(suggestion.parts).toHaveLength(2)
  })

  it('tách khi cả hai vế đều nêu nghĩa vụ', () => {
    const suggestion = suggestRuleSplit(
      'Đơn phải có ít nhất một sản phẩm và khách hàng phải nhập địa chỉ giao',
    )
    expect(suggestion.shouldSplit).toBe(true)
    expect(suggestion.parts).toEqual([
      'Đơn phải có ít nhất một sản phẩm',
      'khách hàng phải nhập địa chỉ giao',
    ])
  })

  it('KHÔNG tách khi "và" chỉ nối hai tân ngữ', () => {
    const suggestion = suggestRuleSplit('Đơn hàng phải có mã đơn và ngày tạo')
    expect(suggestion.shouldSplit).toBe(false)
    expect(suggestion.parts).toHaveLength(1)
    expect(suggestion.reason).toContain('hai tân ngữ')
  })

  it('mệnh đề đơn thì không đề xuất gì', () => {
    const suggestion = suggestRuleSplit('Đơn hàng phải có ít nhất một sản phẩm')
    expect(suggestion.shouldSplit).toBe(false)
  })

  it('nhận cả từ chỉ nghĩa vụ dạng phủ định', () => {
    const suggestion = suggestRuleSplit(
      'Khách hàng không được sửa đơn đã thanh toán và nhân viên phải ghi lý do huỷ',
    )
    expect(suggestion.shouldSplit).toBe(true)
  })
})

describe('chuẩn hoá rule', () => {
  it('báo rule mồ côi khi chưa gắn với use case hay field', () => {
    const result = normalizeRule({
      itemType: 'rule',
      id: 'r-1',
      ordinal: 0,
      statement: 'Đơn phải có sản phẩm',
    })
    expect(result.result.ok).toBe(true)
    expect(result.orphan).toBe(true)
  })

  it('không còn mồ côi khi đã gắn', () => {
    const result = normalizeRule({
      itemType: 'rule',
      id: 'r-1',
      ordinal: 0,
      statement: 'Đơn phải có sản phẩm',
      appliesTo: ['uc-1'],
    })
    expect(result.orphan).toBe(false)
  })

  it('rule quá dài thì khuyên tách thành nhiều quy tắc', () => {
    const result = normalizeRule({
      itemType: 'rule',
      id: 'r-1',
      ordinal: 0,
      statement: 'x'.repeat(LIMITS.statement + 1),
    })
    expect(result.result.ok).toBe(false)
    if (result.result.ok) return
    expect(result.result.problems[0]?.suggestion).toContain('tách thành nhiều quy tắc')
  })
})
