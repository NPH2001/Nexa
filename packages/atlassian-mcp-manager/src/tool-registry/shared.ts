/**
 * Tiện ích dùng chung cho mọi nhóm tool (jira-read, jira-write, confluence-read,
 * confluence-write). Tách khỏi `tool-registry.ts` gốc khi danh mục mở rộng từ 7 lên 98 tool
 * (số tool thật mà gateway `mcp-atlassian` công bố — xem docs/OPEN-QUESTIONS.md A4) để mỗi file
 * còn đọc được.
 */

export const MAX_RESULT_CHARS_FOR_MODEL = 4_000

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

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(đã rút gọn)`
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

export function summarizeGeneric(raw: unknown): { forModel: string; forUser: string } {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
  return {
    forModel: truncate(text, MAX_RESULT_CHARS_FOR_MODEL),
    forUser: `Kết quả dài ${String(text.length)} ký tự`,
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
