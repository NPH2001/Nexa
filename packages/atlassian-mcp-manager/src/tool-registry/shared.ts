/**
 * Tiện ích dùng chung cho mọi nhóm tool (jira-read, jira-write, confluence-read,
 * confluence-write). Tách khỏi `tool-registry.ts` gốc khi danh mục mở rộng từ 7 lên 98 tool
 * (số tool thật mà gateway `mcp-atlassian` công bố — xem docs/OPEN-QUESTIONS.md A4) để mỗi file
 * còn đọc được.
 */

import type { ToolResultSummary } from '@nexa/shared-types'
import { INCOMPLETE_TOOL_RESULT_MARKER } from '@nexa/mcp-client'

/**
 * 12.000 ký tự thường chỉ chiếm khoảng 3.000-4.000 token: đủ lớn để không làm mất các field
 * phổ biến sau trần 4.000 cũ, nhưng vẫn chừa chỗ cho system prompt, tool schema và câu trả lời.
 * Runtime luôn gắn cảnh báo có cấu trúc nếu kết quả còn dài hơn giới hạn này.
 */
export const MAX_RESULT_CHARS_FOR_MODEL = 12_000

export function toJsonSchema(
  properties: Record<string, Record<string, unknown>>,
  required: readonly string[],
): Record<string, unknown> {
  return { type: 'object', properties, required: [...required], additionalProperties: false }
}

export function truncateField(
  label: string,
  value: string,
  max = 500,
): { label: string; value: string; truncated?: boolean; fullValue?: string } {
  if (value.length <= max) return { label, value }
  return { label, value: `${value.slice(0, max)}…`, truncated: true, fullValue: value }
}

export interface ModelTextSummary {
  readonly forModel: string
  readonly incomplete?: true
  readonly completenessNote?: string
}

/**
 * Giữ cả đầu và cuối thay vì chỉ cắt đuôi. Metadata/tiêu đề thường ở đầu, còn tổng kết hoặc
 * trường vừa được yêu cầu có thể nằm cuối payload. Phần giữa vẫn có thể thiếu nên luôn trả cờ
 * `incomplete` và con số cụ thể để runtime buộc model nói rõ giới hạn.
 */
export function summarizeModelText(
  text: string,
  max = MAX_RESULT_CHARS_FOR_MODEL,
): ModelTextSummary {
  if (text.length <= max) return { forModel: text }

  const markerTemplate = (omitted: number): string =>
    `\n…(đã lược bỏ ${omitted.toLocaleString('vi-VN')} ký tự ở giữa)…\n`
  let marker = markerTemplate(text.length - max)
  const contentBudget = Math.max(0, max - marker.length)
  const omitted = text.length - contentBudget
  marker = markerTemplate(omitted)

  // Số chữ số của `omitted` có thể làm marker dài thêm một chút. Thu hẹp phần đầu để giữ invariant.
  const adjustedBudget = Math.max(0, max - marker.length)
  const adjustedHead = Math.ceil(adjustedBudget * 0.7)
  const adjustedTail = adjustedBudget - adjustedHead
  const forModel = `${text.slice(0, adjustedHead)}${marker}${
    adjustedTail === 0 ? '' : text.slice(-adjustedTail)
  }`

  return {
    forModel,
    incomplete: true,
    completenessNote: `${(text.length - adjustedBudget).toLocaleString(
      'vi-VN',
    )} ký tự chưa được đưa vào ngữ cảnh; chỉ giữ phần đầu và phần cuối của kết quả.`,
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** MCP trả text; nhiều server đóng gói JSON trong đó. Thử parse, không được thì thôi. */
export function parseJsonish(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      return asRecord(JSON.parse(raw))
    } catch {
      return null
    }
  }
  return asRecord(raw)
}

export function stringifyValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Trả về giá trị chuỗi đầu tiên tìm thấy theo các đường dẫn đã cho, hoặc `''`. */
export function pickPath(source: Record<string, unknown>, ...paths: readonly string[][]): string {
  for (const path of paths) {
    let current: unknown = source
    for (const key of path) {
      const record = asRecord(current)
      current = record === null ? undefined : record[key]
    }
    if (typeof current === 'string' && current.trim() !== '') return current
  }
  return ''
}

export function summarizeGeneric(raw: unknown): ToolResultSummary {
  const text = typeof raw === 'string' ? raw : (JSON.stringify(raw) ?? String(raw))
  const hasUnreadContent = text.startsWith(INCOMPLETE_TOOL_RESULT_MARKER)
  const readableText = hasUnreadContent
    ? text.slice(INCOMPLETE_TOOL_RESULT_MARKER.length).trimStart()
    : text
  const modelText = summarizeModelText(readableText)
  const completenessNote = [
    modelText.completenessNote,
    hasUnreadContent
      ? 'Tool còn trả về block không phải text; nội dung của các block đó chưa được đọc.'
      : undefined,
  ]
    .filter((note): note is string => note !== undefined)
    .join(' ')
  return {
    ...modelText,
    ...(hasUnreadContent || modelText.incomplete === true
      ? { incomplete: true, completenessNote }
      : {}),
    forUser: `Đã nhận kết quả từ công cụ (${text.length.toLocaleString('vi-VN')} ký tự)`,
  }
}

/** JQL/CQL string literal: escape `\` và `"`. Dùng cho lookup sau write `uncertain` (§16). */
export function escapeJql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function formatJqlDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
