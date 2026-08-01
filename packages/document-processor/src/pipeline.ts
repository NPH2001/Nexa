import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'
import { hashPath } from '@nexa/security'
import type {
  DocumentChunk,
  DocumentKind,
  ExtractionRunner,
  FileDescriptor,
  ProcessedDocument,
} from './types.js'

/**
 * Ước lượng token bằng heuristic ~4 ký tự/token.
 *
 * KHÔNG có tokenizer thật vì Nexa không biết model nào nằm sau LiteLLM (OPEN-QUESTIONS B2).
 * Với tiếng Việt có dấu, tỉ lệ thực tế thường cao hơn (nhiều token hơn ước lượng), nên
 * `AgentRuntime` để sẵn `contextSafetyMargin` bù vào.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export interface DocumentLimits {
  readonly maxFileSizeMb: number
  readonly maxFilesPerRequest: number
  /** Trần ký tự trích xuất mỗi file. Tách khỏi giới hạn dung lượng file. */
  readonly maxCharsPerFile?: number
}

export interface DocumentProcessorOptions {
  readonly runner: ExtractionRunner
  readonly logger: Logger
  readonly limits: DocumentLimits
  /** Token mỗi chunk. Mặc định 1500 — đủ nhỏ để ghép nhiều chunk vào một context. */
  readonly chunkTokens?: number
  /** Số token chồng lấn giữa hai chunk liền kề, tránh cắt ngang một ý. */
  readonly chunkOverlapTokens?: number
}

/** §14: bảng loại file được hỗ trợ. Extension → kind. */
const EXTENSION_MAP: Readonly<Record<string, DocumentKind>> = {
  '.txt': 'txt',
  '.log': 'txt',
  '.csv': 'txt',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.pdf': 'pdf',
  '.docx': 'docx',
}

const MIME_MAP: Readonly<Record<DocumentKind, string>> = {
  txt: 'text/plain',
  markdown: 'text/markdown',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export class DocumentProcessor {
  private readonly runner: ExtractionRunner
  private readonly log: Logger
  private readonly limits: DocumentLimits
  private readonly chunkTokens: number
  private readonly chunkOverlapTokens: number

  constructor(opts: DocumentProcessorOptions) {
    this.runner = opts.runner
    this.log = opts.logger.child({ module: 'document-processor' })
    this.limits = opts.limits
    this.chunkTokens = opts.chunkTokens ?? 1_500
    this.chunkOverlapTokens = opts.chunkOverlapTokens ?? 100
  }

  /**
   * §7.2 bước 2–5: kiểm tra chính sách → trích xuất → chuẩn hoá → chunk.
   *
   * Kiểm tra TOÀN BỘ danh sách trước khi đọc file đầu tiên: người dùng chọn 6 file khi giới hạn
   * là 5 thì phải báo ngay, không phải sau khi đã ngồi parse 5 file.
   */
  async process(files: readonly FileDescriptor[]): Promise<ProcessedDocument[]> {
    if (files.length > this.limits.maxFilesPerRequest) {
      throw new NexaError(ERROR_CODES.TOO_MANY_FILES, {
        safeDetail: `${String(files.length)} files, limit is ${String(this.limits.maxFilesPerRequest)}`,
      })
    }

    const validated = await Promise.all(files.map((f) => this.validate(f)))
    const results: ProcessedDocument[] = []
    for (const item of validated) {
      results.push(await this.processOne(item))
    }
    return results
  }

  private async validate(file: FileDescriptor): Promise<{ file: FileDescriptor; kind: DocumentKind }> {
    const ext = extname(file.fileName).toLowerCase()
    const byExtension = EXTENSION_MAP[ext]
    if (byExtension === undefined) {
      throw new NexaError(ERROR_CODES.FILE_UNSUPPORTED, { safeDetail: `extension "${ext}"` })
    }

    const stats = await stat(file.path).catch(() => null)
    if (stats === null || !stats.isFile()) {
      throw new NexaError(ERROR_CODES.FILE_UNSUPPORTED, { safeDetail: 'not a regular file' })
    }

    const maxBytes = this.limits.maxFileSizeMb * 1024 * 1024
    if (stats.size > maxBytes) {
      throw new NexaError(ERROR_CODES.FILE_TOO_LARGE, {
        safeDetail: `${String(stats.size)} bytes exceeds ${String(maxBytes)}`,
      })
    }
    if (stats.size === 0) {
      throw new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, { safeDetail: 'empty file' })
    }

    // §14.1: "Validate MIME type và extension; không chỉ tin vào tên file."
    const signature = await readSignature(file.path)
    const byContent = detectBySignature(signature)
    if (byContent !== null && byContent !== byExtension) {
      throw new NexaError(ERROR_CODES.FILE_UNSUPPORTED, {
        safeDetail: `content looks like "${byContent}" but extension says "${byExtension}"`,
      })
    }
    // Nội dung nhị phân mang extension .txt: từ chối thay vì nhồi rác vào prompt.
    if (byContent === null && (byExtension === 'txt' || byExtension === 'markdown')) {
      if (looksBinary(signature)) {
        throw new NexaError(ERROR_CODES.FILE_UNSUPPORTED, {
          safeDetail: 'binary content with a text extension',
        })
      }
    }

    return { file: { ...file, sizeBytes: stats.size }, kind: byExtension }
  }

  private async processOne({
    file,
    kind,
  }: {
    file: FileDescriptor
    kind: DocumentKind
  }): Promise<ProcessedDocument> {
    const started = Date.now()
    const maxChars = this.limits.maxCharsPerFile ?? this.limits.maxFileSizeMb * 400_000

    const extracted = await this.runner.run({ path: file.path, kind, maxChars })
    const text = normalizeText(extracted.text)

    if (text.trim() === '') {
      throw new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, {
        safeDetail: extracted.suspectedScan === true ? 'pdf has no text layer' : 'no text extracted',
      })
    }

    const chunks = this.chunk(text, kind)
    // Log CHỈ số liệu — không tên file, không nội dung (§15.1).
    this.log.perf('document-extracted', {
      durationMs: Date.now() - started,
      kind,
      sizeBytes: file.sizeBytes,
      charCount: text.length,
      chunkCount: chunks.length,
      suspectedScan: extracted.suspectedScan === true,
    })

    return {
      fileName: file.fileName,
      kind,
      sizeBytes: file.sizeBytes,
      sourcePathHash: hashPath(file.path),
      text,
      chunks,
      charCount: text.length,
      estimatedTokens: estimateTokens(text),
      truncated: extracted.truncated,
      ...(extracted.pageCount !== undefined ? { pageCount: extracted.pageCount } : {}),
      ...(extracted.suspectedScan === true ? { suspectedScan: true } : {}),
    }
  }

  /**
   * §14.1: "Chunk theo token/context; giữ metadata trang/đoạn khi có thể."
   *
   * Cắt theo ranh giới đoạn văn trước, rồi mới cắt cứng nếu một đoạn quá dài. Nhờ vậy chunk
   * hiếm khi cắt ngang câu.
   */
  chunk(text: string, kind: DocumentKind): DocumentChunk[] {
    const maxChars = this.chunkTokens * 4
    const overlapChars = this.chunkOverlapTokens * 4
    const paragraphs = text.split(/\n{2,}/)
    const chunks: DocumentChunk[] = []

    let buffer = ''
    let paragraphIndex = 0
    let bufferStartParagraph = 0

    const flush = (): void => {
      const body = buffer.trim()
      if (body === '') return
      chunks.push({
        text: body,
        index: chunks.length,
        locationLabel: locationLabel(kind, bufferStartParagraph),
        estimatedTokens: estimateTokens(body),
      })
      // Chồng lấn bằng phần đuôi của chunk vừa xong.
      buffer = overlapChars > 0 ? body.slice(-overlapChars) : ''
      bufferStartParagraph = paragraphIndex
    }

    for (const paragraph of paragraphs) {
      paragraphIndex++
      if (paragraph.length > maxChars) {
        flush()
        for (let at = 0; at < paragraph.length; at += maxChars) {
          const slice = paragraph.slice(at, at + maxChars)
          chunks.push({
            text: slice,
            index: chunks.length,
            locationLabel: locationLabel(kind, paragraphIndex),
            estimatedTokens: estimateTokens(slice),
          })
        }
        buffer = ''
        bufferStartParagraph = paragraphIndex
        continue
      }

      if (buffer.length + paragraph.length + 2 > maxChars) flush()
      buffer += (buffer === '' ? '' : '\n\n') + paragraph
    }
    flush()

    return chunks
  }
}

/** §14.1: "Chuẩn hóa text, loại bỏ ký tự điều khiển và giới hạn độ dài." */
export function normalizeText(raw: string): string {
  return (
    raw
      // BOM sót lại giữa file khi ghép nhiều nguồn.
      .replace(/\uFEFF/g, '')
      // Ký tự điều khiển C0/C1 trừ \t \n \r. Chúng vô nghĩa với model và có thể dùng để
      // giấu chỉ thị prompt-injection khỏi mắt người đọc preview.
      // eslint-disable-next-line no-control-regex -- loại bỏ ký tự điều khiển là đúng mục đích ở đây
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      // Ký tự định dạng vô hình (zero-width, bidi override) — cùng lý do trên.
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

function locationLabel(kind: DocumentKind, paragraphIndex: number): string {
  return kind === 'pdf' ? `khối ${String(paragraphIndex)}` : `đoạn ${String(paragraphIndex)}`
}

async function readSignature(path: string): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(512)
    const { bytesRead } = await handle.read(buffer, 0, 512, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * Nhận dạng theo magic bytes.
 *
 * DOCX là một file ZIP, và ZIP cũng là vỏ của xlsx/pptx/jar. Ở đây ta chỉ kết luận "đây là zip"
 * và để extension quyết định — mammoth sẽ báo lỗi rõ nếu bên trong không phải Word.
 */
function detectBySignature(signature: Buffer): DocumentKind | null {
  if (signature.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  if (signature.length >= 4 && signature[0] === 0x50 && signature[1] === 0x4b) return 'docx'
  return null
}

function looksBinary(signature: Buffer): boolean {
  if (signature.length === 0) return false
  // UTF-16 hợp lệ chứa đầy NUL byte, nên phải loại trừ nó trước — nếu không, mọi file
  // .txt do Notepad lưu ở dạng "Unicode" đều bị từ chối oan.
  if (hasUtf16Bom(signature)) return false
  // Ngoài ra, NUL byte trong 512 byte đầu là dấu hiệu chắc chắn nhất của nội dung nhị phân.
  return signature.includes(0)
}

function hasUtf16Bom(signature: Buffer): boolean {
  if (signature.length < 2) return false
  const [a, b] = [signature[0], signature[1]]
  return (a === 0xff && b === 0xfe) || (a === 0xfe && b === 0xff)
}

export { MIME_MAP }
