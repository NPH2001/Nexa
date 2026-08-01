/** §14 — chỉ TXT/Markdown, PDF, DOCX. Mọi thứ khác bị từ chối. */
export const SUPPORTED_KINDS = ['txt', 'markdown', 'pdf', 'docx'] as const
export type DocumentKind = (typeof SUPPORTED_KINDS)[number]

export interface FileDescriptor {
  /** Đường dẫn thật. CHỈ tồn tại trong main process — không bao giờ đi qua IPC (§5.3). */
  readonly path: string
  readonly fileName: string
  readonly sizeBytes: number
}

export interface ExtractionRequest {
  readonly path: string
  readonly kind: DocumentKind
  /** Cắt cứng để một file bất thường không ngốn hết RAM (§12 ngân sách bộ nhớ). */
  readonly maxChars: number
}

export interface ExtractionResult {
  readonly text: string
  readonly pageCount?: number
  /**
   * PDF không có lớp văn bản — nhiều khả năng là bản scan. §14: "cảnh báo PDF scan",
   * và §2.2 nói OCR nằm ngoài phạm vi MVP.
   */
  readonly suspectedScan?: boolean
  /** true nếu văn bản bị cắt vì chạm `maxChars`. */
  readonly truncated: boolean
}

/**
 * §14.1: "Trích xuất văn bản trong worker/process riêng để tránh khóa UI."
 *
 * Chiến lược được tiêm vào để package này không phụ thuộc vào cách app dựng worker:
 *  - `InlineRunner` chạy ngay trong tiến trình gọi — dùng cho unit test.
 *  - `WorkerThreadRunner` đẩy sang worker_threads — dùng trong Electron main.
 */
export interface ExtractionRunner {
  run(request: ExtractionRequest): Promise<ExtractionResult>
  dispose(): Promise<void>
}

/** Một mẩu văn bản đã cắt theo ngân sách token, kèm metadata nguồn (§14.1). */
export interface DocumentChunk {
  readonly text: string
  readonly index: number
  /** Trang (PDF) hoặc đoạn (DOCX/TXT) mà mẩu này bắt đầu — hiển thị nguồn cho người dùng. */
  readonly locationLabel: string
  readonly estimatedTokens: number
}

export interface ProcessedDocument {
  readonly fileName: string
  readonly kind: DocumentKind
  readonly sizeBytes: number
  readonly sourcePathHash: string
  readonly text: string
  readonly chunks: readonly DocumentChunk[]
  readonly charCount: number
  readonly estimatedTokens: number
  readonly pageCount?: number
  readonly suspectedScan?: boolean
  readonly truncated: boolean
}
