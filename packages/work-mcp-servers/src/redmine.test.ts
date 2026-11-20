import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ERROR_CODES, type PreviewContext, type ToolDefinition } from '@nexa/shared-types'
import {
  buildRedmineGatewayHeaders,
  buildRedmineTools,
  classifyRedmineError,
  identifyRedmineUser,
  redmineIssueUrl,
} from './redmine.js'

interface ServerTool {
  name: string
  inputSchema: { properties?: Record<string, unknown>; required?: string[] }
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

/** Danh mục THẬT lấy từ `tools/list` của gateway (2026-11-17) — nguồn đối chiếu, không đoán. */
const SERVER_TOOLS: ServerTool[] = JSON.parse(
  readFileSync(join(__dirname, '../../../mcp-redmine-tools.json'), 'utf8'),
) as ServerTool[]
const serverTool = (mcp: string): ServerTool | undefined =>
  SERVER_TOOLS.find((t) => t.name === `redmine-${mcp}`)

const BASE = 'https://redmine.example.test'
const registry = buildRedmineTools(BASE)
const byName = (name: string): ToolDefinition => {
  const d = registry.find((t) => t.name === name)
  if (d === undefined) throw new Error(`missing ${name}`)
  return d
}

describe('danh mục Redmine đối chiếu với server thật', () => {
  it('mọi tool Nexa đều có trên server, dưới tên gateway `redmine-<tool>`', () => {
    for (const d of registry) {
      expect(serverTool(d.mcpToolName), d.name).toBeDefined()
      expect(d.name).toBe(`redmine_${d.mcpToolName}`)
      expect(d.targetSystem).toBe('redmine')
    }
  })

  it('mọi tham số Nexa khai báo đều tồn tại trong inputSchema của server', () => {
    for (const d of registry) {
      const serverProps = Object.keys(serverTool(d.mcpToolName)?.inputSchema.properties ?? {})
      const ours = Object.keys((d.jsonSchema['properties'] ?? {}) as Record<string, unknown>)
      for (const p of ours) expect(serverProps, `${d.name}.${p}`).toContain(p)
    }
  })

  it('tham số server bắt buộc thì Nexa cũng bắt buộc', () => {
    for (const d of registry) {
      const serverRequired = serverTool(d.mcpToolName)?.inputSchema.required ?? []
      expect(d.jsonSchema['required'], d.name).toEqual(expect.arrayContaining(serverRequired))
    }
  })

  it('tool READ của Nexa đều được server đánh dấu readOnlyHint — và ngược lại cho tool ghi', () => {
    for (const d of registry) {
      const hint = serverTool(d.mcpToolName)?.annotations?.readOnlyHint
      expect(hint, d.name).toBe(d.riskLevel === 'READ')
    }
  })

  it('không mở tool xoá, quản trị, attachment hay ghi wiki', () => {
    const names = registry.map((d) => d.mcpToolName)
    for (const forbidden of [
      'delete_issue',
      'delete_issue_relation',
      'delete_time_entry',
      'delete_wiki_page',
      'delete_attachment',
      'delete_version',
      'delete_membership',
      'delete_issue_category',
      'remove_watcher',
      'create_membership',
      'update_membership',
      'create_project',
      'update_project',
      'create_version',
      'update_version',
      'create_issue_category',
      'update_issue_category',
      'upload_attachment',
      'upload_project_file',
      'update_attachment',
      'download_attachment',
      'upsert_wiki_page',
      'update_time_entry',
    ]) {
      expect(names).not.toContain(forbidden)
    }
    // Không tool nào server đánh dấu destructive lọt vào danh mục.
    for (const d of registry) {
      expect(serverTool(d.mcpToolName)?.annotations?.destructiveHint, d.name).toBe(false)
    }
  })

  it('mức rủi ro và cờ của tool ghi đúng design D3', () => {
    expect(byName('redmine_create_issue')).toMatchObject({ riskLevel: 'WRITE_LOW', requiredFeature: 'redmineWrite' })
    expect(byName('redmine_add_issue_comment')).toMatchObject({ riskLevel: 'WRITE_LOW', requiredFeature: 'redmineWrite' })
    expect(byName('redmine_log_time')).toMatchObject({ riskLevel: 'WRITE_LOW', requiredFeature: 'redmineWrite' })
    expect(byName('redmine_create_issue_relation')).toMatchObject({ riskLevel: 'WRITE_LOW', requiredFeature: 'redmineWrite' })
    expect(byName('redmine_add_watcher')).toMatchObject({ riskLevel: 'WRITE_LOW', requiredFeature: 'redmineWrite' })
    expect(byName('redmine_update_issue')).toMatchObject({ riskLevel: 'WRITE_HIGH', requiredFeature: 'redmineUpdate' })
    for (const d of registry.filter((t) => t.riskLevel !== 'READ')) {
      expect(d.buildPreview, d.name).toBeDefined()
    }
  })

  it('`uploads` bị loại khỏi payload create/update_issue', () => {
    for (const name of ['redmine_create_issue', 'redmine_update_issue']) {
      const d = byName(name)
      expect(Object.keys(d.jsonSchema['properties'] as object)).not.toContain('uploads')
      const parsed = d.inputSchema.parse({
        project_id: 1,
        issue_id: 1,
        subject: 'x',
        uploads: [{ token: 't', filename: 'a.exe' }],
      }) as Record<string, unknown>
      expect(parsed).not.toHaveProperty('uploads')
    }
  })
})

describe('header gateway', () => {
  it('gửi bearer gateway, chọn server redmine và API key', () => {
    const h = buildRedmineGatewayHeaders({ gatewayToken: 'gw-token', apiKey: 'rm-key' })
    expect(h).toEqual({
      authorization: 'Bearer gw-token',
      'x-mcp-servers': 'redmine',
      'x-mcp-redmine-x-redmine-api-key': 'rm-key',
    })
  })
})

describe('phân loại lỗi Redmine', () => {
  const text = (status: number): string =>
    `Error executing tool get_issue: GET /issues/1.json: HTTP ${String(status)} - something`

  it('401 là lỗi API key', () => {
    expect(classifyRedmineError(text(401), 't').code).toBe(ERROR_CODES.REDMINE_AUTH_FAILED)
  })

  it('403 KHÔNG phải lỗi xác thực — key đúng nhưng thiếu quyền', () => {
    const e = classifyRedmineError(text(403), 'redmine_list_users')
    expect(e.code).not.toBe(ERROR_CODES.REDMINE_AUTH_FAILED)
    expect(e.safeDetail).toContain('permission')
  })

  it('404 là lỗi nghiệp vụ', () => {
    expect(classifyRedmineError(text(404), 't').code).toBe(ERROR_CODES.UPSTREAM_UNAVAILABLE)
  })
})

describe('kết quả Redmine', () => {
  it('get_current_user: login lấy được, api_key KHÔNG bao giờ tới model', async () => {
    const raw = JSON.stringify({ id: 7, login: 'tester', api_key: 'SECRET-KEY-VALUE', firstname: 'T' })
    expect(await identifyRedmineUser(() => Promise.resolve(raw))).toBe('tester')

    const summary = byName('redmine_get_current_user').summarizeResult?.(raw)
    expect(summary?.forModel).toContain('tester')
    expect(summary?.forModel).not.toContain('SECRET-KEY-VALUE')
    expect(summary?.forModel).not.toContain('api_key')
  })

  it('issue đơn lẻ có link dựng từ URL Redmine đã cấu hình', () => {
    const summary = byName('redmine_get_issue').summarizeResult?.(
      JSON.stringify({ id: 42, subject: 'Lỗi đăng nhập' }),
    )
    expect(summary).toMatchObject({
      targetKey: '#42',
      targetUrl: `${BASE}/issues/42`,
      forUser: '#42 — Lỗi đăng nhập',
    })
    expect(redmineIssueUrl('', 42)).toBeUndefined()
    expect(redmineIssueUrl(BASE, 'abc')).toBeUndefined()
  })

  it('danh sách issue chưa đủ trang ⇒ đánh dấu incomplete', () => {
    const summary = byName('redmine_search_issues').summarizeResult?.(
      JSON.stringify({ total_count: 30, issues: [{ id: 1 }, { id: 2 }] }),
    )
    expect(summary?.incomplete).toBe(true)
  })
})

describe('preview ghi Redmine', () => {
  const ctx = (readTool: PreviewContext['readTool']): PreviewContext => ({
    actingAccount: 'tester',
    targetSystemUrl: BASE,
    readTool,
  })

  it('update_issue hiện giá trị trước → sau, đọc từ get_issue', async () => {
    const preview = await byName('redmine_update_issue').buildPreview?.(
      { issue_id: 123, status_id: 5, due_date: '2026-12-01' },
      ctx(() =>
        Promise.resolve(
          JSON.stringify({ issue: { id: 123, status: { id: 2, name: 'In Progress' }, due_date: '2026-11-20' } }),
        ),
      ),
    )
    expect(preview?.riskLevel).toBe('WRITE_HIGH')
    expect(preview?.targetSystem).toBe('redmine')
    expect(preview?.actingAccount).toBe('tester')
    expect(preview?.changes).toEqual(
      expect.arrayContaining([
        { field: 'Trạng thái (id)', before: '2 (In Progress)', after: '5' },
        { field: 'Hạn', before: '2026-11-20', after: '2026-12-01' },
      ]),
    )
  })

  it('update_issue vẫn dựng được preview khi đọc trước thất bại', async () => {
    const preview = await byName('redmine_update_issue').buildPreview?.(
      { issue_id: 123, status_id: 5 },
      ctx(() => Promise.reject(new Error('down'))),
    )
    expect(preview?.changes[0]?.before).toBeNull()
    expect(preview?.impactWarning).toContain('Không đọc được')
  })

  it('create_issue lookup tìm theo tác giả = tôi, tiêu đề và thời điểm', async () => {
    const calls: unknown[] = []
    const result = await byName('redmine_create_issue').lookupResult?.(
      { project_id: 9, subject: 'Việc mới' },
      {
        actingAccount: 'tester',
        startedAt: '2026-11-17T10:00:00.000Z',
        readTool: (name, input) => {
          calls.push({ name, input })
          return Promise.resolve(JSON.stringify({ issues: [{ id: 77, subject: 'Việc mới' }] }))
        },
      },
    )
    expect(result).toEqual({ matches: [{ key: '#77', url: '', summary: 'Việc mới' }], inconclusive: false })
    expect(calls[0]).toMatchObject({
      name: 'redmine_search_issues',
      input: { author_id: 'me', subject: '~Việc mới', project_id: '9' },
    })
  })
})
