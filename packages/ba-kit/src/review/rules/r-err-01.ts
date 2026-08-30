import { buildErrorCodePage } from '../../projections/error-codes.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * `R-ERR-01` — bảng mã lỗi và các luồng phải khớp nhau theo cả hai chiều.
 *
 * Trang mã lỗi của G1 đã tính sẵn cả hai chiều, nên luật này chỉ gói lại. Hai chiều mang mức khác
 * nhau vì hậu quả khác nhau:
 *   - Mã được nhắc trong luồng mà **chưa khai báo** là blocker: người lập trình sẽ tự nghĩ ra một
 *     thông điệp, và mỗi người nghĩ một kiểu.
 *   - Mã đã khai báo mà **không luồng nào dùng** là warning: có thể là mã chết, cũng có thể là
 *     luồng chưa vẽ xong. Cần người nhìn, không cần chặn.
 */
export const R_ERR_01: ReviewRule = {
  id: 'R-ERR-01',
  description: 'Mã lỗi nêu trong luồng đều có trong bảng mã lỗi, và ngược lại.',
  defaultSeverity: 'warning',
  evaluate: ({ doc }) => {
    const page = buildErrorCodePage(doc)

    const undeclared = page.undeclared.map((entry) =>
      makeFinding(R_ERR_01, {
        severity: 'blocker',
        itemId: null,
        message: `Mã lỗi ${entry.code} được nhắc ở ${String(entry.referencedBy.length)} nơi nhưng chưa có trong bảng mã lỗi.`,
        fix: `Khai báo ${entry.code} trong bảng mã lỗi kèm thông điệp hiển thị, hoặc sửa nơi tham chiếu nếu mã bị gõ sai.`,
        evidence: entry.referencedBy,
      }),
    )

    const unreferenced = page.unreferenced.map((entry) =>
      makeFinding(R_ERR_01, {
        itemId: entry.itemId,
        message: `Mã lỗi ${entry.code} đã khai báo nhưng chưa luồng hay use case nào phát sinh nó.`,
        fix: 'Nối mã này vào bước hoặc luồng ngoại lệ phát sinh ra nó, hoặc bỏ khỏi bảng nếu nó không còn dùng.',
      }),
    )

    return [...undeclared, ...unreferenced]
  },
}
