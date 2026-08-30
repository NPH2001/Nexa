import { itemsOfType } from '../../model.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * `R-UC-05` — tác động dữ liệu của use case phải nói được một điều nhất quán.
 *
 * Schema đã bắt `dataEffects` có ít nhất một phần tử, nên "chưa khai" là chuyện không xảy ra được.
 * Thứ schema cho qua là một **khai báo tự mâu thuẫn**: `['none', 'create']` vừa nói use case
 * không đụng dữ liệu vừa nói nó tạo dữ liệu. Đó không phải lỗi gõ nhầm vô hại — nó là lý do một
 * use case bị bỏ qua khi rà soát các điểm ghi dữ liệu.
 */
export const R_UC_05: ReviewRule = {
  id: 'R-UC-05',
  description: 'Mỗi use case ghi tác động dữ liệu nhất quán (tạo/sửa/xoá/đọc/không).',
  defaultSeverity: 'warning',
  evaluate: ({ doc }) =>
    itemsOfType(doc, 'use_case')
      .filter(
        (useCase) => useCase.dataEffects.includes('none') && useCase.dataEffects.length > 1,
      )
      .map((useCase) =>
        makeFinding(R_UC_05, {
          itemId: useCase.id,
          message: `Use case "${useCase.name}" vừa khai không tác động dữ liệu vừa khai ${useCase.dataEffects
            .filter((effect) => effect !== 'none')
            .join(', ')}.`,
          fix: 'Chọn một: bỏ "không tác động" nếu use case có ghi dữ liệu, hoặc bỏ các tác động còn lại nếu nó thật sự chỉ đọc.',
        }),
      ),
}
