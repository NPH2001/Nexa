/**
 * Mã lỗi ổn định (§9.3: "Error code ổn định để UI có thể hiển thị hướng dẫn phù hợp").
 *
 * Nhóm A = đúng theo Phụ lục B của tài liệu thiết kế.
 * Nhóm B = bổ sung; tài liệu không liệt kê nhưng luồng nghiệp vụ trong §10/§16 cần tới.
 *          Xem docs/OPEN-QUESTIONS.md nếu muốn gộp lại.
 */
export const ERROR_CODES = {
  // ── Nhóm A: Phụ lục B ───────────────────────────────────────────────────
  LITELLM_CONFIG_REQUIRED: 'LITELLM_CONFIG_REQUIRED',
  LITELLM_AUTH_FAILED: 'LITELLM_AUTH_FAILED',
  MODEL_NOT_CONFIGURED: 'MODEL_NOT_CONFIGURED',
  LLM_TIMEOUT: 'LLM_TIMEOUT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_UNSUPPORTED: 'FILE_UNSUPPORTED',
  ATLASSIAN_CONFIG_REQUIRED: 'ATLASSIAN_CONFIG_REQUIRED',
  ATLASSIAN_AUTH_FAILED: 'ATLASSIAN_AUTH_FAILED',
  TOOL_APPROVAL_REQUIRED: 'TOOL_APPROVAL_REQUIRED',
  TOOL_EXECUTION_UNCERTAIN: 'TOOL_EXECUTION_UNCERTAIN',
  LOCAL_DB_LOCKED: 'LOCAL_DB_LOCKED',
  MCP_SERVER_UNAVAILABLE: 'MCP_SERVER_UNAVAILABLE',

  // ── Nhóm B: bổ sung ─────────────────────────────────────────────────────
  /** Key hợp lệ nhưng vượt hạn mức LiteLLM (§11.2). */
  LITELLM_RATE_LIMITED: 'LITELLM_RATE_LIMITED',
  /** Người dùng bấm huỷ khi đang streaming (§2.1). Không phải lỗi thật. */
  LLM_CANCELLED: 'LLM_CANCELLED',
  /** LiteLLM/MCP trả lỗi mạng hoặc 5xx. */
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  /** URL không phải HTTPS, hostname không hợp lệ, hoặc nhúng credential (§11.2). */
  INVALID_URL: 'INVALID_URL',
  /** URL không nằm trong allowlist domain của tổ chức (§11.2). */
  DOMAIN_NOT_ALLOWED: 'DOMAIN_NOT_ALLOWED',
  /** Secure storage không giải mã được secret → fail closed (§3). */
  SECRET_UNAVAILABLE: 'SECRET_UNAVAILABLE',
  /** Tool không nằm trong allowlist cục bộ hoặc bị feature flag tắt (§10.1). */
  TOOL_NOT_ALLOWED: 'TOOL_NOT_ALLOWED',
  /** Approval đã hết hạn (§10.2 "approval có thời hạn ngắn"). */
  TOOL_APPROVAL_EXPIRED: 'TOOL_APPROVAL_EXPIRED',
  /** Payload đổi sau preview ⇒ approval vô hiệu (§17.2 kịch bản 3). */
  TOOL_PAYLOAD_MISMATCH: 'TOOL_PAYLOAD_MISMATCH',
  /** Double-submit bị chặn bởi operation lock (§17.2 kịch bản 4). */
  OPERATION_ALREADY_RUNNING: 'OPERATION_ALREADY_RUNNING',
  /** Agent vượt số vòng tool-calling tối đa. Xem OPEN-QUESTIONS B3. */
  MAX_TOOL_ITERATIONS: 'MAX_TOOL_ITERATIONS',
  /** Vượt số file cho phép mỗi request. */
  TOO_MANY_FILES: 'TOO_MANY_FILES',
  /** Trích xuất được nhưng nội dung rỗng/hỏng. */
  DOCUMENT_EXTRACTION_FAILED: 'DOCUMENT_EXTRACTION_FAILED',
  /** Model không nằm trong allowlist nhận tài liệu nội bộ. Xem OPEN-QUESTIONS A5. */
  MODEL_NOT_ALLOWED_FOR_DOCUMENTS: 'MODEL_NOT_ALLOWED_FOR_DOCUMENTS',
  /** IPC payload không khớp schema Zod (§5.3). */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** Lỗi không phân loại được. Không bao giờ chứa chi tiết nhạy cảm. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/** Thông điệp tiếng Việt hiển thị cho người dùng + có retry được không (Phụ lục B). */
interface ErrorMeta {
  readonly message: string
  readonly retryable: boolean
  /** Gợi ý hành động cụ thể cho người dùng, hiện dưới message trong UI. */
  readonly hint?: string
}

export const ERROR_CATALOG: Readonly<Record<ErrorCode, ErrorMeta>> = {
  LITELLM_CONFIG_REQUIRED: {
    message: 'Chưa cấu hình endpoint hoặc API key LiteLLM.',
    retryable: false,
    hint: 'Mở Cài đặt → LiteLLM để nhập endpoint và API key.',
  },
  LITELLM_AUTH_FAILED: {
    message: 'LiteLLM API key không hợp lệ hoặc đã bị thu hồi.',
    retryable: false,
    hint: 'Liên hệ quản trị LiteLLM để cấp key mới, rồi cập nhật trong Cài đặt.',
  },
  MODEL_NOT_CONFIGURED: {
    message: 'Model chưa được thêm vào danh sách cục bộ.',
    retryable: false,
    hint: 'Mở Cài đặt → Model để thêm model id.',
  },
  LLM_TIMEOUT: {
    message: 'Model phản hồi quá thời gian cho phép.',
    retryable: true,
    hint: 'Thử lại, hoặc rút ngắn nội dung gửi đi.',
  },
  FILE_TOO_LARGE: { message: 'File vượt quá giới hạn kích thước.', retryable: false },
  FILE_UNSUPPORTED: {
    message: 'Loại file không được hỗ trợ.',
    retryable: false,
    hint: 'MVP chỉ hỗ trợ TXT, Markdown, PDF và DOCX.',
  },
  ATLASSIAN_CONFIG_REQUIRED: {
    message: 'Chưa cấu hình kết nối Jira/Confluence.',
    retryable: false,
    hint: 'Mở Cài đặt → Jira hoặc Confluence để nhập URL, tên đăng nhập và PAT.',
  },
  ATLASSIAN_AUTH_FAILED: {
    message: 'Tên đăng nhập hoặc PAT không hợp lệ, hoặc tài khoản thiếu quyền.',
    retryable: false,
    hint: 'Kiểm tra lại PAT còn hiệu lực và tài khoản có quyền với dự án/space tương ứng.',
  },
  TOOL_APPROVAL_REQUIRED: {
    message: 'Thao tác này cần bạn xác nhận trước khi thực hiện.',
    retryable: false,
  },
  TOOL_EXECUTION_UNCERTAIN: {
    message: 'Không xác định được thao tác đã hoàn tất hay chưa.',
    retryable: false,
    hint: 'Bấm "Kiểm tra kết quả" để Nexa tra cứu tại hệ thống đích trước khi thử lại.',
  },
  LOCAL_DB_LOCKED: {
    message: 'Không mở được cơ sở dữ liệu cục bộ.',
    retryable: true,
    hint: 'Đóng các phiên bản Nexa khác đang chạy rồi thử lại.',
  },
  MCP_SERVER_UNAVAILABLE: {
    message: 'Không khởi động hoặc kết nối được MCP Atlassian.',
    retryable: true,
    hint: 'Kiểm tra cấu hình MCP trong Cài đặt, sau đó bấm Kiểm tra kết nối.',
  },

  LITELLM_RATE_LIMITED: {
    message: 'API key đã vượt hạn mức tại LiteLLM.',
    retryable: true,
    hint: 'Chờ hạn mức được đặt lại, hoặc liên hệ quản trị LiteLLM để nâng quota.',
  },
  LLM_CANCELLED: { message: 'Đã huỷ yêu cầu.', retryable: true },
  UPSTREAM_UNAVAILABLE: {
    message: 'Không kết nối được tới dịch vụ.',
    retryable: true,
    hint: 'Kiểm tra kết nối mạng nội bộ.',
  },
  INVALID_URL: {
    message: 'URL không hợp lệ.',
    retryable: false,
    hint: 'Chỉ chấp nhận địa chỉ HTTPS, không được nhúng tên đăng nhập/mật khẩu trong URL.',
  },
  DOMAIN_NOT_ALLOWED: {
    message: 'Tên miền này không nằm trong danh sách được tổ chức cho phép.',
    retryable: false,
    hint: 'Liên hệ bộ phận an toàn thông tin nếu bạn cho rằng đây là địa chỉ hợp lệ.',
  },
  SECRET_UNAVAILABLE: {
    message: 'Không đọc được thông tin đăng nhập đã lưu.',
    retryable: false,
    hint: 'Nhập lại API key/PAT trong Cài đặt. Dữ liệu cũ có thể đã hỏng hoặc thuộc tài khoản Windows khác.',
  },
  TOOL_NOT_ALLOWED: {
    message: 'Công cụ này chưa được bật trong cấu hình.',
    retryable: false,
  },
  TOOL_APPROVAL_EXPIRED: {
    message: 'Xác nhận đã hết hạn.',
    retryable: false,
    hint: 'Hãy thực hiện lại thao tác và xác nhận trong thời gian quy định.',
  },
  TOOL_PAYLOAD_MISMATCH: {
    message: 'Nội dung thao tác đã thay đổi sau khi bạn xem trước.',
    retryable: false,
    hint: 'Xác nhận đã bị vô hiệu vì lý do an toàn. Hãy xem trước lại từ đầu.',
  },
  OPERATION_ALREADY_RUNNING: {
    message: 'Thao tác này đang được thực hiện.',
    retryable: false,
  },
  MAX_TOOL_ITERATIONS: {
    message: 'Đã vượt số bước công cụ tối đa cho một lượt trả lời.',
    retryable: false,
    hint: 'Hãy chia nhỏ yêu cầu thành các bước cụ thể hơn.',
  },
  TOO_MANY_FILES: { message: 'Vượt quá số lượng file cho phép mỗi lần gửi.', retryable: false },
  DOCUMENT_EXTRACTION_FAILED: {
    message: 'Không trích xuất được nội dung từ file.',
    retryable: false,
    hint: 'File có thể bị hỏng, được bảo vệ bằng mật khẩu, hoặc là bản scan không có lớp văn bản.',
  },
  MODEL_NOT_ALLOWED_FOR_DOCUMENTS: {
    message: 'Model đang chọn không được phép nhận tài liệu nội bộ.',
    retryable: false,
    hint: 'Chọn model khác trong danh sách được tổ chức cho phép.',
  },
  VALIDATION_FAILED: { message: 'Dữ liệu gửi lên không hợp lệ.', retryable: false },
  INTERNAL_ERROR: {
    message: 'Đã xảy ra lỗi không mong muốn.',
    retryable: true,
    hint: 'Nếu lỗi lặp lại, hãy gửi mã yêu cầu kèm báo cáo cho bộ phận hỗ trợ.',
  },
}

/**
 * Lỗi chuẩn hoá của Nexa.
 *
 * `cause` chỉ dùng nội bộ và KHÔNG bao giờ được serialize ra renderer hay log —
 * upstream error có thể chứa URL kèm token hoặc echo lại payload (§11.1).
 */
export class NexaError extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean
  readonly hint?: string
  readonly requestId?: string
  readonly operationId?: string
  /** Chi tiết an toàn để hiển thị: đã được người gọi tự kiểm tra là không chứa secret. */
  readonly safeDetail?: string

  constructor(
    code: ErrorCode,
    options: {
      requestId?: string
      operationId?: string
      safeDetail?: string
      cause?: unknown
      /** Ghi đè retryable mặc định của catalog (ví dụ 429 có Retry-After). */
      retryable?: boolean
    } = {},
  ) {
    const meta = ERROR_CATALOG[code]
    super(meta.message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'NexaError'
    this.code = code
    this.retryable = options.retryable ?? meta.retryable
    if (meta.hint !== undefined) this.hint = meta.hint
    if (options.requestId !== undefined) this.requestId = options.requestId
    if (options.operationId !== undefined) this.operationId = options.operationId
    if (options.safeDetail !== undefined) this.safeDetail = options.safeDetail
  }

  static is(value: unknown): value is NexaError {
    return value instanceof NexaError
  }

  /** Bọc lỗi lạ thành NexaError mà không để lộ nội dung gốc ra ngoài. */
  static wrap(value: unknown, fallback: ErrorCode = ERROR_CODES.INTERNAL_ERROR): NexaError {
    if (NexaError.is(value)) return value
    return new NexaError(fallback, { cause: value })
  }
}
