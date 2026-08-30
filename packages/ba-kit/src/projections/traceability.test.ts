import { describe, expect, it } from 'vitest'
import { buildTraceabilityMatrix } from './traceability.js'
import { makeFlowStep, makeModel, makeUseCase } from '../testing.js'

describe('ma trận truy vết flow ↔ use case', () => {
  it('đọc đúng chiều covers: use case phủ bước', () => {
    const matrix = buildTraceabilityMatrix(
      makeModel(
        [makeUseCase({ id: 'uc-1' }), makeFlowStep({ id: 'fs-1' })],
        [{ from: 'uc-1', to: 'fs-1', kind: 'covers' }],
      ),
    )

    expect(matrix.steps[0]?.coveredBy).toEqual(['uc-1'])
    expect(matrix.useCases[0]?.covers).toEqual(['fs-1'])
    expect(matrix.uncoveredSteps).toEqual([])
    expect(matrix.unusedUseCases).toEqual([])
  })

  it('link ngược chiều không được tính là đã phủ', () => {
    const matrix = buildTraceabilityMatrix(
      makeModel(
        [makeUseCase({ id: 'uc-1' }), makeFlowStep({ id: 'fs-1' })],
        [{ from: 'fs-1', to: 'uc-1', kind: 'covers' }],
      ),
    )
    expect(matrix.uncoveredSteps).toEqual(['fs-1'])
  })

  it('chỉ ra bước chưa use case nào phủ', () => {
    const matrix = buildTraceabilityMatrix(
      makeModel([
        makeFlowStep({ id: 'fs-1', label: 'Kiểm tra tồn kho', ordinal: 0 }),
        makeFlowStep({ id: 'fs-2', label: 'Tạo đơn', ordinal: 1 }),
      ]),
    )
    expect(matrix.uncoveredSteps).toEqual(['fs-1', 'fs-2'])
  })

  it('chỉ ra use case không chạm bước nào', () => {
    const matrix = buildTraceabilityMatrix(makeModel([makeUseCase({ id: 'uc-1' })]))
    expect(matrix.unusedUseCases).toEqual(['uc-1'])
  })

  it('use case tự khai standalone thì được miễn', () => {
    const matrix = buildTraceabilityMatrix(
      makeModel([makeUseCase({ id: 'uc-1', standalone: true })]),
    )
    expect(matrix.unusedUseCases).toEqual([])
  })

  it('bước chỉ được phủ bởi use case chưa soát thì vẫn tính là chưa phủ', () => {
    const matrix = buildTraceabilityMatrix(
      makeModel(
        [makeUseCase({ id: 'uc-1', needsReview: true }), makeFlowStep({ id: 'fs-1' })],
        [{ from: 'uc-1', to: 'fs-1', kind: 'covers' }],
      ),
    )
    expect(matrix.uncoveredSteps).toEqual(['fs-1'])
    expect(matrix.excludedNeedsReview).toBe(1)
  })

  it('một bước có thể được nhiều use case phủ', () => {
    const matrix = buildTraceabilityMatrix(
      makeModel(
        [
          makeUseCase({ id: 'uc-2', name: 'Huỷ đơn', ordinal: 1 }),
          makeUseCase({ id: 'uc-1', name: 'Đặt đơn', ordinal: 0 }),
          makeFlowStep({ id: 'fs-1' }),
        ],
        [
          { from: 'uc-2', to: 'fs-1', kind: 'covers' },
          { from: 'uc-1', to: 'fs-1', kind: 'covers' },
        ],
      ),
    )
    expect(matrix.steps[0]?.coveredBy).toEqual(['uc-1', 'uc-2'])
  })

  it('mô hình rỗng cho ra ma trận rỗng chứ không lỗi', () => {
    const matrix = buildTraceabilityMatrix(makeModel([]))
    expect(matrix.steps).toEqual([])
    expect(matrix.useCases).toEqual([])
  })
})
