import { describe, expect, it } from 'vitest'
import { TEST_RULEBOOK, makeField, makeModel, makeRule, makeRuleInput } from '../../testing.js'
import { R_FLD_01 } from './r-fld-01.js'
import { R_FLD_02 } from './r-fld-02.js'

describe('R-FLD-01 — trường phải có ràng buộc hoặc lý do miễn', () => {
  it('báo trường không có gì ràng buộc', () => {
    const findings = R_FLD_01.evaluate(
      makeRuleInput({ doc: makeModel([makeField({ id: 'f-1', name: 'Ghi chú' })]) }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.ruleId).toBe('R-FLD-01')
    expect(findings[0]?.itemId).toBe('f-1')
  })

  it('khoá validate tự khai là đủ', () => {
    expect(
      R_FLD_01.evaluate(
        makeRuleInput({ doc: makeModel([makeField({ id: 'f-1', validations: ['email-format'] })]) }),
      ),
    ).toEqual([])
  })

  it('một quy tắc nghiệp vụ trỏ tới trường cũng tính là đã ràng buộc', () => {
    expect(
      R_FLD_01.evaluate(
        makeRuleInput({
          doc: makeModel([
            makeField({ id: 'f-1' }),
            makeRule({ id: 'r-1', appliesTo: ['f-1'] }),
          ]),
        }),
      ),
    ).toEqual([])
  })

  it('liên kết validates cũng tính', () => {
    expect(
      R_FLD_01.evaluate(
        makeRuleInput({
          doc: makeModel(
            [makeField({ id: 'f-1' }), makeRule({ id: 'r-1' })],
            [{ from: 'r-1', to: 'f-1', kind: 'validates' }],
          ),
        }),
      ),
    ).toEqual([])
  })

  it('miễn kèm lý do cụ thể thì im lặng', () => {
    expect(
      R_FLD_01.evaluate(
        makeRuleInput({
          doc: makeModel([
            makeField({ id: 'f-1', noValidationReason: 'Ghi chú nội bộ, không hiển thị ra ngoài' }),
          ]),
        }),
      ),
    ).toEqual([])
  })

  it('miễn bằng chữ giữ chỗ không phải là miễn', () => {
    const findings = R_FLD_01.evaluate(
      makeRuleInput({
        doc: makeModel([makeField({ id: 'f-1', noValidationReason: 'TBD' })]),
      }),
    )
    expect(findings).toHaveLength(1)
  })
})

describe('R-FLD-02 — đủ common validate của chuẩn tổ chức', () => {
  it('liệt kê đúng validate còn thiếu', () => {
    const findings = R_FLD_02.evaluate(
      makeRuleInput({
        doc: makeModel([makeField({ id: 'f-1', validations: ['email-format'] })]),
        rulebook: TEST_RULEBOOK,
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('Giới hạn độ dài')
    expect(findings[0]?.fix).toContain('max-length')
  })

  it('đủ khoá thì im lặng', () => {
    expect(
      R_FLD_02.evaluate(
        makeRuleInput({
          doc: makeModel([
            makeField({ id: 'f-1', validations: ['email-format', 'max-length'] }),
          ]),
          rulebook: TEST_RULEBOOK,
        }),
      ),
    ).toEqual([])
  })

  it('khai báo là luật cần rulebook, để bộ chạy không tính nó là đã đạt', () => {
    expect(R_FLD_02.requires).toBe('rulebook')
  })
})
