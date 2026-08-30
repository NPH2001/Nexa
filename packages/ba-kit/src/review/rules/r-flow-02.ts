import { buildTraceabilityMatrix } from '../../projections/traceability.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * `R-FLOW-02` — mọi use case chạm ít nhất một bước luồng, hoặc tự khai `standalone`.
 *
 * Chiều ngược của `R-FLOW-01`. `standalone` là lối thoát hợp lệ và có chủ ý: một use case quản trị
 * chạy ngoài luồng chính vẫn là use case thật. Cái luật bắt là use case **im lặng** không nằm
 * trong luồng nào — thường là dấu hiệu luồng chưa vẽ xong chứ không phải use case thừa.
 */
export const R_FLOW_02: ReviewRule = {
  id: 'R-FLOW-02',
  description: 'Mọi use case được ít nhất một bước luồng chạm tới, hoặc đánh dấu độc lập.',
  defaultSeverity: 'warning',
  evaluate: ({ doc }) => {
    const matrix = buildTraceabilityMatrix(doc)
    const names = new Map(matrix.useCases.map((useCase) => [useCase.id, useCase.name] as const))
    return matrix.unusedUseCases.map((useCaseId) =>
      makeFinding(R_FLOW_02, {
        itemId: useCaseId,
        message: `Use case "${names.get(useCaseId) ?? useCaseId}" chưa chạm bước luồng nào.`,
        fix: 'Nối use case này với các bước luồng nó phủ, hoặc đánh dấu là use case độc lập nếu nó cố ý nằm ngoài luồng.',
      }),
    )
  },
}
