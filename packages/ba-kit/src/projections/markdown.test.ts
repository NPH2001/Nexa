import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown.js'
import { baTemplateSchema, type BaTemplate } from '../template.js'
import { makeErrorCode, makeModel, makeRule, makeUseCase } from '../testing.js'

const template: BaTemplate = baTemplateSchema.parse({
  id: 'us-standard',
  version: '2',
  name: 'User Story chuẩn',
  documentKind: 'us',
  sections: [
    { key: 'use-cases', title: 'Use case', required: true, itemTypes: ['use_case'] },
    {
      key: 'rules',
      title: 'Quy tắc nghiệp vụ',
      required: true,
      itemTypes: ['rule'],
      guidance: 'Mỗi quy tắc là một mệnh đề.',
    },
    { key: 'errors', title: 'Mã lỗi', itemTypes: ['error_code'] },
  ],
})

describe('chiếu ra Markdown theo mẫu', () => {
  it('ghi rõ mẫu và phiên bản đang dùng', () => {
    const output = renderMarkdown(makeModel([]), template, { title: 'US-01' })
    expect(output).toContain('# US-01')
    expect(output).toContain('User Story chuẩn** phiên bản 2')
  })

  it('in mục theo đúng thứ tự của mẫu', () => {
    const output = renderMarkdown(
      makeModel([makeErrorCode({ id: 'e-1' }), makeUseCase({ id: 'uc-1' })]),
      template,
      { title: 'US-01' },
    )
    expect(output.indexOf('## Use case')).toBeLessThan(output.indexOf('## Mã lỗi'))
  })

  it('không thêm nội dung nghiệp vụ nào ngoài mô hình', () => {
    const output = renderMarkdown(
      makeModel([makeUseCase({ id: 'uc-1', name: 'Khách hàng đặt đơn' })]),
      template,
      { title: 'US-01' },
    )
    expect(output).toContain('Khách hàng đặt đơn')
    expect(output).toContain('1. Chọn sản phẩm')
  })

  it('đánh dấu mục bắt buộc còn trống kèm câu nhắc', () => {
    const output = renderMarkdown(makeModel([makeUseCase({ id: 'uc-1' })]), template, {
      title: 'US-01',
    })
    expect(output).toContain('⚠ Mục bắt buộc còn trống. Mỗi quy tắc là một mệnh đề.')
  })

  it('mục tuỳ chọn trống thì nhắc nhẹ, không cảnh báo', () => {
    const output = renderMarkdown(makeModel([]), template, { title: 'US-01' })
    const errorsSection = output.slice(output.indexOf('## Mã lỗi'))
    expect(errorsSection).toContain('chưa có nội dung')
    expect(errorsSection).not.toContain('⚠')
  })

  it('giấu mục trống được khi người dùng muốn bản sạch', () => {
    const output = renderMarkdown(makeModel([makeUseCase({ id: 'uc-1' })]), template, {
      title: 'US-01',
      showEmptySections: false,
    })
    expect(output).not.toContain('## Mã lỗi')
  })

  it('đeo nhãn cho item còn cần soát — bản Markdown không có cờ trong UI', () => {
    const output = renderMarkdown(
      makeModel([makeUseCase({ id: 'uc-1' }), makeRule({ id: 'r-1', needsReview: true })]),
      template,
      { title: 'US-01' },
    )
    expect(output).toContain('Nexa chưa chắc — cần người soát')
  })

  it('nêu rõ nội dung không thuộc mục nào của mẫu', () => {
    const onlyRules = baTemplateSchema.parse({
      ...template,
      sections: [{ key: 'rules', title: 'Quy tắc', required: false, itemTypes: ['rule'] }],
    })
    const output = renderMarkdown(makeModel([makeUseCase({ id: 'uc-1' })]), onlyRules, {
      title: 'US-01',
    })
    expect(output).toContain('## Nội dung ngoài mẫu')
    expect(output).toContain('Có thể tài liệu đang dùng sai mẫu')
  })

  it('đổi mẫu thì bố cục đổi mà nội dung không đổi', () => {
    const model = makeModel([makeUseCase({ id: 'uc-1' }), makeRule({ id: 'r-1' })])
    const reordered = baTemplateSchema.parse({
      ...template,
      sections: [...template.sections].reverse(),
    })

    const a = renderMarkdown(model, template, { title: 'US-01' })
    const b = renderMarkdown(model, reordered, { title: 'US-01' })

    expect(a).not.toBe(b)
    for (const fragment of ['Khách hàng đặt đơn', 'Đơn hàng phải có ít nhất một sản phẩm']) {
      expect(a).toContain(fragment)
      expect(b).toContain(fragment)
    }
  })
})
