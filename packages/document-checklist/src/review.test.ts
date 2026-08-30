import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  bankChecklistTemplateSchema,
  bankDocumentEvidenceSchema,
  runBankChecklistReview,
  type BankChecklistTemplate,
  type BankDocumentEvidence,
} from './index.js'

const template: BankChecklistTemplate = bankChecklistTemplateSchema.parse({
  id: 'retail-kyc-basic',
  version: '1',
  name: 'KYC bán lẻ cơ bản',
  caseType: 'retail_kyc',
  requirements: [
    {
      id: 'identity-document',
      label: 'Giấy tờ định danh',
      acceptedDocumentTypes: ['national_id', 'passport'],
      requiredFields: ['full_name', 'identity_number', 'expiry_date'],
      expiryField: 'expiry_date',
    },
    {
      id: 'application-form',
      label: 'Đơn đề nghị',
      acceptedDocumentTypes: ['application_form'],
      requiredFields: ['full_name', 'identity_number'],
    },
  ],
  crossChecks: [
    {
      id: 'identity-number-match',
      label: 'Số định danh khớp giữa chứng từ',
      fieldKey: 'identity_number',
      documentTypes: ['national_id', 'application_form'],
    },
  ],
})

function document(
  type: BankDocumentEvidence['documentType'],
  overrides: Partial<BankDocumentEvidence> = {},
): BankDocumentEvidence {
  return bankDocumentEvidenceSchema.parse({
    id: randomUUID(),
    fileName: `${type}.pdf`,
    sourcePathHash: 'a'.repeat(64),
    documentType: type,
    fields: [],
    ...overrides,
  })
}

function field(key: string, value: string, needsReview = false) {
  return { key, value, sourceLabel: 'trang 1', needsReview }
}

describe('bank document checklist', () => {
  it('phân biệt chứng từ thiếu với chứng từ đã nhận nhưng chưa đủ căn cứ', () => {
    const report = runBankChecklistReview(template, [], new Date('2026-08-30T00:00:00.000Z'))
    expect(report.items.find((item) => item.id === 'identity-document')?.status).toBe('missing')

    const uncertain = runBankChecklistReview(
      template,
      [document('national_id', { needsReview: true })],
      new Date('2026-08-30T00:00:00.000Z'),
    )
    expect(uncertain.items.find((item) => item.id === 'identity-document')?.status).toBe(
      'needs_review',
    )
  })

  it('không biến field needsReview thành passed', () => {
    const report = runBankChecklistReview(
      template,
      [
        document('national_id', {
          fields: [
            field('full_name', 'Nguyễn Văn A'),
            field('identity_number', '012345678901', true),
            field('expiry_date', '2030-01-01'),
          ],
        }),
      ],
      new Date('2026-08-30T00:00:00.000Z'),
    )
    expect(report.items.find((item) => item.id === 'identity-document')?.status).toBe(
      'needs_review',
    )
  })

  it('phát hiện ngày hết hạn bằng code', () => {
    const report = runBankChecklistReview(
      template,
      [
        document('national_id', {
          fields: [
            field('full_name', 'Nguyễn Văn A'),
            field('identity_number', '012345678901'),
            field('expiry_date', '2025-01-01'),
          ],
        }),
      ],
      new Date('2026-08-30T00:00:00.000Z'),
    )
    expect(report.items.find((item) => item.id === 'identity-document')?.status).toBe('expired')
  })

  it('đạt khi có ít nhất một chứng từ thay thế còn hiệu lực', () => {
    const expired = document('national_id', {
      fields: [
        field('full_name', 'Nguyễn Văn A'),
        field('identity_number', '012345678901'),
        field('expiry_date', '2025-01-01'),
      ],
    })
    const valid = document('passport', {
      fields: [
        field('full_name', 'Nguyễn Văn A'),
        field('identity_number', 'B1234567'),
        field('expiry_date', '2030-01-01'),
      ],
    })
    const report = runBankChecklistReview(
      template,
      [expired, valid],
      new Date('2026-08-30T00:00:00.000Z'),
    )
    expect(report.items.find((item) => item.id === 'identity-document')?.status).toBe('passed')
  })

  it('chuẩn hóa dấu/cách nhưng vẫn phát hiện số định danh lệch', () => {
    const identity = document('national_id', {
      fields: [
        field('full_name', 'Nguyễn Văn A'),
        field('identity_number', '012 345 678 901'),
        field('expiry_date', '2030-01-01'),
      ],
    })
    const form = document('application_form', {
      fields: [field('full_name', 'Nguyen Van A'), field('identity_number', '012345678902')],
    })
    const report = runBankChecklistReview(
      template,
      [identity, form],
      new Date('2026-08-30T00:00:00.000Z'),
    )
    expect(report.items.find((item) => item.id === 'identity-number-match')?.status).toBe(
      'mismatch',
    )
  })

  it('cho kết quả cùng thứ tự khi evidence đổi thứ tự', () => {
    const a = document('national_id', {
      fields: [
        field('full_name', 'Nguyễn Văn A'),
        field('identity_number', '012345678901'),
        field('expiry_date', '2030-01-01'),
      ],
    })
    const b = document('application_form', {
      fields: [field('full_name', 'Nguyen Van A'), field('identity_number', '012345678901')],
    })
    const at = new Date('2026-08-30T00:00:00.000Z')
    expect(runBankChecklistReview(template, [a, b], at)).toEqual(
      runBankChecklistReview(template, [b, a], at),
    )
  })
})
