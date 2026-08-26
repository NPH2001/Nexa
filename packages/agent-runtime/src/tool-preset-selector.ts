import type { ToolPreset } from '@nexa/shared-types'

/**
 * Chọn preset tool cho một lượt (ADR 0009).
 *
 * Hàm THUẦN: không I/O, không gọi model, không nguồn ngẫu nhiên. Đó là điểm chính của thiết kế —
 * phương án router-bằng-model tiết kiệm token hơn một chút nhưng cộng một round-trip vào MỌI câu
 * hỏi, và `maxToolIterations` đã là 5.
 *
 * Đoán sai không chặn được việc gì: mọi preset hẹp đều kèm tool meta `nexa_mo_rong_tool` để model
 * tự xin danh mục đầy đủ (xem `agent-runtime.ts`). Vì phía "đoán thiếu" chỉ tốn một round-trip
 * còn phía "đoán thừa" tốn token trên mọi câu hỏi, khi không chắc thì luôn nghiêng về `read`.
 */

/**
 * Bỏ dấu tiếng Việt và hạ chữ thường.
 *
 * Bỏ dấu vì người dùng gõ "tao issue" thay vì "tạo issue" là chuyện thường ngày, và một bộ chọn
 * chỉ khớp chữ có dấu sẽ trượt đúng những câu gõ nhanh nhất.
 */
export function normalizeQuestion(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

/**
 * Dấu hiệu Jira. `task`/`cong viec` nằm ở đây vì trong ngữ cảnh tổ chức dùng Jira thì "tạo một
 * task" gần như luôn là Jira, không phải một việc chung chung.
 */
const JIRA_WORDS = [
  'jira',
  'issue',
  'ticket',
  'sprint',
  'backlog',
  'epic',
  'bug',
  'task',
  'subtask',
  'sub-task',
  'cong viec',
  'board',
  'jql',
  'story',
  'assignee',
] as const

/** Dấu hiệu Confluence. */
const CONFLUENCE_WORDS = [
  'confluence',
  'wiki',
  'space',
  'trang',
  'tai lieu',
  'page',
  'document',
] as const

/**
 * Động từ chỉ ý định thay đổi dữ liệu.
 *
 * Đã CỐ Ý bỏ hai từ tưởng như phải có:
 *   - `dong` ("đóng"): sau khi bỏ dấu nó trùng với "động" trong "hoạt động" — một cụm rất thường
 *     gặp và không mang ý định write.
 *   - `gan` ("gán"): trùng với "gần" trong "gần đây".
 * Cả hai đã được `assign`/`transition`/`chuyen` phủ ở phần lớn câu thật, và theo nguyên tắc
 * nghiêng-về-read thì thà trượt rồi mở rộng còn hơn gửi thừa 30 tool write cho mọi câu hỏi.
 */
const WRITE_WORDS = [
  'tao',
  'sua',
  'cap nhat',
  'xoa',
  'chuyen',
  'them',
  'comment',
  'binh luan',
  'giao viec',
  'dinh kem',
  'upload',
  'create',
  'update',
  'delete',
  'move',
  'assign',
  'transition',
] as const

/**
 * Mẫu issue key Jira trên chuỗi GỐC (phân biệt chữ hoa) — "PRJ-1234".
 * Chạy trên chuỗi gốc chứ không phải chuỗi đã hạ chữ thường, vì chữ hoa chính là tín hiệu.
 */
const ISSUE_KEY_PATTERN = /\b([A-Z][A-Z0-9]{1,9})-\d+\b/g

/**
 * Tiền tố hay khớp nhầm `ISSUE_KEY_PATTERN` mà chắc chắn không phải project key.
 * Hại của việc khớp nhầm chỉ là chọn `jira-read` thay vì `all-read`, nên danh sách này giữ ngắn
 * có chủ ý — chỉ những cái thật sự hay xuất hiện trong câu hỏi kỹ thuật.
 */
const ISSUE_KEY_DENYLIST = new Set(['UTF', 'ISO', 'RFC', 'SHA', 'CVE', 'AES', 'HTTP', 'UTC', 'GMT'])

/**
 * "trạng thái" sau khi bỏ dấu thành "trang thai", chứa "trang" — dấu hiệu Confluence.
 * "chuyển trạng thái issue" là câu Jira thuần, nên cụm này bị gỡ trước khi khớp.
 */
const CONFLUENCE_FALSE_FRIENDS = [/\btrang thai\b/g]

function containsWord(haystack: string, needle: string): boolean {
  // Chuỗi đã chuẩn hoá là ASCII nên \b hoạt động đúng, kể cả với cụm nhiều từ.
  return new RegExp(`(?:^|[^a-z0-9])${needle.replace(/[-]/g, '\\-')}(?:[^a-z0-9]|$)`).test(haystack)
}

function hasIssueKey(original: string): boolean {
  for (const match of original.matchAll(ISSUE_KEY_PATTERN)) {
    const prefix = match[1]
    if (prefix !== undefined && !ISSUE_KEY_DENYLIST.has(prefix)) return true
  }
  return false
}

/** Ba tín hiệu rời nhau, tách ra để test được từng cái và để log lý do khi cần. */
export interface PresetSignals {
  readonly jira: boolean
  readonly confluence: boolean
  readonly write: boolean
}

export function detectSignals(question: string): PresetSignals {
  const normalized = normalizeQuestion(question)
  const forConfluence = CONFLUENCE_FALSE_FRIENDS.reduce(
    (text, pattern) => text.replace(pattern, ' '),
    normalized,
  )

  return {
    jira: JIRA_WORDS.some((w) => containsWord(normalized, w)) || hasIssueKey(question),
    confluence: CONFLUENCE_WORDS.some((w) => containsWord(forConfluence, w)),
    write: WRITE_WORDS.some((w) => containsWord(normalized, w)),
  }
}

/**
 * Bảng quyết định hai trục → preset.
 *
 * Không có tín hiệu hệ đích ⇒ `all-read`, KHÔNG phải `all`. Câu hỏi không nhắc Jira lẫn
 * Confluence rất có thể là câu không cần tool nào ("tóm tắt file này") — gửi cả 98 tool cho nó là
 * phần lãng phí thuần khiết nhất trong hành vi trước ADR 0009. Ta không chứng minh được là không
 * cần, nên chọn mức giữa; ý định write ở nhánh này đi qua đường mở rộng.
 */
export function selectPreset(question: string): ToolPreset {
  const { jira, confluence, write } = detectSignals(question)

  if (jira && !confluence) return write ? 'jira-full' : 'jira-read'
  if (confluence && !jira) return write ? 'confluence-full' : 'confluence-read'
  if (jira && confluence) return write ? 'all' : 'all-read'
  return 'all-read'
}

/**
 * Câu hỏi của lượt hiện tại = message `user` CUỐI CÙNG trong history (`history` đã bao gồm câu
 * vừa gửi). Không có message user nào ⇒ không có gì để suy luận ⇒ `all-read`.
 */
export function selectPresetForHistory(
  history: readonly { role: string; content: string }[],
): ToolPreset {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i]
    if (message?.role === 'user') return selectPreset(message.content)
  }
  return 'all-read'
}
