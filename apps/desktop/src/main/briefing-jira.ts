import { z } from 'zod'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import type { BriefingSourceStatusName } from '@nexa/shared-types'
import type { BriefingIssueInput } from '@nexa/daily-briefing'
import type { AtlassianMcpManager } from '@nexa/atlassian-mcp-manager'
import type { Logger } from '@nexa/observability'

/**
 * Nguồn Jira của bản tin (openspec `add-daily-briefing`).
 *
 * Đúng một lời gọi `jira_search` READ, với JQL do FILE NÀY dựng. Không có tham số nào đi từ
 * renderer hay từ model vào câu truy vấn — người dùng không nhập JQL, model không sinh JQL, và
 * một chuỗi `jql` gửi kèm qua IPC đã bị schema strip từ trước.
 */

/**
 * JQL cố định: việc đang được giao cho tôi và chưa đóng.
 *
 * `resolution = EMPTY` thay vì liệt kê tên trạng thái, vì tên trạng thái khác nhau giữa các
 * project còn `resolution` thì không.
 */
export const BRIEFING_JQL = 'assignee = currentUser() AND resolution = EMPTY ORDER BY duedate ASC'

/** Trần của chính tool `jira_search` (`limit` tối đa 50) — không đặt cao hơn được. */
export const BRIEFING_JIRA_LIMIT = 50

export interface BriefingJiraResult {
  readonly status: BriefingSourceStatusName
  readonly issues: readonly BriefingIssueInput[]
  /** Số issue Jira nói là có nhưng không nằm trong trang này. */
  readonly truncatedCount: number
  readonly fetchedAt: string | null
}

/** Trường có thể nằm phẳng ở gốc hoặc lồng trong `fields` — chấp nhận cả hai. */
const looseStringSchema = z.union([z.string(), z.number()]).nullish()

const statusSchema = z
  .union([z.string(), z.object({ name: z.string().nullish() }).passthrough()])
  .nullish()

const sprintSchema = z
  .union([
    z.object({ state: z.string().nullish(), name: z.string().nullish() }).passthrough(),
    z.array(z.object({ state: z.string().nullish() }).passthrough()),
    z.string(),
  ])
  .nullish()

const rawIssueSchema = z
  .object({
    key: z.string().min(1).max(64),
    summary: looseStringSchema,
    status: statusSchema,
    duedate: looseStringSchema,
    due_date: looseStringSchema,
    updated: looseStringSchema,
    sprint: sprintSchema,
    fields: z
      .object({
        summary: looseStringSchema,
        status: statusSchema,
        duedate: looseStringSchema,
        updated: looseStringSchema,
        sprint: sprintSchema,
      })
      .passthrough()
      .nullish(),
  })
  .passthrough()

const searchPayloadSchema = z
  .object({
    total: z.number().nullish(),
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

function statusName(value: z.infer<typeof statusSchema>): string | null {
  if (typeof value === 'string') return text(value)
  if (value !== null && value !== undefined) return text(value.name)
  return null
}

/**
 * Chỉ nhận diện được sprint khi payload có nói.
 *
 * `jira_search` không cho chọn field trả về, nên với nhiều cấu hình sẽ KHÔNG có thông tin sprint —
 * khi đó mọi issue đều `false` và thứ tự trong nhóm "đang làm" lùi về mốc thời gian/cập nhật. Đoán
 * sprint từ tên hay từ project là thứ sai âm thầm, nên không làm.
 */
function isInActiveSprint(value: z.infer<typeof sprintSchema>): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.toLowerCase().includes('active')
  if (Array.isArray(value)) {
    return value.some((entry) => (entry.state ?? '').toLowerCase() === 'active')
  }
  return (value.state ?? '').toLowerCase() === 'active'
}

/**
 * Chuẩn hoá ngày Jira về ISO.
 *
 * Jira trả `duedate` dạng `YYYY-MM-DD` (không giờ). Neo nó vào giữa trưa UTC thay vì nửa đêm: nửa
 * đêm UTC rơi sang ngày hôm trước ở mọi múi giờ âm và trùng đúng ranh giới ngày ở múi giờ dương,
 * nên "đến hạn hôm nay" dễ bị lệch một ngày. Giữa trưa cách cả hai biên hơn 11 tiếng.
 */
function normalizeDate(value: unknown): string | null {
  const raw = text(value)
  if (raw === null) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T12:00:00.000Z`
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

/**
 * Đọc payload `jira_search`.
 *
 * Bỏ qua từng issue hỏng, nhưng payload KHÔNG parse được thì ném lỗi — đây là chỗ dễ hỏng âm
 * thầm nhất: một parser dễ dãi sẽ biến "gateway trả HTML lỗi" thành "hôm nay bạn không có việc
 * gì", đúng thứ spec cấm.
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
      safeDetail: 'jira_search returned a payload that is not JSON',
    })
  }

  const payload = searchPayloadSchema.safeParse(parsed)
  if (!payload.success) {
    throw new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
      safeDetail: 'jira_search payload has no issue list',
    })
  }

  const issues: BriefingIssueInput[] = []
  for (const entry of payload.data.issues) {
    const issue = rawIssueSchema.safeParse(entry)
    if (!issue.success) continue
    const raw = issue.data
    const fields = raw.fields ?? {}
    const summary = text(raw.summary) ?? text(fields.summary)
    if (summary === null) continue

    issues.push({
      key: raw.key,
      summary,
      statusName: statusName(raw.status) ?? statusName(fields.status) ?? 'Không rõ trạng thái',
      dueAt:
        normalizeDate(raw.duedate) ?? normalizeDate(raw.due_date) ?? normalizeDate(fields.duedate),
      updatedAt:
        normalizeDate(raw.updated) ?? normalizeDate(fields.updated) ?? new Date(0).toISOString(),
      inActiveSprint: isInActiveSprint(raw.sprint) || isInActiveSprint(fields.sprint),
    })
  }

  const total = payload.data.total ?? payload.data.issues.length
  const truncatedCount = Math.max(0, total - issues.length)
  return { issues, truncatedCount }
}

/** Mã lỗi nào thì thành trạng thái nguồn nào — để giao diện nói đúng việc cần làm tiếp. */
function statusForError(error: unknown): BriefingSourceStatusName {
  if (!(error instanceof NexaError)) return 'error'
  switch (error.code) {
    case ERROR_CODES.TOOL_NOT_ALLOWED:
      return 'disabled_by_policy'
    case ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED:
    case ERROR_CODES.MCP_GATEWAY_CONFIG_REQUIRED:
      return 'not_configured'
    case ERROR_CODES.ATLASSIAN_AUTH_FAILED:
    case ERROR_CODES.MCP_GATEWAY_AUTH_FAILED:
      return 'unauthenticated'
    // Timeout cũng tới đây: `classifyToolError` gộp "timed out" vào MCP_SERVER_UNAVAILABLE, và
    // đoán lại bằng chuỗi lỗi thì sai âm thầm. Cả hai đều thử lại được nên UI xử như nhau.
    case ERROR_CODES.MCP_SERVER_UNAVAILABLE:
    case ERROR_CODES.OPERATION_ALREADY_RUNNING:
      return 'unavailable'
    default:
      return 'error'
  }
}

export interface BriefingJiraOptions {
  readonly mcp: AtlassianMcpManager | null
  readonly jiraSearchEnabled: boolean
  readonly logger: Logger
  readonly now: () => Date
}

/**
 * Lấy issue cho bản tin.
 *
 * Không bao giờ ném: mọi hỏng hóc trở thành một `status` có tên, vì bản tin phải hiện được phần
 * cam kết kể cả khi Jira chết.
 */
export async function fetchBriefingIssues(
  opts: BriefingJiraOptions,
): Promise<BriefingJiraResult> {
  const empty = { issues: [], truncatedCount: 0, fetchedAt: null } as const

  if (!opts.jiraSearchEnabled) return { ...empty, status: 'disabled_by_policy' }
  if (opts.mcp === null) return { ...empty, status: 'not_configured' }

  const started = Date.now()
  try {
    const outcome = await opts.mcp.callTool('jira_search', {
      jql: BRIEFING_JQL,
      limit: BRIEFING_JIRA_LIMIT,
    })
    const { issues, truncatedCount } = parseBriefingIssues(outcome.rawText)
    opts.logger.info('briefing-jira-fetched', {
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
    opts.logger.warn('briefing-jira-failed', {
      status,
      code: error instanceof NexaError ? error.code : 'UNKNOWN',
      durationMs: Date.now() - started,
    })
    return { ...empty, status }
  }
}
