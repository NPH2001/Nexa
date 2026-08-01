import { z } from 'zod'
import { sanitizeExternalUrl } from '@nexa/security'
import type {
  PreviewContext,
  LookupContext,
  ToolDefinition,
  ToolPreview,
  ToolResultSummary,
  UncertainLookupResult,
} from '@nexa/shared-types'

/**
 * Danh mục tool của Nexa (§13.1 "Mỗi tool có typed input/output, risk level và policy metadata").
 *
 * Phân mức theo §10.1. Một quyết định cần bạn để mắt: `jira.create_issue` được xếp WRITE_LOW.
 * Tài liệu không xếp hạng nó (chỉ nêu add_comment = LOW, update_issue = HIGH). Lý do chọn LOW:
 * tạo mới không phá dữ liệu đang có. Mọi tool write đều phải preview + xác nhận như nhau, nên
 * mức chỉ ảnh hưởng độ chi tiết của preview và việc có thể tắt bằng cờ hay không.
 * Xem docs/OPEN-QUESTIONS.md nếu bạn muốn nâng lên WRITE_HIGH.
 */

const jiraGetIssueInput = z.object({
  issue_key: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*-\d+$/, 'phải có dạng ABC-123'),
})

const jiraSearchInput = z.object({
  jql: z.string().min(1).max(2_000),
  limit: z.number().int().min(1).max(50).default(20),
})

const jiraCreateIssueInput = z.object({
  project_key: z.string().min(1).max(32),
  summary: z.string().min(1).max(255),
  description: z.string().max(32_000).default(''),
  issue_type: z.string().min(1).max(64).default('Task'),
})

const jiraUpdateIssueInput = z.object({
  issue_key: z.string().min(1).max(64),
  fields: z.record(z.union([z.string(), z.number(), z.boolean()])),
})

const jiraAddCommentInput = z.object({
  issue_key: z.string().min(1).max(64),
  comment: z.string().min(1).max(32_000),
})

const confluenceGetPageInput = z.object({ page_id: z.string().min(1).max(64) })

const confluenceSearchInput = z.object({
  cql: z.string().min(1).max(2_000),
  limit: z.number().int().min(1).max(50).default(20),
})

export interface RegistryOptions {
  readonly jiraBaseUrl: string
  readonly confluenceBaseUrl: string
}

/**
 * Dựng danh mục tool.
 *
 * Nhận base URL vì preview phải hiện rõ "hệ thống đích" (§10.2 mục 1) và vì link trả về từ
 * MCP phải được đối chiếu cùng host trước khi hiển thị (chống server trả link lừa đảo).
 */
export function buildToolRegistry(opts: RegistryOptions): ToolDefinition[] {
  const jira = opts.jiraBaseUrl
  const confluence = opts.confluenceBaseUrl

  const definitions: ToolDefinition<unknown>[] = [
    // ── READ (§10.1: chạy khi kết nối đã kiểm tra, không cần xác nhận) ────
    {
      name: 'jira.get_issue',
      mcpToolName: 'jira_get_issue',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Đọc chi tiết một Jira issue theo key, ví dụ PRJ-123.',
      inputSchema: jiraGetIssueInput,
      jsonSchema: toJsonSchema({
        issue_key: { type: 'string', description: 'Key của issue, ví dụ PRJ-123' },
      }, ['issue_key']),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeJiraIssue(raw, jira),
    },
    {
      name: 'jira.search',
      mcpToolName: 'jira_search',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Tìm Jira issue bằng câu truy vấn JQL.',
      inputSchema: jiraSearchInput,
      jsonSchema: toJsonSchema(
        {
          jql: { type: 'string', description: 'Câu JQL' },
          limit: { type: 'number', description: 'Số kết quả tối đa (1–50)' },
        },
        ['jql'],
      ),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeJiraSearch(raw, jira),
    },
    {
      name: 'confluence.get_page',
      mcpToolName: 'confluence_get_page',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Đọc nội dung một trang Confluence theo id.',
      inputSchema: confluenceGetPageInput,
      jsonSchema: toJsonSchema({ page_id: { type: 'string', description: 'Id của trang' } }, [
        'page_id',
      ]),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeConfluencePage(raw, confluence),
    },
    {
      name: 'confluence.search',
      mcpToolName: 'confluence_search',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Tìm trang Confluence bằng câu truy vấn CQL.',
      inputSchema: confluenceSearchInput,
      jsonSchema: toJsonSchema(
        { cql: { type: 'string' }, limit: { type: 'number' } },
        ['cql'],
      ),
      requiredFeature: 'confluenceSearch',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },

    // ── WRITE_LOW ─────────────────────────────────────────────────────────
    {
      name: 'jira.create_issue',
      mcpToolName: 'jira_create_issue',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description:
        'Tạo một Jira issue mới. Thao tác này thay đổi dữ liệu và cần người dùng xác nhận.',
      inputSchema: jiraCreateIssueInput,
      jsonSchema: toJsonSchema(
        {
          project_key: { type: 'string', description: 'Mã dự án, ví dụ PRJ' },
          summary: { type: 'string', description: 'Tiêu đề issue' },
          description: { type: 'string', description: 'Mô tả chi tiết' },
          issue_type: { type: 'string', description: 'Loại issue: Task, Bug, Story…' },
        },
        ['project_key', 'summary', 'issue_type'],
      ),
      requiredFeature: 'jiraCreate',
      buildPreview: (input, ctx) => previewCreateIssue(input as JiraCreateInput, ctx),
      lookupResult: (input, ctx) => lookupCreatedIssue(input as JiraCreateInput, ctx),
      summarizeResult: (raw) => summarizeJiraIssue(raw, jira),
    },
    {
      name: 'jira.add_comment',
      mcpToolName: 'jira_add_comment',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Thêm bình luận vào một Jira issue. Cần người dùng xác nhận.',
      inputSchema: jiraAddCommentInput,
      jsonSchema: toJsonSchema(
        { issue_key: { type: 'string' }, comment: { type: 'string' } },
        ['issue_key', 'comment'],
      ),
      requiredFeature: 'jiraComment',
      buildPreview: (input, ctx) => previewAddComment(input as JiraCommentInput, ctx),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },

    // ── WRITE_HIGH (§10.1: "có thể tắt khỏi MVP theo cấu hình") ───────────
    {
      name: 'jira.update_issue',
      mcpToolName: 'jira_update_issue',
      targetSystem: 'jira',
      riskLevel: 'WRITE_HIGH',
      description:
        'Cập nhật các trường của một Jira issue đang tồn tại. Cần người dùng xác nhận chi tiết.',
      inputSchema: jiraUpdateIssueInput,
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          fields: { type: 'object', description: 'Các trường cần đổi và giá trị mới' },
        },
        ['issue_key', 'fields'],
      ),
      requiredFeature: 'jiraUpdate',
      buildPreview: (input, ctx) => previewUpdateIssue(input as JiraUpdateInput, ctx),
      summarizeResult: (raw) => summarizeJiraIssue(raw, jira),
    },
  ]

  return definitions
}

// ── Preview builders (§10.2) ──────────────────────────────────────────────

interface JiraCreateInput {
  project_key: string
  summary: string
  description: string
  issue_type: string
}
interface JiraUpdateInput {
  issue_key: string
  fields: Record<string, string | number | boolean>
}
interface JiraCommentInput {
  issue_key: string
  comment: string
}

function previewCreateIssue(input: JiraCreateInput, ctx: PreviewContext): Promise<ToolPreview> {
  return Promise.resolve({
    toolName: 'jira.create_issue',
    targetSystem: 'jira',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Tạo issue mới loại "${input.issue_type}" trong dự án ${input.project_key}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [
      { label: 'Dự án', value: input.project_key },
      { label: 'Loại issue', value: input.issue_type },
      { label: 'Tiêu đề', value: input.summary },
      ...(input.description === ''
        ? []
        : [truncateField('Mô tả', input.description)]),
    ],
    changes: [{ field: 'Issue mới trong dự án ' + input.project_key, before: null, after: input.summary }],
    impactWarning:
      'Issue sẽ xuất hiện ngay trong dự án và có thể gửi thông báo tới các thành viên đang theo dõi.',
    reversible: false,
    riskLevel: 'WRITE_LOW',
  })
}

function previewAddComment(input: JiraCommentInput, ctx: PreviewContext): Promise<ToolPreview> {
  return Promise.resolve({
    toolName: 'jira.add_comment',
    targetSystem: 'jira',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Thêm bình luận vào ${input.issue_key}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [
      { label: 'Issue', value: input.issue_key },
      truncateField('Nội dung bình luận', input.comment),
    ],
    changes: [{ field: `Bình luận trên ${input.issue_key}`, before: null, after: input.comment }],
    impactWarning: 'Bình luận hiển thị công khai với mọi người có quyền xem issue.',
    reversible: true,
    riskLevel: 'WRITE_LOW',
  })
}

/**
 * §10.2 mục 5 yêu cầu hiện "trường sẽ bị thay đổi". Với update thì phải biết giá trị CŨ,
 * nên ta đọc issue trước.
 *
 * Đánh đổi (docs/OPEN-QUESTIONS.md B4): tốn thêm một lời gọi API, và giá trị có thể đổi giữa
 * lúc preview và lúc thực thi. Nếu đọc trước thất bại, preview vẫn phải dựng được — chỉ là
 * không có cột "trước", và ta đánh dấu `beforeValuesMayBeStale` để UI nói rõ.
 */
async function previewUpdateIssue(
  input: JiraUpdateInput,
  ctx: PreviewContext,
): Promise<ToolPreview> {
  let current: Record<string, unknown> | null = null
  try {
    const raw = await ctx.readTool('jira.get_issue', { issue_key: input.issue_key })
    current = asRecord(raw)
  } catch {
    current = null
  }

  const changes = Object.entries(input.fields).map(([field, after]) => ({
    field,
    before: current === null ? null : stringifyValue(current[field]),
    after: String(after),
  }))

  return {
    toolName: 'jira.update_issue',
    targetSystem: 'jira',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Cập nhật ${String(changes.length)} trường của ${input.issue_key}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [{ label: 'Issue', value: input.issue_key }],
    changes,
    impactWarning:
      current === null
        ? 'Không đọc được giá trị hiện tại của issue, nên không hiển thị được phần "trước khi đổi". Hãy kiểm tra kỹ trước khi xác nhận.'
        : 'Giá trị cũ sẽ bị ghi đè. Jira giữ lịch sử thay đổi nhưng Nexa không tự hoàn tác được.',
    reversible: false,
    riskLevel: 'WRITE_HIGH',
    beforeValuesMayBeStale: true,
  }
}

// ── Lookup cho trạng thái uncertain (§16, OPEN-QUESTIONS B9) ──────────────

/**
 * Tìm xem issue đã thực sự được tạo hay chưa sau khi write rơi vào `uncertain`.
 *
 * Khớp theo summary + reporter + cửa sổ thời gian. Điểm yếu đã biết: nếu người dùng tạo hai
 * issue có summary giống hệt nhau thì sẽ ra nhiều kết quả — khi đó ta trả về tất cả và để
 * người dùng tự quyết, chứ không đoán bừa.
 */
async function lookupCreatedIssue(
  input: JiraCreateInput,
  ctx: LookupContext,
): Promise<UncertainLookupResult> {
  const since = new Date(new Date(ctx.startedAt).getTime() - 5 * 60_000)
  const jql =
    `project = "${escapeJql(input.project_key)}" ` +
    `AND summary ~ "${escapeJql(input.summary)}" ` +
    `AND reporter = "${escapeJql(ctx.actingAccount)}" ` +
    `AND created >= "${formatJqlDate(since)}"`

  try {
    const raw = await ctx.readTool('jira.search', { jql, limit: 10 })
    const record = asRecord(raw)
    const issues = record === null ? [] : record['issues']
    if (!Array.isArray(issues)) return { matches: [], inconclusive: true }

    return {
      matches: issues.flatMap((entry) => {
        const issue = asRecord(entry)
        if (issue === null) return []
        return [
          {
            key: String(issue['key'] ?? ''),
            url: String(issue['url'] ?? ''),
            summary: String(issue['summary'] ?? ''),
          },
        ]
      }),
      inconclusive: false,
    }
  } catch {
    // Không tra được thì phải nói là không tra được — tuyệt đối không trả "không có" (rỗng),
    // vì nơi gọi sẽ hiểu là chưa tạo và cho retry, dẫn tới issue trùng.
    return { matches: [], inconclusive: true }
  }
}

// ── Rút gọn kết quả trước khi đưa vào context LLM (§7.3 bước 5) ───────────

const MAX_RESULT_CHARS_FOR_MODEL = 4_000

function summarizeJiraIssue(raw: unknown, baseUrl: string): ToolResultSummary {
  const issue = parseJsonish(raw)
  if (issue === null) return summarizeGeneric(raw)

  const key = String(issue['key'] ?? '')
  const summary = String(issue['summary'] ?? '')
  const url = sanitizeExternalUrl(issue['url'], baseUrl)

  const lines = [
    key === '' ? null : `Key: ${key}`,
    summary === '' ? null : `Tiêu đề: ${summary}`,
    issue['status'] === undefined ? null : `Trạng thái: ${String(issue['status'])}`,
    issue['assignee'] === undefined ? null : `Người phụ trách: ${String(issue['assignee'])}`,
    issue['description'] === undefined ? null : `Mô tả: ${String(issue['description'])}`,
  ].filter((l): l is string => l !== null)

  return {
    forModel: truncate(lines.join('\n'), MAX_RESULT_CHARS_FOR_MODEL),
    forUser: key === '' ? 'Đã đọc issue' : `${key}${summary === '' ? '' : ` — ${summary}`}`,
    ...(key !== '' ? { targetKey: key } : {}),
    ...(url !== null ? { targetUrl: url } : {}),
  }
}

function summarizeJiraSearch(raw: unknown, baseUrl: string): ToolResultSummary {
  const result = parseJsonish(raw)
  if (result === null) return summarizeGeneric(raw)

  const issues = Array.isArray(result['issues']) ? result['issues'] : []
  const lines = issues.slice(0, 20).map((entry) => {
    const issue = asRecord(entry)
    if (issue === null) return '- (không đọc được)'
    const url = sanitizeExternalUrl(issue['url'], baseUrl)
    return `- ${String(issue['key'] ?? '?')}: ${String(issue['summary'] ?? '')}${url === null ? '' : ` (${url})`}`
  })

  const total = Number(result['total'] ?? issues.length)
  const header = `Tìm thấy ${String(total)} kết quả${total > lines.length ? `, hiển thị ${String(lines.length)} kết quả đầu` : ''}.`
  return {
    forModel: truncate([header, ...lines].join('\n'), MAX_RESULT_CHARS_FOR_MODEL),
    forUser: header,
  }
}

function summarizeConfluencePage(raw: unknown, baseUrl: string): ToolResultSummary {
  const page = parseJsonish(raw)
  if (page === null) return summarizeGeneric(raw)

  const title = String(page['title'] ?? '')
  const url = sanitizeExternalUrl(page['url'], baseUrl)
  const body = String(page['body'] ?? '')

  return {
    forModel: truncate(
      [title === '' ? null : `Tiêu đề: ${title}`, body].filter((l) => l !== null).join('\n\n'),
      MAX_RESULT_CHARS_FOR_MODEL,
    ),
    forUser: title === '' ? 'Đã đọc trang Confluence' : title,
    ...(page['id'] !== undefined ? { targetKey: String(page['id']) } : {}),
    ...(url !== null ? { targetUrl: url } : {}),
  }
}

function summarizeGeneric(raw: unknown): ToolResultSummary {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
  return {
    forModel: truncate(text, MAX_RESULT_CHARS_FOR_MODEL),
    forUser: `Kết quả dài ${String(text.length)} ký tự`,
  }
}

// ── Tiện ích ──────────────────────────────────────────────────────────────

function toJsonSchema(
  properties: Record<string, Record<string, unknown>>,
  required: readonly string[],
): Record<string, unknown> {
  return { type: 'object', properties, required: [...required], additionalProperties: false }
}

function truncateField(label: string, value: string, max = 500): {
  label: string
  value: string
  truncated?: boolean
} {
  if (value.length <= max) return { label, value }
  return { label, value: `${value.slice(0, max)}…`, truncated: true }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(đã rút gọn)`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** MCP trả text; nhiều server đóng gói JSON trong đó. Thử parse, không được thì thôi. */
function parseJsonish(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      return asRecord(JSON.parse(raw))
    } catch {
      return null
    }
  }
  return asRecord(raw)
}

function stringifyValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** JQL string literal: escape `\` và `"`. */
function escapeJql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function formatJqlDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
