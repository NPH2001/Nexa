import { itemsOfType } from '../../model.js'
import { isPlaceholder } from '../../text.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * `R-FLD-01` — mọi trường có ràng buộc kiểm tra, hoặc được miễn kèm lý do.
 *
 * Ba cách một trường được coi là đã có kiểm tra, và cả ba đều tính:
 *   - tự khai khoá validate của rulebook,
 *   - có một quy tắc nghiệp vụ trỏ tới nó (`appliesTo` hoặc liên kết `validates`),
 *   - được miễn kèm lý do cụ thể.
 *
 * Đếm cả quy tắc chứ không chỉ đếm khoá rulebook là điểm chính: rất nhiều ràng buộc thật là
 * nghiệp vụ chứ không phải định dạng ("ngày kết thúc phải sau ngày bắt đầu"), và một luật chỉ nhìn
 * rulebook sẽ báo thiếu ở đúng những trường được chăm nhất.
 */
export const R_FLD_01: ReviewRule = {
  id: 'R-FLD-01',
  description: 'Mọi trường có ràng buộc kiểm tra, hoặc được miễn kèm lý do.',
  defaultSeverity: 'warning',
  evaluate: ({ doc }) => {
    const constrained = new Set<string>()
    for (const rule of itemsOfType(doc, 'rule')) {
      for (const target of rule.appliesTo) constrained.add(target)
    }
    for (const link of doc.links) {
      if (link.kind === 'validates') constrained.add(link.to)
    }

    return itemsOfType(doc, 'field').flatMap((field) => {
      if (field.validations.length > 0 || constrained.has(field.id)) return []

      const reason = field.noValidationReason
      if (reason !== undefined && !isPlaceholder(reason)) return []

      return [
        makeFinding(R_FLD_01, {
          itemId: field.id,
          message:
            reason === undefined
              ? `Trường "${field.name}" chưa có ràng buộc kiểm tra nào và cũng không được miễn.`
              : `Trường "${field.name}" khai lý do miễn kiểm tra bằng chữ giữ chỗ.`,
          fix: 'Thêm validate theo chuẩn tổ chức, gắn một quy tắc nghiệp vụ vào trường này, hoặc ghi lý do cụ thể vì sao trường này không cần kiểm tra.',
        }),
      ]
    })
  },
}
