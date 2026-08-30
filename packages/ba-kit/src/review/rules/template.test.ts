import { describe, expect, it } from 'vitest'
import { TEST_TEMPLATE, makeErrorCode, makeModel, makeRuleInput, makeUseCase } from '../../testing.js'
import { R_TPL_01 } from './r-tpl-01.js'

describe('R-TPL-01 — đủ mục bắt buộc của mẫu', () => {
  it('báo mục bắt buộc còn trống, gọi tên mục theo mẫu', () => {
    const findings = R_TPL_01.evaluate(
      makeRuleInput({
        doc: makeModel([makeUseCase({ id: 'uc-1' })]),
        template: TEST_TEMPLATE,
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('blocker')
    expect(findings[0]?.message).toContain('Mã lỗi')
    expect(findings[0]?.itemId).toBeNull()
  })

  it('mục chỉ toàn item còn cần soát vẫn tính là chưa có nội dung', () => {
    const findings = R_TPL_01.evaluate(
      makeRuleInput({
        doc: makeModel([
          makeUseCase({ id: 'uc-1' }),
          makeErrorCode({ id: 'ec-1', needsReview: true }),
        ]),
        template: TEST_TEMPLATE,
      }),
    )
    expect(findings.map((finding) => finding.message)).toHaveLength(1)
  })

  it('đủ mục bắt buộc thì im lặng', () => {
    expect(
      R_TPL_01.evaluate(
        makeRuleInput({
          doc: makeModel([makeUseCase({ id: 'uc-1' }), makeErrorCode({ id: 'ec-1' })]),
          template: TEST_TEMPLATE,
        }),
      ),
    ).toEqual([])
  })

  it('khai báo là luật cần mẫu, để tài liệu chưa chọn mẫu không bị tính là đã đạt', () => {
    expect(R_TPL_01.requires).toBe('template')
  })
})
