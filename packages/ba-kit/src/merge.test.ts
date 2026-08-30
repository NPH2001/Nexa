import { describe, expect, it } from 'vitest'
import { mergeChunkModels, mergeItemsInModel } from './merge.js'
import { makeErrorCode, makeFlowStep, makeModel, makeRule, makeUseCase } from './testing.js'

describe('hợp nhất kết quả nhiều chunk', () => {
  it('gộp item trùng khít và cộng dồn vị trí nguồn', () => {
    const result = mergeChunkModels([
      makeModel([makeUseCase({ id: 'uc-a', name: 'Khách hàng đặt đơn', sources: ['chunk-1'] })]),
      makeModel([makeUseCase({ id: 'uc-b', name: 'Khách hàng đặt đơn', sources: ['chunk-2'] })]),
    ])

    expect(result.model.items).toHaveLength(1)
    expect(result.mergedCount).toBe(1)
    expect(result.model.items[0]?.id).toBe('uc-a')
    expect(result.model.items[0]?.sources).toEqual(['chunk-1', 'chunk-2'])
  })

  it('bản đã chắc chắn thắng bản còn cần soát, nhưng giữ id của bản gặp trước', () => {
    const result = mergeChunkModels([
      makeModel([
        makeUseCase({
          id: 'uc-a',
          name: 'Khách hàng đặt đơn',
          postcondition: 'Chưa rõ',
          needsReview: true,
        }),
      ]),
      makeModel([
        makeUseCase({ id: 'uc-b', name: 'Khách hàng đặt đơn', postcondition: 'Đơn được tạo' }),
      ]),
    ])

    const merged = result.model.items[0]
    expect(merged?.id).toBe('uc-a')
    expect(merged?.needsReview).toBe(false)
    expect(merged?.itemType === 'use_case' && merged.postcondition).toBe('Đơn được tạo')
  })

  it('gán lại ordinal theo từng nhóm kiểu', () => {
    const result = mergeChunkModels([
      makeModel([
        makeRule({ id: 'r-1', statement: 'Rule một', ordinal: 7 }),
        makeUseCase({ id: 'uc-1', name: 'Use case một', ordinal: 4 }),
      ]),
      makeModel([makeRule({ id: 'r-2', statement: 'Rule hai', ordinal: 9 })]),
    ])

    const ordinals = Object.fromEntries(
      result.model.items.map((item) => [item.id, [item.itemType, item.ordinal]]),
    )
    expect(ordinals).toEqual({
      'uc-1': ['use_case', 0],
      'r-1': ['rule', 0],
      'r-2': ['rule', 1],
    })
  })

  it('chiếu link sang id còn sống và bỏ link tự trỏ sau khi gộp', () => {
    const result = mergeChunkModels([
      makeModel(
        [
          makeFlowStep({ id: 'fs-1', label: 'Kiểm tra tồn kho' }),
          makeUseCase({ id: 'uc-a', name: 'Khách hàng đặt đơn' }),
        ],
        [{ from: 'uc-a', to: 'fs-1', kind: 'covers' }],
      ),
      makeModel(
        [
          makeUseCase({ id: 'uc-b', name: 'Khách hàng đặt đơn' }),
          makeUseCase({ id: 'uc-c', name: 'Khách hàng đặt đơn' }),
        ],
        [
          // Hai đầu đều bị gộp về uc-a ⇒ cạnh này không còn mang thông tin.
          { from: 'uc-b', to: 'uc-c', kind: 'references' },
          // Trùng với link của chunk đầu sau khi chiếu id.
          { from: 'uc-b', to: 'fs-1', kind: 'covers' },
        ],
      ),
    ])

    expect(result.model.links).toEqual([{ from: 'uc-a', to: 'fs-1', kind: 'covers' }])
  })

  it('bỏ link trỏ tới item không tồn tại', () => {
    const result = mergeChunkModels([
      makeModel([makeUseCase({ id: 'uc-1' })], [{ from: 'uc-1', to: 'khong-co', kind: 'covers' }]),
    ])
    expect(result.model.links).toEqual([])
  })

  it('gắn cờ gần-trùng nhưng không tự gộp', () => {
    const result = mergeChunkModels([
      makeModel([makeRule({ id: 'r-1', statement: 'Đơn hàng phải có ít nhất một sản phẩm' })]),
      makeModel([makeRule({ id: 'r-2', statement: 'Đơn hàng cần có ít nhất một sản phẩm' })]),
    ])

    expect(result.model.items).toHaveLength(2)
    expect(result.mergedCount).toBe(0)
    expect(result.nearDuplicates.map((pair) => [pair.a, pair.b])).toEqual([['r-1', 'r-2']])
  })

  it('giữ nguyên item của các kiểu khác nhau có cùng text', () => {
    const result = mergeChunkModels([
      makeModel([
        makeRule({ id: 'r-1', statement: 'Đơn hàng rỗng' }),
        makeErrorCode({ id: 'e-1', code: 'Đơn hàng rỗng' }),
      ]),
    ])
    expect(result.model.items).toHaveLength(2)
  })
})

describe('gộp hai item do người dùng chọn', () => {
  it('giữ item được chọn và cộng dồn vị trí nguồn', () => {
    const model = makeModel([
      makeRule({ id: 'r-1', statement: 'Quy tắc một', sources: ['muc-1'] }),
      makeRule({ id: 'r-2', statement: 'Quy tắc hai', sources: ['muc-2'] }),
    ])

    const result = mergeItemsInModel(model, 'r-1', 'r-2')

    expect(result.merged).toBe(true)
    expect(result.model.items.map((item) => item.id)).toEqual(['r-1'])
    expect(result.model.items[0]?.sources).toEqual(['muc-1', 'muc-2'])
  })

  it('chiếu cạnh của item bị bỏ sang item được giữ', () => {
    const model = makeModel(
      [
        makeUseCase({ id: 'uc-1' }),
        makeFlowStep({ id: 'fs-1', label: 'Một' }),
        makeFlowStep({ id: 'fs-2', label: 'Hai' }),
      ],
      [{ from: 'uc-1', to: 'fs-2', kind: 'covers' }],
    )

    const result = mergeItemsInModel(model, 'fs-1', 'fs-2')

    expect(result.model.links).toEqual([{ from: 'uc-1', to: 'fs-1', kind: 'covers' }])
  })

  it('bỏ cạnh tự trỏ sinh ra sau khi gộp', () => {
    const model = makeModel(
      [makeFlowStep({ id: 'fs-1', label: 'Một' }), makeFlowStep({ id: 'fs-2', label: 'Hai' })],
      [{ from: 'fs-1', to: 'fs-2', kind: 'next' }],
    )

    const result = mergeItemsInModel(model, 'fs-1', 'fs-2')

    expect(result.model.links).toEqual([])
  })

  it('từ chối gộp hai item khác kiểu', () => {
    const model = makeModel([makeRule({ id: 'r-1' }), makeUseCase({ id: 'uc-1' })])
    const result = mergeItemsInModel(model, 'r-1', 'uc-1')

    expect(result.merged).toBe(false)
    expect(result.reason).toContain('cùng kiểu')
    expect(result.model.items).toHaveLength(2)
  })

  it('từ chối khi một trong hai id không tồn tại', () => {
    const result = mergeItemsInModel(makeModel([makeRule({ id: 'r-1' })]), 'r-1', 'khong-co')
    expect(result.merged).toBe(false)
  })

  it('từ chối gộp một item vào chính nó', () => {
    const result = mergeItemsInModel(makeModel([makeRule({ id: 'r-1' })]), 'r-1', 'r-1')
    expect(result.merged).toBe(false)
  })
})
