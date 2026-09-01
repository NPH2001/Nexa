/**
 * Tiện ích đọc văn bản từ XML của OOXML.
 *
 * Cố ý KHÔNG dùng bộ parse XML tổng quát. Ta chỉ cần lấy chữ trong một số thẻ đã biết, còn
 * một parser đầy đủ lại mở thêm bề mặt tấn công đúng chỗ nguy hiểm nhất: XXE, entity đệ quy
 * (billion laughs), và DTD trỏ ra mạng. Quét theo thẻ như dưới đây thì không có khái niệm
 * entity do tài liệu tự định nghĩa, nên các đòn đó không có chỗ bám.
 */

/** Chỉ giải mã 5 entity dựng sẵn của XML và tham chiếu ký tự dạng số. */
export function decodeXmlEntities(raw: string): string {
  if (!raw.includes('&')) return raw
  return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, name: string) => {
    switch (name) {
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      default:
        break
    }
    const code = name.startsWith('#x')
      ? Number.parseInt(name.slice(2), 16)
      : Number.parseInt(name.slice(1), 10)
    // Code point ngoài dải hợp lệ thì giữ nguyên chuỗi gốc — không đoán.
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
    try {
      return String.fromCodePoint(code)
    } catch {
      return match
    }
  })
}

/** Lấy giá trị một attribute trên đoạn thẻ mở đã cắt sẵn (ví dụ `name="Sheet1" r:id="rId1"`). */
export function attribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${escapeForRegExp(name)}\\s*=\\s*"([^"]*)"`)
  const found = pattern.exec(tag)
  return found?.[1] === undefined ? null : decodeXmlEntities(found[1])
}

/**
 * Nối chữ của mọi thẻ `<a:t>` / `<t>` bên trong một đoạn XML.
 *
 * `separator` cho phép người gọi chọn cách ghép: ô Excel nối liền các run, còn slide
 * PowerPoint tách đoạn bằng xuống dòng.
 */
export function collectTagText(xml: string, tagName: string, separator = ''): string {
  const pattern = new RegExp(
    `<${escapeForRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeForRegExp(tagName)}>`,
    'g',
  )
  const parts: string[] = []
  let found: RegExpExecArray | null
  while ((found = pattern.exec(xml)) !== null) {
    const body = found[1]
    if (body !== undefined) parts.push(decodeXmlEntities(body))
  }
  return parts.join(separator)
}

/** Cắt các khối `<tag ...>...</tag>` (không lồng nhau) thành mảng nội dung bên trong. */
export function sliceBlocks(xml: string, tagName: string): string[] {
  const pattern = new RegExp(
    `<${escapeForRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeForRegExp(tagName)}>`,
    'g',
  )
  const blocks: string[] = []
  let found: RegExpExecArray | null
  while ((found = pattern.exec(xml)) !== null) {
    const body = found[1]
    if (body !== undefined) blocks.push(body)
  }
  return blocks
}

function escapeForRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
