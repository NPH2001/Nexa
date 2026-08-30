import { z } from 'zod'
import { reviewedModel, type BaDocModel } from '../model.js'
import type { BaRulebook } from '../rulebook.js'
import type { BaTemplate } from '../template.js'
import {
  SEVERITY_ORDER,
  findingSchema,
  type BaKnowledgeFact,
  type Finding,
  type FindingSeverity,
  type RuleInput,
  type RulePack,
  type RuleRequirement,
} from './types.js'

/**
 * Bộ chạy review.
 *
 * Ba tính chất phải giữ, và cả ba đều có test riêng:
 *
 * 1. **Xác định.** Cùng tài liệu + cùng phiên bản pack ⇒ cùng tập finding, cùng thứ tự. Nên finding
 *    được sắp lại bằng một khoá không phụ thuộc thứ tự item đầu vào.
 * 2. **Không dùng item chưa soát làm căn cứ**, và số bị loại phải hiện ra (D4).
 * 3. **Không biết tên luật nào.** Bộ chạy chỉ duyệt `pack.rules`. Thêm luật không đụng file này.
 */

export interface SkippedRule {
  readonly ruleId: string
  readonly missing: RuleRequirement
}

export interface ReviewReport {
  readonly rulePackId: string
  readonly rulePackVersion: string
  /** Số luật có trong pack. */
  readonly rulesTotal: number
  /** Số luật thật sự chạy được. Luật thiếu căn cứ không tính vào đây. */
  readonly rulesRun: number
  /** Số luật đã chạy và không ra finding nào. */
  readonly rulesPassed: number
  /** Luật chưa kiểm được vì thiếu mẫu, thiếu rulebook hoặc chưa có tri thức đã xác nhận. */
  readonly skippedRules: readonly SkippedRule[]
  /** Item bị loại khỏi căn cứ vì còn cần người soát. */
  readonly excludedNeedsReview: number
  /** Số item tri thức đã xác nhận được dùng làm căn cứ. */
  readonly knowledgeConsidered: number
  readonly findings: readonly Finding[]
  readonly countsBySeverity: Readonly<Record<FindingSeverity, number>>
}

export interface ReviewInput {
  readonly model: BaDocModel
  readonly knowledge?: readonly BaKnowledgeFact[]
  readonly rulebook?: BaRulebook | null
  readonly template?: BaTemplate | null
}

/**
 * Phần báo cáo được lưu xuống DB.
 *
 * Cột `findings_ciphertext` của `ba_reviews` giữ đúng object này chứ không chỉ mảng finding: danh
 * sách luật bị bỏ qua phụ thuộc vào việc lúc chạy có mẫu/rulebook hay không, nên nó KHÔNG suy lại
 * được từ pack. Không lưu thì một báo cáo mở lại sau này sẽ tự nhận là đã kiểm nhiều hơn thực tế.
 */
export const reviewPayloadSchema = z.object({
  findings: z.array(findingSchema),
  skippedRules: z
    .array(
      z.object({
        ruleId: z.string().trim().min(1).max(32),
        missing: z.enum(['template', 'rulebook', 'knowledge']),
      }),
    )
    .default([]),
  knowledgeConsidered: z.number().int().nonnegative().default(0),
})
export type ReviewPayload = z.infer<typeof reviewPayloadSchema>

function isAvailable(requirement: RuleRequirement, input: RuleInput): boolean {
  if (requirement === 'template') return input.template !== null
  if (requirement === 'rulebook') return input.rulebook !== null
  return input.knowledge.length > 0
}

export function runReview(pack: RulePack, input: ReviewInput): ReviewReport {
  const reviewed = reviewedModel(input.model)
  // Lọc `confirmed` ở đây, một lần, thay vì tin mỗi luật tự nhớ. `R-KB-01` vẫn lọc lại — hai hàng
  // rào cho cùng một bất biến là cái giá rẻ nhất trong file này.
  const knowledge = (input.knowledge ?? []).filter((fact) => fact.status === 'confirmed')

  const ruleInput = {
    doc: reviewed.model,
    knowledge,
    rulebook: input.rulebook ?? null,
    template: input.template ?? null,
  }

  const findings: Finding[] = []
  const skippedRules: SkippedRule[] = []
  const orderOfRule = new Map(pack.rules.map((rule, index) => [rule.id, index] as const))
  let rulesRun = 0
  let rulesPassed = 0

  for (const rule of pack.rules) {
    if (rule.requires !== undefined && !isAvailable(rule.requires, ruleInput)) {
      skippedRules.push({ ruleId: rule.id, missing: rule.requires })
      continue
    }
    rulesRun += 1
    const produced = rule.evaluate(ruleInput)
    if (produced.length === 0) rulesPassed += 1
    findings.push(...produced)
  }

  findings.sort(compareFindings(orderOfRule))

  const countsBySeverity: Record<FindingSeverity, number> = { blocker: 0, warning: 0, info: 0 }
  for (const finding of findings) countsBySeverity[finding.severity] += 1

  return {
    rulePackId: pack.id,
    rulePackVersion: pack.version,
    rulesTotal: pack.rules.length,
    rulesRun,
    rulesPassed,
    skippedRules,
    excludedNeedsReview: reviewed.excluded,
    knowledgeConsidered: knowledge.length,
    findings,
    countsBySeverity,
  }
}

/**
 * Khoá sắp xếp của danh sách finding.
 *
 * Cố ý KHÔNG sắp theo mức nghiêm trọng trước: người đọc sửa tài liệu theo từng chỗ, nên gom các
 * finding của cùng một luật lại với nhau hữu ích hơn. Mức được dùng làm khoá phụ để trong cùng một
 * luật thì blocker nổi lên trước, và UI vẫn lọc theo mức được.
 *
 * Bốn khoá là đủ để thứ tự không còn phụ thuộc thứ tự item đầu vào — điều kiện của tính lặp lại.
 */
function compareFindings(order: ReadonlyMap<string, number>) {
  return (a: Finding, b: Finding): number =>
    (order.get(a.ruleId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.ruleId) ?? Number.MAX_SAFE_INTEGER) ||
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    (a.itemId ?? '').localeCompare(b.itemId ?? '') ||
    a.message.localeCompare(b.message)
}
