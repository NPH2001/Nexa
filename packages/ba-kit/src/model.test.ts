import { describe, expect, it } from 'vitest'
import { LIMITS, baDocItemSchema, itemsOfType, reviewedItems } from './model.js'
import { makeErrorCode, makeModel, makeRule, makeUseCase } from './testing.js'

describe('schema mô hình tài liệu', () => {
  it('điền giá trị mặc định cho needsReview và sources', () => {
    const useCase = makeUseCase({ id: 'uc-1' })
    expect(useCase.needsReview).toBe(false)
    expect(useCase.sources).toEqual([])
    expect(useCase.standalone).toBe(false)
  })

  it('từ chối use case có luồng chính dài quá giới hạn thay vì cắt bớt', () => {
    const tooLong = {
      itemType: 'use_case',
      id: 'uc-1',
      ordinal: 0,
      name: 'Use case gộp nhiều việc',
      actor: 'Khách hàng',
      precondition: 'Đã đăng nhập',
      mainFlow: Array.from({ length: LIMITS.mainFlowSteps + 1 }, (_, i) => `Bước ${i}`),
      postcondition: 'Xong',
      role: 'customer',
      dataEffects: ['create'],
    }
    const result = baDocItemSchema.safeParse(tooLong)
    expect(result.success).toBe(false)
  })

  it('chấp nhận đúng giới hạn số bước', () => {
    const atLimit = makeUseCase({
      id: 'uc-1',
      mainFlow: Array.from({ length: LIMITS.mainFlowSteps }, (_, i) => `Bước ${i}`),
    })
    expect(atLimit.mainFlow).toHaveLength(LIMITS.mainFlowSteps)
  })

  it('từ chối rule dài hơn một mệnh đề', () => {
    const result = baDocItemSchema.safeParse({
      itemType: 'rule',
      id: 'r-1',
      ordinal: 0,
      statement: 'x'.repeat(LIMITS.statement + 1),
    })
    expect(result.success).toBe(false)
  })

  it('cho phép rule chưa gắn với use case nào — đó là finding, không phải lỗi lưu trữ', () => {
    const rule = makeRule({ id: 'r-1' })
    expect(rule.appliesTo).toEqual([])
  })

  it('bắt buộc use case khai báo tác động dữ liệu', () => {
    const result = baDocItemSchema.safeParse({
      itemType: 'use_case',
      id: 'uc-1',
      ordinal: 0,
      name: 'Xem đơn',
      actor: 'Khách hàng',
      precondition: 'Đã đăng nhập',
      mainFlow: ['Mở danh sách đơn'],
      postcondition: 'Hiển thị đơn',
      role: 'customer',
      dataEffects: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('truy vấn mô hình', () => {
  it('lọc theo kiểu item', () => {
    const model = makeModel([
      makeUseCase({ id: 'uc-1' }),
      makeRule({ id: 'r-1' }),
      makeErrorCode({ id: 'e-1' }),
    ])
    expect(itemsOfType(model, 'rule').map((item) => item.id)).toEqual(['r-1'])
  })

  it('loại item needsReview khỏi căn cứ kết luận', () => {
    const model = makeModel([
      makeUseCase({ id: 'uc-1' }),
      makeUseCase({ id: 'uc-2', name: 'Chưa chắc', needsReview: true }),
    ])
    expect(reviewedItems(model).map((item) => item.id)).toEqual(['uc-1'])
  })
})
