import { itemsOfType } from '../../model.js'
import { isPlaceholder } from '../../text.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * `R-UC-02` — mỗi use case có ít nhất một luồng thay thế, hoặc ghi rõ vì sao không có.
 *
 * Lối thoát bằng lý do là cố ý: có những use case thật sự chỉ có một đường đi. Cái không chấp
 * nhận được là bỏ trống im lặng — vì khi đó không ai biết là đã cân nhắc hay là đã quên.
 */
export const R_UC_02: ReviewRule = {
  id: 'R-UC-02',
  description: 'Mỗi use case có luồng thay thế, hoặc nêu lý do không có.',
  defaultSeverity: 'warning',
  evaluate: ({ doc }) =>
    itemsOfType(doc, 'use_case').flatMap((useCase) => {
      if (useCase.alternateFlows.length > 0) return []

      const reason = useCase.noAlternateReason
      if (reason !== undefined && !isPlaceholder(reason)) return []

      return [
        makeFinding(R_UC_02, {
          itemId: useCase.id,
          message:
            reason === undefined
              ? `Use case "${useCase.name}" không có luồng thay thế nào và cũng không nói vì sao.`
              : `Use case "${useCase.name}" khai lý do không có luồng thay thế bằng chữ giữ chỗ.`,
          fix: 'Bổ sung luồng thay thế, hoặc ghi lý do cụ thể vì sao use case này chỉ có một đường đi.',
        }),
      ]
    }),
}
