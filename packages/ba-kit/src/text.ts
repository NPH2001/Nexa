/**
 * Chuẩn hoá text tiếng Việt cho việc so sánh — không phải cho việc hiển thị.
 *
 * Kết quả của module này chỉ dùng để dò trùng (`dedupe.ts`). Nội dung người dùng đọc luôn là bản
 * gốc; không có đường nào để bản đã bỏ dấu quay lại tài liệu.
 */

/**
 * Từ dừng bị loại trước khi so sánh.
 *
 * Danh sách này CỐ Ý ngắn và chỉ chứa hư từ. Từ mang nghĩa logic — `khong`, `va`, `hoac`, `neu`,
 * `phai`, `chi`, `moi`, `tru` — **không bao giờ** được thêm vào đây.
 *
 * Vì sao đây là điều quan trọng nhất trong file: nếu loại `khong`, thì "cho phép sửa đơn hàng" và
 * "không cho phép sửa đơn hàng" chuẩn hoá ra cùng một chuỗi. Bộ dò trùng sẽ báo hai rule ngược
 * nhau là trùng khít, và người dùng gộp mất một nửa nghiệp vụ. Một từ dừng sai ở đây gây hỏng dữ
 * liệu nghiệp vụ, không chỉ gây nhiễu kết quả.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'cua',
  'la',
  'cac',
  'nhung',
  'mot',
  'nay',
  'do',
  'kia',
  'o',
  'trong',
  'vao',
  'de',
  'tai',
  'ma',
  'se',
  'da',
  'dang',
  'cung',
  'rang',
  'thi',
  'khi',
  'voi',
  'cho',
  've',
  'boi',
  'nham',
])

/**
 * Từ mang nghĩa logic — khẳng định bằng test rằng chúng không lọt vào `STOPWORDS`.
 *
 * `nhung` vắng mặt ở đây có lý do: sau khi bỏ dấu, "nhưng" (liên từ) và "những" (từ chỉ số nhiều)
 * cùng thành `nhung`. Không tách được hai nghĩa thì phải chọn một, và chọn loại bỏ là an toàn —
 * cả hai đều không mang phủ định, nên loại chúng không đảo ngược nghĩa của mệnh đề nào.
 */
export const LOGICAL_WORDS: readonly string[] = [
  'khong',
  'va',
  'hoac',
  'neu',
  'phai',
  'chi',
  'moi',
  'tru',
]

/**
 * Bỏ dấu tiếng Việt.
 *
 * `đ`/`Đ` không phải là `d` + dấu phụ nên NFD không tách được — phải thay tay. Bỏ sót nó khiến
 * "đơn" và "don" thành hai token khác nhau, và mọi rule về đơn hàng hết dò trùng được.
 */
export function stripDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
}

/**
 * Chuỗi đã chuẩn hoá: bỏ dấu, hạ chữ, bỏ dấu câu, gộp khoảng trắng.
 *
 * Chưa bỏ từ dừng — dùng cho so sánh trùng khít, nơi thứ tự từ vẫn có nghĩa.
 */
export function normalizeText(input: string): string {
  return stripDiacritics(input)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Tập token đã bỏ từ dừng — dùng cho so sánh gần-trùng.
 *
 * Trả về `Set` nên thứ tự từ không còn ý nghĩa: "khách hàng huỷ đơn" và "đơn bị khách hàng huỷ"
 * ra cùng một tập. Đó là điều mong muốn cho việc gợi ý gần-trùng, và cũng là lý do kết quả chỉ
 * được dùng để **gắn cờ cho người dùng quyết định**, không bao giờ để tự gộp.
 */
export function tokenSet(input: string): Set<string> {
  const tokens = normalizeText(input)
    .split(' ')
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
  return new Set(tokens)
}

/**
 * Chữ giữ chỗ — ô đã được điền nhưng chưa nói gì.
 *
 * Vì sao cần tới một danh sách như thế này: Zod đã bắt buộc `actor`, `precondition`,
 * `postcondition` và `role` của use case phải khác rỗng, nên chúng KHÔNG BAO GIỜ trống ở tầng
 * schema. Thứ schema không phân biệt được là "Khách hàng" với "TBD" — cả hai đều là chuỗi hợp lệ.
 * Đó đúng là khoảng trống mà `R-UC-01` và `R-UC-04` phải lấp: một tài liệu điền "chưa xác định"
 * vào ô actor thì về hình thức là đầy đủ, về nghiệp vụ thì chưa ai trả lời.
 *
 * So khớp trên **toàn bộ giá trị đã chuẩn hoá**, không so khớp chuỗi con: một precondition
 * "Khách hàng chưa xác định phương thức thanh toán" là một câu thật, không phải chỗ trống.
 */
const PLACEHOLDERS: ReadonlySet<string> = new Set([
  'tbd',
  'tba',
  'todo',
  'na',
  'n a',
  'none',
  'null',
  'xxx',
  'x',
  'chua xac dinh',
  'chua ro',
  'chua co',
  'chua biet',
  'khong ro',
  'khong co',
  'dang cap nhat',
  'cap nhat sau',
  'update sau',
  'bo sung sau',
  'can bo sung',
])

/**
 * `true` khi giá trị là chỗ trống trá hình.
 *
 * Chuỗi chỉ gồm dấu câu (`-`, `?`, `...`) chuẩn hoá về rỗng và cũng tính là chỗ trống.
 */
export function isPlaceholder(value: string): boolean {
  const normalized = normalizeText(value)
  return normalized === '' || PLACEHOLDERS.has(normalized)
}

/** Jaccard trên hai tập token. Hai tập rỗng coi là không giống nhau, không phải giống hoàn toàn. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection += 1
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}
