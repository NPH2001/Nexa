import { z } from 'zod'
import { fieldTypeSchema, type BaField, type BaFieldType } from './model.js'

/**
 * Rulebook common validate — nửa có giá trị của ask #3, và nó **không cần vision** (D7).
 *
 * Yêu cầu gốc là "đọc ảnh, mô tả validate các trường theo hình ảnh và common validate chung, biết
 * trường nào cần validate trường nào không". Phần khó không nằm ở ảnh: ảnh chỉ cho biết form có
 * những trường nào. Phần có giá trị là tri thức "field kiểu này thì cần những validate nào" — và
 * đó là một bảng tra do tổ chức chốt.
 *
 * Có bảng đó rồi thì câu hỏi "trường nào cần validate" trả lời được cho field đến từ BẤT KỲ nguồn
 * nào: văn xuôi, bảng trong DOCX, hay sau này là ảnh.
 *
 * Rulebook ship kèm bản cài và IT ghi đè lúc phân phối, cùng đường với template (D12).
 */

export const validationRuleSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'key chỉ gồm chữ thường, số và dấu gạch ngang'),
  label: z.string().trim().min(1).max(120),
  /** Vì sao validate này cần — hiển thị khi báo thiếu, để người dùng không phải đoán. */
  rationale: z.string().trim().max(300).optional(),
})
export type BaValidationRule = z.infer<typeof validationRuleSchema>

export const baRulebookSchema = z.object({
  id: z.string().trim().min(1).max(64),
  version: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  byFieldType: z
    .array(
      z.object({
        fieldType: fieldTypeSchema,
        validations: z.array(validationRuleSchema).min(1),
      }),
    )
    .min(1),
})
export type BaRulebook = z.infer<typeof baRulebookSchema>

export interface FieldValidationAudit {
  readonly fieldId: string
  readonly fieldName: string
  readonly fieldType: BaFieldType
  /** Validate mà rulebook đòi cho kiểu này. */
  readonly expected: readonly BaValidationRule[]
  /** Validate còn thiếu. Rỗng nghĩa là field đã đủ theo chuẩn tổ chức. */
  readonly missing: readonly BaValidationRule[]
  /** Field đã khai trong `validations` nhưng rulebook không biết — sai khoá hoặc chuẩn đã đổi. */
  readonly unknownKeys: readonly string[]
  /** Field được đánh dấu cố ý không cần validate, kèm lý do. */
  readonly exemptReason?: string
}

function rulesFor(rulebook: BaRulebook, fieldType: BaFieldType): readonly BaValidationRule[] {
  return rulebook.byFieldType.find((entry) => entry.fieldType === fieldType)?.validations ?? []
}

/**
 * Đối chiếu một field với rulebook.
 *
 * Field mang `noValidationReason` được miễn: "trường này không cần validate" là một quyết định
 * hợp lệ, miễn là có người nói ra lý do. Cái không hợp lệ là im lặng bỏ trống — và đó chính là
 * thứ `R-FLD-01` bắt, còn hàm này lo `R-FLD-02`.
 *
 * Field kiểu `unknown` không có kỳ vọng nào: chưa biết kiểu thì chưa thể nói thiếu validate gì.
 * Nó là việc của người soát, không phải của bảng tra.
 */
export function auditField(field: BaField, rulebook: BaRulebook): FieldValidationAudit {
  const expected = rulesFor(rulebook, field.fieldType)
  const have = new Set(field.validations)
  const known = new Set(
    rulebook.byFieldType.flatMap((entry) => entry.validations.map((rule) => rule.key)),
  )

  const exempt = field.noValidationReason !== undefined
  return {
    fieldId: field.id,
    fieldName: field.name,
    fieldType: field.fieldType,
    expected,
    missing: exempt ? [] : expected.filter((rule) => !have.has(rule.key)),
    unknownKeys: field.validations.filter((key) => !known.has(key)),
    ...(exempt ? { exemptReason: field.noValidationReason } : {}),
  }
}

export function auditFields(
  fields: readonly BaField[],
  rulebook: BaRulebook,
): FieldValidationAudit[] {
  return fields.map((field) => auditField(field, rulebook))
}
