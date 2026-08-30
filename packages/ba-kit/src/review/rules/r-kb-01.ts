import { compareStatements } from '../../dedupe.js'
import { itemsOfType } from '../../model.js'
import { makeFinding, type BaKnowledgeFact, type ReviewRule } from '../types.js'

/**
 * `R-KB-01` — không có khẳng định mâu thuẫn với tri thức đã xác nhận của tổ chức.
 *
 * Đây là luật khiến review đáng làm (D2). Mười bốn luật còn lại kiểm tính đầy đủ **về hình thức**:
 * hữu ích, nhưng bất kỳ công cụ nào cũng làm được. Luật này kiểm tài liệu **so với những gì tổ
 * chức đã chốt** — việc không công cụ nào làm được nếu không có một kho tri thức có trạng thái.
 *
 * Ba quyết định định hình nó:
 *
 * 1. **Chỉ item `confirmed` được làm căn cứ.** Một item `draft` là ý kiến của một người chưa qua
 *    xác nhận; lấy nó ra bắt lỗi tài liệu của người khác thì "confirm" thôi mang nghĩa. Bộ chạy đã
 *    lọc, và luật lọc lại — đây là loại bất biến đáng trả giá bằng một dòng thừa.
 *
 * 2. **So bằng chuẩn hoá tiếng Việt + Jaccard, không embedding** (D5). Cần xác định, cần test
 *    được, cần chạy được không mạng. `compareStatements` là đúng phép đo mà bộ dò trùng dùng, nên
 *    Nexa chỉ có MỘT định nghĩa "thế nào là hai câu nói ngược nhau".
 *
 * 3. **Chỉ đối chiếu `rule`.** Quy tắc trong mô hình đã là mệnh đề nguyên tử ≤200 ký tự (D5), tức
 *    là đúng hình dạng mà phép đo trên tập token có nghĩa. Đem so cả một luồng chính 12 bước với
 *    một item tri thức thì tỉ lệ trùng token loãng ra và kết quả thành ngẫu nhiên — tệ hơn không
 *    kiểm, vì nó vẫn ra một con số trông như bằng chứng.
 *
 * Luật chỉ báo **nghi mâu thuẫn** và trỏ tới item tri thức làm căn cứ. Nó không tự sửa và không
 * kết luận bên nào đúng: tri thức cũng có thể là cái đã lỗi thời.
 */
export const R_KB_01: ReviewRule = {
  id: 'R-KB-01',
  description: 'Không có khẳng định mâu thuẫn với tri thức nghiệp vụ đã xác nhận.',
  defaultSeverity: 'blocker',
  requires: 'knowledge',
  evaluate: ({ doc, knowledge }) => {
    const confirmed = knowledge.filter((fact) => fact.status === 'confirmed')
    if (confirmed.length === 0) return []

    return itemsOfType(doc, 'rule').flatMap((rule) =>
      confirmed.flatMap((fact) => {
        const against = closestClaim(rule.statement, fact)
        if (!against.contradictory) return []

        return [
          makeFinding(R_KB_01, {
            itemId: rule.id,
            message: `Quy tắc "${rule.statement}" có vẻ ngược với tri thức đã xác nhận "${fact.title}": ${against.claim}`,
            fix: 'Đối chiếu lại với người chốt nghiệp vụ. Nếu tài liệu đúng thì cập nhật mục tri thức và đánh dấu bản cũ đã thay thế; nếu tri thức đúng thì sửa quy tắc trong tài liệu.',
            evidence: [fact.id],
          }),
        ]
      }),
    )
  },
}

/**
 * Vế của item tri thức khớp nhất với khẳng định đang xét.
 *
 * So với cả tiêu đề và nội dung vì hai cách ghi tri thức đều gặp: có người đặt trọn quy tắc vào
 * tiêu đề ("Đơn dưới 500k không được miễn phí giao hàng"), có người để tiêu đề là chủ đề và viết
 * quy tắc trong nội dung. Lấy vế giống hơn, hoà thì lấy nội dung.
 */
function closestClaim(
  statement: string,
  fact: BaKnowledgeFact,
): { readonly claim: string; readonly contradictory: boolean } {
  const body = compareStatements(statement, fact.body)
  const title = compareStatements(statement, fact.title)
  return title.similarity > body.similarity
    ? { claim: fact.title, contradictory: title.contradictory }
    : { claim: fact.body, contradictory: body.contradictory }
}
