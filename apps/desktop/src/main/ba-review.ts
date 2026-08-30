import {
  RULE_PACK_V1,
  applyItemText,
  findRulePack,
  runReview,
  summarizeItem,
  summarizeModel,
  type BaItemSummary,
  type BaKnowledgeFact,
  type Finding,
  type PatchableField,
  type RulePack,
} from '@nexa/ba-kit'
import type {
  ActivityRepository,
  BaDocumentRepository,
  BaKnowledgeRepository,
  BaReview,
  BaReviewRepository,
} from '@nexa/local-store'
import { newRequestId, type Logger } from '@nexa/observability'
import {
  ERROR_CODES,
  NexaError,
  type AppSettings,
  type BaFindingView,
  type BaReviewReportView,
  type BaReviewRuleView,
  type BaWordingSuggestionView,
  type LlmProvider,
} from '@nexa/shared-types'
import type { ChatRequest, ChatResult, RequestContext } from '@nexa/llm-client'
import { z } from 'zod'
import type { BaStandards } from './ba-standards.js'

/**
 * Chạy review, lưu báo cáo, và — tách hẳn ra — xin model một câu chữ gợi ý (D2, ADR 0010).
 *
 * Hình dạng của lớp này là chỗ quyết định "phán quyết do code trả" có thật hay không, nên đáng nói
 * rõ ba điều:
 *
 * 1. **`run` không chạm tới model.** Nó gọi `runReview` của `ba-kit` — một hàm thuần — rồi lưu kết
 *    quả. Không có nhánh nào trong `run` gọi LLM, nên không có đường nào để một lượt gọi model đổi
 *    được tập finding.
 *
 * 2. **`suggestWording` không sinh ra finding.** Nó tra một finding **đã lưu** theo con trỏ, gửi đi
 *    hỏi câu chữ, và trả lại đúng finding đó cộng một chuỗi. Model có trả về `{"findings": [],
 *    "bo_qua": true}` thì cũng chỉ là các khoá bị bỏ qua khi parse.
 *
 * 3. **`applyFinding` sửa đúng một ô của đúng một item**, và mỗi lần là một dòng activity. Không
 *    có "áp dụng tất cả": một nút gộp mọi thay đổi lại chính là cách biến review thành tự sửa.
 */

export interface ReviewLlm {
  complete(request: ChatRequest, ctx: RequestContext): Promise<ChatResult>
}

export interface BaReviewDeps {
  readonly profileId: string
  readonly documents: BaDocumentRepository
  readonly knowledge: BaKnowledgeRepository
  readonly reviews: BaReviewRepository
  readonly activity: ActivityRepository
  readonly standards: () => BaStandards
  readonly resolveModel: () => { readonly modelId: string; readonly provider: LlmProvider }
  readonly buildLlmClient: (provider: LlmProvider, timeoutMs: number) => ReviewLlm
  readonly settings: () => AppSettings
  readonly logger: Logger
}

const SYSTEM_PROMPT = `Bạn giúp một Business Analyst diễn đạt lại MỘT chỗ trong tài liệu nghiệp vụ.

Bạn được đưa một phát hiện đã do hệ thống kiểm tra sinh ra. Việc của bạn CHỈ là đề xuất câu chữ thay thế cho chỗ đó.

Quy tắc bắt buộc:
- Trả về đúng JSON dạng {"goi_y": "..."} — không giải thích, không markdown fence.
- KHÔNG bàn về việc phát hiện này đúng hay sai, KHÔNG đề nghị bỏ qua nó.
- Viết tiếng Việt, một câu hoặc một đoạn ngắn, tối đa 400 ký tự.
- Chỉ viết lại nội dung nghiệp vụ. Không thêm yêu cầu mới mà tài liệu chưa nói.`

/**
 * Schema output của bước gợi ý.
 *
 * Chỉ MỘT trường. Zod bỏ mọi khoá lạ, nên một output cố tình kèm `"findings"` hay `"severity"` đi
 * qua đây là mất sạch phần thừa — hàng rào cuối cùng cho "model không thêm, không xoá, không hạ
 * mức finding". Có test khẳng định điều đó.
 */
const suggestionSchema = z.object({
  goi_y: z.string().trim().min(1).max(600),
})

function stripFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(trimmed)
  return fenced?.[1]?.trim() ?? trimmed
}

export class BaReviewService {
  constructor(private readonly deps: BaReviewDeps) {}

  /** Chạy bộ luật và lưu báo cáo. Hoàn toàn cục bộ, không gọi model. */
  run(documentId: string): BaReviewReportView {
    const document = this.deps.documents.get(documentId)
    if (document === null) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: `ba document not found: ${documentId}`,
      })
    }

    const standards = this.deps.standards()
    const previous = this.deps.reviews.latest(documentId)

    const report = runReview(RULE_PACK_V1, {
      model: this.deps.documents.readModel(documentId),
      knowledge: this.confirmedKnowledge(),
      rulebook: standards.rulebook,
      template: standards.templates.find((entry) => entry.id === document.templateId) ?? null,
    })

    const saved = this.deps.reviews.create({
      documentId,
      rulePackId: report.rulePackId,
      rulePackVersion: report.rulePackVersion,
      rulesRun: report.rulesRun,
      rulesPassed: report.rulesPassed,
      excludedNeedsReview: report.excludedNeedsReview,
      knowledgeConsidered: report.knowledgeConsidered,
      findings: report.findings,
      skippedRules: [...report.skippedRules],
    })

    // "use_count tăng khi item được `R-KB-01` dùng" (D6). Dùng nghĩa là đã làm căn cứ cho một
    // finding — item chỉ được quét qua mà không khớp gì vẫn là tri thức chết, và thống kê phải
    // nói được điều đó.
    const usedKnowledge = [
      ...new Set(
        report.findings
          .filter((finding) => finding.ruleId === 'R-KB-01')
          .flatMap((finding) => finding.evidence),
      ),
    ]
    if (usedKnowledge.length > 0) this.deps.knowledge.recordUsage(usedKnowledge)

    // Chỉ id, phiên bản và số đếm. Không mức, không nội dung finding, không tên item.
    this.deps.logger.info('ba-review-completed', {
      documentId,
      reviewId: saved.id,
      rulePackId: report.rulePackId,
      rulePackVersion: report.rulePackVersion,
      rulesTotal: report.rulesTotal,
      rulesRun: report.rulesRun,
      rulesPassed: report.rulesPassed,
      skippedCount: report.skippedRules.length,
      findingCount: report.findings.length,
      excludedNeedsReview: report.excludedNeedsReview,
    })

    return toReportView(saved, previous)
  }

  /** Báo cáo đã lưu của một tài liệu, mới nhất trước. */
  history(documentId: string, limit = 10): BaReviewReportView[] {
    const stored = this.deps.reviews.list(documentId, limit)
    return stored.map((review, index) => toReportView(review, stored[index + 1] ?? null))
  }

  /**
   * Xin model một câu chữ cho MỘT finding đã có trong báo cáo mới nhất.
   *
   * Tra lại finding từ báo cáo đã lưu thay vì nhận nội dung từ renderer là chủ đích: renderer là
   * bên không đáng tin (§5.3), và nếu nó gửi được nội dung finding thì nó cũng bịa được một
   * finding để mớm cho model.
   */
  async suggestWording(
    documentId: string,
    ref: { readonly ruleId: string; readonly itemId: string | null },
  ): Promise<BaWordingSuggestionView> {
    const latest = this.deps.reviews.latest(documentId)
    if (latest === null) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'no stored review for this document',
      })
    }

    const finding = latest.findings.find(
      (entry) => entry.ruleId === ref.ruleId && entry.itemId === ref.itemId,
    )
    if (finding === undefined) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'finding is not part of the latest review for this document',
      })
    }

    const config = this.deps.resolveModel()
    const llm = this.deps.buildLlmClient(config.provider, this.deps.settings().llmTimeoutMs)

    const result = await llm.complete(
      {
        model: config.modelId,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: this.wordingPrompt(documentId, finding) },
        ],
        temperature: 0,
      },
      { requestId: newRequestId() },
    )

    let parsed: unknown
    try {
      parsed = JSON.parse(stripFence(result.text))
    } catch {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'wording suggestion output is not valid JSON',
      })
    }

    const suggestion = suggestionSchema.safeParse(parsed)
    if (!suggestion.success) {
      this.deps.logger.warn('ba-review-suggestion-invalid', {
        documentId,
        ruleId: finding.ruleId,
        invalidFields: suggestion.error.issues.map((issue) => issue.path.join('.')),
      })
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'wording suggestion output does not match schema',
      })
    }

    this.deps.logger.info('ba-review-suggestion', { documentId, ruleId: finding.ruleId })

    // Finding trả về là bản do CODE sinh ra, đọc từ báo cáo đã lưu. Model chỉ đóng góp `suggestion`.
    return { finding: toFindingView(finding), suggestion: suggestion.data.goi_y }
  }

  /** Áp một câu chữ lên đúng một ô của đúng một item, và ghi một dòng activity. */
  applyFinding(input: {
    readonly documentId: string
    readonly itemId: string
    readonly field: PatchableField
    readonly value: string
  }): { readonly items: readonly BaItemSummary[] } {
    const model = this.deps.documents.readModel(input.documentId)
    const applied = applyItemText(model, {
      itemId: input.itemId,
      field: input.field,
      value: input.value,
    })
    if (!applied.ok) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, { safeDetail: applied.reason })
    }

    this.deps.documents.replaceModel(input.documentId, applied.model)

    this.deps.activity.record({
      profileId: this.deps.profileId,
      type: 'ba_document_mutation',
      action: 'updated',
      status: 'success',
      subjectType: 'ba_document',
      subjectId: input.documentId,
      actor: 'user',
    })

    // Ô nào đã sửa là một enum khép kín, không phải nội dung — an toàn để log và hữu ích khi soi lại.
    this.deps.logger.info('ba-review-finding-applied', {
      documentId: input.documentId,
      itemType: applied.item.itemType,
      field: input.field,
    })

    return { items: summarizeModel(applied.model.items) }
  }

  private confirmedKnowledge(): BaKnowledgeFact[] {
    return this.deps.knowledge
      .list(this.deps.profileId, { status: 'confirmed' })
      .map((item) => ({ id: item.id, title: item.title, body: item.body, status: item.status }))
  }

  /**
   * Chỉ hai dòng tóm tắt của item đi ra ngoài, không phải payload đầy đủ.
   *
   * Model cần biết chỗ đang nói tới hiện đang viết thế nào để đề xuất câu thay thế, nhưng nó không
   * cần trọn luồng chính 12 bước — nên `summarizeItem` là đúng lượng dữ liệu, và cũng là phép chiếu
   * mà renderer đã dùng.
   */
  private wordingPrompt(documentId: string, finding: Finding): string {
    const lines = [
      `Phát hiện (luật ${finding.ruleId}): ${finding.message}`,
      `Việc cần làm: ${finding.fix}`,
    ]

    if (finding.itemId !== null) {
      const item = this.deps.documents
        .readModel(documentId)
        .items.find((entry) => entry.id === finding.itemId)
      if (item !== undefined) {
        const summary = summarizeItem(item)
        lines.push(
          `Nội dung hiện tại của mục (${summary.itemType}): ${summary.title}${
            summary.detail === '' ? '' : ` — ${summary.detail}`
          }`,
        )
      }
    }

    lines.push('Trả về JSON {"goi_y": "..."}.')
    return lines.join('\n')
  }
}

function toFindingView(finding: Finding): BaFindingView {
  return {
    ruleId: finding.ruleId,
    severity: finding.severity,
    itemId: finding.itemId,
    message: finding.message,
    fix: finding.fix,
    evidence: finding.evidence,
  }
}

/**
 * Đổi bản ghi đã lưu thành báo cáo hiển thị được.
 *
 * Danh sách `rules` dựng từ **pack đã ghi trong bản ghi**, không phải pack hiện hành: một báo cáo
 * ba tháng trước phải được đọc bằng đúng bộ luật đã chạy nó. Tra hụt pack thì vẫn dựng được danh
 * sách từ chính finding và phần bị bỏ qua — mất phần mô tả, không mất phần sự thật.
 */
export function toReportView(
  review: BaReview,
  previous: BaReview | null,
): BaReviewReportView {
  const pack: RulePack | null = findRulePack(review.rulePackId, review.rulePackVersion)
  const countByRule = new Map<string, number>()
  for (const finding of review.findings) {
    countByRule.set(finding.ruleId, (countByRule.get(finding.ruleId) ?? 0) + 1)
  }
  const skipped = new Map(review.skippedRules.map((entry) => [entry.ruleId, entry.missing] as const))

  const ruleIds =
    pack !== null
      ? pack.rules.map((rule) => rule.id)
      : [...new Set([...countByRule.keys(), ...skipped.keys()])].sort()

  const rules: BaReviewRuleView[] = ruleIds.map((id) => {
    const description = pack?.rules.find((rule) => rule.id === id)?.description ?? ''
    const missing = skipped.get(id)
    if (missing !== undefined) {
      return { id, description, status: 'skipped', findingCount: 0, missing }
    }
    const findingCount = countByRule.get(id) ?? 0
    return { id, description, status: findingCount === 0 ? 'passed' : 'failed', findingCount }
  })

  const countsBySeverity = { blocker: 0, warning: 0, info: 0 }
  for (const finding of review.findings) countsBySeverity[finding.severity] += 1

  return {
    reviewId: review.id,
    documentId: review.documentId,
    rulePackId: review.rulePackId,
    rulePackVersion: review.rulePackVersion,
    rulesTotal: pack?.rules.length ?? rules.length,
    rulesRun: review.rulesRun,
    rulesPassed: review.rulesPassed,
    excludedNeedsReview: review.excludedNeedsReview,
    knowledgeConsidered: review.knowledgeConsidered,
    countsBySeverity,
    findings: review.findings.map(toFindingView),
    rules,
    createdAt: review.createdAt,
    ...(previous !== null && previous.rulePackVersion !== review.rulePackVersion
      ? { previousRulePackVersion: previous.rulePackVersion }
      : {}),
  }
}
