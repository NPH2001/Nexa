import { describe, expect, it } from 'vitest'
import { auditField, baRulebookSchema, type BaRulebook } from './rulebook.js'
import { baDocItemSchema, type BaField } from './model.js'

const rulebook: BaRulebook = baRulebookSchema.parse({
  id: 'chuan-noi-bo',
  version: '1',
  name: 'Chuẩn validate nội bộ',
  byFieldType: [
    {
      fieldType: 'email',
      validations: [
        { key: 'required-check', label: 'Kiểm tra bắt buộc' },
        { key: 'email-format', label: 'Đúng định dạng email', rationale: 'Tránh gửi thư đi đâu mất' },
        { key: 'max-length', label: 'Giới hạn độ dài' },
      ],
    },
    {
      fieldType: 'money',
      validations: [
        { key: 'non-negative', label: 'Không âm' },
        { key: 'currency-scale', label: 'Đúng số chữ số thập phân của loại tiền' },
      ],
    },
  ],
})

function field(overrides: Partial<BaField> = {}): BaField {
  return baDocItemSchema.parse({
    itemType: 'field',
    id: 'f-1',
    ordinal: 0,
    name: 'Email khách hàng',
    fieldType: 'email',
    required: true,
    ...overrides,
  }) as BaField
}

describe('rulebook common validate', () => {
  it('chỉ ra validate còn thiếu theo kiểu field', () => {
    const audit = auditField(field({ validations: ['required-check'] }), rulebook)
    expect(audit.missing.map((rule) => rule.key)).toEqual(['email-format', 'max-length'])
  })

  it('không báo thiếu khi field đã đủ', () => {
    const audit = auditField(
      field({ validations: ['required-check', 'email-format', 'max-length'] }),
      rulebook,
    )
    expect(audit.missing).toEqual([])
  })

  it('kèm lý do để người dùng không phải đoán vì sao cần', () => {
    const audit = auditField(field(), rulebook)
    expect(audit.missing.find((rule) => rule.key === 'email-format')?.rationale).toContain('thư')
  })

  it('field cố ý không validate thì được miễn, và giữ lại lý do', () => {
    const audit = auditField(
      field({ noValidationReason: 'Trường ghi chú nội bộ, không hiển thị ra ngoài' }),
      rulebook,
    )
    expect(audit.missing).toEqual([])
    expect(audit.exemptReason).toContain('ghi chú nội bộ')
  })

  it('kiểu chưa xác định thì không có kỳ vọng nào — đó là việc của người soát', () => {
    const audit = auditField(field({ fieldType: 'unknown' }), rulebook)
    expect(audit.expected).toEqual([])
    expect(audit.missing).toEqual([])
  })

  it('báo khoá lạ khi field khai một validate rulebook không biết', () => {
    const audit = auditField(field({ validations: ['captcha-check'] }), rulebook)
    expect(audit.unknownKeys).toEqual(['captcha-check'])
  })

  it('khoá hợp lệ của kiểu khác không bị coi là lạ', () => {
    const audit = auditField(field({ validations: ['non-negative'] }), rulebook)
    expect(audit.unknownKeys).toEqual([])
    expect(audit.missing.map((rule) => rule.key)).toContain('email-format')
  })

  it('từ chối rulebook không có kiểu field nào', () => {
    expect(baRulebookSchema.safeParse({ ...rulebook, byFieldType: [] }).success).toBe(false)
  })
})
