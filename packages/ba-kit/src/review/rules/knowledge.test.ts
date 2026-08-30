import { describe, expect, it } from 'vitest'
import { makeKnowledge, makeModel, makeRule, makeRuleInput } from '../../testing.js'
import { R_KB_01 } from './r-kb-01.js'

const CONFIRMED_CLAIM = 'Đơn hàng trên 500k được miễn phí giao hàng'
const OPPOSITE_CLAIM = 'Đơn hàng trên 500k không được miễn phí giao hàng'

describe('R-KB-01 — đối chiếu với tri thức đã xác nhận', () => {
  it('báo khi tài liệu nói ngược một tri thức đã xác nhận, và trỏ tới item làm căn cứ', () => {
    const findings = R_KB_01.evaluate(
      makeRuleInput({
        doc: makeModel([makeRule({ id: 'r-1', statement: OPPOSITE_CLAIM })]),
        knowledge: [makeKnowledge({ id: 'k-1', body: CONFIRMED_CLAIM })],
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.ruleId).toBe('R-KB-01')
    expect(findings[0]?.severity).toBe('blocker')
    expect(findings[0]?.itemId).toBe('r-1')
    // Spec đòi finding nêu CẢ HAI nội dung và trỏ tới item tri thức.
    expect(findings[0]?.message).toContain(OPPOSITE_CLAIM)
    expect(findings[0]?.message).toContain(CONFIRMED_CLAIM)
    expect(findings[0]?.evidence).toEqual(['k-1'])
  })

  it('tri thức draft KHÔNG được dùng làm căn cứ', () => {
    const findings = R_KB_01.evaluate(
      makeRuleInput({
        doc: makeModel([makeRule({ id: 'r-1', statement: OPPOSITE_CLAIM })]),
        knowledge: [makeKnowledge({ id: 'k-1', body: CONFIRMED_CLAIM, status: 'draft' })],
      }),
    )
    expect(findings).toEqual([])
  })

  it('tri thức đã thay thế cũng không được dùng làm căn cứ', () => {
    const findings = R_KB_01.evaluate(
      makeRuleInput({
        doc: makeModel([makeRule({ id: 'r-1', statement: OPPOSITE_CLAIM })]),
        knowledge: [makeKnowledge({ id: 'k-1', body: CONFIRMED_CLAIM, status: 'outdated' })],
      }),
    )
    expect(findings).toEqual([])
  })

  it('tài liệu nói cùng một điều với tri thức thì im lặng', () => {
    const findings = R_KB_01.evaluate(
      makeRuleInput({
        doc: makeModel([makeRule({ id: 'r-1', statement: CONFIRMED_CLAIM })]),
        knowledge: [makeKnowledge({ id: 'k-1', body: CONFIRMED_CLAIM })],
      }),
    )
    expect(findings).toEqual([])
  })

  it('quy tắc không liên quan tới tri thức nào thì im lặng', () => {
    const findings = R_KB_01.evaluate(
      makeRuleInput({
        doc: makeModel([makeRule({ id: 'r-1', statement: 'Mã giảm giá hết hạn sau ba mươi ngày' })]),
        knowledge: [makeKnowledge({ id: 'k-1', body: CONFIRMED_CLAIM })],
      }),
    )
    expect(findings).toEqual([])
  })

  it('đối chiếu được cả khi quy tắc nằm ở tiêu đề của mục tri thức', () => {
    const findings = R_KB_01.evaluate(
      makeRuleInput({
        doc: makeModel([makeRule({ id: 'r-1', statement: OPPOSITE_CLAIM })]),
        knowledge: [
          makeKnowledge({ id: 'k-1', title: CONFIRMED_CLAIM, body: 'Chốt trong họp ngày 12/8.' }),
        ],
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence).toEqual(['k-1'])
  })
})
