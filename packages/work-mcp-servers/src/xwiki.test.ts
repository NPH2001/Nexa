import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ERROR_CODES, NexaError, type PreviewContext, type ToolDefinition } from '@nexa/shared-types'
import {
  XWIKI_NOT_FOUND_DETAIL,
  buildXwikiTools,
  classifyXwikiError,
  parseXwikiVersion,
  summarizeXwiki,
} from './xwiki.js'

interface ServerTool {
  name: string
  inputSchema: { properties?: Record<string, unknown>; required?: string[] }
}
const SERVER_TOOLS: ServerTool[] = JSON.parse(
  readFileSync(join(__dirname, '../../../mcp-xwiki-tools.json'), 'utf8'),
) as ServerTool[]

const ORIGIN = 'https://wiki.example.test'
const registry = buildXwikiTools(ORIGIN)
const byName = (name: string): ToolDefinition => {
  const d = registry.find((t) => t.name === name)
  if (d === undefined) throw new Error(`missing ${name}`)
  return d
}

/** Header thật của `get_document` (quan sát 2026-11-17), nội dung đã thay bằng dữ liệu giả. */
const DOC = `Reference: xwiki:Sales.Plan
URL: ${ORIGIN}/bin/view/Sales/Plan
Title: Plan
Syntax: xwiki/2.1
Version: 4.3
Size: 3 lines · 40 chars · ~10 tokens
`

describe('danh mục XWiki đối chiếu với server thật', () => {
  it('phủ đúng 12 tool server công bố, tên có tiền tố xwiki_', () => {
    expect(registry.map((d) => d.mcpToolName).sort()).toEqual(SERVER_TOOLS.map((t) => t.name).sort())
    for (const d of registry) expect(d.name).toBe(`xwiki_${d.mcpToolName}`)
  })

  it('mọi tham số Nexa đều có ở server, và tham số server bắt buộc thì Nexa cũng bắt buộc', () => {
    for (const d of registry) {
      const server = SERVER_TOOLS.find((t) => t.name === d.mcpToolName)
      const serverProps = Object.keys(server?.inputSchema.properties ?? {})
      for (const p of Object.keys(d.jsonSchema['properties'] as object)) {
        expect(serverProps, `${d.name}.${p}`).toContain(p)
      }
      expect(d.jsonSchema['required'], d.name).toEqual(
        expect.arrayContaining(server?.inputSchema.required ?? []),
      )
    }
  })

  it('chỉ write/edit là ghi, mức WRITE_HIGH thuộc cờ xwikiWrite', () => {
    const writes = registry.filter((d) => d.riskLevel !== 'READ').map((d) => d.name).sort()
    expect(writes).toEqual(['xwiki_edit_document', 'xwiki_write_document'])
    for (const name of writes) {
      expect(byName(name)).toMatchObject({ riskLevel: 'WRITE_HIGH', requiredFeature: 'xwikiWrite' })
      expect(byName(name).prepareWrite).toBeDefined()
      expect(byName(name).buildPreview).toBeDefined()
    }
    for (const d of registry.filter((t) => t.riskLevel === 'READ')) {
      expect(d.requiredFeature).toBe('xwikiRead')
    }
  })

  it('base_version không gửi cho model nhưng vẫn qua được validate', () => {
    const d = byName('xwiki_write_document')
    expect(Object.keys(d.jsonSchema['properties'] as object)).not.toContain('base_version')
    expect(d.inputSchema.parse({ reference: 'A.B', content: 'x', base_version: '1.1' })).toHaveProperty(
      'base_version',
      '1.1',
    )
  })
})

describe('khoá phiên bản (prepareWrite)', () => {
  const ctx = (readTool: PreviewContext['readTool']): PreviewContext => ({
    actingAccount: 'tester',
    targetSystemUrl: ORIGIN,
    readTool,
  })

  it('trang đang có ⇒ gắn base_version đọc được, THAY giá trị model tự điền', async () => {
    const reads: unknown[] = []
    const prepared = await byName('xwiki_write_document').prepareWrite?.(
      { reference: 'Sales.Plan', content: 'new', base_version: '99.9' },
      ctx((name, input) => {
        reads.push({ name, input })
        return Promise.resolve(DOC)
      }),
    )
    expect(prepared).toMatchObject({ base_version: '4.3', content: 'new' })
    expect(reads[0]).toMatchObject({ name: 'xwiki_get_document', input: { reference: 'Sales.Plan', outline: true } })
  })

  it('trang chưa tồn tại ⇒ bỏ base_version (tạo mới)', async () => {
    const prepared = await byName('xwiki_write_document').prepareWrite?.(
      { reference: 'Sales.New', content: 'x', base_version: '1.1' },
      ctx(() => Promise.reject(classifyXwikiError('No such document: "Sales.New".', 'xwiki_get_document'))),
    )
    expect(prepared).not.toHaveProperty('base_version')
  })

  it('lỗi đọc khác ⇒ dừng, không ghi mù', async () => {
    await expect(
      byName('xwiki_edit_document').prepareWrite?.(
        { reference: 'Sales.Plan', edits: [{ old_string: 'a', new_string: 'b' }] },
        ctx(() => Promise.reject(new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE))),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.UPSTREAM_UNAVAILABLE })
  })

  it('đọc được nhưng không có dòng Version ⇒ dừng', async () => {
    await expect(
      byName('xwiki_write_document').prepareWrite?.(
        { reference: 'Sales.Plan', content: 'x' },
        ctx(() => Promise.resolve('Reference: xwiki:Sales.Plan\n')),
      ),
    ).rejects.toBeInstanceOf(NexaError)
  })

  it('preview ghi đè nói rõ "GHI ĐÈ" và phiên bản đang có', async () => {
    const preview = await byName('xwiki_write_document').buildPreview?.(
      { reference: 'Sales.Plan', content: 'a\nb', base_version: '4.3' },
      ctx(() => Promise.resolve('')),
    )
    expect(preview?.action).toContain('GHI ĐÈ')
    expect(preview?.action).toContain('4.3')
    expect(preview?.targetSystem).toBe('xwiki')
    expect(preview?.riskLevel).toBe('WRITE_HIGH')
  })

  it('preview tạo mới không nói ghi đè', async () => {
    const preview = await byName('xwiki_write_document').buildPreview?.(
      { reference: 'Sales.New', content: 'x' },
      ctx(() => Promise.resolve('')),
    )
    expect(preview?.action).toContain('Tạo trang mới')
  })

  it('preview edit liệt kê từng cặp tìm/thay', async () => {
    const preview = await byName('xwiki_edit_document').buildPreview?.(
      {
        reference: 'Sales.Plan',
        base_version: '4.3',
        edits: [
          { old_string: 'cũ', new_string: 'mới' },
          { old_string: 'x', new_string: 'y', replace_all: true },
        ],
      },
      ctx(() => Promise.resolve('')),
    )
    expect(preview?.changes).toEqual([
      { field: 'Đoạn 1', before: 'cũ', after: 'mới' },
      { field: 'Đoạn 2 (mọi chỗ khớp)', before: 'x', after: 'y' },
    ])
  })
})

describe('lỗi và kết quả XWiki', () => {
  it('xung đột phiên bản có mã riêng, không bị gộp vào lỗi mạng', () => {
    expect(classifyXwikiError('Version conflict: document is at 4.4', 'w').code).toBe(
      ERROR_CODES.XWIKI_VERSION_CONFLICT,
    )
  })

  it('không tìm thấy tài liệu mang marker để prepareWrite nhận ra', () => {
    expect(classifyXwikiError('No such document: "A.B".', 'r').safeDetail).toBe(XWIKI_NOT_FOUND_DETAIL)
  })

  it('401 là lỗi token', () => {
    expect(classifyXwikiError('HTTP 401 Unauthorized', 'r').code).toBe(ERROR_CODES.XWIKI_AUTH_FAILED)
  })

  it('lấy link từ dòng URL, chỉ khi cùng host với endpoint', () => {
    expect(summarizeXwiki(DOC, ORIGIN)).toMatchObject({
      targetKey: 'xwiki:Sales.Plan',
      targetUrl: `${ORIGIN}/bin/view/Sales/Plan`,
    })
    const evil = DOC.replace(`URL: ${ORIGIN}`, 'URL: https://evil.example')
    expect(summarizeXwiki(evil, ORIGIN).targetUrl).toBeUndefined()
  })

  it('đọc số phiên bản từ header', () => {
    expect(parseXwikiVersion(DOC)).toBe('4.3')
    expect(parseXwikiVersion('no header')).toBeNull()
  })
})
