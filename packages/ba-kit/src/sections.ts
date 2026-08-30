/**
 * Cắt tài liệu theo heading trước khi trích xuất (D4 quy tắc 3).
 *
 * Vì sao không dùng bộ chunk theo token của `document-processor`: bộ đó cắt theo ranh giới đoạn
 * văn và **chồng lấn** giữa hai chunk để không cắt ngang một ý — đúng cho việc nhồi tài liệu vào
 * context. Với trích xuất thì chồng lấn là tác hại: cùng một use case bị sinh hai lần với hai id
 * khác nhau. Ở đây cắt theo heading, không chồng lấn, và `anchor` giữ lại đường dẫn heading để
 * người dùng biết item đến từ mục nào.
 *
 * Đây là xử lý text thuần nên nó thuộc `ba-kit`. Việc lấy text ra khỏi PDF/DOCX vẫn là của
 * `document-processor`.
 */

export interface DocumentSection {
  /** Đường dẫn heading, ví dụ `3. Luồng nghiệp vụ > 3.2 Ngoại lệ`. Rỗng ở phần mở đầu. */
  readonly anchor: string
  readonly text: string
}

export const DEFAULT_SECTION_MAX_CHARS = 6_000

/** Markdown ATX (`## Mục`) hoặc heading đánh số kiểu tài liệu Việt (`3.2 Luồng ngoại lệ`). */
const HEADING = /^(#{1,6})\s+(.*\S)\s*$|^(\d+(?:\.\d+)*)\.?\s+(\S.{0,118})$/

interface HeadingMatch {
  readonly level: number
  readonly title: string
}

function matchHeading(line: string): HeadingMatch | null {
  const match = HEADING.exec(line.trim())
  if (match === null) return null

  const hashes = match[1]
  if (hashes !== undefined && match[2] !== undefined) {
    return { level: hashes.length, title: match[2] }
  }

  const numbering = match[3]
  const title = match[4]
  if (numbering === undefined || title === undefined) return null
  // "3.2 Luồng ngoại lệ" là heading; "500000 đồng là ngưỡng" thì không. Phân biệt bằng việc dòng
  // không kết thúc bằng dấu câu của một câu văn.
  if (/[.,;:!?]$/.test(title)) return null
  return { level: numbering.split('.').length, title: `${numbering} ${title}` }
}

function anchorOf(stack: readonly HeadingMatch[]): string {
  return stack.map((heading) => heading.title).join(' > ')
}

/**
 * Cắt một section quá dài theo ranh giới đoạn văn, rồi cắt cứng nếu một đoạn vẫn quá dài.
 *
 * Section quá dài là chuyện có thật (một bảng field dài không có heading con), và bỏ qua nó sẽ
 * làm lượt trích xuất vượt context rồi hỏng ở đuôi tài liệu — kiểu hỏng im lặng khó thấy nhất.
 */
function splitOversized(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]

  const parts: string[] = []
  let current = ''
  for (const paragraph of text.split(/\n{2,}/)) {
    const candidate = current === '' ? paragraph : `${current}\n\n${paragraph}`
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }
    if (current !== '') {
      parts.push(current)
      current = ''
    }
    if (paragraph.length <= maxChars) {
      current = paragraph
      continue
    }
    for (let offset = 0; offset < paragraph.length; offset += maxChars) {
      parts.push(paragraph.slice(offset, offset + maxChars))
    }
  }
  if (current !== '') parts.push(current)
  return parts
}

export function splitSections(
  text: string,
  maxChars: number = DEFAULT_SECTION_MAX_CHARS,
): DocumentSection[] {
  const stack: HeadingMatch[] = []
  const sections: DocumentSection[] = []
  let anchor = ''
  let buffer: string[] = []

  const flush = (): void => {
    const body = buffer.join('\n').trim()
    buffer = []
    if (body === '') return
    for (const part of splitOversized(body, maxChars)) {
      sections.push({ anchor, text: part })
    }
  }

  for (const line of text.split(/\r?\n/)) {
    const heading = matchHeading(line)
    if (heading === null) {
      buffer.push(line)
      continue
    }

    flush()
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= heading.level) {
      stack.pop()
    }
    stack.push(heading)
    anchor = anchorOf(stack)
    buffer.push(line)
  }
  flush()

  return sections
}
