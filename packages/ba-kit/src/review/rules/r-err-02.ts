import { buildErrorCodePage } from '../../projections/error-codes.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * `R-ERR-02` — một mã lỗi không mang hai thông điệp khác nhau.
 *
 * Blocker, không phải warning: hai thông điệp cho cùng một mã nghĩa là bộ phận hỗ trợ tra mã ra
 * hai câu trả lời khác nhau cho cùng một sự cố. Đây là loại lỗi rất rẻ để sửa lúc này và rất đắt
 * để sửa sau khi đã lên tài liệu API.
 */
export const R_ERR_02: ReviewRule = {
  id: 'R-ERR-02',
  description: 'Một mã lỗi chỉ mang một thông điệp.',
  defaultSeverity: 'blocker',
  evaluate: ({ doc }) =>
    buildErrorCodePage(doc).inconsistent.map((entry) =>
      makeFinding(R_ERR_02, {
        // Không trỏ vào một biến thể nào: chọn một cái làm "đúng" là việc của người dùng.
        itemId: null,
        message: `Mã lỗi ${entry.code} đang mang ${String(entry.variants.length)} thông điệp khác nhau: ${entry.variants
          .map((variant) => `"${variant.message}"`)
          .join(' · ')}.`,
        fix: 'Chọn một thông điệp duy nhất cho mã này, hoặc tách thành hai mã riêng nếu đây thật sự là hai tình huống khác nhau.',
        evidence: entry.variants.map((variant) => variant.itemId),
      }),
    ),
}
