import { TOOL_PRESET_FLAGS, type McpTargetSystem, type ToolPreset } from '@nexa/shared-types'

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
 * Từ chỉ RIÊNG Jira (ADR 0010): tên hệ thống và khái niệm chỉ Jira có (sprint, epic, board, JQL).
 */
const JIRA_WORDS = ['jira', 'sprint', 'backlog', 'epic', 'board', 'jql', 'story'] as const

/** Từ chỉ RIÊNG Confluence. */
const CONFLUENCE_WORDS = ['confluence', 'cql'] as const

/** Từ chỉ RIÊNG Redmine — tên hệ thống và log time. */
const REDMINE_WORDS = [
  'redmine',
  'log time',
  'logtime',
  'log gio',
  'time entry',
  'spent time',
] as const

/** Từ chỉ RIÊNG XWiki. */
const XWIKI_WORDS = ['xwiki'] as const

/**
 * Từ CHUNG cho hệ thống quản lý việc (Jira hoặc Redmine). `task`/`cong viec` nằm ở đây vì "tạo
 * một task" gần như luôn là một hệ thống issue, không phải một việc chung chung — nhưng là hệ thống
 * NÀO thì tuỳ tổ chức đang dùng gì (xem `available` của `detectSignals`).
 */
const ISSUE_WORDS = [
  'issue',
  'ticket',
  'bug',
  'task',
  'subtask',
  'sub-task',
  'cong viec',
  'assignee',
] as const

/** Từ CHUNG cho hệ thống tài liệu (Confluence hoặc XWiki). */
const DOC_WORDS = ['wiki', 'space', 'trang', 'tai lieu', 'page', 'document'] as const

/**
 * Hệ thống mà từ chung trỏ tới khi caller không nói gì về hệ thống khả dụng — đúng hành vi trước
 * ADR 0010, khi Nexa chỉ biết Jira và Confluence.
 */
const DEFAULT_AVAILABLE: readonly McpTargetSystem[] = ['jira', 'confluence']

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

/** Redmine gọi issue bằng "#1234". Phải đứng sau khoảng trắng/đầu câu để không khớp "C#1". */
const REDMINE_ISSUE_PATTERN = /(?:^|[\s(])#\d{1,7}\b/

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

/** Tín hiệu rời nhau, tách ra để test được từng cái và để log lý do khi cần. */
export interface PresetSignals {
  readonly jira: boolean
  readonly confluence: boolean
  readonly redmine: boolean
  readonly xwiki: boolean
  readonly write: boolean
}

/**
 * @param available  Hệ thống đang có tool khả dụng. Từ CHUNG ("task", "trang wiki") chỉ trỏ tới
 *   hệ thống thuộc nhóm đó đang khả dụng — người chỉ cấu hình Redmine hỏi "tạo task" phải ra
 *   preset Redmine, không phải `jira-full` rỗng tool. Từ RIÊNG (tên hệ thống, mã issue) luôn được
 *   tính dù hệ thống có khả dụng hay không: đó là ý người dùng.
 */
export function detectSignals(
  question: string,
  available: readonly McpTargetSystem[] = DEFAULT_AVAILABLE,
): PresetSignals {
  const normalized = normalizeQuestion(question)
  const forDocs = CONFLUENCE_FALSE_FRIENDS.reduce(
    (text, pattern) => text.replace(pattern, ' '),
    normalized,
  )
  const has = (words: readonly string[], text: string): boolean =>
    words.some((w) => containsWord(text, w))
  const genericIssue = has(ISSUE_WORDS, normalized)
  const genericDoc = has(DOC_WORDS, forDocs)
  const can = (system: McpTargetSystem): boolean => available.includes(system)

  const jiraExplicit = has(JIRA_WORDS, normalized) || hasIssueKey(question)
  const redmineExplicit = has(REDMINE_WORDS, normalized) || REDMINE_ISSUE_PATTERN.test(question)
  const confluenceExplicit = has(CONFLUENCE_WORDS, forDocs)
  const xwikiExplicit = has(XWIKI_WORDS, normalized)

  // Đã gọi tên một hệ thống trong nhóm ⇒ từ chung của nhóm đó thuộc về hệ thống được gọi tên, không
  // kéo thêm hệ thống còn lại vào ("issue Redmine #12" không cần tool Jira).
  const issueNamed = jiraExplicit || redmineExplicit
  const docNamed = confluenceExplicit || xwikiExplicit

  return {
    jira: jiraExplicit || (genericIssue && !issueNamed && can('jira')),
    redmine: redmineExplicit || (genericIssue && !issueNamed && can('redmine')),
    confluence: confluenceExplicit || (genericDoc && !docNamed && can('confluence')),
    xwiki: xwikiExplicit || (genericDoc && !docNamed && can('xwiki')),
    write: has(WRITE_WORDS, normalized),
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
export function selectPreset(
  question: string,
  available: readonly McpTargetSystem[] = DEFAULT_AVAILABLE,
): ToolPreset {
  const signals = detectSignals(question, available)
  const systems = (['jira', 'confluence', 'redmine', 'xwiki'] as const).filter((s) => signals[s])

  // Đúng một hệ thống ⇒ preset của hệ thống đó. Từ hai hệ thống trở lên ⇒ `all-read`/`all`: tập
  // preset là danh sách ĐÓNG (ADR 0009), không sinh preset tổ hợp theo từng câu hỏi.
  const [only] = systems
  if (systems.length === 1 && only !== undefined) {
    return `${only}-${signals.write ? 'full' : 'read'}` as ToolPreset
  }
  if (systems.length > 1) return signals.write ? 'all' : 'all-read'
  return 'all-read'
}

/**
 * Câu hỏi của lượt hiện tại = message `user` CUỐI CÙNG trong history (`history` đã bao gồm câu
 * vừa gửi). Không có message user nào ⇒ không có gì để suy luận ⇒ `all-read`.
 */
export function selectPresetForHistory(
  history: readonly { role: string; content: string }[],
  available: readonly McpTargetSystem[] = DEFAULT_AVAILABLE,
): ToolPreset {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i]
    if (message?.role === 'user') return selectPreset(message.content, available)
  }
  return 'all-read'
}

/**
 * Áp trần tool của agent lên preset do bộ chọn chọn (openspec `add-custom-agents`, D2).
 *
 * Preset được chọn nằm TRỌN trong trần (cờ của nó là tập con cờ của trần) ⇒ giữ nguyên; ngược
 * lại dùng trần. Kết quả luôn là một trong các preset có sẵn, nên không sinh prefix `tools` mới
 * (ADR 0009). Phép giao chính xác theo từng cờ bị loại vì nó cho ra tổ hợp ngoài danh sách đóng.
 *
 * Chỉ THU HẸP: kết quả không bao giờ có cờ nào mà `ceiling` không có.
 */
export function clampPreset(selected: ToolPreset, ceiling: ToolPreset): ToolPreset {
  const allowed = new Set<string>(TOOL_PRESET_FLAGS[ceiling])
  const withinCeiling = TOOL_PRESET_FLAGS[selected].every((flag) => allowed.has(flag))
  return withinCeiling ? selected : ceiling
}
