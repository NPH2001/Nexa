import { itemsOfType } from '../../model.js'
import { auditFields } from '../../rulebook.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * `R-FLD-02` — trường có kiểu nhận diện được phải đủ common validate của rulebook.
 *
 * Đây là nửa có giá trị của ask #3 và nó không cần vision (D7): `auditFields` đã tính sẵn phần
 * thiếu bằng cách so **khoá** với `===`, nên câu trả lời là xác định chứ không phải so khớp mờ.
 *
 * `requires: 'rulebook'` chứ không im lặng trả rỗng: bản cài không có rulebook thì luật này
 * **chưa được kiểm**, và báo cáo phải nói thế thay vì tính nó là một luật đã đạt.
 */
export const R_FLD_02: ReviewRule = {
  id: 'R-FLD-02',
  description: 'Trường có kiểu nhận diện được đủ common validate theo chuẩn tổ chức.',
  defaultSeverity: 'warning',
  requires: 'rulebook',
  evaluate: ({ doc, rulebook }) => {
    if (rulebook === null) return []
    return auditFields(itemsOfType(doc, 'field'), rulebook)
      .filter((audit) => audit.missing.length > 0)
      .map((audit) =>
        makeFinding(R_FLD_02, {
          itemId: audit.fieldId,
          message: `Trường "${audit.fieldName}" (kiểu ${audit.fieldType}) còn thiếu ${String(audit.missing.length)} validate của chuẩn tổ chức: ${audit.missing
            .map((rule) => rule.label)
            .join(', ')}.`,
          fix: `Bổ sung các validate còn thiếu (${audit.missing
            .map((rule) => rule.key)
            .join(', ')}), hoặc đánh dấu trường được miễn kèm lý do nếu chuẩn không áp dụng ở đây.`,
        }),
      )
  },
}
