/**
 * Tiện ích dùng chung cho ba định dạng nhị phân Office 97-2003.
 *
 * Chúng ra đời trước khi Unicode phổ biến, nên chuỗi trong file có thể ở một trong hai dạng:
 * 8-bit theo code page của máy soạn thảo, hoặc UTF-16LE. Ở đây mặc định code page là
 * windows-1252 — đúng cho tuyệt đại đa số file tiếng Anh/Tây Âu, và cũng là điều duy nhất suy
 * ra được khi file không ghi lại code page gốc.
 *
 * Với tiếng Việt, file `.doc` cũ thường dùng TCVN3/VNI (font-based, không phải code page thật)
 * và sẽ ra chữ sai dấu. Đó là giới hạn có thật của định dạng, không phải lỗi đọc: bản thân
 * file không mang đủ thông tin để phân biệt. Người dùng nên lưu lại dạng `.docx`.
 */

let cp1252Decoder: TextDecoder | null | undefined

export function decodeCp1252(bytes: Buffer): string {
  if (cp1252Decoder === undefined) {
    try {
      cp1252Decoder = new TextDecoder('windows-1252')
    } catch {
      cp1252Decoder = null
    }
  }
  // Runtime không có bảng mã đó: latin1 trùng windows-1252 ở mọi vị trí trừ dải 0x80-0x9F.
  return cp1252Decoder === null ? bytes.toString('latin1') : cp1252Decoder.decode(bytes)
}

export function decodeUtf16Le(bytes: Buffer): string {
  return bytes.toString('utf16le')
}

/**
 * Chuẩn hoá các ký tự điều khiển riêng của Word/PowerPoint về văn bản thường.
 *
 * Chúng không phải rác ngẫu nhiên mà là cấu trúc: 0x07 kết thúc ô bảng, 0x0B là ngắt dòng mềm,
 * 0x0D kết thúc đoạn. Ánh xạ đúng thì bảng biểu vẫn còn hình hài sau khi trích xuất.
 */
export function normalizeLegacyControlChars(raw: string): string {
  let out = ''
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0
    switch (code) {
      case 0x07: // kết thúc ô / hàng trong bảng
        out += '\t'
        break
      case 0x0b: // ngắt dòng mềm
      case 0x0c: // ngắt trang
      case 0x0d: // kết thúc đoạn
      case 0x0e: // ngắt cột
        out += '\n'
        break
      case 0x1e: // gạch nối không ngắt
        out += '-'
        break
      case 0xa0: // khoảng trắng không ngắt
        out += ' '
        break
      case 0x00:
      case 0x01: // đối tượng nhúng
      case 0x02: // dấu chú thích chân trang
      case 0x03:
      case 0x04:
      case 0x05: // dấu chú thích
      case 0x08: // đối tượng vẽ
      case 0x1f: // gạch nối tuỳ chọn
        break
      default:
        out += character
    }
  }
  return out
}

/**
 * Bỏ phần chỉ dẫn của field, giữ lại kết quả.
 *
 * Trong Word, `{ HYPERLINK "http://…" }` được lưu thành: 0x13 chỉ-dẫn 0x14 kết-quả 0x15. Người
 * dùng chỉ nhìn thấy phần kết quả, nên nếu giữ cả chỉ dẫn thì model đọc được những chuỗi mà
 * người gửi file không hề biết là mình đang gửi.
 */
export function stripFieldInstructions(raw: string): string {
  let out = ''
  let depth = 0
  let inInstruction = false

  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0
    if (code === 0x13) {
      depth++
      inInstruction = true
      continue
    }
    if (code === 0x14) {
      inInstruction = false
      continue
    }
    if (code === 0x15) {
      if (depth > 0) depth--
      inInstruction = false
      continue
    }
    if (depth > 0 && inInstruction) continue
    out += character
  }
  return out
}
