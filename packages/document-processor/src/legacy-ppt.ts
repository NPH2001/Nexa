import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import { CfbArchive } from './cfb.js'
import { decodeCp1252, decodeUtf16Le, normalizeLegacyControlChars } from './legacy-text.js'
import type { LegacyExtraction } from './legacy-word.js'

/**
 * Trích văn bản từ `.ppt` (PowerPoint 97-2003).
 *
 * Định dạng này là một cây bản ghi lồng nhau: mỗi bản ghi có header 8 byte, và 4 bit thấp của
 * hai byte đầu cho biết nó là "container" (còn con bên trong) hay "atom" (dữ liệu lá). Ta đi
 * đệ quy xuống cây, và mỗi lần gặp một container Slide thì mở một nhóm mới — nhờ vậy chữ được
 * gom theo từng slide chứ không thành một khối lẫn lộn.
 *
 * Giới hạn đã biết: slide xuất ra theo thứ tự chúng nằm trong file, có thể khác thứ tự trình
 * chiếu nếu người dùng đã sắp xếp lại. Thứ tự thật nằm trong bảng persist directory — đọc được
 * nhưng không tương xứng công sức cho một định dạng đang lụi tàn. Bản `.pptx` thì đã lấy đúng
 * thứ tự từ `sldIdLst`.
 */

const RECORD_TEXT_CHARS_ATOM = 0x0fa0
const RECORD_TEXT_BYTES_ATOM = 0x0fa8
const RECORD_CSTRING_ATOM = 0x0fba
const RECORD_SLIDE_CONTAINER = 0x03ee
const RECORD_NOTES_CONTAINER = 0x03ef

/** 4 bit thấp bằng 0xF nghĩa là bản ghi chứa bản ghi con. */
const VERSION_CONTAINER = 0x0f

const MAX_DEPTH = 24
const MAX_SLIDES = 1_000
const HEADER_SIZE = 8

export function extractPpt(buffer: Buffer, maxChars: number): LegacyExtraction {
  const cfb = CfbArchive.open(buffer)
  const stream = cfb.firstStream(['PowerPoint Document', 'PP97_DUALSTORAGE'])
  if (stream === null) {
    throw failure('ppt has no PowerPoint Document stream (not a presentation?)')
  }

  const collector = new SlideCollector(maxChars)
  walk(stream, 0, stream.length, 0, collector)
  const text = collector.render()

  if (text.trim() === '') throw failure('ppt contains no extractable text')
  return { text: text.slice(0, maxChars), truncated: collector.truncated || text.length > maxChars }
}

function walk(
  stream: Buffer,
  from: number,
  to: number,
  depth: number,
  collector: SlideCollector,
): void {
  if (depth > MAX_DEPTH) return

  let at = from
  while (at + HEADER_SIZE <= to) {
    const versionAndInstance = stream.readUInt16LE(at)
    const type = stream.readUInt16LE(at + 2)
    const length = stream.readUInt32LE(at + 4)
    const bodyAt = at + HEADER_SIZE
    const bodyEnd = bodyAt + length

    // Độ dài khai láo vượt khỏi vùng cha: dừng nhánh này thay vì đọc lấn sang dữ liệu khác.
    if (length < 0 || bodyEnd > to) return

    if ((versionAndInstance & 0x000f) === VERSION_CONTAINER) {
      if (type === RECORD_SLIDE_CONTAINER) collector.startSlide()
      else if (type === RECORD_NOTES_CONTAINER) collector.startNotes()
      walk(stream, bodyAt, bodyEnd, depth + 1, collector)
    } else {
      const body = stream.subarray(bodyAt, bodyEnd)
      switch (type) {
        case RECORD_TEXT_CHARS_ATOM:
        case RECORD_CSTRING_ATOM:
          collector.add(decodeUtf16Le(body))
          break
        case RECORD_TEXT_BYTES_ATOM:
          collector.add(decodeCp1252(body))
          break
        default:
          break
      }
    }

    at = bodyEnd
    if (collector.full) return
  }
}

interface Group {
  readonly heading: string
  readonly lines: string[]
}

class SlideCollector {
  private readonly groups: Group[] = []
  private used = 0
  truncated = false

  constructor(private readonly maxChars: number) {}

  get full(): boolean {
    return this.used >= this.maxChars
  }

  startSlide(): void {
    if (this.groups.length >= MAX_SLIDES) return
    // Đếm slide theo số nhóm slide đã mở, không theo tổng số nhóm (ghi chú không tính).
    const slideNumber =
      this.groups.filter((group) => group.heading.startsWith('## Slide')).length + 1
    this.groups.push({ heading: `## Slide ${String(slideNumber)}`, lines: [] })
  }

  startNotes(): void {
    if (this.groups.length >= MAX_SLIDES) return
    this.groups.push({ heading: 'Ghi chú:', lines: [] })
  }

  add(raw: string): void {
    if (this.full) {
      this.truncated = true
      return
    }
    const text = normalizeLegacyControlChars(raw)
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter((line) => line !== '')

    if (text.length === 0) return

    // Chữ xuất hiện trước container Slide đầu tiên (master, layout) vẫn giữ, nhưng gom vào
    // một nhóm không tên để không mất nội dung.
    let group = this.groups[this.groups.length - 1]
    if (group === undefined) {
      group = { heading: '', lines: [] }
      this.groups.push(group)
    }

    for (const line of text) {
      if (this.used + line.length + 1 > this.maxChars) {
        this.truncated = true
        return
      }
      group.lines.push(line)
      this.used += line.length + 1
    }
  }

  render(): string {
    const out: string[] = []
    for (const group of this.groups) {
      if (group.lines.length === 0) continue
      if (group.heading !== '') out.push(group.heading)
      out.push(...group.lines)
    }
    return out.join('\n')
  }
}

function failure(detail: string): NexaError {
  return new NexaError(ERROR_CODES.DOCUMENT_EXTRACTION_FAILED, { safeDetail: detail })
}
