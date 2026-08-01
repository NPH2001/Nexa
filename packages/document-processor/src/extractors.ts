import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import type { ExtractionRequest, ExtractionResult } from './types.js'

const nodeRequire = createRequire(import.meta.url)

/** Dưới ngưỡng này trên mỗi trang thì coi như trang không có lớp văn bản (§14 "cảnh báo PDF scan"). */
const SCAN_CHARS_PER_PAGE_THRESHOLD = 20

export async function extract(request: ExtractionRequest): Promise<ExtractionResult> {
  switch (request.kind) {
    case 'txt':
    case 'markdown':
      return extractText(request)
    case 'pdf':
      return extractPdf(request)
    case 'docx':
      return extractDocx(request)
    default: {
      const never: never = request.kind
      throw new NexaError(ERROR_CODES.FILE_UNSUPPORTED, { safeDetail: String(never) })
    }
  }
}

/**
 * §14: "Đọc UTF-8; phát hiện encoding cơ bản."
 *
 * Không kéo thêm thư viện đoán encoding: kiểm tra BOM, và nếu giải mã UTF-8 sinh ra quá nhiều
 * ký tự thay thế U+FFFD thì thử lại bằng windows-1258 (bảng mã tiếng Việt hay gặp trong file cũ).
 */
async function extractText(request: ExtractionRequest): Promise<ExtractionResult> {
  const buffer = await readFile(request.path)

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return finish(new TextDecoder('utf-16le').decode(buffer.subarray(2)), request)
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return finish(new TextDecoder('utf-16be').decode(buffer.subarray(2)), request)
  }
  const body =
    buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
      ? buffer.subarray(3)
      : buffer

  const utf8 = new TextDecoder('utf-8').decode(body)
  const replacements = (utf8.match(/�/g) ?? []).length
  if (utf8.length > 0 && replacements / utf8.length > 0.01) {
    try {
      return finish(new TextDecoder('windows-1258').decode(body), request)
    } catch {
      // Runtime không có bảng mã đó — cứ dùng UTF-8 kèm ký tự thay thế.
    }
  }
  return finish(utf8, request)
}

/**
 * §14: "Parser text; không OCR mặc định."
 *
 * pdfjs-dist bản legacy chạy được trong Node thuần. Ta tắt worker của chính pdfjs
 * (`disableWorker`) vì việc chạy nền đã do ExtractionRunner của Nexa đảm nhiệm — lồng hai
 * lớp worker chỉ thêm phức tạp mà không thêm lợi ích.
 */
async function extractPdf(request: ExtractionRequest): Promise<ExtractionResult> {
  const pdfjs = nodeRequire('pdfjs-dist/legacy/build/pdf.mjs') as PdfJsModule
  const data = new Uint8Array(await readFile(request.path))

  // pdfjs cần bảng metric của 14 font chuẩn PDF để đo chữ. Trỏ vào thư mục đi kèm package
  // (đường dẫn file cục bộ, KHÔNG phải URL mạng) — nếu bỏ trống, nó cảnh báo và một số PDF
  // trả về text sai vị trí.
  const standardFontDataUrl = `${dirname(nodeRequire.resolve('pdfjs-dist/package.json'))}/standard_fonts/`

  let doc: PdfDocument
  try {
    doc = await pdfjs.getDocument({
      data,
      disableWorker: true,
      isEvalSupported: false,
      // Không tải font/cmap từ mạng — app phải chạy được khi ngoại tuyến và không được
      // phát sinh request ra ngoài (§11.2 allowlist domain).
      useSystemFonts: false,
      standardFontDataUrl,
    }).promise
  } catch (cause) {
    throw new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, {
      cause,
      safeDetail: 'pdf could not be opened (corrupt or password protected)',
    })
  }

  try {
    const pages: string[] = []
    let total = 0
    let truncated = false

    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo)
      try {
        const content = await page.getTextContent()
        const pageText = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/[ \t]+/g, ' ')
          .trim()
        pages.push(pageText)
        total += pageText.length
      } finally {
        page.cleanup()
      }

      if (total >= request.maxChars) {
        truncated = true
        break
      }
    }

    const text = pages.join('\n\n')
    const charsPerPage = pages.length === 0 ? 0 : total / pages.length
    return {
      text: text.slice(0, request.maxChars),
      pageCount: doc.numPages,
      suspectedScan: charsPerPage < SCAN_CHARS_PER_PAGE_THRESHOLD,
      truncated: truncated || text.length > request.maxChars,
    }
  } finally {
    await doc.destroy()
  }
}

/** §14: "Đọc paragraph/table text. Không xử lý macro/embedded object." */
async function extractDocx(request: ExtractionRequest): Promise<ExtractionResult> {
  const mammoth = nodeRequire('mammoth') as {
    extractRawText(input: { path: string }): Promise<{ value: string }>
  }
  try {
    const { value } = await mammoth.extractRawText({ path: request.path })
    return finish(value, request)
  } catch (cause) {
    throw new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, {
      cause,
      safeDetail: 'docx could not be parsed',
    })
  }
}

function finish(raw: string, request: ExtractionRequest): ExtractionResult {
  const truncated = raw.length > request.maxChars
  return { text: truncated ? raw.slice(0, request.maxChars) : raw, truncated }
}

interface PdfJsModule {
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocument> }
}

interface PdfDocument {
  readonly numPages: number
  getPage(n: number): Promise<PdfPage>
  destroy(): Promise<void>
}

interface PdfPage {
  getTextContent(): Promise<{ items: ({ str: string } | Record<string, unknown>)[] }>
  cleanup(): void
}
