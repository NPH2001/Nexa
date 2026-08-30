import { z } from 'zod'
import type { BaDocModel } from '../model.js'
import type { BaRulebook } from '../rulebook.js'
import type { BaTemplate } from '../template.js'

/**
 * Hợp đồng của bộ luật review (D2, ADR 0010).
 *
 * Điều quan trọng nhất trong file này là chữ ký của `evaluate`: một **hàm thuần** trên dữ liệu đã
 * có sẵn. Không `async`, không nhận client, không nhận repository. Đó là cách "phán quyết do code
 * trả" trở thành một tính chất kiểm tra được bằng kiểu, chứ không phải một lời hứa trong tài liệu:
 * một luật muốn hỏi model thì không compile được ở đây.
 */

export const FINDING_SEVERITIES = ['blocker', 'warning', 'info'] as const
export const findingSeveritySchema = z.enum(FINDING_SEVERITIES)
export type FindingSeverity = z.infer<typeof findingSeveritySchema>

/** Thứ tự nghiêm trọng giảm dần — dùng để sắp báo cáo, không phải để so sánh bằng số ở nơi khác. */
export const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  blocker: 0,
  warning: 1,
  info: 2,
}

export const findingSchema = z.object({
  /** Không có finding nào không có `ruleId`. Đây là bất biến của cả change này. */
  ruleId: z.string().trim().min(1).max(32),
  severity: findingSeveritySchema,
  /** Item liên quan. `null` khi phát hiện thuộc về cả tài liệu (ví dụ thiếu mục của mẫu). */
  itemId: z.string().trim().min(1).max(64).nullable(),
  /** Vấn đề là gì. */
  message: z.string().trim().min(1).max(600),
  /** Việc cần làm. Tách khỏi `message` để UI hiển thị riêng và để người đọc không phải suy ra. */
  fix: z.string().trim().min(1).max(600),
  /** Id khác làm căn cứ — item tri thức của `R-KB-01`, item đối ứng của `R-RULE-01`. */
  evidence: z.array(z.string().trim().min(1).max(64)).default([]),
})
export type Finding = z.infer<typeof findingSchema>

/**
 * Tri thức nghiệp vụ ở dạng `ba-kit` nhìn thấy.
 *
 * Cố ý là một interface cấu trúc chứ không phải kiểu import từ `local-store`: ranh giới D9 cấm
 * `ba-kit` biết tới DB. Bên gọi truyền vào cái gì có đủ bốn trường này là chạy được — kể cả một
 * object dựng tay trong test.
 */
export interface BaKnowledgeFact {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly status: 'draft' | 'confirmed' | 'outdated'
}

/**
 * Đầu vào của một luật.
 *
 * Thiết kế gốc ghi `(doc, kb) => Finding[]`. Thực tế có hai luật đối chiếu với **chuẩn của tổ
 * chức** chứ không phải với tài liệu hay tri thức: `R-FLD-02` cần rulebook, `R-TPL-01` cần mẫu.
 * Nhét chúng vào `kb` sẽ làm hỏng nghĩa của `kb`, nên chúng thành hai trường riêng. Tính thuần và
 * tính xác định không đổi: vẫn là một object dữ liệu vào, một mảng finding ra.
 */
export interface RuleInput {
  /** Mô hình **đã loại item `needsReview`** — bộ chạy lo việc đó, luật không phải nhớ (D4). */
  readonly doc: BaDocModel
  /** Tri thức **đã lọc còn `confirmed`** — bộ chạy lo việc đó. */
  readonly knowledge: readonly BaKnowledgeFact[]
  readonly rulebook: BaRulebook | null
  readonly template: BaTemplate | null
}

/** Thứ mà một luật cần mới chạy được. Thiếu thì luật bị **bỏ qua và báo rõ**, không phải "đạt". */
export const RULE_REQUIREMENTS = ['template', 'rulebook', 'knowledge'] as const
export type RuleRequirement = (typeof RULE_REQUIREMENTS)[number]

export interface ReviewRule {
  readonly id: string
  readonly description: string
  /**
   * Mức của finding khi luật không phân biệt. Luật nào phân biệt (ví dụ `R-ERR-01`: mã được nhắc
   * mà chưa khai báo nặng hơn mã khai báo mà không ai dùng) thì tự đặt mức cho từng finding.
   *
   * Mức luôn do **luật** quyết định theo dữ liệu, không bao giờ do người dùng hay model chỉnh.
   */
  readonly defaultSeverity: FindingSeverity
  readonly requires?: RuleRequirement
  readonly evaluate: (input: RuleInput) => Finding[]
}

export interface RulePack {
  readonly id: string
  readonly version: string
  readonly name: string
  readonly rules: readonly ReviewRule[]
}

/** Dựng một finding, lấy `ruleId` và mức mặc định từ chính luật để hai chỗ không lệch nhau. */
export function makeFinding(
  rule: ReviewRule,
  opts: {
    readonly itemId?: string | null
    readonly message: string
    readonly fix: string
    readonly severity?: FindingSeverity
    readonly evidence?: readonly string[]
  },
): Finding {
  return {
    ruleId: rule.id,
    severity: opts.severity ?? rule.defaultSeverity,
    itemId: opts.itemId ?? null,
    message: opts.message,
    fix: opts.fix,
    evidence: [...(opts.evidence ?? [])],
  }
}
