import type {
  BaFieldAuditView,
  BaFindingSeverityName,
  BaFindingView,
  BaProjectionsView,
  BaReviewReportView,
  BaTraceabilityView,
  BaErrorCodePageView,
  BaItemSummaryView,
  BaItemTypeName,
  BaKnowledgeCategoryName,
  BaKnowledgeStatusName,
  BaKnowledgeView,
} from '@nexa/shared-types/renderer'

/**
 * Helper thuần cho màn hình Nghiệp vụ.
 *
 * Tách khỏi component để test được mà không dựng DOM — cùng cách `commitment-ui.ts` làm.
 */

export const KNOWLEDGE_CATEGORY_LABELS: Record<BaKnowledgeCategoryName, string> = {
  domain: 'Kiến thức miền',
  rule: 'Quy tắc',
  term: 'Thuật ngữ',
  constraint: 'Ràng buộc',
  decision: 'Quyết định',
}

export const KNOWLEDGE_STATUS_LABELS: Record<BaKnowledgeStatusName, string> = {
  draft: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  outdated: 'Đã thay thế',
}

export const ITEM_TYPE_LABELS: Record<BaItemTypeName, string> = {
  actor: 'Tác nhân',
  field: 'Trường dữ liệu',
  use_case: 'Use case',
  rule: 'Quy tắc',
  flow_step: 'Bước luồng',
  error_code: 'Mã lỗi',
}

/** Thứ tự hiển thị nhóm item — đi từ khái quát tới chi tiết, không theo bảng chữ cái. */
export const ITEM_TYPE_ORDER: readonly BaItemTypeName[] = [
  'actor',
  'use_case',
  'flow_step',
  'field',
  'rule',
  'error_code',
]

export interface ItemGroup {
  readonly itemType: BaItemTypeName
  readonly label: string
  readonly items: readonly BaItemSummaryView[]
}

/**
 * Nhóm item theo kiểu, và **tách riêng phần còn cần soát**.
 *
 * Tách chứ không trộn là điểm chính: item `needsReview` không được dùng làm căn cứ kết luận (D4),
 * nên nó cũng không được nằm lẫn trong danh sách khiến người dùng tưởng đã chốt.
 */
export function groupItems(items: readonly BaItemSummaryView[]): {
  readonly groups: readonly ItemGroup[]
  readonly needsReview: readonly BaItemSummaryView[]
} {
  const reviewed = items.filter((item) => !item.needsReview)
  const needsReview = items.filter((item) => item.needsReview)

  const groups = ITEM_TYPE_ORDER.map((itemType) => ({
    itemType,
    label: ITEM_TYPE_LABELS[itemType],
    items: reviewed
      .filter((item) => item.itemType === itemType)
      .slice()
      .sort((a, b) => a.ordinal - b.ordinal),
  })).filter((group) => group.items.length > 0)

  return { groups, needsReview }
}

export interface ErrorPageHeadline {
  readonly text: string
  readonly tone: 'ok' | 'warning'
}

/**
 * Câu tóm tắt trên đầu trang mã lỗi.
 *
 * KHÔNG bao giờ dùng chữ "đầy đủ" cho cả tài liệu — trang này chỉ biết những gì có trong mô hình,
 * nó không biết một mã lỗi chưa ai nghĩ tới. Câu chữ ở đây nói **đã kiểm được gì**, không phán
 * tài liệu đúng hay sai.
 */
export function summarizeErrorPage(page: BaErrorCodePageView): ErrorPageHeadline {
  const { declared, undeclared, unreferenced, inconsistent, excludedNeedsReview } = page.counts
  const problems = undeclared + unreferenced + inconsistent

  const parts = [`Đã gom ${String(declared)} mã lỗi đã khai báo`]
  if (undeclared > 0) parts.push(`${String(undeclared)} mã được nhắc nhưng chưa khai báo`)
  if (unreferenced > 0) parts.push(`${String(unreferenced)} mã chưa luồng nào dùng`)
  if (inconsistent > 0) parts.push(`${String(inconsistent)} mã có hai thông điệp`)
  if (excludedNeedsReview > 0) {
    parts.push(`${String(excludedNeedsReview)} mục còn cần soát đã bị loại khỏi tổng hợp`)
  }

  return { text: `${parts.join(' · ')}.`, tone: problems > 0 ? 'warning' : 'ok' }
}

export interface KnowledgeFilter {
  readonly status: BaKnowledgeStatusName | 'all'
  readonly category: BaKnowledgeCategoryName | 'all'
}

export function filterKnowledge(
  items: readonly BaKnowledgeView[],
  filter: KnowledgeFilter,
): BaKnowledgeView[] {
  return items.filter(
    (item) =>
      (filter.status === 'all' || item.status === filter.status) &&
      (filter.category === 'all' || item.category === filter.category),
  )
}

/**
 * Nhãn cho biết một mục tri thức đã được dùng tới chưa.
 *
 * "Chưa dùng lần nào" là tín hiệu có ích chứ không phải lỗi: nó chỉ ra tri thức chết — thứ đã
 * confirm nhưng không tài liệu nào và không lượt chat nào chạm tới.
 */
export function formatUsage(item: BaKnowledgeView): string {
  if (item.useCount === 0) return 'Chưa dùng lần nào'
  return `Đã dùng ${String(item.useCount)} lần`
}

/**
 * Câu tóm tắt cho ma trận truy vết.
 *
 * Cùng nguyên tắc với trang mã lỗi: nói **đã đối chiếu được gì**, không phán tài liệu đúng hay sai.
 */
export function summarizeMatrix(matrix: BaTraceabilityView): ErrorPageHeadline {
  const parts = [
    `Đã đối chiếu ${String(matrix.steps.length)} bước với ${String(matrix.useCases.length)} use case`,
  ]
  if (matrix.uncoveredSteps.length > 0) {
    parts.push(`${String(matrix.uncoveredSteps.length)} bước chưa use case nào phủ`)
  }
  if (matrix.unusedUseCases.length > 0) {
    parts.push(`${String(matrix.unusedUseCases.length)} use case chưa chạm bước nào`)
  }
  if (matrix.excludedNeedsReview > 0) {
    parts.push(`${String(matrix.excludedNeedsReview)} mục còn cần soát đã bị loại`)
  }

  const problems = matrix.uncoveredSteps.length + matrix.unusedUseCases.length
  return { text: `${parts.join(' · ')}.`, tone: problems > 0 ? 'warning' : 'ok' }
}

/** Field còn thiếu validate theo chuẩn tổ chức. Field được miễn có lý do thì không tính. */
export function fieldsMissingValidation(
  audits: readonly BaFieldAuditView[],
): readonly BaFieldAuditView[] {
  return audits.filter((audit) => audit.missing.length > 0)
}

export function summarizeFieldAudits(audits: readonly BaFieldAuditView[]): ErrorPageHeadline {
  if (audits.length === 0) {
    return { text: 'Tài liệu chưa khai trường dữ liệu nào để đối chiếu.', tone: 'ok' }
  }

  const missing = fieldsMissingValidation(audits)
  const exempt = audits.filter((audit) => audit.exemptReason !== undefined)
  const unknown = audits.filter((audit) => audit.unknownKeys.length > 0)

  const parts = [`Đã đối chiếu ${String(audits.length)} trường với chuẩn của tổ chức`]
  if (missing.length > 0) parts.push(`${String(missing.length)} trường còn thiếu validate`)
  if (exempt.length > 0) parts.push(`${String(exempt.length)} trường được miễn có lý do`)
  if (unknown.length > 0) parts.push(`${String(unknown.length)} trường khai validate lạ`)

  return { text: `${parts.join(' · ')}.`, tone: missing.length > 0 ? 'warning' : 'ok' }
}

/**
 * Trạng thái mẫu của tài liệu.
 *
 * Trả `null` khi tài liệu chưa chọn mẫu — chưa chọn không phải là lỗi, nên đừng cảnh báo.
 */
export function describeTemplateState(projections: BaProjectionsView): ErrorPageHeadline | null {
  if (projections.template === null) return null

  const parts = [`Theo mẫu "${projections.template.name}" phiên bản ${projections.template.version}`]
  if (projections.templateOutdated === true) {
    parts.push('tổ chức đã phát hành bản mới hơn')
  }
  if (projections.missingRequired.length > 0) {
    parts.push(`${String(projections.missingRequired.length)} mục bắt buộc còn trống`)
  }
  if (projections.unplacedCount > 0) {
    parts.push(`${String(projections.unplacedCount)} mục nằm ngoài mẫu`)
  }

  const problems =
    projections.missingRequired.length +
    projections.unplacedCount +
    (projections.templateOutdated === true ? 1 : 0)
  return { text: `${parts.join(' · ')}.`, tone: problems > 0 ? 'warning' : 'ok' }
}

// ═══════════════════════════════════════════════════════════════════════════
// Báo cáo review
// ═══════════════════════════════════════════════════════════════════════════

export const SEVERITY_LABELS: Record<BaFindingSeverityName, string> = {
  blocker: 'Phải sửa',
  warning: 'Nên xem lại',
  info: 'Ghi chú',
}

/** Nặng trước. Người sửa tài liệu bắt đầu từ chỗ chặn, không từ chỗ đầu bảng chữ cái. */
export const SEVERITY_ORDER: readonly BaFindingSeverityName[] = ['blocker', 'warning', 'info']

const MISSING_LABELS: Record<'template' | 'rulebook' | 'knowledge', string> = {
  template: 'tài liệu chưa chọn mẫu',
  rulebook: 'bản cài chưa có chuẩn validate',
  knowledge: 'chưa có tri thức nào đã xác nhận',
}

/**
 * Câu nói thẳng giới hạn của bộ luật, hiển thị cạnh MỌI báo cáo.
 *
 * Đây là hàng rào chính chống lại rủi ro mà ADR 0010 gọi là "cảm giác an toàn giả". Nó không phải
 * lời rào đón lịch sự: một BA đọc "15/15 luật đạt" mà không đọc câu này sẽ hiểu thành "tài liệu
 * đúng", và đó chính là câu hỏi gốc ("làm sao chắc chắn tài liệu đã đầy đủ hết case") bị trả lời
 * sai một lần nữa.
 */
export const REVIEW_SCOPE_NOTE =
  'Bộ luật kiểm cấu trúc tài liệu và đối chiếu với tri thức nghiệp vụ đã xác nhận. Nó không biết một yêu cầu nghiệp vụ chưa ai nghĩ tới — nên "không có phát hiện" nghĩa là các luật dưới đây đều đạt, không phải tài liệu đã đúng.'

/**
 * Câu tóm tắt trên đầu báo cáo.
 *
 * Nói **đã kiểm cái gì**: bộ luật nào, phiên bản nào, bao nhiêu luật chạy trên tổng bao nhiêu, bao
 * nhiêu đạt, phát hiện theo mức, và bao nhiêu thứ bị loại khỏi phạm vi. Không có chỗ nào trong câu
 * này nói tài liệu đúng hay sai — và có test khẳng định chữ "đầy đủ" không bao giờ xuất hiện, kể
 * cả khi mọi luật đều đạt.
 */
export function summarizeReview(report: BaReviewReportView): ErrorPageHeadline {
  const { blocker, warning, info } = report.countsBySeverity
  const parts = [
    `Đã kiểm ${String(report.rulesRun)}/${String(report.rulesTotal)} luật của bộ ${report.rulePackId} phiên bản ${report.rulePackVersion}`,
    `${String(report.rulesPassed)} luật đạt`,
  ]

  if (blocker > 0) parts.push(`${String(blocker)} chỗ phải sửa`)
  if (warning > 0) parts.push(`${String(warning)} chỗ nên xem lại`)
  if (info > 0) parts.push(`${String(info)} ghi chú`)
  if (blocker + warning + info === 0) parts.push('không có phát hiện nào')

  const skipped = report.rules.filter((rule) => rule.status === 'skipped').length
  if (skipped > 0) parts.push(`${String(skipped)} luật chưa kiểm được`)
  if (report.excludedNeedsReview > 0) {
    parts.push(`${String(report.excludedNeedsReview)} mục còn cần soát đã bị loại`)
  }

  return { text: `${parts.join(' · ')}.`, tone: blocker + warning > 0 ? 'warning' : 'ok' }
}

export interface FindingGroup {
  readonly severity: BaFindingSeverityName
  readonly label: string
  readonly findings: readonly BaFindingView[]
}

/** Gom phát hiện theo mức, nặng trước; bỏ nhóm rỗng. Giữ nguyên thứ tự main đã sắp trong nhóm. */
export function groupFindings(report: BaReviewReportView): readonly FindingGroup[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    label: SEVERITY_LABELS[severity],
    findings: report.findings.filter((finding) => finding.severity === severity),
  })).filter((group) => group.findings.length > 0)
}

/**
 * Câu nói luật nào chưa kiểm được và vì sao.
 *
 * Trả `null` khi không có luật nào bị bỏ — chứ không trả một câu rỗng — để giao diện không hiện
 * một dòng trống. Có luật bị bỏ thì phải nói ra: một luật chưa chạy mà bị đọc thành một luật đã
 * đạt là đúng kiểu im lặng sai mà bộ luật sinh ra để tránh.
 */
export function describeSkippedRules(report: BaReviewReportView): string | null {
  const skipped = report.rules.filter((rule) => rule.status === 'skipped')
  if (skipped.length === 0) return null

  const reasons = skipped.map(
    (rule) => `${rule.id} (${rule.missing === undefined ? 'thiếu căn cứ' : MISSING_LABELS[rule.missing]})`,
  )
  return `Chưa kiểm được ${String(skipped.length)} luật: ${reasons.join(', ')}.`
}

/** Cảnh báo hai báo cáo đo bằng hai thước khác nhau. `null` khi cùng phiên bản. */
export function describeRulePackChange(report: BaReviewReportView): string | null {
  if (report.previousRulePackVersion === undefined) return null
  return `Báo cáo trước chạy bằng bộ luật phiên bản ${report.previousRulePackVersion}, lần này là ${report.rulePackVersion} — hai kết quả không so trực tiếp với nhau được.`
}
