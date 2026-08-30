import { describe, expect, it } from 'vitest'
import { baTemplateSchema, evaluateTemplate, type BaTemplate } from './template.js'
import { makeErrorCode, makeModel, makeRule, makeUseCase } from './testing.js'

function template(overrides: Partial<BaTemplate> = {}): BaTemplate {
  return baTemplateSchema.parse({
    id: 'us-standard',
    version: '1',
    name: 'User Story chuẩn',
    documentKind: 'us',
    sections: [
      { key: 'use-cases', title: 'Use case', required: true, itemTypes: ['use_case'] },
      { key: 'rules', title: 'Quy tắc nghiệp vụ', itemTypes: ['rule'] },
      { key: 'errors', title: 'Mã lỗi', required: true, itemTypes: ['error_code'] },
    ],
    ...overrides,
  })
}

describe('schema template', () => {
  it('từ chối template không có mục nào', () => {
    expect(baTemplateSchema.safeParse({ ...template(), sections: [] }).success).toBe(false)
  })

  it('từ chối key có dấu cách hoặc chữ hoa', () => {
    const broken = { ...template(), sections: [{ key: 'Use Cases', title: 'X', itemTypes: ['rule'] }] }
    expect(baTemplateSchema.safeParse(broken).success).toBe(false)
  })

  it('mục mặc định là tuỳ chọn', () => {
    expect(template().sections[1]?.required).toBe(false)
  })
})

describe('đặt item vào mục', () => {
  it('xếp item theo kiểu và giữ thứ tự ordinal', () => {
    const model = makeModel([
      makeRule({ id: 'r-2', statement: 'Quy tắc hai', ordinal: 1 }),
      makeRule({ id: 'r-1', statement: 'Quy tắc một', ordinal: 0 }),
      makeUseCase({ id: 'uc-1' }),
    ])
    const evaluation = evaluateTemplate(model, template())

    expect(evaluation.sections.map((section) => section.key)).toEqual([
      'use-cases',
      'rules',
      'errors',
    ])
    expect(evaluation.sections[1]?.items.map((item) => item.id)).toEqual(['r-1', 'r-2'])
  })

  it('báo mục bắt buộc còn trống', () => {
    const evaluation = evaluateTemplate(makeModel([makeUseCase({ id: 'uc-1' })]), template())
    expect(evaluation.missingRequired).toEqual(['errors'])
  })

  it('mục bắt buộc chỉ toàn item cần soát vẫn tính là thiếu', () => {
    const model = makeModel([
      makeUseCase({ id: 'uc-1' }),
      makeErrorCode({ id: 'e-1', needsReview: true }),
    ])
    expect(evaluateTemplate(model, template()).missingRequired).toEqual(['errors'])
  })

  it('mục đầu tiên thắng khi hai mục cùng nhận một kiểu', () => {
    const twoSections = template({
      sections: [
        { key: 'a', title: 'A', required: false, itemTypes: ['rule'] },
        { key: 'b', title: 'B', required: false, itemTypes: ['rule'] },
      ],
    })
    const evaluation = evaluateTemplate(makeModel([makeRule({ id: 'r-1' })]), twoSections)

    expect(evaluation.sections[0]?.items).toHaveLength(1)
    expect(evaluation.sections[1]?.items).toHaveLength(0)
  })

  it('chỉ ra item không thuộc mục nào của mẫu', () => {
    const onlyRules = template({
      sections: [{ key: 'rules', title: 'Quy tắc', required: false, itemTypes: ['rule'] }],
    })
    const evaluation = evaluateTemplate(makeModel([makeUseCase({ id: 'uc-1' })]), onlyRules)

    expect(evaluation.unplaced.map((item) => item.id)).toEqual(['uc-1'])
  })
})
