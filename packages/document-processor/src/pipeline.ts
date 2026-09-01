import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'
import { hashPath } from '@nexa/security'
import { CfbArchive } from './cfb.js'
import { detectImageMediaType, estimateImageTokens } from './image.js'
import { isImageKind } from './types.js'
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
  /**
   * Trần dung lượng RIÊNG cho ảnh, tính sau khi gỡ metadata.
   *
   * Tách khỏi `maxFileSizeMb` vì hai con số này chặn hai thứ khác nhau: giới hạn chung bảo vệ
   * bộ nhớ lúc đọc file, còn giới hạn ảnh bảo vệ payload thật sự rời khỏi máy — ảnh đi nguyên
   * si tới model chứ không được rút gọn như văn bản.
   */
  readonly maxImageSizeMb?: number
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
  '.tsv': 'txt',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'doc',
  '.xlsx': 'xlsx',
  '.xlsm': 'xlsx',
  '.xls': 'xls',
  '.pptx': 'pptx',
  '.pptm': 'pptx',
  '.ppt': 'ppt',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
}

const MIME_MAP: Readonly<Record<DocumentKind, string>> = {
  txt: 'text/plain',
  markdown: 'text/markdown',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  image: 'image/*',
}

/**
 * "Họ" định dạng nhận ra được từ magic bytes.
 *
 * Magic bytes KHÔNG phân biệt được `.docx` với `.xlsx` — cả hai đều là ZIP; cũng như `.doc`
 * với `.xls` — cả hai đều là OLE. Nên kiểm tra chéo diễn ra ở mức họ, rồi tinh chỉnh thêm
 * bằng tên part bên trong (xem `refineOoxmlKind`). Bộ đọc của từng định dạng vẫn là chốt cuối:
 * mở một `.xlsx` mà bên trong là Word thì nó báo lỗi rõ ràng.
 */
type FormatFamily = 'text' | 'pdf' | 'ooxml' | 'ole' | 'image'

const KIND_FAMILY: Readonly<Record<DocumentKind, FormatFamily>> = {
  txt: 'text',
  markdown: 'text',
  pdf: 'pdf',
  docx: 'ooxml',
  xlsx: 'ooxml',
  pptx: 'ooxml',
  doc: 'ole',
  xls: 'ole',
  ppt: 'ole',
  image: 'image',
}

/** Phần mở rộng hiện ra trong hộp thoại chọn file. Suy thẳng từ `EXTENSION_MAP` để hai nơi
 *  không bao giờ lệch nhau. */
export const SUPPORTED_FILE_EXTENSIONS: readonly string[] = Object.keys(EXTENSION_MAP)
  .map((extension) => extension.slice(1))
  .sort()

/**
 * Phần mở rộng cho các luồng chỉ tiêu thụ VĂN BẢN trích xuất.
 *
 * Không gian Nghiệp vụ và hồ sơ chứng từ đọc `text`/`chunks` của tài liệu; một tấm ảnh cho ra
 * chuỗi rỗng, nên nếu để lọt thì model nhận một tài liệu trống mà không ai được báo. Danh sách
 * này giữ ảnh ra khỏi hộp thoại ngay từ đầu.
 */
export const TEXT_FILE_EXTENSIONS: readonly string[] = Object.entries(EXTENSION_MAP)
  .filter(([, kind]) => !isImageKind(kind))
  .map(([extension]) => extension.slice(1))
  .sort()

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

  private async validate(
    file: FileDescriptor,
  ): Promise<{ file: FileDescriptor; kind: DocumentKind }> {
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
    const expectedFamily = KIND_FAMILY[byExtension]
    const actualFamily = detectFamily(signature)

    if (actualFamily !== null && actualFamily !== expectedFamily) {
      throw new NexaError(ERROR_CODES.FILE_UNSUPPORTED, {
        safeDetail: `content looks like "${actualFamily}" but extension says "${byExtension}"`,
      })
    }
    // Nội dung nhị phân mang extension .txt: từ chối thay vì nhồi rác vào prompt.
    if (actualFamily === null && expectedFamily === 'text' && looksBinary(signature)) {
      throw new NexaError(ERROR_CODES.FILE_UNSUPPORTED, {
        safeDetail: 'binary content with a text extension',
      })
    }
    if (actualFamily === 'ooxml') {
      const insideKind = refineOoxmlKind(signature)
      if (insideKind !== null && insideKind !== byExtension) {
        throw new NexaError(ERROR_CODES.FILE_UNSUPPORTED, {
          safeDetail: `office package contains "${insideKind}" parts but extension says "${byExtension}"`,
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
    const maxImageBytes =
      (this.limits.maxImageSizeMb ?? Math.min(this.limits.maxFileSizeMb, 8)) * 1024 * 1024

    const extracted = await this.runner.run({ path: file.path, kind, maxChars, maxImageBytes })

    if (isImageKind(kind)) {
      return this.finishImage({ file, kind, extracted, started })
    }

    const text = normalizeText(extracted.text)

    if (text.trim() === '') {
      throw new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, {
        safeDetail:
          extracted.suspectedScan === true ? 'pdf has no text layer' : 'no text extracted',
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
   * Ảnh đi một nhánh riêng: không có văn bản để chuẩn hoá, không có gì để chunk.
   *
   * `estimatedTokens` vẫn phải có thật, vì `AgentRuntime` dùng nó để quyết định ảnh có vừa
   * context hay không — và ảnh đắt hơn nhiều so với cảm giác trực quan (một ảnh 1024×1024
   * tốn cỡ 765 token, bằng gần hai trang văn bản).
   */
  private finishImage({
    file,
    kind,
    extracted,
    started,
  }: {
    file: FileDescriptor
    kind: DocumentKind
    extracted: { image?: ProcessedDocument['image'] }
    started: number
  }): ProcessedDocument {
    const image = extracted.image
    if (image === undefined) {
      throw new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, {
        safeDetail: 'image extraction returned no image',
      })
    }

    const estimatedTokens = estimateImageTokens(image.width, image.height)
    this.log.perf('image-prepared', {
      durationMs: Date.now() - started,
      sizeBytes: file.sizeBytes,
      preparedBytes: image.byteSize,
      mediaType: image.mediaType,
      metadataStripped: image.metadataStripped,
      estimatedTokens,
    })

    return {
      fileName: file.fileName,
      kind,
      sizeBytes: file.sizeBytes,
      sourcePathHash: hashPath(file.path),
      text: '',
      chunks: [],
      charCount: 0,
      estimatedTokens,
      truncated: false,
      image,
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
  const index = String(paragraphIndex)
  switch (kind) {
    case 'pdf':
      return `khối ${index}`
    case 'xlsx':
    case 'xls':
      return `vùng bảng ${index}`
    case 'pptx':
    case 'ppt':
      return `nhóm slide ${index}`
    default:
      return `đoạn ${index}`
  }
}

/**
 * Đọc 4 KB đầu thay vì 512 byte.
 *
 * 512 byte đủ để nhận ra họ định dạng, nhưng không đủ để thấy tên part đầu tiên bên trong một
 * gói OOXML — mà đó chính là thứ phân biệt `.docx` với `.xlsx`.
 */
async function readSignature(path: string): Promise<Buffer> {
  const SIGNATURE_BYTES = 4096
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(SIGNATURE_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, SIGNATURE_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Nhận dạng HỌ định dạng theo magic bytes. */
function detectFamily(signature: Buffer): FormatFamily | null {
  if (signature.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  if (detectImageMediaType(signature) !== null) return 'image'
  if (CfbArchive.isCfb(signature)) return 'ole'
  // "PK\x03\x04" — local file header của ZIP.
  if (signature.length >= 4 && signature[0] === 0x50 && signature[1] === 0x4b) return 'ooxml'
  return null
}

/**
 * Đoán loại gói OOXML từ tên part xuất hiện sớm trong file.
 *
 * Đọc tên từ chính các local file header, KHÔNG tìm chuỗi trong toàn bộ 4 KB. Khác biệt này
 * quan trọng: phần lớn 4 KB đầu là dữ liệu đã nén, và ba byte `xl/` xuất hiện ngẫu nhiên trong
 * đó thường xuyên hơn ta tưởng — đủ để thỉnh thoảng từ chối oan một file `.docx` hợp lệ. Tên
 * part thì nằm ở vị trí xác định trong header nên đọc được chính xác.
 *
 * Không thấy part chính trong 4 KB đầu thì trả `null` và để bộ đọc kết luận; đây là kiểm tra
 * bổ sung, không phải chốt chặn duy nhất.
 */
function refineOoxmlKind(signature: Buffer): DocumentKind | null {
  const LOCAL_FILE_SIGNATURE = 0x04034b50
  let at = 0

  while (at + 30 <= signature.length && signature.readUInt32LE(at) === LOCAL_FILE_SIGNATURE) {
    const nameLength = signature.readUInt16LE(at + 26)
    const extraLength = signature.readUInt16LE(at + 28)
    const nameEnd = at + 30 + nameLength
    if (nameEnd > signature.length) break

    const name = signature.subarray(at + 30, nameEnd).toString('latin1')
    if (name.startsWith('word/')) return 'docx'
    if (name.startsWith('xl/')) return 'xlsx'
    if (name.startsWith('ppt/')) return 'pptx'

    // Không thể nhảy tới entry sau nếu độ dài nằm ở data descriptor (cờ bit 3) thay vì header.
    if ((signature.readUInt16LE(at + 6) & 0x0008) !== 0) break
    at = nameEnd + extraLength + signature.readUInt32LE(at + 18)
  }

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
