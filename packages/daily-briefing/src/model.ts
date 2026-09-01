/**
 * Mô hình bản tin công việc cá nhân (openspec `add-daily-briefing`).
 *
 * Package này là logic thuần: không biết SQLite, không biết LLM, không biết MCP. Nó nhận dữ liệu
 * đã giải mã/đã chuẩn hoá và trả về một bản tin đã nhóm, đã xếp thứ tự — cùng đầu vào và cùng mốc
 * thời gian thì luôn ra cùng kết quả.
 *
 * Model KHÔNG có mặt ở đây một cách có chủ ý: nó không quyết định mục nào xuất hiện, thuộc nhóm
 * nào hay đứng thứ mấy (xem `specs/daily-briefing/spec.md`).
 */

/**
 * Bốn nhóm cố định, xếp theo mức khẩn giảm dần. Thứ tự khai báo CHÍNH LÀ thứ tự hiển thị.
 *
 * `in_progress` gom cả việc không có mốc thời gian lẫn việc có hạn xa hơn 7 ngày: cả hai đều là
 * "đang làm, chưa tới lúc", và việc có hạn xa vẫn giữ nguyên `at` để giao diện nói được ngày.
 */
export const BRIEFING_GROUPS = ['overdue', 'due_today', 'due_this_week', 'in_progress'] as const
export type BriefingGroup = (typeof BRIEFING_GROUPS)[number]

export const BRIEFING_SOURCES = ['commitment', 'jira'] as const
export type BriefingSource = (typeof BRIEFING_SOURCES)[number]

/**
 * Lý do một mục được đưa lên bản tin, dạng có cấu trúc.
 *
 * Main gửi enum + timestamp, renderer tự dựng câu tiếng Việt. Không gửi sẵn câu chữ để tránh hai
 * tầng cùng viết copy cho một trạng thái.
 */
export const BRIEFING_REASONS = [
  'overdue',
  'due_today',
  'due_this_week',
  'in_progress',
  'check_in_due',
] as const
export type BriefingReasonKind = (typeof BRIEFING_REASONS)[number]

export interface BriefingReason {
  readonly kind: BriefingReasonKind
  /** Mốc thời gian đã quyết định nhóm; `null` khi mục không có mốc nào. */
  readonly at: string | null
  /**
   * Số ngày địa phương lệch so với hôm nay: âm là quá hạn, 0 là hôm nay, dương là sắp tới.
   * `null` khi không có mốc.
   */
  readonly days: number | null
}

export interface BriefingItem {
  /** Ổn định giữa các lần dựng: `commitment:<id>` hoặc `jira:<key>`. */
  readonly id: string
  readonly source: BriefingSource
  readonly title: string
  /** Bước tiếp theo của cam kết, hoặc tên trạng thái của issue. */
  readonly detail: string | null
  /** Issue key với nguồn Jira; `null` với cam kết. */
  readonly reference: string | null
  /** Hội thoại nguồn của cam kết, để Today mở lại đúng chỗ. */
  readonly sourceConversationId: string | null
  readonly status: string
  readonly group: BriefingGroup
  readonly reason: BriefingReason
  /** Mốc thời gian dùng để xếp hạng, ISO 8601. */
  readonly at: string | null
  readonly updatedAt: string
  /** Chỉ đúng với issue Jira đang nằm trong sprint chạy. */
  readonly inActiveSprint: boolean
}

export interface BriefingGroupResult {
  readonly group: BriefingGroup
  readonly items: readonly BriefingItem[]
  /** Số mục bị cắt vì vượt trần — hiển thị ra chứ không im lặng bỏ. */
  readonly truncatedCount: number
}

export interface Briefing {
  /** Thời điểm dựng, ISO 8601. */
  readonly generatedAt: string
  /** Ngày địa phương bản tin này thuộc về, `YYYY-MM-DD`. Khoá cache cũng dùng giá trị này. */
  readonly localDate: string
  /** Luôn đủ bốn nhóm theo thứ tự `BRIEFING_GROUPS`, kể cả nhóm rỗng. */
  readonly groups: readonly BriefingGroupResult[]
  readonly totalItems: number
  readonly truncatedTotal: number
}

export interface BriefingCommitmentInput {
  readonly id: string
  readonly title: string
  readonly nextAction: string | null
  readonly status: string
  readonly dueAt: string | null
  readonly checkInAt: string | null
  readonly sourceConversationId: string | null
  readonly updatedAt: string
}

export interface BriefingIssueInput {
  readonly key: string
  readonly summary: string
  readonly statusName: string
  readonly dueAt: string | null
  readonly updatedAt: string
  readonly inActiveSprint: boolean
}

export interface BriefingInput {
  /** Mốc "bây giờ" được tiêm vào để test không phụ thuộc lúc chạy. */
  readonly now: Date
  /**
   * Lệch múi giờ địa phương so với UTC, tính bằng phút và dương về phía đông
   * (Việt Nam = +420). Ranh giới ngày phải theo đồng hồ người dùng đang nhìn, không theo UTC.
   */
  readonly timeZoneOffsetMinutes: number
  readonly commitments: readonly BriefingCommitmentInput[]
  readonly issues: readonly BriefingIssueInput[]
  /** Trần số mục mỗi nhóm. Phần vượt được đếm vào `truncatedCount`, không biến mất lặng lẽ. */
  readonly maxItemsPerGroup?: number
}

export const DEFAULT_MAX_ITEMS_PER_GROUP = 20
