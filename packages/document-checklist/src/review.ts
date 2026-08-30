import type {
  BankChecklistEvidenceRef,
  BankChecklistItem,
  BankChecklistReport,
  BankChecklistRequirement,
  BankChecklistStatus,
  BankChecklistTemplate,
  BankDocumentEvidence,
  BankExtractedField,
} from './model.js'

export const BANK_CHECKLIST_RULE_PACK = {
  id: 'bank-document-checklist',
  version: '1',
} as const

interface DocumentVerdict {
  readonly status: Extract<
    BankChecklistStatus,
    'passed' | 'expired' | 'unreadable' | 'needs_review'
  >
  readonly message: string
  readonly fix: string
  readonly evidence: readonly BankChecklistEvidenceRef[]
}

const VERDICT_RANK: Record<DocumentVerdict['status'], number> = {
  passed: 0,
  expired: 1,
  needs_review: 2,
  unreadable: 3,
}

function fieldOf(document: BankDocumentEvidence, key: string): BankExtractedField | undefined {
  return document.fields.find((field) => field.key === key)
}

function evidenceFor(
  document: BankDocumentEvidence,
  fields: readonly BankExtractedField[] = [],
): BankChecklistEvidenceRef[] {
  if (fields.length === 0) return [{ documentId: document.id, fileName: document.fileName }]
  return fields.map((field) => ({
    documentId: document.id,
    fileName: document.fileName,
    fieldKey: field.key,
    value: field.value,
    sourceLabel: field.sourceLabel,
  }))
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date
}

function evaluateDocument(
  requirement: BankChecklistRequirement,
  document: BankDocumentEvidence,
  reviewDate: Date,
): DocumentVerdict {
  if (document.suspectedScan) {
    return {
      status: 'unreadable',
      message: `${document.fileName} có dấu hiệu là bản scan chưa có lớp văn bản.`,
      fix: 'Đính kèm bản có lớp văn bản hoặc chuyển sang hàng chờ OCR/người kiểm tra.',
      evidence: evidenceFor(document),
    }
  }

  if (document.needsReview || document.truncated) {
    return {
      status: 'needs_review',
      message: `${document.fileName} chưa đủ căn cứ để kiểm tự động.`,
      fix: document.truncated
        ? 'Đính kèm lại tài liệu trong giới hạn hoặc kiểm thủ công phần bị cắt.'
        : 'Kiểm tra lại loại tài liệu và các trường AI chưa chắc chắn.',
      evidence: evidenceFor(document),
    }
  }

  const requiredFields = requirement.requiredFields.map((key) => fieldOf(document, key))
  const missingKeys = requirement.requiredFields.filter(
    (_, index) => requiredFields[index] === undefined,
  )
  if (missingKeys.length > 0) {
    return {
      status: 'needs_review',
      message: `${document.fileName} chưa trích xuất được: ${missingKeys.join(', ')}.`,
      fix: 'Đối chiếu tài liệu nguồn và bổ sung/xác nhận các trường còn thiếu.',
      evidence: evidenceFor(
        document,
        requiredFields.filter((field): field is BankExtractedField => field !== undefined),
      ),
    }
  }

  const uncertain = requiredFields.filter(
    (field): field is BankExtractedField => field !== undefined && field.needsReview,
  )
  if (uncertain.length > 0) {
    return {
      status: 'needs_review',
      message: `${document.fileName} có ${String(uncertain.length)} trường cần người xác minh.`,
      fix: 'Mở bằng chứng nguồn và xác nhận từng trường trước khi dùng làm căn cứ.',
      evidence: evidenceFor(document, uncertain),
    }
  }

  if (requirement.expiryField !== undefined) {
    const expiry = fieldOf(document, requirement.expiryField)
    if (expiry === undefined || expiry.needsReview) {
      return {
        status: 'needs_review',
        message: `${document.fileName} chưa có ngày hết hạn đã được xác minh.`,
        fix: 'Đối chiếu ngày hết hạn trên tài liệu nguồn.',
        evidence: expiry === undefined ? evidenceFor(document) : evidenceFor(document, [expiry]),
      }
    }
    const expiresAt = parseIsoDate(expiry.value)
    if (expiresAt === null) {
      return {
        status: 'needs_review',
        message: `${document.fileName} có ngày hết hạn không theo định dạng YYYY-MM-DD.`,
        fix: 'Xác nhận và chuẩn hóa ngày hết hạn.',
        evidence: evidenceFor(document, [expiry]),
      }
    }
    const reviewDay = new Date(`${reviewDate.toISOString().slice(0, 10)}T00:00:00.000Z`)
    if (expiresAt.getTime() < reviewDay.getTime()) {
      return {
        status: 'expired',
        message: `${document.fileName} đã hết hạn ngày ${expiry.value}.`,
        fix: 'Yêu cầu chứng từ thay thế còn hiệu lực.',
        evidence: evidenceFor(document, [expiry]),
      }
    }
  }

  return {
    status: 'passed',
    message: `${document.fileName} đạt các luật đã chạy cho yêu cầu này.`,
    fix: 'Không có hành động tự động.',
    evidence: evidenceFor(
      document,
      requiredFields.filter((field): field is BankExtractedField => field !== undefined),
    ),
  }
}

function evaluateRequirement(
  requirement: BankChecklistRequirement,
  documents: readonly BankDocumentEvidence[],
  reviewDate: Date,
): BankChecklistItem {
  const matches = documents
    .filter((document) => requirement.acceptedDocumentTypes.includes(document.documentType))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))

  if (matches.length === 0) {
    return {
      id: requirement.id,
      label: requirement.label,
      ruleId: `REQ-${requirement.id}`,
      status: 'missing',
      message: `Chưa nhận chứng từ cho yêu cầu “${requirement.label}”.`,
      fix: 'Yêu cầu khách hàng hoặc hệ thống nguồn bổ sung chứng từ.',
      evidence: [],
    }
  }

  const best = matches
    .map((document) => evaluateDocument(requirement, document, reviewDate))
    .sort((a, b) => VERDICT_RANK[a.status] - VERDICT_RANK[b.status])[0]

  if (best === undefined) throw new Error('requirement evaluation has no candidate')
  return {
    id: requirement.id,
    label: requirement.label,
    ruleId: `REQ-${requirement.id}`,
    ...best,
    evidence: [...best.evidence],
  }
}

function normalizeComparable(fieldKey: string, value: string): string {
  const base = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('vi-VN')
  if (fieldKey.includes('number') || fieldKey.includes('id')) return base.replace(/[^a-z0-9]/g, '')
  return base
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function evaluateCrossChecks(
  template: BankChecklistTemplate,
  documents: readonly BankDocumentEvidence[],
): BankChecklistItem[] {
  return template.crossChecks.map((check) => {
    const evidence = documents
      .filter((document) => check.documentTypes.includes(document.documentType))
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .flatMap((document) => {
        const field = fieldOf(document, check.fieldKey)
        return field === undefined ? [] : [{ document, field }]
      })

    if (
      evidence.length < 2 ||
      evidence.some(({ document, field }) => document.needsReview || field.needsReview)
    ) {
      return {
        id: check.id,
        label: check.label,
        ruleId: `CROSS-${check.id}`,
        status: 'needs_review' as const,
        message: `Chưa có ít nhất hai giá trị “${check.fieldKey}” đã xác minh để đối chiếu.`,
        fix: 'Bổ sung hoặc xác nhận trường tương ứng trên các chứng từ nguồn.',
        evidence: evidence.flatMap(({ document, field }) => evidenceFor(document, [field])),
      }
    }

    const values = new Set(
      evidence.map(({ field }) => normalizeComparable(check.fieldKey, field.value)),
    )
    const mismatch = values.size > 1
    return {
      id: check.id,
      label: check.label,
      ruleId: `CROSS-${check.id}`,
      status: mismatch ? ('mismatch' as const) : ('passed' as const),
      message: mismatch
        ? `Các chứng từ có giá trị “${check.fieldKey}” không khớp.`
        : `Đã đối chiếu “${check.fieldKey}” trên ${String(evidence.length)} chứng từ.`,
      fix: mismatch
        ? 'Xác minh với khách hàng và hệ thống nguồn trước khi tiếp tục.'
        : 'Không có hành động tự động.',
      evidence: evidence.flatMap(({ document, field }) => evidenceFor(document, [field])),
    }
  })
}

export function runBankChecklistReview(
  template: BankChecklistTemplate,
  documents: readonly BankDocumentEvidence[],
  reviewedAt: Date = new Date(),
): BankChecklistReport {
  const items = [
    ...template.requirements.map((requirement) =>
      evaluateRequirement(requirement, documents, reviewedAt),
    ),
    ...evaluateCrossChecks(template, documents),
  ]

  const counts: BankChecklistReport['counts'] = {
    passed: 0,
    missing: 0,
    expired: 0,
    mismatch: 0,
    unreadable: 0,
    needs_review: 0,
  }
  for (const item of items) counts[item.status] += 1

  return {
    rulePackId: BANK_CHECKLIST_RULE_PACK.id,
    rulePackVersion: BANK_CHECKLIST_RULE_PACK.version,
    templateId: template.id,
    templateVersion: template.version,
    reviewedAt: reviewedAt.toISOString(),
    items,
    counts,
  }
}
