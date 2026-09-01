/**
 * §14 mở rộng: ngoài TXT/Markdown, PDF và DOCX ban đầu, Nexa nhận thêm bộ Office còn lại
 * (`.xlsx`, `.pptx` và ba định dạng nhị phân 97-2003) và ảnh. Mọi thứ khác vẫn bị từ chối.
 */
export const TEXT_DOCUMENT_KINDS = [
  'txt',
  'markdown',
  'pdf',
  'docx',
  'doc',
  'xlsx',
  'xls',
  'pptx',
  'ppt',
] as const
export type TextDocumentKind = (typeof TEXT_DOCUMENT_KINDS)[number]

/**
 * Ảnh là MỘT kind duy nhất, không tách theo png/jpeg/…
 *
 * Lý do: mọi thứ phía sau — chính sách, ngân sách context, cách hiển thị — đối xử với ảnh như
 * nhau; chỉ có `ExtractedImage.mediaType` mới cần biết định dạng cụ thể để dựng data URL.
 */
export const IMAGE_DOCUMENT_KIND = 'image'

export const SUPPORTED_KINDS = [...TEXT_DOCUMENT_KINDS, IMAGE_DOCUMENT_KIND] as const
export type DocumentKind = (typeof SUPPORTED_KINDS)[number]

export function isImageKind(kind: DocumentKind): boolean {
  return kind === IMAGE_DOCUMENT_KIND
}

/** Định dạng ảnh gửi được cho model thị giác. */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number]

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
  /** Trần byte cho ảnh sau khi gỡ metadata. Bỏ trống ⇒ dùng mặc định của package. */
  readonly maxImageBytes?: number
}

/**
 * Ảnh đã sẵn sàng gửi đi: đã kiểm bằng magic bytes, đã gỡ EXIF/XMP, đã mã hoá base64.
 *
 * Không giữ đường dẫn và không giữ buffer gốc — thứ duy nhất rời khỏi worker là đúng những
 * byte sẽ được gửi cho model.
 */
export interface ExtractedImage {
  readonly mediaType: ImageMediaType
  readonly dataBase64: string
  readonly byteSize: number
  readonly width: number
  readonly height: number
  /** true nếu có khối metadata đã bị loại bỏ so với file gốc. */
  readonly metadataStripped: boolean
}

export interface ExtractionResult {
  readonly text: string
  /**
   * Số trang (PDF), slide (PPT/PPTX) hoặc sheet (XLS/XLSX). Một con số duy nhất vì UI chỉ cần
   * nói "tài liệu này có bao nhiêu phần", và `kind` đã cho biết đơn vị là gì.
   */
  readonly pageCount?: number
  /**
   * PDF không có lớp văn bản — nhiều khả năng là bản scan. §14: "cảnh báo PDF scan",
   * và §2.2 nói OCR nằm ngoài phạm vi MVP.
   */
  readonly suspectedScan?: boolean
  /** true nếu văn bản bị cắt vì chạm `maxChars`. */
  readonly truncated: boolean
  /** Chỉ có với `kind = 'image'`. Khi có mặt thì `text` rỗng. */
  readonly image?: ExtractedImage
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
  /** Rỗng với ảnh — nội dung của ảnh nằm ở `image`. */
  readonly text: string
  readonly chunks: readonly DocumentChunk[]
  readonly charCount: number
  /** Với ảnh, đây là ước lượng token của chính tấm ảnh khi đưa vào context. */
  readonly estimatedTokens: number
  readonly pageCount?: number
  readonly suspectedScan?: boolean
  readonly truncated: boolean
  readonly image?: ExtractedImage
}
