import { buildTraceabilityMatrix } from '../../projections/traceability.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * `R-FLOW-01` — mọi bước luồng phải được ít nhất một use case phủ.
 *
 * Không tính lại gì: ma trận truy vết của G2 đã trả sẵn `uncoveredSteps`. Một bước không use case
 * nào phủ là bước sẽ được lập trình mà không ai viết kịch bản kiểm thử cho nó.
 */
export const R_FLOW_01: ReviewRule = {
  id: 'R-FLOW-01',
  description: 'Mọi bước luồng được ít nhất một use case phủ.',
  defaultSeverity: 'warning',
  evaluate: ({ doc }) => {
    const matrix = buildTraceabilityMatrix(doc)
    const labels = new Map(matrix.steps.map((step) => [step.id, step.label] as const))
    return matrix.uncoveredSteps.map((stepId) =>
      makeFinding(R_FLOW_01, {
        itemId: stepId,
        message: `Bước "${labels.get(stepId) ?? stepId}" chưa được use case nào phủ.`,
        fix: 'Nối bước này vào một use case bằng liên kết "phủ", hoặc bỏ bước nếu nó không thuộc phạm vi tài liệu.',
      }),
    )
  },
}
