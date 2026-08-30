import { describe, expect, it } from 'vitest'
import { makeModel, makeRule, makeRuleInput } from '../../testing.js'
import { R_RULE_01 } from './r-rule-01.js'
import { R_RULE_02 } from './r-rule-02.js'

describe('R-RULE-01 — không trùng lặp, không mâu thuẫn', () => {
  it('bắt hai quy tắc cùng nội dung', () => {
    const findings = R_RULE_01.evaluate(
      makeRuleInput({
        doc: makeModel([
          makeRule({ id: 'r-1', statement: 'Đơn hàng phải có ít nhất một sản phẩm' }),
          makeRule({ id: 'r-2', statement: 'Đơn hàng phải có ít nhất một sản phẩm' }),
        ]),
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.itemId).toBe('r-1')
    expect(findings[0]?.evidence).toEqual(['r-2'])
  })

  it('bắt cặp gần trùng — chính cặp mà ngưỡng 0.7 được chốt để bắt', () => {
    const findings = R_RULE_01.evaluate(
      makeRuleInput({
        doc: makeModel([
          makeRule({ id: 'r-1', statement: 'Đơn hàng phải có ít nhất một sản phẩm' }),
          makeRule({ id: 'r-2', statement: 'Đơn hàng cần có ít nhất một sản phẩm' }),
        ]),
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('warning')
  })

  it('cặp lệch nhau ở phủ định là blocker và KHÔNG được khuyên gộp', () => {
    const findings = R_RULE_01.evaluate(
      makeRuleInput({
        doc: makeModel([
          makeRule({ id: 'r-1', statement: 'Cho phép sửa đơn sau khi xác nhận' }),
          makeRule({ id: 'r-2', statement: 'Không cho phép sửa đơn sau khi xác nhận' }),
        ]),
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('blocker')
    expect(findings[0]?.fix).toContain('KHÔNG gộp')
  })

  it('hai quy tắc không liên quan thì im lặng', () => {
    expect(
      R_RULE_01.evaluate(
        makeRuleInput({
          doc: makeModel([
            makeRule({ id: 'r-1', statement: 'Đơn hàng phải có ít nhất một sản phẩm' }),
            makeRule({ id: 'r-2', statement: 'Mã giảm giá hết hạn sau ba mươi ngày' }),
          ]),
        }),
      ),
    ).toEqual([])
  })
})

describe('R-RULE-02 — không có quy tắc mồ côi', () => {
  it('báo quy tắc chưa gắn vào đâu', () => {
    const findings = R_RULE_02.evaluate(
      makeRuleInput({ doc: makeModel([makeRule({ id: 'r-1' })]) }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.ruleId).toBe('R-RULE-02')
  })

  it('gắn bằng appliesTo thì không mồ côi', () => {
    expect(
      R_RULE_02.evaluate(
        makeRuleInput({ doc: makeModel([makeRule({ id: 'r-1', appliesTo: ['uc-1'] })]) }),
      ),
    ).toEqual([])
  })

  it('gắn bằng liên kết validates cũng không mồ côi', () => {
    expect(
      R_RULE_02.evaluate(
        makeRuleInput({
          doc: makeModel(
            [makeRule({ id: 'r-1' })],
            [{ from: 'r-1', to: 'f-1', kind: 'validates' }],
          ),
        }),
      ),
    ).toEqual([])
  })
})
