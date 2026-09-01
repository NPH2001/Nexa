import { z } from 'zod'
export { RETENTION_CHOICES } from './ui-constants.js'

/**
 * Feature flag cục bộ cho tool/write action (§13.1).
 * Mặc định theo Phụ lục A và khuyến nghị §22.3: Confluence write TẮT trong MVP.
 */
export const featureFlagsSchema = z.object({
  /** Đọc issue/user/field — bao gồm mọi tool Jira READ đơn giản (một issue, một user, một field…). */
  jiraRead: z.boolean().default(true),
  /** Tìm kiếm/liệt kê nhiều đối tượng Jira: issue theo JQL, board, sprint, project, version… */
  jiraSearch: z.boolean().default(true),
  /**
   * Jira Service Management (queue, request type, customer request) — READ.
   *
   * Tách khỏi `jiraRead` có chủ ý: đây là một tính năng riêng (JSM) không phải tổ chức nào cũng
   * dùng, và request/queue có thể chứa dữ liệu khách hàng nhạy cảm hơn issue nội bộ thường.
   *
   * Mặc định BẬT theo yêu cầu 2026-08-22 "full quyền dùng cả 98 tool" — sai lệch có chủ ý so
   * với khuyến nghị §22.3 (mặc định tắt). Xem OPEN-QUESTIONS.md mục G1.
   */
  jiraServiceDesk: z.boolean().default(true),
  jiraCreate: z.boolean().default(true),
  /** Mặc định BẬT — xem ghi chú ở `jiraServiceDesk` và OPEN-QUESTIONS.md mục G1. */
  jiraComment: z.boolean().default(true),
  /**
   * WRITE_LOW mang tính "tổ chức lại" chứ không sửa nội dung issue: watcher, link (issue↔issue,
   * issue↔epic, remote link), thêm/bỏ issue khỏi sprint. Tách khỏi `jiraComment`/`jiraCreate` vì
   * đây là nhóm hành vi khác — không tạo/không viết nội dung, chỉ thay đổi quan hệ.
   *
   * Mặc định BẬT — xem OPEN-QUESTIONS.md mục G1.
   */
  jiraLink: z.boolean().default(true),
  /**
   * WRITE_HIGH — sửa field/sprint/version đã tồn tại. §10.1 gốc khuyến nghị tắt khỏi MVP.
   * Mặc định BẬT — xem OPEN-QUESTIONS.md mục G1.
   */
  jiraUpdate: z.boolean().default(true),
  /**
   * WRITE_HIGH: đổi trạng thái workflow (`transition_issue`), chuyển project (`move_issue`),
   * hoặc xoá quan hệ giữa hai issue (`remove_issue_link`). Tách khỏi `jiraUpdate` vì đây không
   * phải "sửa field" mà là thay đổi có thể kéo theo tác dụng phụ (thông báo, quy tắc workflow,
   * đổi issue key) khó dự đoán hơn một field update thường.
   *
   * Cờ này cũng mở khoá cho `jira_delete_issue` (DESTRUCTIVE) — xem `manager.ts` và
   * OPEN-QUESTIONS.md mục G1. Mặc định BẬT.
   */
  jiraWorkflow: z.boolean().default(true),
  confluenceRead: z.boolean().default(true),
  confluenceSearch: z.boolean().default(true),
  /**
   * WRITE_LOW Confluence: tạo trang, comment, label, upload attachment, copy trang.
   *
   * Trước đây cờ này không điều khiển tool nào (§22.3 ngoài MVP, xem OPEN-QUESTIONS A6). Nay đã
   * nối với các tool WRITE_LOW ở `tool-registry/confluence-write.ts`.
   *
   * Mặc định BẬT theo yêu cầu 2026-08-22 "full quyền dùng cả 98 tool" — sai lệch có chủ ý so
   * với khuyến nghị §22.3 (mặc định tắt). Xem OPEN-QUESTIONS.md mục G1.
   */
  confluenceWrite: z.boolean().default(true),
  /**
   * WRITE_HIGH Confluence: ghi đè nội dung trang (`update_page`, `update_page_section`), di
   * chuyển trang (`move_page`), đổi quyền xem/sửa (`set_page_restrictions`). Tách khỏi
   * `confluenceWrite` vì các hành động này ghi đè hoặc thay đổi quyền truy cập của nội dung đã
   * có, rủi ro cao hơn hẳn việc tạo mới hay thêm comment.
   *
   * Cờ này cũng mở khoá cho `confluence_delete_page`/`confluence_delete_attachment`
   * (DESTRUCTIVE) — xem `manager.ts` và OPEN-QUESTIONS.md mục G1. Mặc định BẬT.
   */
  confluenceWriteHigh: z.boolean().default(true),
  /** §22.2 A8: mặc định tắt, để IT phân phối tập trung. */
  autoUpdate: z.boolean().default(false),
  /** §8.3: có lưu text đã trích xuất từ file vào DB (đã mã hoá) hay không. */
  storeExtractedText: z.boolean().default(true),
  /** OPEN-QUESTIONS A7: cho phép người dùng tắt lưu lịch sử. */
  storeHistory: z.boolean().default(true),
  /**
   * Thu hẹp danh mục tool gửi cho model theo ngữ cảnh câu hỏi (ADR 0009).
   *
   * BẬT: mỗi lượt chỉ gửi một preset tool (xem `TOOL_PRESET_FLAGS` trong `tools.ts`) thay vì
   * cả 98 tool — tiết kiệm ~50–65% token khối `tools`. Model vẫn lấy được danh mục đầy đủ bằng
   * cách gọi tool meta `nexa_mo_rong_tool`, nên thu hẹp không bao giờ chặn được việc gì.
   *
   * TẮT: gửi toàn bộ tool khả dụng như trước ADR 0009, và không đưa tool meta vào request.
   *
   * Đây KHÔNG phải cờ quyền: nó chỉ đổi cái model *thấy*, không đổi cái được phép *chạy* —
   * `resolveCallable()` vẫn là cổng duy nhất. Tắt cờ không mở thêm quyền nào.
   *
   * IT khoá được cờ này qua `forcedFeatures` trong `resources/policy.json` để rollback toàn
   * tổ chức không cần build lại.
   */
  toolScoping: z.boolean().default(true),
  /**
   * Business Analyst workbench: kho tri thức nghiệp vụ, tài liệu có cấu trúc và tool `nexa_ba_*`
   * (openspec `add-ba-workbench`).
   *
   * Mặc định TẮT. Đây là một bề mặt sản phẩm mới, không phải một tinh chỉnh — cùng lập trường
   * với `proactiveCheckInsEnabled` và `agentCommitmentToolsEnabled`.
   *
   * Cờ này nằm trong `features` chứ không nằm ở tầng `AppSettings` để IT khoá được toàn tổ chức
   * qua `forcedFeatures` trong `resources/policy.json` mà không phải build lại — đúng đường mà
   * `toolScoping` đang dùng.
   *
   * TẮT ⇒ đích Nghiệp vụ không hiện, IPC `ba:*` từ chối, và registry tool BA không được nối vào
   * khối `tools`. Cờ không nới lỏng Confirmation Guard: bật rồi thì mọi tool ghi vẫn phải qua
   * preview và xác nhận.
   */
  baWorkbench: z.boolean().default(false),
})
export type FeatureFlags = z.infer<typeof featureFlagsSchema>

export const appSettingsSchema = z.object({
  /** Opt-in hoàn toàn cho proactive check-ins; mặc định không chạy nền. */
  proactiveCheckInsEnabled: z.boolean().default(false),
  /**
   * Cho phép agent ĐỀ XUẤT tạo/cập nhật cam kết từ hội thoại.
   *
   * Mặc định TẮT vì đây là quyền ghi mới cho agent, cùng lập trường với
   * `proactiveCheckInsEnabled`. Tắt cờ ⇒ tool cam kết không có trong khối `tools`, nên model
   * không đề xuất được. Cờ này không nới lỏng Confirmation Guard: bật rồi thì mọi lời gọi vẫn
   * phải qua preview và xác nhận.
   */
  agentCommitmentToolsEnabled: z.boolean().default(false),
  /**
   * Nạp cam kết đang hoạt động vào context để model biết người dùng đang treo việc gì.
   *
   * Mặc định BẬT: đây là quyền ĐỌC để trả lời sát hơn, khác mức rủi ro với quyền ghi ở trên.
   * Với provider ngoài, nội dung cam kết còn phải qua cổng chia sẻ như memory.
   */
  commitmentContextEnabled: z.boolean().default(true),
  /**
   * Bản tin công việc buổi sáng trên Today (openspec `add-daily-briefing`).
   *
   * Mặc định BẬT: nó chỉ đọc cam kết cục bộ và gọi một tool Jira READ mà người dùng đã được cấp
   * quyền từ trước — không mở thêm quyền nào. Tắt cờ ⇒ Today quay lại phần tổng quan cũ và main
   * không gọi Jira cho bản tin nữa.
   */
  dailyBriefingEnabled: z.boolean().default(true),
  /**
   * Cho model viết một đoạn dẫn ngắn phía trên bản tin.
   *
   * Mặc định TẮT, cùng lập trường với `proactiveCheckInsEnabled`: đây mới là chỗ dữ liệu công
   * việc rời máy đi tới model. Đoạn văn không phải nguồn dữ liệu — nó không thêm, bớt, đổi thứ
   * tự hay đổi hạn của mục nào, và bản tin vẫn đầy đủ khi model lỗi.
   */
  dailyBriefingSummaryEnabled: z.boolean().default(false),
  /** §14: giới hạn MVP 20–30 MB/file. Phụ lục A chốt 30. */
  maxFileSizeMb: z.number().int().min(1).max(100).default(30),
  maxFilesPerRequest: z.number().int().min(1).max(20).default(5),
  /**
   * Trần dung lượng riêng cho ảnh, tính SAU khi gỡ metadata.
   *
   * Thấp hơn `maxFileSizeMb` một cách có chủ ý: văn bản được rút gọn trước khi gửi, còn ảnh
   * thì đi nguyên vẹn — 30 MB base64 là hơn 40 MB trên dây và gần như chắc chắn bị gateway
   * từ chối.
   */
  maxImageSizeMb: z.number().int().min(1).max(20).default(8),
  /** 0 = giữ tới khi người dùng tự xoá (§8.3). */
  historyRetentionDays: z.number().int().min(0).max(3650).default(180),
  /** §8.3: 7–14 ngày. */
  logRetentionDays: z.number().int().min(1).max(90).default(14),
  /** §10.2 "approval có thời hạn ngắn". OPEN-QUESTIONS B8. */
  approvalTtlSeconds: z.number().int().min(15).max(900).default(120),
  /** §9.3 "timeout rõ ràng". */
  llmTimeoutMs: z.number().int().min(5_000).max(600_000).default(120_000),
  toolTimeoutMs: z.number().int().min(1_000).max(300_000).default(60_000),
  /** OPEN-QUESTIONS B3. */
  maxToolIterations: z.number().int().min(1).max(10).default(5),
  /**
   * Model NỘI BỘ (qua LiteLLM) được phép nhận tài liệu (§11.2).
   * Rỗng = không giới hạn — fail-open. OPEN-QUESTIONS A5.
   */
  documentAllowedModels: z.array(z.string()).default([]),
  /**
   * Model của provider NGOÀI được phép nhận tài liệu.
   *
   * Rỗng = KHÔNG model ngoài nào được nhận tài liệu — fail-closed (OPEN-QUESTIONS F1).
   *
   * Tách khỏi `documentAllowedModels` có chủ ý: nếu dùng chung một danh sách thì việc admin
   * thêm một model ngoài vào đó sẽ VÔ TÌNH chặn mọi model nội bộ khác — hai chính sách ngược
   * chiều nhau không thể dùng chung một danh sách.
   *
   * Ghi dạng `provider:modelId` để không nhập nhằng khi cùng model id có ở nhiều provider.
   */
  externalDocumentAllowedModels: z.array(z.string()).default([]),
  /** Hiện cảnh báo dữ liệu trước mỗi lần gửi file (§11.2). */
  warnBeforeSendingDocuments: z.boolean().default(true),
  /**
   * Bỏ qua xác thực chứng chỉ TLS ở chặng **gateway MCP → Jira/Confluence** (ADR-0008).
   *
   * MẶC ĐỊNH TẮT, và cố ý không có cách nào bật ngoài việc người dùng tự tích vào Settings —
   * không đọc từ biến môi trường, không đọc từ policy file. Bật nó là một quyết định phải có
   * người chịu trách nhiệm, nên nó phải là một hành động tường minh trong UI.
   *
   * Vì sao tồn tại: hạ tầng thật đã gặp (ABBANK, 2026-08-03) có Jira/Confluence dùng chứng chỉ
   * do CA nội bộ ký, mà container `mcp-atlassian` phía gateway KHÔNG tin cậy. TLS handshake ở
   * chặng đó thất bại, `/rest/api/2/myself` không gọi được, và `mcp-atlassian` báo lại thành
   * "Invalid header-based Jira token or configuration: Unable to get current user account ID:"
   * — một câu nói về token, không hề nói về chứng chỉ. Mọi tool Jira/Confluence đều lỗi.
   *
   * Cờ này KHÔNG ảnh hưởng chặng Nexa → gateway: chặng đó luôn là HTTPS có xác thực chứng chỉ
   * và không có cờ nào tắt được (`McpHttpClient`). Phạm vi rủi ro vì thế giới hạn ở một chặng
   * trong mạng nội bộ, và cách sửa ĐÚNG vẫn là cài CA nội bộ vào container gateway
   * (`REQUESTS_CA_BUNDLE`/`SSL_CERT_FILE`) rồi tắt cờ này đi.
   */
  mcpGatewaySkipAtlassianTlsVerify: z.boolean().default(false),
  features: featureFlagsSchema.default({}),
})
export type AppSettings = z.infer<typeof appSettingsSchema>

export const DEFAULT_APP_SETTINGS: AppSettings = appSettingsSchema.parse({})

/**
 * Policy do IT ghi đè lúc phân phối (resources/policy.json), người dùng KHÔNG sửa được.
 * Xem OPEN-QUESTIONS D2: đề nghị ATTT bắt buộc điền `allowedDomains`.
 */
export const orgPolicySchema = z.object({
  /** IT có thể tắt hoàn toàn provider OpenAI gọi trực tiếp, kể cả với cấu hình đã lưu từ trước. */
  allowDirectOpenAi: z.boolean().default(true),
  /**
   * Allowlist domain cho mọi kết nối ra ngoài (§5.3, §11.2).
   * Rỗng = không giới hạn (fail-open có chủ ý — xem D2).
   * Hỗ trợ wildcard một cấp: "*.corp.local".
   */
  allowedDomains: z.array(z.string()).default([]),
  /** Khoá không cho người dùng đổi các flag này. */
  lockedFeatures: z.array(z.string()).default([]),
  /** Ghi đè cứng feature flag, thắng cả cấu hình người dùng. */
  forcedFeatures: featureFlagsSchema.partial().default({}),
  /** URL version manifest cho update service. */
  updateManifestUrl: z.string().url().optional(),
  /** Trần retention do tổ chức áp; cấu hình người dùng không được vượt. */
  maxHistoryRetentionDays: z.number().int().min(0).optional(),
})
export type OrgPolicy = z.infer<typeof orgPolicySchema>

export const DEFAULT_ORG_POLICY: OrgPolicy = orgPolicySchema.parse({})

/**
 * Cấu hình MCP Atlassian. Command cấu hình được để đổi package không phải sửa code
 * (OPEN-QUESTIONS A4 — package cụ thể CHƯA được chốt).
 */
export const mcpServerSpecSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  /**
   * Biến môi trường tĩnh. Credential KHÔNG nằm ở đây — được main process tiêm
   * lúc spawn, sau khi giải mã (§4.2).
   */
  env: z.record(z.string()).default({}),
  /** Thư mục làm việc của child process. */
  cwd: z.string().optional(),
  startupTimeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
})
export type McpServerSpec = z.infer<typeof mcpServerSpecSchema>
