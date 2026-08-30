import { describe, expect, it } from 'vitest'
import { buildErrorCodePage } from './error-codes.js'
import { makeErrorCode, makeFlowStep, makeModel, makeUseCase } from '../testing.js'

describe('trang mã lỗi', () => {
  it('sắp mã theo số chứ không theo chuỗi', () => {
    const page = buildErrorCodePage(
      makeModel([
        makeErrorCode({ id: 'e-10', code: 'E10', message: 'Mười' }),
        makeErrorCode({ id: 'e-2', code: 'E2', message: 'Hai' }),
      ]),
    )
    expect(page.declared.map((entry) => entry.code)).toEqual(['E2', 'E10'])
  })

  it('bắt mã được nhắc trong luồng ngoại lệ nhưng chưa khai báo', () => {
    const page = buildErrorCodePage(
      makeModel([
        makeUseCase({
          id: 'uc-1',
          exceptionFlows: [{ name: 'Hết hàng', steps: ['Báo lỗi'], errorCode: 'E404' }],
        }),
      ]),
    )
    expect(page.undeclared).toEqual([{ code: 'E404', referencedBy: ['uc-1'] }])
    expect(page.counts.undeclared).toBe(1)
  })

  it('bắt mã đã khai báo nhưng không luồng nào dùng', () => {
    const page = buildErrorCodePage(
      makeModel([makeErrorCode({ id: 'e-1', code: 'E001', message: 'Đơn hàng rỗng' })]),
    )
    expect(page.unreferenced.map((entry) => entry.code)).toEqual(['E001'])
  })

  it('nhận tham chiếu từ flow step và từ link raises', () => {
    const page = buildErrorCodePage(
      makeModel(
        [
          makeErrorCode({ id: 'e-1', code: 'E001', message: 'Đơn hàng rỗng' }),
          makeFlowStep({ id: 'fs-1', label: 'Kiểm tra giỏ hàng', errorCode: 'E001' }),
          makeUseCase({ id: 'uc-1' }),
        ],
        [{ from: 'uc-1', to: 'e-1', kind: 'raises' }],
      ),
    )
    expect(page.declared[0]?.referencedBy).toEqual(['fs-1', 'uc-1'])
    expect(page.unreferenced).toEqual([])
  })

  it('so mã không phân biệt hoa thường và khoảng trắng thừa', () => {
    const page = buildErrorCodePage(
      makeModel([
        makeErrorCode({ id: 'e-1', code: 'E001', message: 'Đơn hàng rỗng' }),
        makeFlowStep({ id: 'fs-1', label: 'Kiểm tra giỏ hàng', errorCode: ' e001 ' }),
      ]),
    )
    expect(page.undeclared).toEqual([])
    expect(page.declared[0]?.referencedBy).toEqual(['fs-1'])
  })

  it('báo bất nhất khi một mã mang hai thông điệp', () => {
    const page = buildErrorCodePage(
      makeModel([
        makeErrorCode({ id: 'e-1', code: 'E001', message: 'Đơn hàng rỗng' }),
        makeErrorCode({ id: 'e-2', code: 'E001', message: 'Giỏ hàng trống' }),
      ]),
    )
    expect(page.inconsistent).toHaveLength(1)
    expect(page.inconsistent[0]?.variants).toEqual([
      { message: 'Đơn hàng rỗng', itemId: 'e-1' },
      { message: 'Giỏ hàng trống', itemId: 'e-2' },
    ])
  })

  it('không báo bất nhất khi hai bản ghi cùng thông điệp', () => {
    const page = buildErrorCodePage(
      makeModel([
        makeErrorCode({ id: 'e-1', code: 'E001', message: 'Đơn hàng rỗng' }),
        makeErrorCode({ id: 'e-2', code: 'E001', message: 'Đơn hàng rỗng' }),
      ]),
    )
    expect(page.inconsistent).toEqual([])
  })

  it('loại item cần soát khỏi căn cứ và báo số bị loại', () => {
    const page = buildErrorCodePage(
      makeModel([
        makeErrorCode({ id: 'e-1', code: 'E001', message: 'Đơn hàng rỗng' }),
        makeErrorCode({ id: 'e-2', code: 'E002', message: 'Chưa chắc', needsReview: true }),
      ]),
    )
    expect(page.declared.map((entry) => entry.code)).toEqual(['E001'])
    expect(page.counts.excludedNeedsReview).toBe(1)
  })

  it('không lấy tham chiếu từ use case còn cần soát', () => {
    const page = buildErrorCodePage(
      makeModel([
        makeUseCase({
          id: 'uc-1',
          needsReview: true,
          exceptionFlows: [{ name: 'Hết hàng', steps: ['Báo lỗi'], errorCode: 'E404' }],
        }),
      ]),
    )
    expect(page.undeclared).toEqual([])
  })

  it('mô hình rỗng cho ra trang rỗng chứ không lỗi', () => {
    const page = buildErrorCodePage(makeModel([]))
    expect(page.counts).toEqual({
      declared: 0,
      undeclared: 0,
      unreferenced: 0,
      inconsistent: 0,
      excludedNeedsReview: 0,
    })
  })
})
