import { itemsOfType } from '../../model.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * `R-UC-03` — mỗi use case có ít nhất một luồng ngoại lệ.
 *
 * Không có lối thoát bằng lý do, khác `R-UC-02`. Đó là chủ đích: một use case chạm dữ liệu thật
 * luôn có ít nhất một cách hỏng — mất mạng, hết hạn phiên, dữ liệu không hợp lệ. "Không có ngoại
 * lệ nào" gần như luôn nghĩa là chưa nghĩ tới, và đây đúng là câu hỏi "đã đủ case chưa" mà bộ
 * luật sinh ra để trả lời.
 */
export const R_UC_03: ReviewRule = {
  id: 'R-UC-03',
  description: 'Mỗi use case có ít nhất một luồng ngoại lệ.',
  defaultSeverity: 'warning',
  evaluate: ({ doc }) =>
    itemsOfType(doc, 'use_case')
      .filter((useCase) => useCase.exceptionFlows.length === 0)
      .map((useCase) =>
        makeFinding(R_UC_03, {
          itemId: useCase.id,
          message: `Use case "${useCase.name}" chưa có luồng ngoại lệ nào.`,
          fix: 'Bổ sung ít nhất một luồng ngoại lệ: dữ liệu không hợp lệ, hết quyền, hoặc hệ thống phụ thuộc không phản hồi.',
        }),
      ),
}
