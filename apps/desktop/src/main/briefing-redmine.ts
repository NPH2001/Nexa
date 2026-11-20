import { z } from 'zod'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import type { BriefingSourceStatusName, McpToolSource } from '@nexa/shared-types'
import type { BriefingIssueInput } from '@nexa/daily-briefing'
import type { Logger } from '@nexa/observability'

/**
 * Nguồn Redmine của bản tin (openspec `switch-briefing-to-redmine`).
 *
 * Đúng một lời gọi `redmine_search_issues` READ, với bộ lọc do FILE NÀY dựng. Không có tham số nào
 * đi từ renderer hay từ model vào truy vấn.
 */

export const BRIEFING_REDMINE_TOOL = 'redmine_search_issues'

/** Trần của chính tool (`limit` tối đa 100); giữ 50 như bản tin trước để trang không quá dài. */
export const BRIEFING_REDMINE_LIMIT = 50

/**
 * Việc đang giao cho tôi và còn mở, sắp theo hạn.
 *
 * `status: 'open'` là loại trừ phía server theo cờ "đã đóng" của từng trạng thái, nên không cần
 * liệt kê tên trạng thái — tên khác nhau giữa các dự án và tên không tồn tại làm lỗi cả truy vấn.
 */
export const BRIEFING_REDMINE_QUERY = {
  assigned_to_id: 'me',
  status: 'open',
  sort: 'due_date:asc',
  limit: BRIEFING_REDMINE_LIMIT,
} as const

export interface BriefingRedmineResult {
  readonly status: BriefingSourceStatusName
  readonly issues: readonly BriefingIssueInput[]
  /** Số issue Redmine nói là có nhưng không nằm trong trang này. */
  readonly truncatedCount: number
  readonly fetchedAt: string | null
}

const looseStringSchema = z.union([z.string(), z.number()]).nullish()

const rawIssueSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    subject: looseStringSchema,
    status: z.union([z.string(), z.object({ name: z.string().nullish() }).passthrough()]).nullish(),
    due_date: looseStringSchema,
    updated_on: looseStringSchema,
  })
  .passthrough()

const searchPayloadSchema = z
  .object({
    total_count: z.number().nullish(),
    issues: z.array(z.unknown()),
  })
  .passthrough()

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
  }
  if (typeof value === 'number') return String(value)
  return null
}

function statusName(value: z.infer<typeof rawIssueSchema>['status']): string | null {
  if (typeof value === 'string') return text(value)
  if (value !== null && value !== undefined) return text(value.name)
  return null
}

/** Mã issue dạng `#123`; id không phải số nguyên dương thì bỏ cả issue. */
function issueKey(id: number | string): string | null {
  const n = Number(id)
  return Number.isInteger(n) && n > 0 ? `#${String(n)}` : null
}

/**
 * Chuẩn hoá ngày về ISO.
 *
 * Redmine trả `due_date` dạng `YYYY-MM-DD` (không giờ). Neo vào giữa trưa UTC: nửa đêm UTC rơi
 * sang ngày hôm trước ở múi giờ âm và trùng ranh giới ngày ở múi giờ dương, nên "đến hạn hôm nay"
 * dễ lệch một ngày. Giữa trưa cách cả hai biên hơn 11 tiếng.
 */
function normalizeDate(value: unknown): string | null {
  const raw = text(value)
  if (raw === null) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T12:00:00.000Z`
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

/**
 * Đọc payload `redmine_search_issues`.
 *
 * Bỏ qua từng issue hỏng, nhưng payload KHÔNG parse được thì ném lỗi: một parser dễ dãi sẽ biến
 * "gateway trả HTML lỗi" thành "hôm nay bạn không có việc gì", đúng thứ spec cấm.
 */
export function parseBriefingIssues(rawText: string): {
  readonly issues: BriefingIssueInput[]
  readonly truncatedCount: number
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
      safeDetail: 'redmine_search_issues returned a payload that is not JSON',
    })
  }

  const payload = searchPayloadSchema.safeParse(parsed)
  if (!payload.success) {
    throw new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
      safeDetail: 'redmine_search_issues payload has no issue list',
    })
  }

  const issues: BriefingIssueInput[] = []
  for (const entry of payload.data.issues) {
    const issue = rawIssueSchema.safeParse(entry)
    if (!issue.success) continue
    const raw = issue.data
    const key = issueKey(raw.id)
    const summary = text(raw.subject)
    if (key === null || summary === null) continue

    issues.push({
      key,
      summary,
      statusName: statusName(raw.status) ?? 'Không rõ trạng thái',
      dueAt: normalizeDate(raw.due_date),
      updatedAt: normalizeDate(raw.updated_on) ?? new Date(0).toISOString(),
    })
  }

  const total = payload.data.total_count ?? payload.data.issues.length
  return { issues, truncatedCount: Math.max(0, total - issues.length) }
}

/** Mã lỗi nào thì thành trạng thái nguồn nào — để giao diện nói đúng việc cần làm tiếp. */
function statusForError(error: unknown): BriefingSourceStatusName {
  if (!(error instanceof NexaError)) return 'error'
  switch (error.code) {
    case ERROR_CODES.TOOL_NOT_ALLOWED:
      return 'disabled_by_policy'
    case ERROR_CODES.REDMINE_CONFIG_REQUIRED:
    case ERROR_CODES.REDMINE_GATEWAY_REQUIRED:
    case ERROR_CODES.MCP_GATEWAY_CONFIG_REQUIRED:
      return 'not_configured'
    case ERROR_CODES.REDMINE_AUTH_FAILED:
    case ERROR_CODES.MCP_GATEWAY_AUTH_FAILED:
      return 'unauthenticated'
    // Timeout cũng tới đây: `classifyError` gộp "timed out" vào MCP_SERVER_UNAVAILABLE, và đoán lại
    // bằng chuỗi lỗi thì sai âm thầm. Cả hai đều thử lại được nên UI xử như nhau.
    case ERROR_CODES.MCP_SERVER_UNAVAILABLE:
    case ERROR_CODES.OPERATION_ALREADY_RUNNING:
      return 'unavailable'
    default:
      return 'error'
  }
}

export interface BriefingRedmineOptions {
  readonly redmine: Pick<McpToolSource, 'callTool'> | null
  readonly redmineReadEnabled: boolean
  readonly logger: Logger
  readonly now: () => Date
}

/**
 * Lấy issue cho bản tin.
 *
 * Không bao giờ ném: mọi hỏng hóc trở thành một `status` có tên, vì bản tin phải hiện được phần
 * cam kết kể cả khi Redmine chết.
 */
export async function fetchBriefingIssues(
  opts: BriefingRedmineOptions,
): Promise<BriefingRedmineResult> {
  const empty = { issues: [], truncatedCount: 0, fetchedAt: null } as const

  if (!opts.redmineReadEnabled) return { ...empty, status: 'disabled_by_policy' }
  if (opts.redmine === null) return { ...empty, status: 'not_configured' }

  const started = Date.now()
  try {
    const outcome = await opts.redmine.callTool(BRIEFING_REDMINE_TOOL, {
      ...BRIEFING_REDMINE_QUERY,
    })
    const { issues, truncatedCount } = parseBriefingIssues(outcome.rawText)
    opts.logger.info('briefing-redmine-fetched', {
      issueCount: issues.length,
      truncatedCount,
      durationMs: Date.now() - started,
    })
    return {
      status: issues.length === 0 ? 'empty' : 'ok',
      issues,
      truncatedCount,
      fetchedAt: opts.now().toISOString(),
    }
  } catch (error) {
    const status = statusForError(error)
    // Chỉ mã lỗi và số đếm; tiêu đề issue và câu lỗi từ gateway không được vào log.
    opts.logger.warn('briefing-redmine-failed', {
      status,
      code: error instanceof NexaError ? error.code : 'UNKNOWN',
      durationMs: Date.now() - started,
    })
    return { ...empty, status }
  }
}
