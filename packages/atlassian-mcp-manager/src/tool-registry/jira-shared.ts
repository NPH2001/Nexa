import { sanitizeExternalUrl } from '@nexa/security'
import type { ToolResultSummary } from '@nexa/shared-types'
import {
  MAX_RESULT_CHARS_FOR_MODEL,
  asRecord,
  parseJsonish,
  summarizeModelText,
  summarizeGeneric,
} from './shared.js'

/**
 * Đúng theo `inputSchema` thật của `mcp-atlassian` (xem mcp-atlassian-tools.json) — KHÔNG phải
 * mẫu cũ `^[A-Z][A-Z0-9_]*-\d+$` mà `jira_get_issue`/`jira_search` gốc dùng. Chỉ áp dụng cho
 * tool MỚI ở đây; hai tool gốc giữ nguyên mẫu cũ để không đổi hành vi đã có test khoá lại.
 */
export const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+(?:-\d+)*$/
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]+$/

/** Danh sách field mặc định mà `mcp-atlassian` dùng cho mọi tool trả về issue (get_issue, search, get_board_issues…). */
export const DEFAULT_ISSUE_FIELDS =
  'issuetype,labels,priority,created,updated,summary,reporter,status,description,assignee,versions'

/** Dùng cho mọi tool trả về đúng một issue (get_issue, create_issue, update_issue, assign_issue…). */
export function summarizeJiraIssue(raw: unknown, baseUrl: string): ToolResultSummary {
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

  // Hình dạng payload lạ ⇒ trả nguyên văn, không trả rỗng (model cần đọc được thứ gì đó).
  if (lines.length === 0) return summarizeGeneric(raw)

  const safeIssue = { ...issue }
  delete safeIssue['url']
  if (url !== null) safeIssue['url'] = url
  const modelText = summarizeModelText(
    `${lines.join('\n')}\n\nDữ liệu có cấu trúc:\n${JSON.stringify(safeIssue)}`,
    MAX_RESULT_CHARS_FOR_MODEL,
  )

  return {
    ...modelText,
    forUser: key === '' ? 'Đã đọc issue' : `${key}${summary === '' ? '' : ` — ${summary}`}`,
    ...(key !== '' ? { targetKey: key } : {}),
    ...(url !== null ? { targetUrl: url } : {}),
  }
}

/** Dùng cho mọi tool trả về danh sách issue (search, get_project_issues, get_sprint_issues…). */
export function summarizeJiraSearch(raw: unknown, baseUrl: string): ToolResultSummary {
  const result = parseJsonish(raw)
  if (result === null) return summarizeGeneric(raw)

  if (!Array.isArray(result['issues'])) return summarizeGeneric(raw)

  const issues = result['issues']
  const lines = issues.map((entry) => {
    const issue = asRecord(entry)
    if (issue === null) return '- (không đọc được)'
    const url = sanitizeExternalUrl(issue['url'], baseUrl)
    const safeIssue = { ...issue }
    delete safeIssue['url']
    if (url !== null) safeIssue['url'] = url
    return `- ${JSON.stringify(safeIssue)}`
  })

  const total = Number(result['total'] ?? issues.length)
  const header = `Tìm thấy ${String(total)} kết quả; tool trả về ${String(issues.length)} kết quả trong trang hiện tại.`
  const modelText = summarizeModelText([header, ...lines].join('\n'), MAX_RESULT_CHARS_FOR_MODEL)
  const pageIncomplete = total > issues.length
  const completenessNote = [
    modelText.completenessNote,
    pageIncomplete
      ? `Tool mới trả về ${String(issues.length)}/${String(total)} kết quả; cần lấy trang tiếp theo để kết luận đầy đủ.`
      : undefined,
  ]
    .filter((note): note is string => note !== undefined)
    .join(' ')
  return {
    ...modelText,
    ...(pageIncomplete || modelText.incomplete === true
      ? { incomplete: true, completenessNote }
      : {}),
    forUser: header,
  }
}

/** Dùng cho tool trả về danh sách phẳng không phải issue (board, sprint, version, worklog…). */
export function summarizeJiraList(
  raw: unknown,
  label: string,
  arrayKey?: string,
): ToolResultSummary {
  const result = parseJsonish(raw)
  if (result === null) return summarizeGeneric(raw)

  const list = arrayKey === undefined ? result : result[arrayKey]
  if (!Array.isArray(list)) return summarizeGeneric(raw)

  const header = `${label}: ${String(list.length)} kết quả.`
  const modelText = summarizeModelText(
    [header, JSON.stringify(list)].join('\n'),
    MAX_RESULT_CHARS_FOR_MODEL,
  )
  return {
    ...modelText,
    forUser: header,
  }
}
