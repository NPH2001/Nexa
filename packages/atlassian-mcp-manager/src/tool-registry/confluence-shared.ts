import { sanitizeExternalUrl } from '@nexa/security'
import type { ToolResultSummary } from '@nexa/shared-types'
import {
  MAX_RESULT_CHARS_FOR_MODEL,
  asRecord,
  parseJsonish,
  pickPath,
  summarizeModelText,
  summarizeGeneric,
} from './shared.js'

/**
 * Trang Confluence không có một hình dạng payload duy nhất.
 *
 * `mcp-atlassian` gói nội dung dưới `metadata` + `content.value`, các bản/gateway khác trả phẳng
 * `{title, body}`. `pickPath` thử nhiều vị trí; phần cuối hàm CHẶN mọi kết quả rỗng — hình dạng lạ
 * thì trả nguyên văn cho model, không trả chuỗi rỗng khiến model tưởng trang trống.
 */
export function summarizeConfluencePage(raw: unknown, baseUrl: string): ToolResultSummary {
  const page = parseJsonish(raw)
  if (page === null) return summarizeGeneric(raw)

  const title = pickPath(page, ['title'], ['metadata', 'title'], ['page', 'title'])
  const body = pickPath(
    page,
    ['body'],
    ['content'],
    ['content', 'value'],
    ['page_content'],
    ['metadata', 'content'],
    ['body', 'storage', 'value'],
    ['page', 'body'],
  )
  const url = sanitizeExternalUrl(
    page['url'] ?? asRecord(page['metadata'])?.['url'] ?? asRecord(page['_links'])?.['webui'],
    baseUrl,
  )
  const id = page['id'] ?? asRecord(page['metadata'])?.['id']

  if (body === '') return summarizeGeneric(raw)

  const modelText = summarizeModelText(
    [title === '' ? null : `Tiêu đề: ${title}`, body].filter((l) => l !== null).join('\n\n'),
    MAX_RESULT_CHARS_FOR_MODEL,
  )
  return {
    ...modelText,
    forUser: title === '' ? 'Đã đọc trang Confluence' : title,
    ...(id !== undefined ? { targetKey: String(id) } : {}),
    ...(url !== null ? { targetUrl: url } : {}),
  }
}

/** Dùng cho tool trả về danh sách phẳng (comment, label, attachment, template…). */
export function summarizeConfluenceList(raw: unknown, label: string): ToolResultSummary {
  const result = parseJsonish(raw)
  const list =
    result === null ? null : (result['results'] ?? result['labels'] ?? result['children'])
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
