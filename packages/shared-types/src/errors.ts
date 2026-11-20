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
  /** Chưa cấu hình endpoint/token của MCP gateway remote (ADR-0005). */
  MCP_GATEWAY_CONFIG_REQUIRED: 'MCP_GATEWAY_CONFIG_REQUIRED',
  /** Gateway từ chối bearer token, hoặc token đã bị thu hồi. */
  MCP_GATEWAY_AUTH_FAILED: 'MCP_GATEWAY_AUTH_FAILED',
  /**
   * Redmine đi qua MCP Gateway (ADR 0010): bật Redmine mà gateway chưa bật hoặc chưa có token thì
   * không có đường nào để gọi. Mã riêng để UI chỉ đúng chỗ cần sửa — mục MCP Gateway, không phải
   * mục Redmine.
   */
  REDMINE_GATEWAY_REQUIRED: 'REDMINE_GATEWAY_REQUIRED',
  /** Chưa cấu hình kết nối Redmine (URL web + API key). */
  REDMINE_CONFIG_REQUIRED: 'REDMINE_CONFIG_REQUIRED',
  /** Chưa cấu hình kết nối XWiki (URL endpoint MCP + token). */
  XWIKI_CONFIG_REQUIRED: 'XWIKI_CONFIG_REQUIRED',
  /** Gateway chấp nhận bearer token nhưng Redmine từ chối API key. */
  REDMINE_AUTH_FAILED: 'REDMINE_AUTH_FAILED',
  /** Endpoint MCP XWiki từ chối bearer token (HTTP 401). */
  XWIKI_AUTH_FAILED: 'XWIKI_AUTH_FAILED',
  /**
   * Trang XWiki đã đổi phiên bản kể từ lúc Nexa đọc để dựng preview (lệch `base_version`). Mã
   * riêng vì đây là cơ chế an toàn đang chạy đúng, không phải lỗi mạng — gộp vào
   * UPSTREAM_UNAVAILABLE sẽ khuyên người dùng "kiểm tra mạng" trong khi việc cần làm là đọc lại.
   */
  XWIKI_VERSION_CONFLICT: 'XWIKI_VERSION_CONFLICT',
  /** Key hợp lệ nhưng vượt hạn mức LiteLLM (§11.2). */
  LITELLM_RATE_LIMITED: 'LITELLM_RATE_LIMITED',
  /**
   * Chưa cấu hình kết nối OpenAI. Mã riêng thay vì dùng lại LITELLM_* để thông báo lỗi nói
   * đúng nơi người dùng cần vào sửa — hai kết nối này độc lập nhau.
   */
  OPENAI_CONFIG_REQUIRED: 'OPENAI_CONFIG_REQUIRED',
  OPENAI_AUTH_FAILED: 'OPENAI_AUTH_FAILED',
  OPENAI_RATE_LIMITED: 'OPENAI_RATE_LIMITED',
  CHATGPT_APP_SERVER_UNAVAILABLE: 'CHATGPT_APP_SERVER_UNAVAILABLE',
  CHATGPT_MODEL_CATALOG_UNAVAILABLE: 'CHATGPT_MODEL_CATALOG_UNAVAILABLE',
  CHATGPT_AUTH_FAILED: 'CHATGPT_AUTH_FAILED',
  CHATGPT_LOGIN_TIMEOUT: 'CHATGPT_LOGIN_TIMEOUT',
  CHATGPT_AUTH_REQUIRED: 'CHATGPT_AUTH_REQUIRED',
  CHATGPT_MODEL_UNAVAILABLE: 'CHATGPT_MODEL_UNAVAILABLE',
  CHATGPT_RATE_LIMITED: 'CHATGPT_RATE_LIMITED',
  CHATGPT_TURN_FAILED: 'CHATGPT_TURN_FAILED',
  PROVIDER_DISABLED_BY_POLICY: 'PROVIDER_DISABLED_BY_POLICY',
  /** Người dùng bấm huỷ khi đang streaming (§2.1). Không phải lỗi thật. */
  LLM_CANCELLED: 'LLM_CANCELLED',
  /** LiteLLM/MCP trả lỗi mạng hoặc 5xx. */
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  /**
   * Gateway từ chối vì body quá lớn (HTTP 413) — gần như luôn là ảnh đính kèm.
   *
   * Tách khỏi `UPSTREAM_UNAVAILABLE` vì hai mã này đẩy người dùng đi hai hướng trái ngược: mã kia
   * nói "kiểm tra kết nối mạng", còn nguyên nhân thật ở đây là mạng vẫn tốt và chính yêu cầu quá
   * lớn. Ảnh đi lên dạng base64 nên cộng thêm ~33%, và nhiều proxy chặn ở 1–10 MB.
   */
  UPSTREAM_PAYLOAD_TOO_LARGE: 'UPSTREAM_PAYLOAD_TOO_LARGE',
  /**
   * Gateway nhận được yêu cầu, nhưng nhà cung cấp model ĐỨNG SAU nó báo lỗi hoặc quá tải.
   *
   * Tách khỏi `UPSTREAM_UNAVAILABLE` vì cùng một lý do đã tách `UPSTREAM_PAYLOAD_TOO_LARGE`: mã kia
   * bảo người dùng "kiểm tra kết nối mạng nội bộ", mà ở đây mạng chắc chắn tốt — lỗi này chỉ tới
   * được khi kết nối đã mở, đã gửi xong yêu cầu và gateway đã bắt đầu trả dòng SSE. Bảo người dùng
   * đi kiểm tra mạng khi mạng đang chạy là đẩy họ đi sai hướng hoàn toàn.
   *
   * Retry được, khác `UPSTREAM_PAYLOAD_TOO_LARGE`: quá tải và lỗi tạm của nhà cung cấp thường tự
   * hết, còn một body quá lớn thì gửi lại bao nhiêu lần cũng vẫn quá lớn.
   */
  UPSTREAM_PROVIDER_FAILED: 'UPSTREAM_PROVIDER_FAILED',
  /**
   * Gateway báo nội dung vượt cửa sổ ngữ cảnh của model.
   *
   * Khác `IMAGE_EXCEEDS_CONTEXT`: mã đó là phép kiểm CỦA NEXA trước khi gửi, còn mã này là phán
   * quyết của gateway sau khi đã gửi — thường vì phần văn bản, hoặc vì cách nhà cung cấp tính
   * token cho ảnh khác với ước lượng heuristic của Nexa.
   */
  CONTEXT_LENGTH_EXCEEDED: 'CONTEXT_LENGTH_EXCEEDED',
  /** Gateway nhận request nhưng từ chối chính ảnh: không tải/giải mã được, hoặc sai định dạng. */
  IMAGE_REJECTED_BY_UPSTREAM: 'IMAGE_REJECTED_BY_UPSTREAM',
  /** Bộ lọc nội dung của nhà cung cấp chặn lượt này. Không phải lỗi kỹ thuật, không retry. */
  CONTENT_FILTERED: 'CONTENT_FILTERED',
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
  /**
   * Model thuộc provider NGOÀI tổ chức và chưa được cho phép nhận tài liệu.
   * Đây là fail-closed có chủ ý — xem OPEN-QUESTIONS F1.
   */
  EXTERNAL_MODEL_NOT_ALLOWED_FOR_DOCUMENTS: 'EXTERNAL_MODEL_NOT_ALLOWED_FOR_DOCUMENTS',
  /**
   * Model đang chọn không đọc được ảnh.
   *
   * Tách khỏi allowlist tài liệu vì đây là chuyện NĂNG LỰC, không phải chuyện quyền: gửi ảnh
   * cho một model chỉ đọc chữ thì hoặc gateway trả 400, hoặc tệ hơn — nó âm thầm bỏ ảnh đi và
   * trả lời như thể đã xem, mà người dùng không hề biết.
   */
  MODEL_DOES_NOT_SUPPORT_IMAGES: 'MODEL_DOES_NOT_SUPPORT_IMAGES',
  /**
   * Ảnh không vừa cửa sổ ngữ cảnh của model.
   *
   * Văn bản rút gọn được, ảnh thì không — hoặc gửi cả tấm hoặc không gửi. Vì vậy đây là LỖI
   * chứ không phải một lần cắt bớt im lặng: người dùng phải biết ảnh đã không tới được model.
   */
  IMAGE_EXCEEDS_CONTEXT: 'IMAGE_EXCEEDS_CONTEXT',
  /**
   * Luồng này cần tài liệu CÓ VĂN BẢN, và người dùng đưa vào một tấm ảnh.
   *
   * Tách khỏi `FILE_UNSUPPORTED` vì hai chuyện khác nhau: file không hỏng, và Nexa nói chung
   * vẫn nhận ảnh — chỉ riêng đường nghiệp vụ thì chưa. Dùng chung mã sẽ khiến người dùng đi
   * kiểm tra file thay vì hiểu ra giới hạn thật.
   */
  DOCUMENT_REQUIRES_TEXT: 'DOCUMENT_REQUIRES_TEXT',
  /**
   * Ghi file xuống ổ đĩa thất bại: hết dung lượng, không có quyền, hoặc file đang bị ứng dụng
   * khác giữ.
   *
   * Tách khỏi `INTERNAL_ERROR` vì đây là loại lỗi người dùng tự xử lý được — chọn thư mục khác
   * hoặc đóng ứng dụng đang mở file — còn `INTERNAL_ERROR` thì không nói được điều gì hữu ích.
   */
  FILE_WRITE_FAILED: 'FILE_WRITE_FAILED',
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
    hint: 'Hỗ trợ TXT, Markdown, CSV, PDF, Word (.doc/.docx), Excel (.xls/.xlsx), PowerPoint (.ppt/.pptx) và ảnh PNG/JPEG/WebP/GIF.',
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

  MCP_GATEWAY_CONFIG_REQUIRED: {
    message: 'Chưa cấu hình MCP Gateway cho Jira/Confluence.',
    retryable: false,
    hint: 'Mở Cài đặt → MCP Gateway để nhập URL và bearer token do tổ chức cấp.',
  },
  MCP_GATEWAY_AUTH_FAILED: {
    message: 'Bearer token của MCP Gateway không hợp lệ hoặc đã bị thu hồi.',
    retryable: false,
    hint: 'Liên hệ quản trị gateway để cấp token mới, rồi cập nhật trong Cài đặt.',
  },
  REDMINE_GATEWAY_REQUIRED: {
    message: 'Redmine cần MCP Gateway, nhưng MCP Gateway chưa được bật hoặc chưa có token.',
    retryable: false,
    hint: 'Mở Cài đặt → MCP Gateway để nhập URL và bearer token, rồi kiểm tra lại Redmine.',
  },
  REDMINE_CONFIG_REQUIRED: {
    message: 'Chưa cấu hình kết nối Redmine.',
    retryable: false,
    hint: 'Mở Cài đặt → Redmine để nhập URL Redmine và API key.',
  },
  XWIKI_CONFIG_REQUIRED: {
    message: 'Chưa cấu hình kết nối XWiki.',
    retryable: false,
    hint: 'Mở Cài đặt → XWiki để nhập URL endpoint MCP và token.',
  },
  REDMINE_AUTH_FAILED: {
    message: 'Redmine từ chối API key, hoặc tài khoản thiếu quyền.',
    retryable: false,
    hint: 'Lấy lại API key ở Redmine → Tài khoản của tôi → API access key, rồi cập nhật trong Cài đặt.',
  },
  XWIKI_VERSION_CONFLICT: {
    message:
      'Trang XWiki đã được sửa sau khi bạn xem bản xem trước, nên Nexa không ghi đè thay đổi đó.',
    retryable: false,
    hint: 'Yêu cầu lại để Nexa đọc phiên bản mới nhất của trang rồi đề xuất lại.',
  },
  XWIKI_AUTH_FAILED: {
    message: 'XWiki từ chối token, hoặc token đã hết hạn.',
    retryable: false,
    hint: 'Tạo token mới trong XWiki rồi cập nhật ở Cài đặt → XWiki.',
  },

  LITELLM_RATE_LIMITED: {
    message: 'API key đã vượt hạn mức tại LiteLLM.',
    retryable: true,
    hint: 'Chờ hạn mức được đặt lại, hoặc liên hệ quản trị LiteLLM để nâng quota.',
  },
  OPENAI_CONFIG_REQUIRED: {
    message: 'Chưa cấu hình endpoint hoặc API key OpenAI.',
    retryable: false,
    hint: 'Mở Cài đặt → OpenAI để nhập API key.',
  },
  OPENAI_AUTH_FAILED: {
    message: 'API key OpenAI không hợp lệ hoặc đã bị thu hồi.',
    retryable: false,
    hint: 'Kiểm tra lại key tại nền tảng OpenAI, rồi cập nhật trong Cài đặt.',
  },
  OPENAI_RATE_LIMITED: {
    message: 'Đã vượt hạn mức của OpenAI.',
    retryable: true,
    hint: 'Chờ hạn mức được đặt lại, hoặc kiểm tra hạn mức của tài khoản OpenAI.',
  },
  CHATGPT_APP_SERVER_UNAVAILABLE: {
    message: 'Không khởi động được dịch vụ đăng nhập Codex trên máy.',
    retryable: true,
    hint: 'Cài hoặc cập nhật Codex CLI, rồi mở lại Nexa và thử đăng nhập lần nữa.',
  },
  CHATGPT_MODEL_CATALOG_UNAVAILABLE: {
    message: 'Không tải được danh sách model Codex của tài khoản ChatGPT.',
    retryable: true,
    hint: 'Cập nhật Codex CLI lên bản mới nhất, rồi bấm Làm mới tài khoản và model.',
  },
  CHATGPT_AUTH_FAILED: {
    message: 'Không đăng nhập được bằng tài khoản ChatGPT.',
    retryable: true,
    hint: 'Thử lại và hoàn tất bước xác nhận trong cửa sổ trình duyệt.',
  },
  CHATGPT_LOGIN_TIMEOUT: {
    message: 'Phiên đăng nhập ChatGPT đã hết thời gian chờ.',
    retryable: true,
    hint: 'Bắt đầu đăng nhập lại và hoàn tất trong cửa sổ trình duyệt.',
  },
  CHATGPT_AUTH_REQUIRED: {
    message: 'Cần đăng nhập ChatGPT trước khi dùng model Codex.',
    retryable: false,
    hint: 'Mở Cài đặt → OpenAI và đăng nhập bằng ChatGPT.',
  },
  CHATGPT_MODEL_UNAVAILABLE: {
    message: 'Model Codex đã chọn hiện không còn khả dụng cho tài khoản này.',
    retryable: false,
    hint: 'Làm mới danh sách model rồi chọn một model Codex khác.',
  },
  CHATGPT_RATE_LIMITED: {
    message: 'Tài khoản ChatGPT đã chạm hạn mức Codex.',
    retryable: true,
    hint: 'Chờ hạn mức được đặt lại hoặc chọn một provider khác.',
  },
  CHATGPT_TURN_FAILED: {
    message: 'Codex không hoàn tất được lượt trả lời.',
    retryable: true,
    hint: 'Thử lại; nếu lỗi lặp lại, làm mới tài khoản và danh sách model trong Cài đặt → OpenAI.',
  },
  PROVIDER_DISABLED_BY_POLICY: {
    message: 'Provider này đã bị chính sách của tổ chức vô hiệu hoá.',
    retryable: false,
    hint: 'Dùng model nội bộ qua LiteLLM hoặc liên hệ bộ phận IT nếu cần quyền truy cập.',
  },
  LLM_CANCELLED: { message: 'Đã huỷ yêu cầu.', retryable: true },
  UPSTREAM_UNAVAILABLE: {
    message: 'Không kết nối được tới dịch vụ.',
    retryable: true,
    hint: 'Kiểm tra kết nối mạng nội bộ.',
  },
  UPSTREAM_PAYLOAD_TOO_LARGE: {
    message: 'Yêu cầu quá lớn so với giới hạn của gateway.',
    // Gửi lại y nguyên sẽ lỗi y nguyên: phải bớt đính kèm hoặc nâng giới hạn phía gateway.
    retryable: false,
    hint: 'Ảnh đính kèm là nguyên nhân thường gặp nhất. Hãy dùng ảnh nhỏ hơn, bớt số file trong một lượt, hạ "Dung lượng ảnh tối đa" trong Cài đặt, hoặc nhờ quản trị LiteLLM nâng giới hạn body.',
  },
  UPSTREAM_PROVIDER_FAILED: {
    message: 'Dịch vụ model phía sau gateway đang lỗi hoặc quá tải.',
    retryable: true,
    // Không nhắc tới mạng: yêu cầu đã đi tới nơi và gateway đã trả lời, nên mạng không phải nghi
    // phạm. Gợi ý cuối là đường đi tiếp khi lỗi lặp lại — Nexa cố ý không ghi lại câu lỗi của
    // gateway (§11.1), nên đối chiếu mã yêu cầu với log LiteLLM là cách duy nhất biết thêm (§15.2).
    hint: 'Kết nối vẫn tốt — lỗi đến từ phía sau gateway. Nếu bạn vừa yêu cầu một câu trả lời dài (sơ đồ, tài liệu, file), hãy thử chia nhỏ yêu cầu: lượt càng dài càng dễ bị cắt giữa đường. Nếu lặp lại, gửi mã yêu cầu cho quản trị LiteLLM để đối chiếu log.',
  },
  CONTEXT_LENGTH_EXCEEDED: {
    message: 'Nội dung gửi lên vượt cửa sổ ngữ cảnh của model.',
    retryable: false,
    hint: 'Bớt tài liệu hoặc ảnh đính kèm, chia câu hỏi thành nhiều lượt, hoặc chọn model có cửa sổ ngữ cảnh lớn hơn.',
  },
  IMAGE_REJECTED_BY_UPSTREAM: {
    message: 'Gateway không đọc được ảnh đính kèm.',
    retryable: false,
    hint: 'Thử ảnh PNG hoặc JPEG khác, hoặc ảnh có dung lượng nhỏ hơn.',
  },
  CONTENT_FILTERED: {
    message: 'Nhà cung cấp đã chặn nội dung của lượt này.',
    retryable: false,
    hint: 'Diễn đạt lại câu hỏi, hoặc bỏ phần nội dung mà bộ lọc có thể đang chặn.',
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
  EXTERNAL_MODEL_NOT_ALLOWED_FOR_DOCUMENTS: {
    message: 'Không thể gửi tài liệu tới một model bên ngoài tổ chức.',
    retryable: false,
    hint: 'Hãy chọn một model chạy qua LiteLLM nội bộ. Nếu bạn thực sự cần gửi tài liệu ra ngoài, bộ phận an toàn thông tin phải cho phép model đó trước.',
  },
  MODEL_DOES_NOT_SUPPORT_IMAGES: {
    message: 'Model đang chọn không đọc được ảnh.',
    retryable: false,
    hint: 'Chọn một model có đánh dấu "đọc được ảnh" trong Cài đặt → Model, hoặc bỏ ảnh khỏi lượt gửi này.',
  },
  IMAGE_EXCEEDS_CONTEXT: {
    message: 'Ảnh đính kèm không vừa cửa sổ ngữ cảnh của model.',
    retryable: false,
    hint: 'Bớt file đính kèm, bắt đầu một hội thoại mới, hoặc chọn model có cửa sổ ngữ cảnh lớn hơn.',
  },
  DOCUMENT_REQUIRES_TEXT: {
    message: 'Chức năng này cần một tài liệu có văn bản.',
    retryable: false,
    hint: 'Ảnh và bản scan chưa dùng được ở Không gian Nghiệp vụ. Hãy chọn file Word, Excel, PowerPoint, PDF có lớp văn bản hoặc TXT.',
  },
  FILE_WRITE_FAILED: {
    message: 'Không ghi được file xuống ổ đĩa.',
    retryable: true,
    hint: 'Chọn thư mục khác, hoặc đóng ứng dụng đang mở file này rồi thử lại.',
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

/** Câu báo lỗi cho người dùng: thông điệp, gợi ý và mã lỗi để họ chép lại khi báo cáo. */
export function formatNexaErrorMessage(error: NexaError): string {
  const hint = error.hint === undefined ? '' : ` ${error.hint}`
  return `Mình chưa thể hoàn tất yêu cầu này. ${error.message}${hint} (Mã lỗi: ${error.code})`
}
