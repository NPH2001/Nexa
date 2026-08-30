import type {
  BankChecklistReportView,
  BankChecklistStatusName,
  BankDocumentTypeName,
} from '@nexa/shared-types/renderer'

export const CHECKLIST_STATUS_LABELS: Readonly<Record<BankChecklistStatusName, string>> = {
  passed: 'Đạt luật đã chạy',
  missing: 'Thiếu',
  expired: 'Hết hạn',
  mismatch: 'Không khớp',
  unreadable: 'Không đọc được',
  needs_review: 'Cần kiểm tra',
}

export const DOCUMENT_TYPE_LABELS: Readonly<Record<BankDocumentTypeName, string>> = {
  national_id: 'CCCD/CMND',
  passport: 'Hộ chiếu',
  application_form: 'Phiếu đề nghị',
  proof_of_residence: 'Chứng từ địa chỉ',
  proof_of_income: 'Chứng từ thu nhập',
  bank_statement: 'Sao kê ngân hàng',
  other: 'Chưa phân loại',
}

export function checklistStatusClass(status: BankChecklistStatusName): string {
  if (status === 'passed') return 'tag-success'
  if (status === 'needs_review' || status === 'unreadable') return 'tag-warning'
  return 'tag-danger'
}

export function summarizeBankChecklist(report: BankChecklistReportView): string {
  const attention =
    report.counts.missing +
    report.counts.expired +
    report.counts.mismatch +
    report.counts.unreadable +
    report.counts.needs_review
  return `${String(report.counts.passed)} đạt luật đã chạy · ${String(attention)} cần xử lý`
}
