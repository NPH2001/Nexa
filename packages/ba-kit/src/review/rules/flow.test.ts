import { describe, expect, it } from 'vitest'
import { makeFlowStep, makeModel, makeRuleInput, makeUseCase } from '../../testing.js'
import { R_FLOW_01 } from './r-flow-01.js'
import { R_FLOW_02 } from './r-flow-02.js'

describe('R-FLOW-01 — bước luồng phải được use case phủ', () => {
  it('báo bước không use case nào phủ', () => {
    const findings = R_FLOW_01.evaluate(
      makeRuleInput({ doc: makeModel([makeFlowStep({ id: 'fs-1', label: 'Kiểm tồn kho' })]) }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.ruleId).toBe('R-FLOW-01')
    expect(findings[0]?.itemId).toBe('fs-1')
    expect(findings[0]?.message).toContain('Kiểm tồn kho')
    expect(findings[0]?.fix).not.toBe('')
  })

  it('im lặng khi bước đã được phủ', () => {
    const findings = R_FLOW_01.evaluate(
      makeRuleInput({
        doc: makeModel(
          [makeFlowStep({ id: 'fs-1' }), makeUseCase({ id: 'uc-1' })],
          [{ from: 'uc-1', to: 'fs-1', kind: 'covers' }],
        ),
      }),
    )
    expect(findings).toEqual([])
  })

  it('use case còn cần soát không tính là đã phủ', () => {
    const findings = R_FLOW_01.evaluate(
      makeRuleInput({
        doc: makeModel(
          [makeFlowStep({ id: 'fs-1' }), makeUseCase({ id: 'uc-1', needsReview: true })],
          [{ from: 'uc-1', to: 'fs-1', kind: 'covers' }],
        ),
      }),
    )
    expect(findings.map((finding) => finding.itemId)).toEqual(['fs-1'])
  })
})

describe('R-FLOW-02 — use case phải chạm bước luồng', () => {
  it('báo use case chưa chạm bước nào', () => {
    const findings = R_FLOW_02.evaluate(
      makeRuleInput({ doc: makeModel([makeUseCase({ id: 'uc-1', name: 'Đặt đơn' })]) }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.ruleId).toBe('R-FLOW-02')
    expect(findings[0]?.message).toContain('Đặt đơn')
  })

  it('use case tự khai độc lập thì không bị báo', () => {
    const findings = R_FLOW_02.evaluate(
      makeRuleInput({ doc: makeModel([makeUseCase({ id: 'uc-1', standalone: true })]) }),
    )
    expect(findings).toEqual([])
  })
})
