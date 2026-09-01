/**
 * Nhận ra ô ngày/giờ trong bảng tính và đổi số serial thành ngày đọc được.
 *
 * Excel không lưu ngày. Nó lưu một con số — số ngày kể từ 30/12/1899 — rồi để **định dạng
 * hiển thị** quyết định con số đó trông ra ngày hay ra số. Cùng giá trị `45678` sẽ hiện là
 * "15/01/2025" ở ô này và "45678" ở ô kia, chỉ khác nhau ở style.
 *
 * Nếu bỏ qua tầng style đó, một cột tiêu đề "Ngày ký" sẽ tới model dưới dạng `45678`. Model
 * không có cách nào biết đó là ngày, nên nó sẽ trả lời tự tin về một con số — kiểu sai âm thầm
 * tệ nhất, vì câu trả lời trông vẫn hợp lý.
 *
 * Kết quả xuất ra theo ISO (`2025-01-15`) chứ không theo `dd/mm/yyyy`. Người Việt đọc quen
 * `dd/mm`, nhưng người đọc ở đây là model, và `03/04/2025` là ngày 3 tháng 4 hay 4 tháng 3 thì
 * không định dạng nào nói được — ISO thì không mơ hồ.
 */

/**
 * Các mã định dạng dựng sẵn mang ngày hoặc giờ.
 *
 * 14-17 ngày, 18-21 giờ, 22 ngày+giờ, 45-47 các biến thể thời lượng. Excel không ghi
 * `formatCode` cho chúng vào file — mọi bộ đọc đều phải mang sẵn bảng này.
 */
const BUILT_IN_DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

/** Chỉ có giờ, không có ngày — dùng để không in ra một ngày mà người dùng chưa từng thấy. */
const BUILT_IN_TIME_ONLY_FORMAT_IDS = new Set([18, 19, 20, 21, 45, 46, 47])

export interface NumberFormat {
  readonly id: number
  /** Chuỗi định dạng tuỳ biến, nếu file có khai. */
  readonly code?: string
}

export function isDateFormat(format: NumberFormat | undefined): boolean {
  if (format === undefined) return false
  if (format.code !== undefined) return codeLooksLikeDate(format.code)
  return BUILT_IN_DATE_FORMAT_IDS.has(format.id)
}

function isTimeOnlyFormat(format: NumberFormat): boolean {
  if (format.code !== undefined) {
    const stripped = stripLiterals(format.code)
    return !/[ymd]/i.test(stripped) && /[hs]/i.test(stripped)
  }
  return BUILT_IN_TIME_ONLY_FORMAT_IDS.has(format.id)
}

/**
 * Một `formatCode` có phải định dạng ngày không.
 *
 * Phải bỏ phần văn bản trong ngoặc kép và các ký tự escape trước đã: `"Ngày "0` là định dạng
 * SỐ có tiền tố chữ, và chữ `y` `d` trong đó không nói lên điều gì về giá trị.
 */
function codeLooksLikeDate(code: string): boolean {
  const stripped = stripLiterals(code)
  return /[ymdhs]/i.test(stripped)
}

function stripLiterals(code: string): string {
  return (
    code
      // Văn bản trong ngoặc kép.
      .replace(/"[^"]*"/g, '')
      // Ký tự escape bằng dấu gạch chéo ngược.
      .replace(/\\./g, '')
      // Mã màu và điều kiện: [Red], [<=100], [$-409].
      .replace(/\[[^\]]*\]/g, '')
  )
}

/**
 * Đổi số serial của Excel thành chuỗi ngày ISO.
 *
 * Mốc là 30/12/1899 chứ không phải 31/12: Excel cố ý giữ lại lỗi coi năm 1900 là năm nhuận của
 * Lotus 1-2-3 để tương thích ngược, nên mọi ngày từ 01/03/1900 trở đi bị lệch một ngày so với
 * cách tính đúng. Lùi mốc đi một ngày là cách bù lại lỗi đó cho toàn bộ dải ngày dùng thật.
 */
export function formatExcelSerial(serial: number, format: NumberFormat): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null

  const days = Math.floor(serial)
  const fraction = serial - days
  // Làm tròn về giây: 0.5 ngày lưu dưới dạng nhị phân không bao giờ ra đúng 12:00:00.
  const secondsOfDay = Math.round(fraction * 86_400)

  if (isTimeOnlyFormat(format) || days === 0) {
    return formatClock(secondsOfDay, true)
  }

  const at = new Date(Date.UTC(1899, 11, 30) + days * 86_400_000)
  if (Number.isNaN(at.getTime())) return null

  const date = [
    String(at.getUTCFullYear()).padStart(4, '0'),
    String(at.getUTCMonth() + 1).padStart(2, '0'),
    String(at.getUTCDate()).padStart(2, '0'),
  ].join('-')

  return secondsOfDay === 0 ? date : `${date} ${formatClock(secondsOfDay, false)}`
}

function formatClock(secondsOfDay: number, withSeconds: boolean): string {
  const seconds = ((secondsOfDay % 86_400) + 86_400) % 86_400
  const parts = [
    String(Math.floor(seconds / 3600)).padStart(2, '0'),
    String(Math.floor((seconds % 3600) / 60)).padStart(2, '0'),
  ]
  if (withSeconds || seconds % 60 !== 0) parts.push(String(seconds % 60).padStart(2, '0'))
  return parts.join(':')
}
