import { describe, expect, it } from 'vitest'
import { makeModel, makeRuleInput, makeUseCase } from '../../testing.js'
import { R_UC_01 } from './r-uc-01.js'
import { R_UC_02 } from './r-uc-02.js'
import { R_UC_03 } from './r-uc-03.js'
import { R_UC_04 } from './r-uc-04.js'
import { R_UC_05 } from './r-uc-05.js'

const branch = { name: 'Nhánh', steps: ['Một bước'] }

describe('R-UC-01 — bốn ô chính phải nói được điều gì đó', () => {
  it('im lặng với use case điền đủ', () => {
    expect(
      R_UC_01.evaluate(makeRuleInput({ doc: makeModel([makeUseCase({ id: 'uc-1' })]) })),
    ).toEqual([])
  })

  it('bắt ô điền bằng chữ giữ chỗ — thứ schema không bắt được', () => {
    const findings = R_UC_01.evaluate(
      makeRuleInput({
        doc: makeModel([makeUseCase({ id: 'uc-1', actor: 'TBD', postcondition: 'chưa xác định' })]),
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('blocker')
    expect(findings[0]?.message).toContain('actor')
    expect(findings[0]?.message).toContain('điều kiện sau')
  })

  it('không nhầm một câu thật có chứa chữ giữ chỗ thành chỗ trống', () => {
    const findings = R_UC_01.evaluate(
      makeRuleInput({
        doc: makeModel([
          makeUseCase({ id: 'uc-1', precondition: 'Khách hàng chưa xác định phương thức thanh toán' }),
        ]),
      }),
    )
    expect(findings).toEqual([])
  })
})

describe('R-UC-02 — luồng thay thế hoặc lý do', () => {
  it('báo khi không có luồng thay thế và không có lý do', () => {
    const findings = R_UC_02.evaluate(
      makeRuleInput({ doc: makeModel([makeUseCase({ id: 'uc-1' })]) }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.ruleId).toBe('R-UC-02')
  })

  it('có luồng thay thế thì im lặng', () => {
    expect(
      R_UC_02.evaluate(
        makeRuleInput({ doc: makeModel([makeUseCase({ id: 'uc-1', alternateFlows: [branch] })]) }),
      ),
    ).toEqual([])
  })

  it('lý do cụ thể là lối thoát hợp lệ', () => {
    expect(
      R_UC_02.evaluate(
        makeRuleInput({
          doc: makeModel([
            makeUseCase({ id: 'uc-1', noAlternateReason: 'Chỉ có một đường duyệt duy nhất' }),
          ]),
        }),
      ),
    ).toEqual([])
  })

  it('lý do bằng chữ giữ chỗ không phải là lý do', () => {
    const findings = R_UC_02.evaluate(
      makeRuleInput({ doc: makeModel([makeUseCase({ id: 'uc-1', noAlternateReason: 'N/A' })]) }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('chữ giữ chỗ')
  })
})

describe('R-UC-03 — luồng ngoại lệ', () => {
  it('báo use case không có luồng ngoại lệ nào', () => {
    const findings = R_UC_03.evaluate(
      makeRuleInput({ doc: makeModel([makeUseCase({ id: 'uc-1', name: 'Đặt đơn' })]) }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.ruleId).toBe('R-UC-03')
    expect(findings[0]?.itemId).toBe('uc-1')
    expect(findings[0]?.fix).toContain('ngoại lệ')
  })

  it('im lặng khi đã có luồng ngoại lệ', () => {
    expect(
      R_UC_03.evaluate(
        makeRuleInput({ doc: makeModel([makeUseCase({ id: 'uc-1', exceptionFlows: [branch] })]) }),
      ),
    ).toEqual([])
  })
})

describe('R-UC-04 — role được phép thực hiện', () => {
  it('báo khi role là chữ giữ chỗ', () => {
    const findings = R_UC_04.evaluate(
      makeRuleInput({ doc: makeModel([makeUseCase({ id: 'uc-1', role: 'TBD' })]) }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.ruleId).toBe('R-UC-04')
  })

  it('im lặng khi role có thật', () => {
    expect(
      R_UC_04.evaluate(
        makeRuleInput({ doc: makeModel([makeUseCase({ id: 'uc-1', role: 'customer' })]) }),
      ),
    ).toEqual([])
  })
})

describe('R-UC-05 — tác động dữ liệu nhất quán', () => {
  it('bắt khai báo vừa "không tác động" vừa có tác động', () => {
    const findings = R_UC_05.evaluate(
      makeRuleInput({
        doc: makeModel([makeUseCase({ id: 'uc-1', dataEffects: ['none', 'create'] })]),
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('create')
  })

  it('chỉ "không tác động" là hợp lệ', () => {
    expect(
      R_UC_05.evaluate(
        makeRuleInput({ doc: makeModel([makeUseCase({ id: 'uc-1', dataEffects: ['none'] })]) }),
      ),
    ).toEqual([])
  })

  it('nhiều tác động thật không phải mâu thuẫn', () => {
    expect(
      R_UC_05.evaluate(
        makeRuleInput({
          doc: makeModel([makeUseCase({ id: 'uc-1', dataEffects: ['create', 'update'] })]),
        }),
      ),
    ).toEqual([])
  })
})
