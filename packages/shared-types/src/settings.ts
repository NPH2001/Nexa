import { z } from 'zod'

/**
 * Feature flag cục bộ cho tool/write action (§13.1).
 * Mặc định theo Phụ lục A và khuyến nghị §22.3: Confluence write TẮT trong MVP.
 */
export const featureFlagsSchema = z.object({
  jiraRead: z.boolean().default(true),
  jiraSearch: z.boolean().default(true),
  jiraCreate: z.boolean().default(true),
  jiraComment: z.boolean().default(false),
  /** WRITE_HIGH — §10.1 cho phép tắt khỏi MVP. */
  jiraUpdate: z.boolean().default(false),
  confluenceRead: z.boolean().default(true),
  confluenceSearch: z.boolean().default(true),
  /**
   * §22.3: ngoài MVP.
   *
   * ⚠️ HIỆN CHƯA CÓ TOOL NÀO dùng cờ này — không tool Confluence write nào được đăng ký trong
   * `tool-registry.ts`. Bật nó lên KHÔNG có tác dụng gì. Cờ tồn tại để Phụ lục A khớp và để
   * chỗ cắm sẵn khi Confluence write vào phạm vi. Xem OPEN-QUESTIONS A6.
   */
  confluenceWrite: z.boolean().default(false),
  /** §22.2 A8: mặc định tắt, để IT phân phối tập trung. */
  autoUpdate: z.boolean().default(false),
  /** §8.3: có lưu text đã trích xuất từ file vào DB (đã mã hoá) hay không. */
  storeExtractedText: z.boolean().default(true),
  /** OPEN-QUESTIONS A7: cho phép người dùng tắt lưu lịch sử. */
  storeHistory: z.boolean().default(true),
})
export type FeatureFlags = z.infer<typeof featureFlagsSchema>

export const RETENTION_CHOICES = [30, 90, 180, 0] as const // 0 = không tự xoá

export const appSettingsSchema = z.object({
  /** §14: giới hạn MVP 20–30 MB/file. Phụ lục A chốt 30. */
  maxFileSizeMb: z.number().int().min(1).max(100).default(30),
  maxFilesPerRequest: z.number().int().min(1).max(20).default(5),
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
  features: featureFlagsSchema.default({}),
})
export type AppSettings = z.infer<typeof appSettingsSchema>

export const DEFAULT_APP_SETTINGS: AppSettings = appSettingsSchema.parse({})

/**
 * Policy do IT ghi đè lúc phân phối (resources/policy.json), người dùng KHÔNG sửa được.
 * Xem OPEN-QUESTIONS D2: đề nghị ATTT bắt buộc điền `allowedDomains`.
 */
export const orgPolicySchema = z.object({
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
