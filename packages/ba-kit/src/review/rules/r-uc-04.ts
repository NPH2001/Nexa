import { itemsOfType } from '../../model.js'
import { isPlaceholder } from '../../text.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * `R-UC-04` — mỗi use case nêu role/quyền được phép thực hiện.
 *
 * Tách khỏi `R-UC-01` vì đây là câu hỏi khác hẳn: `actor` nói **ai làm**, `role` nói **ai được
 * phép làm**. Hai thứ trùng nhau trong phần lớn use case và khác nhau đúng ở những use case dễ
 * hỏng nhất — người dùng cuối bấm được nút mà chỉ quản trị viên mới được bấm.
 *
 * Giống `R-UC-01`, phần schema không kiểm được là chữ giữ chỗ.
 */
export const R_UC_04: ReviewRule = {
  id: 'R-UC-04',
  description: 'Mỗi use case nêu role hoặc quyền được thực hiện.',
  defaultSeverity: 'warning',
  evaluate: ({ doc }) =>
    itemsOfType(doc, 'use_case')
      .filter((useCase) => isPlaceholder(useCase.role))
      .map((useCase) =>
        makeFinding(R_UC_04, {
          itemId: useCase.id,
          message: `Use case "${useCase.name}" chưa nêu role được phép thực hiện.`,
          fix: 'Ghi rõ role hoặc quyền được thực hiện use case này — đây là căn cứ để phân quyền, không phải chú thích.',
        }),
      ),
}
