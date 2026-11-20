import type { z } from 'zod'
import type { McpTargetSystem, RiskLevel, ToolPreview } from './domain.js'
import type { FeatureFlags } from './settings.js'

/**
 * §13.1: "Mỗi tool có typed input/output, risk level và policy metadata."
 *
 * Đây là mô tả tool phía Nexa — tách biệt với schema mà MCP server công bố qua `tools/list`.
 * Nexa không tin schema từ MCP (§11.3 "không coi LLM output là dữ liệu tin cậy" và tương tự
 * với input từ server bên ngoài): tool nào không có định nghĩa ở đây thì không được gọi.
 */
export interface ToolDefinition<TInput = unknown> {
  /** Tên Nexa dùng nội bộ và hiển thị cho LLM. */
  readonly name: string
  /** Tên tool thật trên MCP server. Có thể khác `name` nếu package đổi quy ước. */
  readonly mcpToolName: string
  readonly targetSystem: McpTargetSystem
  readonly riskLevel: RiskLevel
  /** Mô tả gửi cho LLM (tiếng Việt — người dùng và prompt đều tiếng Việt). */
  readonly description: string
  readonly inputSchema: z.ZodType<TInput>
  /** JSON Schema tương ứng, gửi trong `tools` của request LiteLLM. */
  readonly jsonSchema: Record<string, unknown>
  /** Feature flag phải bật thì tool mới khả dụng. */
  readonly requiredFeature: keyof FeatureFlags
  /**
   * Chốt payload cuối cùng cho tool ghi, chạy TRƯỚC `buildPreview` (ADR 0010).
   *
   * Dùng khi payload thực thi phải mang một giá trị chỉ đọc được từ hệ thống đích — ví dụ
   * `base_version` của trang XWiki, để một trang bị người khác sửa trong lúc chờ xác nhận bị server
   * từ chối thay vì ghi đè lặng lẽ. Payload trả về được validate lại theo `inputSchema`, và chính
   * nó được xem trước, băm vào approval (ADR-0007) và thực thi.
   */
  readonly prepareWrite?: (input: TInput, ctx: PreviewContext) => Promise<TInput>
  /** Sinh preview cho tool write (§10.2). Bắt buộc với mọi risk khác READ. */
  readonly buildPreview?: (input: TInput, ctx: PreviewContext) => Promise<ToolPreview>
  /**
   * Tra cứu kết quả khi write rơi vào trạng thái `uncertain` (§16, OPEN-QUESTIONS B9).
   * Trả về đối tượng tìm được, hoặc rỗng nếu chắc chắn chưa tạo.
   */
  readonly lookupResult?: (input: TInput, ctx: LookupContext) => Promise<UncertainLookupResult>
  /** Rút gọn kết quả trước khi đưa vào context LLM (§7.3 bước 5). */
  readonly summarizeResult?: (raw: unknown) => ToolResultSummary
}

export interface PreviewContext {
  readonly actingAccount: string
  readonly targetSystemUrl: string
  /** Gọi một tool READ để lấy giá trị hiện tại (B4). Có thể thất bại — preview vẫn phải chạy. */
  readonly readTool: (toolName: string, input: unknown) => Promise<unknown>
}

export interface LookupContext {
  readonly actingAccount: string
  /** Thời điểm bắt đầu thao tác — dùng để giới hạn cửa sổ tìm kiếm. */
  readonly startedAt: string
  readonly readTool: (toolName: string, input: unknown) => Promise<unknown>
}

export interface UncertainLookupResult {
  readonly matches: readonly { key: string; url: string; summary: string }[]
  /** true khi tra cứu không kết luận được (lỗi mạng, tool read cũng hỏng). */
  readonly inconclusive: boolean
}

export interface ToolResultSummary {
  /** Text đưa vào context LLM. Đã rút gọn. */
  readonly forModel: string
  /** Text ngắn hiển thị trong UI và lưu `result_summary_ciphertext`. */
  readonly forUser: string
  /**
   * `true` khi `forModel` không đại diện cho toàn bộ kết quả tool (bị giới hạn ký tự,
   * phân trang, hoặc chỉ lấy một phần danh sách). Runtime phải chuyển cờ này tới model/UI;
   * không được để model trình bày phần dữ liệu còn lại như một kết quả đầy đủ.
   */
  readonly incomplete?: boolean
  /** Mô tả an toàn, không chứa raw payload, cho biết phần nào chưa được đưa vào context. */
  readonly completenessNote?: string
  readonly targetKey?: string
  readonly targetUrl?: string
}

/** Một lời gọi tool do model đề xuất, đã parse khỏi response LiteLLM. */
export interface ProposedToolCall {
  /** id do model sinh — phải echo lại trong tool result message. */
  readonly id: string
  readonly name: string
  readonly rawArguments: string
}

/** §10.3 — approval gắn cứng với operation_id + payload_hash. */
export interface ApprovalRecord {
  readonly operationId: string
  readonly payloadHash: string
  readonly toolName: string
  readonly approvedAt: string
  readonly expiresAt: string
}

/** Yêu cầu xác nhận đẩy lên UI, kèm mọi thứ cần để hiển thị §10.2. */
export interface ConfirmationRequest {
  readonly operationId: string
  readonly payloadHash: string
  readonly conversationId: string
  readonly preview: ToolPreview
  readonly expiresAt: string
}

export function isWriteRisk(level: RiskLevel): boolean {
  return level !== 'READ'
}

// ═══════════════════════════════════════════════════════════════════════════
// Preset tool — ADR 0009
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tập tool được gửi cho model trong một lượt.
 *
 * Vì sao là một danh sách ĐÓNG và không phải "chọn đúng tool liên quan tới câu hỏi này":
 * khối `tools` nằm ở đầu request, nên nó là prefix của prompt. Một tập tool khác nhau cho mỗi
 * câu hỏi nghĩa là một prefix mới mỗi lần ⇒ prompt cache luôn miss, và việc lọc có thể thành
 * LỖ RÒNG so với gửi cả 98 tool nhưng cache được. Mười preset = mười prefix khả dĩ, biết trước
 * (sáu preset gốc của ADR 0009, cộng bốn preset Redmine/XWiki — ADR 0010).
 *
 * ĐỪNG biến cái này thành động. Xem `docs/architecture/adr/0009-tool-preset-scoping.md`.
 */
export type ToolPreset =
  | 'jira-read'
  | 'jira-full'
  | 'confluence-read'
  | 'confluence-full'
  | 'redmine-read'
  | 'redmine-full'
  | 'xwiki-read'
  | 'xwiki-full'
  | 'all-read'
  | 'all'

const JIRA_READ_FLAGS = ['jiraRead', 'jiraSearch'] as const
const JIRA_WRITE_FLAGS = [
  'jiraCreate',
  'jiraComment',
  'jiraLink',
  'jiraUpdate',
  'jiraWorkflow',
  'jiraServiceDesk',
] as const
const CONFLUENCE_READ_FLAGS = ['confluenceRead', 'confluenceSearch'] as const
const CONFLUENCE_WRITE_FLAGS = ['confluenceWrite', 'confluenceWriteHigh'] as const
const REDMINE_READ_FLAGS = ['redmineRead'] as const
const REDMINE_WRITE_FLAGS = ['redmineWrite', 'redmineUpdate'] as const
const XWIKI_READ_FLAGS = ['xwikiRead'] as const
const XWIKI_WRITE_FLAGS = ['xwikiWrite'] as const

/**
 * Preset → tập feature flag của nó. Preset là HỢP của các nhóm cờ đã có, không phải một trục
 * phân loại mới: 12 cờ tool hiện tại đã phân hoạch trọn 98 tool, mỗi tool đúng một cờ.
 *
 * Thêm một cờ tool mới mà quên cập nhật `all` ở đây sẽ làm mọi tool của nhóm đó IM LẶNG biến
 * mất khỏi mọi preset. `tool-preset.test.ts` trong agent-runtime khẳng định `all` phủ trọn
 * tập cờ mà registry thật sự dùng, nên lỗi đó thành đỏ ngay chứ không âm thầm.
 */
export const TOOL_PRESET_FLAGS: Readonly<Record<ToolPreset, readonly (keyof FeatureFlags)[]>> = {
  'jira-read': JIRA_READ_FLAGS,
  'jira-full': [...JIRA_READ_FLAGS, ...JIRA_WRITE_FLAGS],
  'confluence-read': CONFLUENCE_READ_FLAGS,
  'confluence-full': [...CONFLUENCE_READ_FLAGS, ...CONFLUENCE_WRITE_FLAGS],
  'redmine-read': REDMINE_READ_FLAGS,
  'redmine-full': [...REDMINE_READ_FLAGS, ...REDMINE_WRITE_FLAGS],
  'xwiki-read': XWIKI_READ_FLAGS,
  'xwiki-full': [...XWIKI_READ_FLAGS, ...XWIKI_WRITE_FLAGS],
  'all-read': [
    ...JIRA_READ_FLAGS,
    ...CONFLUENCE_READ_FLAGS,
    ...REDMINE_READ_FLAGS,
    ...XWIKI_READ_FLAGS,
  ],
  all: [
    ...JIRA_READ_FLAGS,
    ...JIRA_WRITE_FLAGS,
    ...CONFLUENCE_READ_FLAGS,
    ...CONFLUENCE_WRITE_FLAGS,
    ...REDMINE_READ_FLAGS,
    ...REDMINE_WRITE_FLAGS,
    ...XWIKI_READ_FLAGS,
    ...XWIKI_WRITE_FLAGS,
  ],
}

/** Mọi preset khả dĩ — dùng để test tính hữu hạn của tập prefix. */
export const TOOL_PRESETS: readonly ToolPreset[] = Object.keys(TOOL_PRESET_FLAGS) as ToolPreset[]

/**
 * Tên tool meta cho phép model tự yêu cầu danh mục đầy đủ khi preset hẹp không đủ (ADR 0009).
 *
 * Tên này KHÔNG có trong `buildToolRegistry()` và không được thêm vào đó. `runTurn` chặn lời gọi
 * này trước khi tới lớp thực thi; `resolveCallable()` vẫn phải từ chối nó. Nhét một
 * `ToolDefinition` giả vào registry để nó "lọt qua" đúng là đường vòng mà comment trong
 * `AtlassianMcpManager.callTool` cảnh báo.
 */
export const EXPAND_TOOLS_TOOL_NAME = 'nexa_mo_rong_tool'

// ═══════════════════════════════════════════════════════════════════════════
// Tool cục bộ — thao tác lên dữ liệu trên máy người dùng
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tool chạy thẳng trong main process, không qua MCP.
 *
 * Kiểu này CỐ Ý tách khỏi `ToolDefinition`: tool cục bộ không có `mcpToolName`, không thuộc
 * hệ thống đích Jira/Confluence và không gắn với feature flag của MCP server. Ép chung một
 * kiểu sẽ buộc phải điền các trường vô nghĩa, và đó chính là cách một tool cục bộ vô tình
 * lọt vào đường thực thi MCP.
 *
 * Cái KHÔNG đổi: risk level, preview và Confirmation Guard. Tool cục bộ ghi dữ liệu người dùng
 * nên nó đi qua đúng tám bước của §7.4 như tool write ngoài.
 */
export interface LocalToolDefinition<TInput = unknown> {
  readonly kind: 'local'
  /** Tên gửi cho LLM. Không được trùng tên tool MCP nào. */
  readonly name: string
  readonly riskLevel: RiskLevel
  readonly description: string
  readonly inputSchema: z.ZodType<TInput>
  readonly jsonSchema: Record<string, unknown>
  /** Bắt buộc với mọi risk khác READ — không có preview thì không có xác nhận có nghĩa. */
  readonly buildPreview?: (input: TInput, ctx: LocalPreviewContext) => Promise<ToolPreview>
  readonly execute: (input: TInput) => Promise<ToolResultSummary>
}

/**
 * Context dựng preview cho tool cục bộ.
 *
 * Không có `readTool`: tool cục bộ không được phép gọi tool MCP để dựng preview. Muốn đọc giá
 * trị "trước", nó dùng cổng đọc cục bộ mà main process bơm vào chính định nghĩa tool.
 */
export interface LocalPreviewContext {
  /** Profile đang thao tác — thay cho tài khoản Jira ở tool ngoài. */
  readonly actingAccount: string
}

/**
 * Danh mục tool cục bộ khả dụng cho một lượt chat.
 *
 * Danh sách ĐÓNG và do main process dựng theo setting; runtime chỉ đọc.
 */
export interface LocalToolRegistry {
  list(): readonly LocalToolDefinition[]
  get(name: string): LocalToolDefinition | undefined
}

// ═══════════════════════════════════════════════════════════════════════════
// MCP source — ADR 0010
// ═══════════════════════════════════════════════════════════════════════════

/** Kết quả một lời gọi tool MCP. */
export interface McpToolCallOutcome {
  readonly summary: ToolResultSummary
  /** Text thô từ server — chỉ dùng nội bộ (preview, lookup), không log. */
  readonly rawText: string
}

/**
 * Bề mặt một MCP server phục vụ cho runtime (ADR 0010).
 *
 * `AtlassianMcpManager`, mỗi `RemoteMcpServer` (Redmine, XWiki) và chính `McpToolRouter` đều thoả
 * interface này, nên `AgentRuntime` không cần biết bên dưới có một hay nhiều server.
 *
 * Hai cổng giữ nguyên nghĩa như ở `AtlassianMcpManager`: `findTool` tra metadata, còn
 * `resolveCallable` là cổng DUY NHẤT trước khi thực thi (registry ∧ feature flag ∧ server có
 * công bố tool).
 */
export interface McpToolSource {
  readonly isReady: boolean
  /** Tool khả dụng = có trong registry ∧ cờ bật ∧ server công bố. */
  availableTools(): ToolDefinition[]
  findTool(name: string): ToolDefinition | null
  resolveCallable(name: string): ToolDefinition
  validateInput(definition: ToolDefinition, rawArgs: unknown): Record<string, unknown>
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallOutcome>
  /** Tool READ gọi được ngay không — dùng khi dựng preview cho tool ghi. */
  canCallReadTool(name: string): boolean
  /** URL hệ thống đích hiện trong preview (§10.2 mục 1). Rỗng nếu source không phục vụ hệ thống đó. */
  targetSystemUrl(system: McpTargetSystem): string
  /**
   * Tài khoản đang hành động trên hệ thống đích, nếu source biết (ví dụ Redmine lấy từ
   * `get_current_user`). `undefined` ⇒ host dùng giá trị mặc định của mình.
   */
  actingAccount?(system: McpTargetSystem): string | undefined
}
