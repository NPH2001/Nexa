import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Logger, MemorySink, Redactor } from '@nexa/observability'
import { loadBaStandards, loadRulebook, loadTemplates } from './ba-standards.js'

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

function testLogger(): { logger: Logger; sink: MemorySink } {
  const sink = new MemorySink()
  return { logger: new Logger({ sink, redactor: new Redactor(), minLevel: 'debug' }), sink }
}

function readResource(name: string): unknown {
  return JSON.parse(readFileSync(`${ROOT}apps/desktop/resources/${name}`, 'utf8'))
}

const validTemplate = {
  id: 'us-standard',
  version: '1',
  name: 'User Story chuẩn',
  documentKind: 'us',
  sections: [{ key: 'rules', title: 'Quy tắc', required: true, itemTypes: ['rule'] }],
}

describe('bộ mẫu ship kèm bản cài', () => {
  it('file resource thật đọc được và hợp lệ', () => {
    const { logger } = testLogger()
    const templates = loadTemplates(readResource('ba-templates.json'), logger)
    expect(templates.length).toBeGreaterThan(0)
    expect(templates.map((entry) => entry.id)).toContain('us-standard')
  })

  it('mọi mẫu ship kèm đều có ít nhất một mục bắt buộc', () => {
    const { logger } = testLogger()
    for (const template of loadTemplates(readResource('ba-templates.json'), logger)) {
      expect(template.sections.some((section) => section.required)).toBe(true)
    }
  })

  it('một mẫu hỏng bị loại, các mẫu còn lại vẫn dùng được', () => {
    const { logger, sink } = testLogger()
    const templates = loadTemplates(
      { templates: [{ id: 'hong', version: '1' }, validTemplate] },
      logger,
    )

    expect(templates.map((entry) => entry.id)).toEqual(['us-standard'])
    expect(sink.asText()).toContain('ba-template-invalid-skipped')
  })

  it('file hỏng hoàn toàn không làm hỏng khởi động', () => {
    const { logger } = testLogger()
    expect(loadTemplates({ khong: 'phai mang' }, logger)).toEqual([])
    expect(loadTemplates(null, logger)).toEqual([])
  })

  it('loại mẫu trùng id thay vì để cái sau đè cái trước', () => {
    const { logger, sink } = testLogger()
    const templates = loadTemplates(
      { templates: [validTemplate, { ...validTemplate, name: 'Bản khác' }] },
      logger,
    )

    expect(templates).toHaveLength(1)
    expect(templates[0]?.name).toBe('User Story chuẩn')
    expect(sink.asText()).toContain('ba-template-duplicate-id-skipped')
  })

  it('log chỉ ghi id và tên trường sai, không ghi nội dung mẫu', () => {
    const { logger, sink } = testLogger()
    loadTemplates(
      { templates: [{ id: 'hong', name: 'Mẫu nội bộ tuyệt mật', version: 1 }] },
      logger,
    )
    const logged = sink.asText()
    expect(logged).toContain('hong')
    expect(logged).not.toContain('Mẫu nội bộ tuyệt mật')
  })
})

describe('rulebook ship kèm bản cài', () => {
  it('file resource thật đọc được và hợp lệ', () => {
    const { logger } = testLogger()
    const rulebook = loadRulebook(readResource('ba-rulebook.json'), logger)
    expect(rulebook).not.toBeNull()
    expect(rulebook?.byFieldType.map((entry) => entry.fieldType)).toContain('email')
  })

  it('không khai kỳ vọng nào cho kiểu chưa xác định', () => {
    const { logger } = testLogger()
    const rulebook = loadRulebook(readResource('ba-rulebook.json'), logger)
    expect(rulebook?.byFieldType.map((entry) => entry.fieldType)).not.toContain('unknown')
  })

  it('rulebook hỏng thì trả null, không ném lỗi', () => {
    const { logger, sink } = testLogger()
    expect(loadRulebook({ id: 'x' }, logger)).toBeNull()
    expect(sink.asText()).toContain('ba-rulebook-invalid')
  })
})

describe('nạp chuẩn tổ chức', () => {
  it('thiếu cả hai file vẫn cho ra trạng thái dùng được', () => {
    const { logger } = testLogger()
    const standards = loadBaStandards(() => null, logger)
    expect(standards).toEqual({ templates: [], rulebook: null })
  })
})
