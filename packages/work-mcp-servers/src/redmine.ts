import { z } from 'zod'
import {
  ERROR_CODES,
  NexaError,
  type FeatureFlags,
  type LookupContext,
  type PreviewContext,
  type PreviewChange,
  type PreviewField,
  type RiskLevel,
  type ToolDefinition,
  type ToolPreview,
  type ToolResultSummary,
  type UncertainLookupResult,
} from '@nexa/shared-types'
import {
  asRecord,
  parseJsonish,
  summarizeGeneric,
  summarizeModelText,
  truncateField,
} from '@nexa/atlassian-mcp-manager'
import {
  PAGING,
  bool,
  int,
  num,
  paramsJsonSchema,
  paramsSchema,
  req,
  str,
  type ParamTable,
} from './params.js'

// ═══════════════════════════════════════════════════════════════════════════
// Header gateway
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tên header mà gateway LiteLLM nhận credential Redmine (ADR 0010).
 *
 * ⚠️ Quy ước của MỘT gateway cụ thể (đã xác nhận bằng probe thật 2026-11-17), không phải chuẩn
 * MCP — cùng tình trạng với `GATEWAY_HEADER_KEYS` của Atlassian. Gateway khác dùng tên khác thì
 * sửa đúng bảng này.
 */
export const REDMINE_GATEWAY_HEADER_KEYS = {
  mcpServers: 'x-mcp-servers',
  apiKey: 'x-mcp-redmine-x-redmine-api-key',
} as const

/**
 * Dựng header cho một request tới gateway. Chỉ hàm này chạm vào giá trị bearer token/API key;
 * nhận giá trị đã giải mã, trả object dùng một lần rồi bỏ.
 */
export function buildRedmineGatewayHeaders(credentials: {
  readonly gatewayToken: string
  readonly apiKey: string
}): Record<string, string> {
  return {
    authorization: `Bearer ${credentials.gatewayToken}`,
    [REDMINE_GATEWAY_HEADER_KEYS.mcpServers]: 'redmine',
    [REDMINE_GATEWAY_HEADER_KEYS.apiKey]: credentials.apiKey,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Phân loại lỗi
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Text lỗi của server Redmine có dạng (quan sát thật 2026-11-17):
 *   "Error executing tool get_issue: GET /issues/1.json: HTTP 404 - not found (or not visible…)"
 *
 * - HTTP 401 ⇒ API key sai/thu hồi ⇒ `REDMINE_AUTH_FAILED`.
 * - HTTP 403 ⇒ key HỢP LỆ nhưng thiếu quyền (ví dụ `list_users` chỉ dành cho admin). KHÔNG phải
 *   lỗi xác thực — báo là lỗi xác thực sẽ khiến người dùng đi thay một key đang đúng.
 * - Còn lại (404, 422 validation…) là lỗi nghiệp vụ model tự xử lý được.
 */
export function classifyRedmineError(rawText: string, toolName: string): NexaError {
  const lower = rawText.toLowerCase()
  if (
    /\bhttp 401\b/.test(lower) ||
    lower.includes('invalid api key') ||
    lower.includes('unauthorized')
  ) {
    return new NexaError(ERROR_CODES.REDMINE_AUTH_FAILED, {
      safeDetail: `${toolName} rejected by Redmine (credential)`,
    })
  }
  if (/\bhttp 403\b/.test(lower) || lower.includes('forbidden')) {
    return new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
      safeDetail: `${toolName}: Redmine account lacks permission (HTTP 403)`,
      retryable: false,
    })
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
      safeDetail: `${toolName} timed out at Redmine`,
    })
  }
  return new NexaError(ERROR_CODES.UPSTREAM_UNAVAILABLE, {
    safeDetail: `${toolName} failed at Redmine`,
    retryable: false,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Định danh tài khoản
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gọi `get_current_user` lúc khởi chạy: vừa xác nhận API key dùng được (sai key ⇒
 * `REDMINE_AUTH_FAILED` ngay ở "Kiểm tra kết nối"), vừa lấy login để preview ghi đúng "hành động
 * dưới tài khoản nào".
 */
export async function identifyRedmineUser(
  call: (mcpToolName: string, args: Record<string, unknown>) => Promise<string>,
): Promise<string | undefined> {
  const user = parseJsonish(await call('get_current_user', {}))
  const login = user === null ? '' : String(user['login'] ?? '')
  return login === '' ? undefined : login
}

// ═══════════════════════════════════════════════════════════════════════════
// Rút gọn kết quả
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trường KHÔNG BAO GIỜ được đưa vào context model.
 *
 * `get_current_user` của server này trả cả `api_key` của chính người dùng (quan sát thật
 * 2026-11-17). Redactor sẽ che giá trị trong log vì key đã được đăng ký — nhưng `forModel` đi
 * thẳng tới LLM, nên phải gỡ ở đây, trước khi nó rời khỏi tiến trình.
 */
const STRIPPED_KEYS = new Set(['api_key', 'apikey', 'password', 'passwd'])

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets)
  const record = asRecord(value)
  if (record === null) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) {
    if (STRIPPED_KEYS.has(k.toLowerCase())) continue
    out[k] = stripSecrets(v)
  }
  return out
}

/** Link web của issue — tool không trả URL nào, nên Nexa dựng từ URL Redmine đã cấu hình. */
export function redmineIssueUrl(baseUrl: string, id: unknown): string | undefined {
  const n = Number(id)
  if (baseUrl === '' || !Number.isInteger(n) || n <= 0) return undefined
  return `${baseUrl.replace(/\/+$/, '')}/issues/${String(n)}`
}

function summarizeRedmine(raw: unknown, baseUrl: string): ToolResultSummary {
  const parsed = parseJsonish(raw)
  if (parsed === null) return summarizeGeneric(raw)
  const safe = stripSecrets(parsed) as Record<string, unknown>
  const text = JSON.stringify(safe)
  const modelText = summarizeModelText(text)

  const issueList = Array.isArray(safe['issues']) ? safe['issues'] : null
  if (issueList !== null) {
    const total = Number(safe['total_count'] ?? issueList.length)
    const header = `Tìm thấy ${String(total)} issue; trang hiện tại có ${String(issueList.length)}.`
    const incomplete = total > issueList.length
    return {
      ...summarizeModelText(`${header}\n${text}`),
      ...(incomplete
        ? {
            incomplete: true,
            completenessNote: `Mới có ${String(issueList.length)}/${String(total)} issue; cần gọi tiếp với offset để xem đủ.`,
          }
        : {}),
      forUser: header,
    }
  }

  // Một issue đơn lẻ: get_issue / create_issue / update_issue trả object issue (có thể bọc trong
  // `issue`).
  const issue = asRecord(safe['issue']) ?? (safe['subject'] !== undefined ? safe : null)
  if (issue !== null && issue['id'] !== undefined) {
    const id = String(issue['id'])
    const url = redmineIssueUrl(baseUrl, issue['id'])
    const subject = String(issue['subject'] ?? '')
    return {
      ...modelText,
      forUser: `#${id}${subject === '' ? '' : ` — ${subject}`}`,
      targetKey: `#${id}`,
      ...(url !== undefined ? { targetUrl: url } : {}),
    }
  }

  return {
    ...modelText,
    forUser: `Đã nhận kết quả từ Redmine (${text.length.toLocaleString('vi-VN')} ký tự)`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Danh mục tool
// ═══════════════════════════════════════════════════════════════════════════

interface RedmineToolSpec {
  /** Tên tool trên server KHÔNG kèm tiền tố gateway, ví dụ `get_issue`. */
  readonly mcp: string
  readonly risk: RiskLevel
  readonly flag: keyof FeatureFlags
  readonly description: string
  readonly params: ParamTable
  readonly buildPreview?: ToolDefinition['buildPreview']
  readonly lookupResult?: ToolDefinition['lookupResult']
}

/** Bộ lọc Redmine nhận "biểu thức toán tử" — mô tả một lần, dùng cho mọi tham số lọc. */
const OP = "Biểu thức lọc Redmine: giá trị trần = bằng; '>=2026-10-01', '<=…', '><a|b' (khoảng), '!5' (khác), '5|6' (một trong), '*' (có giá trị), '!*' (trống), '~chữ' (chứa), 't' hôm nay, '>t-7' (7 ngày qua), 'w' tuần này, 'm' tháng này"
const DATE = 'Ngày dạng YYYY-MM-DD'

const READ_TOOLS: readonly RedmineToolSpec[] = [
  {
    mcp: 'get_current_user',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Lấy thông tin tài khoản Redmine đang dùng (id, login, tên).',
    params: {},
  },
  {
    mcp: 'list_trackers',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Liệt kê tracker (loại issue) kèm id — dùng trước khi tạo issue.',
    params: {},
  },
  {
    mcp: 'list_issue_statuses',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Liệt kê trạng thái issue kèm id và cờ is_closed.',
    params: {},
  },
  {
    mcp: 'list_priorities',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Liệt kê mức ưu tiên issue kèm id.',
    params: {},
  },
  {
    mcp: 'list_custom_fields',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Liệt kê định nghĩa custom field (cần quyền admin; không có quyền thì lỗi 403).',
    params: {},
  },
  {
    mcp: 'list_projects',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Liệt kê dự án người dùng xem được (phân trang).',
    params: {
      name: str('Lọc theo một phần tên dự án'),
      status: int('1 = đang hoạt động, 5 = đã đóng, 9 = lưu trữ'),
      sort: str("Ví dụ 'name:asc', 'created_on:desc'"),
      ...PAGING,
    },
  },
  {
    mcp: 'get_project',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Lấy một dự án theo id số hoặc identifier.',
    params: {
      project_id: req(str('Id số hoặc identifier của dự án')),
      include: str("Danh sách cách nhau bởi dấu phẩy: trackers, issue_categories, enabled_modules…"),
    },
  },
  {
    mcp: 'list_project_members',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Liệt kê thành viên dự án (người dùng/nhóm và vai trò) — dùng để tìm user id khi giao việc.',
    params: { project_id: req(str('Id số hoặc identifier của dự án')), ...PAGING },
  },
  {
    mcp: 'list_versions',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Liệt kê version (milestone/sprint) của một dự án.',
    params: { project_id: req(str('Id số hoặc identifier của dự án')) },
  },
  {
    mcp: 'get_version',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Lấy một version (milestone).',
    params: { version_id: req(int('Id version', { min: 1 })) },
  },
  {
    mcp: 'search_issues',
    risk: 'READ',
    flag: 'redmineRead',
    description:
      "Tìm issue Redmine theo bộ lọc phía server. Mỗi bộ lọc nhận biểu thức toán tử Redmine. Ví dụ việc quá hạn của tôi: assigned_to_id='me', due_date='<=2026-10-13'. Lưu ý due_date không nhận '<2026-10-13', hãy dùng '<=…' hoặc '<t-0'.",
    params: {
      project_id: str('Id số hoặc identifier của dự án'),
      status: str("open | closed | * | <id trạng thái> | !<id> (mặc định open)"),
      assigned_to_id: str("Id người được giao, 'me' hoặc '!me'"),
      author_id: str("Id người tạo, 'me' hoặc '!me'"),
      watcher_id: str("Id người theo dõi, 'me' hoặc '!me'"),
      tracker_id: int('Id tracker'),
      priority_id: str(OP),
      category_id: str(OP),
      parent_id: str(OP),
      fixed_version_id: str(OP),
      issue_id: str("Một hoặc nhiều id, ví dụ '12|15'"),
      subject: str(`Tiêu đề — ${OP}`),
      description: str(`Mô tả — ${OP}`),
      due_date: str(`Hạn — ${OP}`),
      start_date: str(`Ngày bắt đầu — ${OP}`),
      created_on: str(`Ngày tạo — ${OP}`),
      updated_on: str(`Ngày cập nhật — ${OP}`),
      closed_on: str(`Ngày đóng — ${OP}`),
      done_ratio: str(`% hoàn thành — ${OP}`),
      estimated_hours: str(`Giờ ước tính — ${OP}`),
      custom_fields: { type: 'object', description: 'Lọc custom field, ví dụ {"18": "BAU-1"}' },
      include: str('children, attachments, relations, changesets, journals, watchers'),
      sort: str("Ví dụ 'due_date:asc,priority:desc'"),
      ...PAGING,
    },
  },
  {
    mcp: 'get_issue',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Lấy một issue Redmine theo id, kèm lịch sử ghi chú, issue con, đính kèm và quan hệ.',
    params: {
      issue_id: req(int('Id issue (số sau dấu #)', { min: 1 })),
      include: str('journals, children, attachments, relations, changesets, watchers'),
    },
  },
  {
    mcp: 'list_issue_relations',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Liệt kê quan hệ của một issue.',
    params: { issue_id: req(int('Id issue', { min: 1 })) },
  },
  {
    mcp: 'get_issue_relation',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Lấy một quan hệ issue theo id quan hệ.',
    params: { relation_id: req(int('Id quan hệ', { min: 1 })) },
  },
  {
    mcp: 'list_time_entries',
    risk: 'READ',
    flag: 'redmineRead',
    description: "Liệt kê bản ghi log time. user_id có thể là 'me'.",
    params: {
      project_id: str('Id số hoặc identifier của dự án'),
      issue_id: int('Id issue'),
      user_id: str("Id người dùng hoặc 'me'"),
      activity_id: int('Id activity'),
      from_date: str(DATE),
      to_date: str(DATE),
      spent_on: str(`Ngày log — ${OP}`),
      sort: str("Ví dụ 'spent_on:desc'"),
      ...PAGING,
    },
  },
  {
    mcp: 'list_time_entry_activities',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Liệt kê loại activity của log time kèm id — dùng trước khi log time.',
    params: {},
  },
  {
    mcp: 'get_time_entry',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Lấy một bản ghi log time.',
    params: { time_entry_id: req(int('Id bản ghi log time', { min: 1 })) },
  },
  {
    mcp: 'list_users',
    risk: 'READ',
    flag: 'redmineRead',
    description:
      'Tìm người dùng theo tên/login (cần quyền admin; không có quyền thì dùng list_project_members).',
    params: {
      name: str('Một phần tên hoặc login'),
      status: int('1 = đang hoạt động'),
      group_id: int('Id nhóm'),
      sort: str('Khoá sắp xếp'),
      ...PAGING,
    },
  },
  {
    mcp: 'search',
    risk: 'READ',
    flag: 'redmineRead',
    description:
      'Tìm kiếm toàn văn trên Redmine (issue, wiki, tin tức…), xếp theo độ liên quan. Bật một hoặc nhiều cờ loại đối tượng để thu hẹp; không bật cờ nào = mọi loại.',
    params: {
      q: req(str('Từ khoá tìm kiếm', { max: 500 })),
      project_id: str('Giới hạn trong một dự án'),
      scope: str("'all' (mặc định), 'my_projects', 'subprojects'"),
      titles_only: bool('Chỉ khớp tiêu đề'),
      all_words: bool('false = khớp BẤT KỲ từ nào thay vì tất cả'),
      open_issues: bool('Bỏ qua issue đã đóng'),
      issues: bool('Tìm trong issue'),
      wiki_pages: bool('Tìm trong wiki'),
      news: bool('Tìm trong tin tức'),
      documents: bool('Tìm trong tài liệu'),
      changesets: bool('Tìm trong changeset'),
      messages: bool('Tìm trong diễn đàn'),
      projects: bool('Tìm trong dự án'),
      attachments: str("'0' không, '1' cả đính kèm, 'only' chỉ đính kèm"),
      ...PAGING,
    },
  },
  {
    mcp: 'list_wiki_pages',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Liệt kê trang wiki Redmine của một dự án.',
    params: { project_id: req(str('Id số hoặc identifier của dự án')) },
  },
  {
    mcp: 'get_wiki_page',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Đọc một trang wiki Redmine (có thể chọn phiên bản cũ).',
    params: {
      project_id: req(str('Id số hoặc identifier của dự án')),
      title: req(str('Tiêu đề trang wiki', { max: 255 })),
      version: int('Phiên bản cũ cần đọc', { min: 1 }),
    },
  },
  {
    mcp: 'get_attachment',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Lấy metadata một file đính kèm (tên, dung lượng, người tải lên). Không tải nội dung.',
    params: { attachment_id: req(int('Id đính kèm', { min: 1 })) },
  },
  {
    mcp: 'list_project_files',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Liệt kê file trong mục Files của dự án.',
    params: { project_id: req(str('Id số hoặc identifier của dự án')) },
  },
  {
    mcp: 'list_issue_categories',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Liệt kê category issue của một dự án.',
    params: { project_id: req(str('Id số hoặc identifier của dự án')) },
  },
  {
    mcp: 'get_issue_category',
    risk: 'READ',
    flag: 'redmineRead',
    description: 'Lấy một category issue.',
    params: { category_id: req(int('Id category', { min: 1 })) },
  },
]

const customFieldItem = z.object({
  id: z.number().int(),
  value: z.union([z.string().max(2_000), z.number(), z.boolean(), z.array(z.string().max(500))]),
})
const CUSTOM_FIELDS_PARAM = {
  type: 'array',
  description: 'Custom field: [{"id": 18, "value": "x"}]',
  items: { type: 'object', properties: { id: { type: 'integer' }, value: {} }, required: ['id', 'value'] },
  itemSchema: customFieldItem,
  maxItems: 30,
} as const

/**
 * Tool ghi đang mở. Tham số `uploads` của create/update_issue CỐ Ý không có trong bảng: change này
 * không mở `upload_attachment`, nên không có token upload hợp lệ nào để truyền.
 */
function writeTools(): readonly RedmineToolSpec[] {
  return [
    {
      mcp: 'create_issue',
      risk: 'WRITE_LOW',
      flag: 'redmineWrite',
      description:
        'Tạo một issue Redmine mới. Cần project_id dạng số (lấy từ list_projects/get_project); tracker/priority/assignee dùng id. Thao tác này thay đổi dữ liệu và cần người dùng xác nhận.',
      params: {
        project_id: req(int('Id SỐ của dự án', { min: 1 })),
        subject: req(str('Tiêu đề issue', { max: 255 })),
        description: str('Mô tả chi tiết (cú pháp Textile/Markdown của Redmine)', { max: 32_000 }),
        tracker_id: int('Id tracker (list_trackers)'),
        status_id: int('Id trạng thái (list_issue_statuses)'),
        priority_id: int('Id ưu tiên (list_priorities)'),
        assigned_to_id: int('Id người được giao (list_project_members)'),
        parent_issue_id: int('Id issue cha'),
        fixed_version_id: int('Id version'),
        start_date: str(DATE),
        due_date: str(DATE),
        estimated_hours: num('Số giờ ước tính', { min: 0 }),
        custom_fields: CUSTOM_FIELDS_PARAM,
      },
      buildPreview: (input, ctx) => previewCreateIssue(input as Record<string, unknown>, ctx),
      lookupResult: (input, ctx) => lookupCreatedIssue(input as Record<string, unknown>, ctx),
    },
    {
      mcp: 'update_issue',
      risk: 'WRITE_HIGH',
      flag: 'redmineUpdate',
      description:
        'Cập nhật một issue Redmine đã có: chỉ các trường được truyền mới đổi. `notes` thêm một ghi chú vào lịch sử. Thao tác này ghi đè dữ liệu và cần người dùng xác nhận.',
      params: {
        issue_id: req(int('Id issue', { min: 1 })),
        subject: str('Tiêu đề mới', { max: 255 }),
        description: str('Mô tả mới', { max: 32_000 }),
        status_id: int('Id trạng thái mới'),
        priority_id: int('Id ưu tiên mới'),
        assigned_to_id: int('Id người được giao mới'),
        done_ratio: int('% hoàn thành', { min: 0, max: 100 }),
        start_date: str(DATE),
        due_date: str(DATE),
        estimated_hours: num('Số giờ ước tính', { min: 0 }),
        fixed_version_id: int('Id version'),
        notes: str('Ghi chú thêm vào lịch sử', { max: 32_000 }),
        custom_fields: CUSTOM_FIELDS_PARAM,
      },
      buildPreview: (input, ctx) => previewUpdateIssue(input as Record<string, unknown>, ctx),
    },
    {
      mcp: 'add_issue_comment',
      risk: 'WRITE_LOW',
      flag: 'redmineWrite',
      description: 'Thêm một ghi chú (comment) vào issue Redmine. Cần người dùng xác nhận.',
      params: {
        issue_id: req(int('Id issue', { min: 1 })),
        notes: req(str('Nội dung ghi chú', { max: 32_000 })),
        private: bool('Ghi chú riêng tư (chỉ người có quyền mới thấy)'),
      },
      buildPreview: (input, ctx) => previewComment(input as Record<string, unknown>, ctx),
      lookupResult: (input, ctx) => lookupComment(input as Record<string, unknown>, ctx),
    },
    {
      mcp: 'log_time',
      risk: 'WRITE_LOW',
      flag: 'redmineWrite',
      description:
        'Log thời gian đã làm vào một issue hoặc dự án (cần issue_id hoặc project_id). Cần người dùng xác nhận.',
      params: {
        hours: req(num('Số giờ', { min: 0.01, max: 24 })),
        issue_id: int('Id issue'),
        project_id: int('Id SỐ của dự án'),
        spent_on: str(`${DATE}; mặc định hôm nay`),
        activity_id: int('Id activity (list_time_entry_activities)'),
        comments: str('Ghi chú cho bản ghi', { max: 1_000 }),
      },
      buildPreview: (input, ctx) => previewLogTime(input as Record<string, unknown>, ctx),
      lookupResult: (input, ctx) => lookupLoggedTime(input as Record<string, unknown>, ctx),
    },
    {
      mcp: 'create_issue_relation',
      risk: 'WRITE_LOW',
      flag: 'redmineWrite',
      description: 'Liên kết hai issue Redmine. Cần người dùng xác nhận.',
      params: {
        issue_id: req(int('Id issue nguồn', { min: 1 })),
        issue_to_id: req(int('Id issue đích', { min: 1 })),
        relation_type: {
          type: 'string',
          description: 'Loại quan hệ (mặc định relates)',
          enum: [
            'relates',
            'duplicates',
            'duplicated',
            'blocks',
            'blocked',
            'precedes',
            'follows',
            'copied_to',
            'copied_from',
          ],
        },
        delay: int('Số ngày trễ (chỉ cho precedes/follows)'),
      },
      buildPreview: (raw, ctx) => {
        const input = raw as Record<string, unknown>
        return Promise.resolve(
          simplePreview(ctx, 'create_issue_relation', {
            action: `Liên kết #${String(input['issue_id'])} → #${String(input['issue_to_id'])}`,
            payload: input,
            change: {
              field: `Quan hệ của #${String(input['issue_id'])}`,
              before: null,
              after: `${String(input['relation_type'] ?? 'relates')} #${String(input['issue_to_id'])}`,
            },
            impactWarning: 'Quan hệ hiện ngay trên cả hai issue. Có thể gỡ lại trong Redmine.',
            reversible: true,
          }),
        )
      },
    },
    {
      mcp: 'add_watcher',
      risk: 'WRITE_LOW',
      flag: 'redmineWrite',
      description: 'Thêm một người theo dõi vào issue Redmine. Cần người dùng xác nhận.',
      params: {
        issue_id: req(int('Id issue', { min: 1 })),
        user_id: req(int('Id người dùng', { min: 1 })),
      },
      buildPreview: (raw, ctx) => {
        const input = raw as Record<string, unknown>
        return Promise.resolve(
          simplePreview(ctx, 'add_watcher', {
            action: `Thêm người dùng ${String(input['user_id'])} theo dõi #${String(input['issue_id'])}`,
            payload: input,
            change: {
              field: `Người theo dõi #${String(input['issue_id'])}`,
              before: null,
              after: `user ${String(input['user_id'])}`,
            },
            impactWarning: 'Người được thêm sẽ nhận thông báo về mọi thay đổi của issue.',
            reversible: true,
          }),
        )
      },
    },
  ]
}

/** Tên Nexa của một tool Redmine: tiền tố `redmine_` để không đụng tên tool hệ thống khác. */
export function redmineToolName(mcp: string): string {
  return `redmine_${mcp}`
}

/**
 * Danh mục tool Redmine của Nexa (ADR 0010).
 *
 * KHÔNG có: mọi `delete_*`, `remove_watcher`, membership, tạo/sửa project, CRUD version/category,
 * upload/update/download attachment, `upsert_wiki_page`, `update_time_entry`. `download_attachment`
 * bị loại cả ở nhóm đọc: nó đổ base64 thẳng vào context model.
 */
export function buildRedmineTools(baseUrl: string): ToolDefinition[] {
  return [...READ_TOOLS, ...writeTools()].map((spec) => ({
    name: redmineToolName(spec.mcp),
    mcpToolName: spec.mcp,
    targetSystem: 'redmine' as const,
    riskLevel: spec.risk,
    description: spec.description,
    inputSchema: paramsSchema(spec.params),
    jsonSchema: paramsJsonSchema(spec.params),
    requiredFeature: spec.flag,
    ...(spec.buildPreview !== undefined ? { buildPreview: spec.buildPreview } : {}),
    ...(spec.lookupResult !== undefined ? { lookupResult: spec.lookupResult } : {}),
    summarizeResult: (raw: unknown) => summarizeRedmine(raw, baseUrl),
  }))
}

// ═══════════════════════════════════════════════════════════════════════════
// Preview
// ═══════════════════════════════════════════════════════════════════════════

const FIELD_LABELS: Readonly<Record<string, string>> = {
  project_id: 'Dự án (id)',
  subject: 'Tiêu đề',
  description: 'Mô tả',
  tracker_id: 'Tracker (id)',
  status_id: 'Trạng thái (id)',
  priority_id: 'Ưu tiên (id)',
  assigned_to_id: 'Người được giao (id)',
  parent_issue_id: 'Issue cha',
  fixed_version_id: 'Version (id)',
  start_date: 'Ngày bắt đầu',
  due_date: 'Hạn',
  estimated_hours: 'Giờ ước tính',
  done_ratio: '% hoàn thành',
  notes: 'Ghi chú',
  custom_fields: 'Custom field',
  hours: 'Số giờ',
  issue_id: 'Issue',
  spent_on: 'Ngày',
  activity_id: 'Activity (id)',
  comments: 'Ghi chú',
  private: 'Riêng tư',
  issue_to_id: 'Issue đích',
  relation_type: 'Loại quan hệ',
  delay: 'Số ngày trễ',
  user_id: 'Người dùng (id)',
}

function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function payloadFields(input: Record<string, unknown>): PreviewField[] {
  return Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => truncateField(FIELD_LABELS[k] ?? k, display(v)))
}

function basePreview(
  ctx: PreviewContext,
  mcp: string,
  riskLevel: RiskLevel,
): Pick<ToolPreview, 'toolName' | 'targetSystem' | 'targetSystemUrl' | 'actingAccount' | 'riskLevel'> {
  return {
    toolName: redmineToolName(mcp),
    targetSystem: 'redmine',
    targetSystemUrl: ctx.targetSystemUrl,
    actingAccount: ctx.actingAccount,
    riskLevel,
  }
}

function simplePreview(
  ctx: PreviewContext,
  mcp: string,
  p: {
    action: string
    payload: Record<string, unknown>
    change: PreviewChange
    impactWarning: string
    reversible: boolean
  },
): ToolPreview {
  return {
    ...basePreview(ctx, mcp, 'WRITE_LOW'),
    action: p.action,
    payloadFields: payloadFields(p.payload),
    changes: [p.change],
    impactWarning: p.impactWarning,
    reversible: p.reversible,
  }
}

function previewCreateIssue(input: Record<string, unknown>, ctx: PreviewContext): Promise<ToolPreview> {
  return Promise.resolve(
    simplePreview(ctx, 'create_issue', {
      action: `Tạo issue mới trong dự án ${String(input['project_id'])}`,
      payload: input,
      change: {
        field: `Issue mới trong dự án ${String(input['project_id'])}`,
        before: null,
        after: String(input['subject'] ?? ''),
      },
      impactWarning:
        'Issue xuất hiện ngay trong dự án và có thể gửi thông báo cho người được giao và người theo dõi. Nexa không tự xoá được issue đã tạo.',
      reversible: false,
    }),
  )
}

function previewComment(input: Record<string, unknown>, ctx: PreviewContext): Promise<ToolPreview> {
  return Promise.resolve(
    simplePreview(ctx, 'add_issue_comment', {
      action: `Thêm ghi chú vào #${String(input['issue_id'])}${input['private'] === true ? ' (riêng tư)' : ''}`,
      payload: input,
      change: {
        field: `Ghi chú trên #${String(input['issue_id'])}`,
        before: null,
        after: String(input['notes'] ?? ''),
      },
      impactWarning:
        input['private'] === true
          ? 'Ghi chú riêng tư chỉ hiện với người có quyền xem ghi chú riêng tư.'
          : 'Ghi chú hiện với mọi người xem được issue và có thể gửi thông báo.',
      reversible: false,
    }),
  )
}

function previewLogTime(input: Record<string, unknown>, ctx: PreviewContext): Promise<ToolPreview> {
  const target =
    input['issue_id'] !== undefined
      ? `issue #${String(input['issue_id'])}`
      : `dự án ${String(input['project_id'] ?? '?')}`
  const day = typeof input['spent_on'] === 'string' ? input['spent_on'] : 'hôm nay'
  return Promise.resolve(
    simplePreview(ctx, 'log_time', {
      action: `Log ${String(input['hours'])} giờ vào ${target} (${day})`,
      payload: input,
      change: { field: `Thời gian đã làm — ${target}`, before: null, after: `${String(input['hours'])} giờ` },
      impactWarning:
        input['issue_id'] === undefined && input['project_id'] === undefined
          ? 'Chưa có issue_id hoặc project_id — Redmine sẽ từ chối bản ghi này.'
          : 'Bản ghi tính vào báo cáo thời gian của bạn. Có thể sửa hoặc xoá lại trong Redmine.',
      reversible: true,
    }),
  )
}

/**
 * Đọc issue trước để hiện "trước → sau" từng trường (§10.2 mục 5, B4). Đọc thất bại thì preview
 * vẫn dựng được, chỉ không có cột "trước".
 */
async function previewUpdateIssue(
  input: Record<string, unknown>,
  ctx: PreviewContext,
): Promise<ToolPreview> {
  let current: Record<string, unknown> | null = null
  try {
    const raw = await ctx.readTool(redmineToolName('get_issue'), { issue_id: input['issue_id'] })
    const parsed = parseJsonish(raw)
    current = parsed === null ? null : (asRecord(parsed['issue']) ?? parsed)
  } catch {
    current = null
  }

  const changes: PreviewChange[] = Object.entries(input)
    .filter(([k, v]) => k !== 'issue_id' && v !== undefined && v !== null)
    .map(([k, v]) => ({
      field: FIELD_LABELS[k] ?? k,
      before: current === null || k === 'notes' ? null : currentValue(current, k),
      after: display(v),
    }))

  return {
    ...basePreview(ctx, 'update_issue', 'WRITE_HIGH'),
    action: `Cập nhật ${String(changes.length)} trường của #${String(input['issue_id'])}`,
    payloadFields: [{ label: 'Issue', value: `#${String(input['issue_id'])}` }],
    changes,
    impactWarning:
      current === null
        ? 'Không đọc được giá trị hiện tại của issue nên không hiện được cột "trước". Hãy kiểm tra kỹ trước khi xác nhận.'
        : 'Giá trị cũ sẽ bị ghi đè. Redmine giữ lịch sử thay đổi nhưng Nexa không tự hoàn tác được.',
    reversible: false,
    beforeValuesMayBeStale: true,
  }
}

/**
 * Giá trị hiện tại của một trường, theo hình dạng thật của issue Redmine: các trường `*_id` nằm
 * dưới object lồng (`status: {id, name}`), nên hiện cả tên cho người dùng đọc được.
 */
function currentValue(issue: Record<string, unknown>, key: string): string | null {
  if (key.endsWith('_id')) {
    const nested = asRecord(issue[key.replace(/_id$/, '').replace(/^parent_issue$/, 'parent')])
    if (nested !== null) {
      const name = nested['name']
      return `${String(nested['id'] ?? '')}${typeof name === 'string' ? ` (${name})` : ''}`
    }
  }
  const v = issue[key]
  return v === undefined || v === null ? null : display(v)
}

// ═══════════════════════════════════════════════════════════════════════════
// Lookup khi kết quả ghi `uncertain` (§16)
// ═══════════════════════════════════════════════════════════════════════════

/** Lùi 5 phút để chịu được lệch đồng hồ giữa máy người dùng và Redmine. */
function sinceDate(startedAt: string): string {
  return new Date(new Date(startedAt).getTime() - 5 * 60_000).toISOString().slice(0, 10)
}

async function lookupCreatedIssue(
  input: Record<string, unknown>,
  ctx: LookupContext,
): Promise<UncertainLookupResult> {
  try {
    const raw = await ctx.readTool(redmineToolName('search_issues'), {
      project_id: String(input['project_id']),
      author_id: 'me',
      status: '*',
      subject: `~${String(input['subject'] ?? '')}`,
      created_on: `>=${sinceDate(ctx.startedAt)}`,
      limit: 10,
    })
    const parsed = parseJsonish(raw)
    const issues = parsed === null ? null : parsed['issues']
    if (!Array.isArray(issues)) return { matches: [], inconclusive: true }
    return {
      matches: issues.flatMap((entry) => {
        const issue = asRecord(entry)
        if (issue === null) return []
        return [
          {
            key: `#${String(issue['id'] ?? '')}`,
            url: '',
            summary: String(issue['subject'] ?? ''),
          },
        ]
      }),
      inconclusive: false,
    }
  } catch {
    return { matches: [], inconclusive: true }
  }
}

async function lookupComment(
  input: Record<string, unknown>,
  ctx: LookupContext,
): Promise<UncertainLookupResult> {
  try {
    const raw = await ctx.readTool(redmineToolName('get_issue'), {
      issue_id: input['issue_id'],
      include: 'journals',
    })
    const parsed = parseJsonish(raw)
    const issue = parsed === null ? null : (asRecord(parsed['issue']) ?? parsed)
    const journals = issue === null ? null : issue['journals']
    if (!Array.isArray(journals)) return { matches: [], inconclusive: true }
    const since = new Date(ctx.startedAt).getTime() - 5 * 60_000
    const notes = String(input['notes'] ?? '').trim()
    const found = journals
      .map((j) => asRecord(j))
      .filter(
        (j): j is Record<string, unknown> =>
          j !== null &&
          String(j['notes'] ?? '').trim() === notes &&
          new Date(String(j['created_on'] ?? '')).getTime() >= since,
      )
    return {
      matches: found.map((j) => ({
        key: `#${String(input['issue_id'])}`,
        url: '',
        summary: `Ghi chú #${String(j['id'] ?? '')}`,
      })),
      inconclusive: false,
    }
  } catch {
    return { matches: [], inconclusive: true }
  }
}

async function lookupLoggedTime(
  input: Record<string, unknown>,
  ctx: LookupContext,
): Promise<UncertainLookupResult> {
  try {
    const spentOn =
      typeof input['spent_on'] === 'string' ? input['spent_on'] : new Date().toISOString().slice(0, 10)
    const raw = await ctx.readTool(redmineToolName('list_time_entries'), {
      user_id: 'me',
      spent_on: spentOn,
      ...(input['issue_id'] !== undefined ? { issue_id: input['issue_id'] } : {}),
      limit: 50,
    })
    const parsed = parseJsonish(raw)
    const entries = parsed === null ? null : parsed['time_entries']
    if (!Array.isArray(entries)) return { matches: [], inconclusive: true }
    const since = new Date(ctx.startedAt).getTime() - 5 * 60_000
    const found = entries
      .map((e) => asRecord(e))
      .filter(
        (e): e is Record<string, unknown> =>
          e !== null &&
          Number(e['hours']) === Number(input['hours']) &&
          new Date(String(e['created_on'] ?? '')).getTime() >= since,
      )
    return {
      matches: found.map((e) => ({
        key: `time_entry ${String(e['id'] ?? '')}`,
        url: '',
        summary: `${String(e['hours'])} giờ ngày ${spentOn}`,
      })),
      inconclusive: false,
    }
  } catch {
    return { matches: [], inconclusive: true }
  }
}
