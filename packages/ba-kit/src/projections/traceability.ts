import type { BaDocModel } from '../model.js'
import { itemsOfType } from '../model.js'

/**
 * Ma trận truy vết bước flow ↔ use case (ask #5).
 *
 * Gần như miễn phí khi cả hai đã có cấu trúc — đó chính là lập luận của D1. Và nó không chỉ để
 * xem: hai danh sách ô trống dưới đây là đầu vào trực tiếp của `R-FLOW-01` và `R-FLOW-02` ở G3.
 *
 * Chiều của cạnh `covers` là use_case → flow_step (xem `LINK_KINDS`). Đọc sai chiều thì ma trận
 * vẫn ra bảng, chỉ là bảng nói ngược — nên nó được khẳng định bằng test.
 */

export interface TraceabilityStep {
  readonly id: string
  readonly label: string
  readonly coveredBy: readonly string[]
}

export interface TraceabilityUseCase {
  readonly id: string
  readonly name: string
  readonly standalone: boolean
  readonly covers: readonly string[]
}

export interface TraceabilityMatrix {
  readonly steps: readonly TraceabilityStep[]
  readonly useCases: readonly TraceabilityUseCase[]
  /** Bước không use case nào phủ — `R-FLOW-01`. */
  readonly uncoveredSteps: readonly string[]
  /** Use case không chạm bước nào và không tự khai `standalone` — `R-FLOW-02`. */
  readonly unusedUseCases: readonly string[]
  /** Số item bị bỏ vì còn cần soát; phải hiển thị chứ không được giấu (D4). */
  readonly excludedNeedsReview: number
}

export function buildTraceabilityMatrix(model: BaDocModel): TraceabilityMatrix {
  const allSteps = itemsOfType(model, 'flow_step')
  const allUseCases = itemsOfType(model, 'use_case')

  const steps = allSteps.filter((step) => !step.needsReview).slice().sort((a, b) => a.ordinal - b.ordinal)
  const useCases = allUseCases
    .filter((useCase) => !useCase.needsReview)
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)

  const stepIds = new Set(steps.map((step) => step.id))
  const useCaseIds = new Set(useCases.map((useCase) => useCase.id))

  const coveredBy = new Map<string, string[]>()
  const covers = new Map<string, string[]>()

  const append = (index: Map<string, string[]>, key: string, value: string): void => {
    const existing = index.get(key)
    if (existing === undefined) index.set(key, [value])
    else existing.push(value)
  }

  for (const link of model.links) {
    if (link.kind !== 'covers') continue
    // Bỏ link trỏ tới item đã bị loại vì `needsReview`: một bước "được phủ" bởi một use case chưa
    // ai soát thì thực chất vẫn chưa được phủ.
    if (!useCaseIds.has(link.from) || !stepIds.has(link.to)) continue
    append(coveredBy, link.to, link.from)
    append(covers, link.from, link.to)
  }

  const stepRows = steps.map((step) => ({
    id: step.id,
    label: step.label,
    coveredBy: (coveredBy.get(step.id) ?? []).slice().sort(),
  }))

  const useCaseRows = useCases.map((useCase) => ({
    id: useCase.id,
    name: useCase.name,
    standalone: useCase.standalone,
    covers: (covers.get(useCase.id) ?? []).slice().sort(),
  }))

  return {
    steps: stepRows,
    useCases: useCaseRows,
    uncoveredSteps: stepRows.filter((row) => row.coveredBy.length === 0).map((row) => row.id),
    unusedUseCases: useCaseRows
      .filter((row) => !row.standalone && row.covers.length === 0)
      .map((row) => row.id),
    excludedNeedsReview:
      allSteps.length - steps.length + (allUseCases.length - useCases.length),
  }
}
