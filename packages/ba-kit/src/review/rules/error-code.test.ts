import { describe, expect, it } from 'vitest'
import { makeErrorCode, makeFlowStep, makeModel, makeRuleInput } from '../../testing.js'
import { R_ERR_01 } from './r-err-01.js'
import { R_ERR_02 } from './r-err-02.js'

describe('R-ERR-01 — bảng mã lỗi khớp luồng theo cả hai chiều', () => {
  it('mã được nhắc mà chưa khai báo là blocker', () => {
    const findings = R_ERR_01.evaluate(
      makeRuleInput({ doc: makeModel([makeFlowStep({ id: 'fs-1', errorCode: 'E404' })]) }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('blocker')
    expect(findings[0]?.message).toContain('E404')
    expect(findings[0]?.evidence).toEqual(['fs-1'])
  })

  it('mã khai báo mà không luồng nào dùng là warning', () => {
    const findings = R_ERR_01.evaluate(
      makeRuleInput({ doc: makeModel([makeErrorCode({ id: 'ec-1', code: 'E001' })]) }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('warning')
    expect(findings[0]?.itemId).toBe('ec-1')
  })

  it('khớp cả hai chiều thì im lặng', () => {
    expect(
      R_ERR_01.evaluate(
        makeRuleInput({
          doc: makeModel([
            makeErrorCode({ id: 'ec-1', code: 'E001' }),
            makeFlowStep({ id: 'fs-1', errorCode: 'E001' }),
          ]),
        }),
      ),
    ).toEqual([])
  })
})

describe('R-ERR-02 — một mã một thông điệp', () => {
  it('bắt một mã mang hai thông điệp', () => {
    const findings = R_ERR_02.evaluate(
      makeRuleInput({
        doc: makeModel([
          makeErrorCode({ id: 'ec-1', code: 'E001', message: 'Đơn hàng rỗng' }),
          makeErrorCode({ id: 'ec-2', code: 'E001', message: 'Giỏ hàng trống' }),
        ]),
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('blocker')
    expect(findings[0]?.evidence).toEqual(['ec-1', 'ec-2'])
    // Không chọn hộ biến thể nào là đúng — đó là việc của người dùng.
    expect(findings[0]?.itemId).toBeNull()
  })

  it('hai mã khác nhau với hai thông điệp là bình thường', () => {
    expect(
      R_ERR_02.evaluate(
        makeRuleInput({
          doc: makeModel([
            makeErrorCode({ id: 'ec-1', code: 'E001', message: 'Đơn hàng rỗng' }),
            makeErrorCode({ id: 'ec-2', code: 'E002', message: 'Giỏ hàng trống' }),
          ]),
        }),
      ),
    ).toEqual([])
  })
})
