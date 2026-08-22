import type { ToolDefinition } from '@nexa/shared-types'
import { buildJiraReadTools } from './tool-registry/jira-read.js'
import { buildJiraWriteTools } from './tool-registry/jira-write.js'
import { buildConfluenceReadTools } from './tool-registry/confluence-read.js'
import { buildConfluenceWriteTools } from './tool-registry/confluence-write.js'

/**
 * Danh mục tool của Nexa (§13.1 "Mỗi tool có typed input/output, risk level và policy metadata").
 *
 * Danh mục thật (98 tool — gateway `mcp-atlassian` công bố, xem docs/OPEN-QUESTIONS.md A4 và
 * `mcp-atlassian-tools.json`) được chia bốn nhóm để mỗi file còn đọc được:
 *   - `tool-registry/jira-read.ts`, `tool-registry/jira-write.ts`
 *   - `tool-registry/confluence-read.ts`, `tool-registry/confluence-write.ts`
 * Zod schema của từng tool khớp đúng `inputSchema` thật lấy từ `tools/list` — không đoán tên
 * tham số (bài học từ vụ `confluence_search` dùng `cql` thay vì `query`, xem jira-shared.ts và
 * confluence-shared.ts).
 *
 * Một quyết định cần bạn để mắt: `jira_create_issue` được xếp WRITE_LOW. Tài liệu không xếp
 * hạng nó (chỉ nêu add_comment = LOW, update_issue = HIGH). Lý do chọn LOW: tạo mới không phá dữ
 * liệu đang có. Mọi tool write đều phải preview + xác nhận như nhau, nên mức chỉ ảnh hưởng độ chi
 * tiết của preview và việc có thể tắt bằng cờ hay không. Xem docs/OPEN-QUESTIONS.md nếu bạn muốn
 * nâng lên WRITE_HIGH.
 */

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
  return [
    ...buildJiraReadTools(opts.jiraBaseUrl),
    ...buildJiraWriteTools(opts.jiraBaseUrl),
    ...buildConfluenceReadTools(opts.confluenceBaseUrl),
    ...buildConfluenceWriteTools(opts.confluenceBaseUrl),
  ]
}
