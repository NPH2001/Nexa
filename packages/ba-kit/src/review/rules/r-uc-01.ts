import { itemsOfType } from '../../model.js'
import { isPlaceholder } from '../../text.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * `R-UC-01` — mỗi use case có actor, precondition, luồng chính và postcondition **nói được điều gì đó**.
 *
 * Vì sao luật này không thừa dù Zod đã bắt buộc bốn ô đó khác rỗng: schema phân biệt được "có
 * chữ" với "không có chữ", nó không phân biệt được "Khách hàng" với "TBD". Một tài liệu điền
 * "chưa xác định" vào ô actor thì qua schema, qua cả bản xuất theo mẫu, và chỉ vỡ ra ở lúc lập
 * trình — đúng loại im lặng sai mà change này được viết ra để tránh.
 *
 * Nên phần luật này thật sự kiểm là **chỗ trống trá hình**, và nó là blocker: không biết ai làm
 * thì không review tiếp được cái gì.
 */
export const R_UC_01: ReviewRule = {
  id: 'R-UC-01',
  description: 'Mỗi use case nêu rõ actor, điều kiện trước, luồng chính và điều kiện sau.',
  defaultSeverity: 'blocker',
  evaluate: ({ doc }) =>
    itemsOfType(doc, 'use_case').flatMap((useCase) => {
      const blanks: string[] = []
      if (isPlaceholder(useCase.actor)) blanks.push('actor')
      if (isPlaceholder(useCase.precondition)) blanks.push('điều kiện trước')
      if (isPlaceholder(useCase.postcondition)) blanks.push('điều kiện sau')
      if (useCase.mainFlow.every((step) => isPlaceholder(step))) blanks.push('luồng chính')

      if (blanks.length === 0) return []
      return [
        makeFinding(R_UC_01, {
          itemId: useCase.id,
          message: `Use case "${useCase.name}" còn để trống bằng chữ giữ chỗ: ${blanks.join(', ')}.`,
          fix: `Điền nội dung thật cho ${blanks.join(', ')}. Tài liệu nguồn chưa nói thì hỏi lại người ra yêu cầu, đừng đoán.`,
        }),
      ]
    }),
}
