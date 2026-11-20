import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  ERROR_CODES,
  NexaError,
  type ErrorCode,
  type McpTargetSystem,
  type McpToolSource,
  type ToolDefinition,
} from '@nexa/shared-types'
import { McpToolRouter, assertDisjointToolNames, type RoutedMcpSource } from './mcp-router.js'

function def(name: string, targetSystem: McpTargetSystem): ToolDefinition {
  return {
    name,
    mcpToolName: name,
    targetSystem,
    riskLevel: 'READ',
    description: name,
    inputSchema: z.object({}).passthrough(),
    jsonSchema: { type: 'object' },
    requiredFeature: 'jiraRead',
  }
}

interface FakeSource extends McpToolSource {
  ready: boolean
  readonly calls: string[]
}

function fakeSource(
  system: McpTargetSystem,
  tools: readonly string[],
  opts: { ready?: boolean; url?: string; account?: string } = {},
): FakeSource {
  const registry = tools.map((t) => def(t, system))
  const calls: string[] = []
  const source: FakeSource = {
    ready: opts.ready ?? true,
    calls,
    get isReady() {
      return this.ready
    },
    availableTools: () => registry,
    findTool: (name) => registry.find((d) => d.name === name) ?? null,
    resolveCallable: (name) => {
      const d = registry.find((x) => x.name === name)
      if (d === undefined) throw new NexaError(ERROR_CODES.TOOL_NOT_ALLOWED)
      return d
    },
    validateInput: (_d, raw) => raw as Record<string, unknown>,
    callTool: vi.fn(async (name: string) => {
      calls.push(name)
      return { summary: { forModel: `${system}:${name}`, forUser: 'ok' }, rawText: '{}' }
    }),
    canCallReadTool: (name) => registry.some((d) => d.name === name),
    targetSystemUrl: (s) => (s === system ? (opts.url ?? `https://${system}.test`) : ''),
    ...(opts.account !== undefined
      ? { actingAccount: (s: McpTargetSystem) => (s === system ? opts.account : undefined) }
      : {}),
  }
  return source
}

function routed(label: string, source: McpToolSource, unavailable?: ErrorCode): RoutedMcpSource {
  return {
    label,
    source,
    ...(unavailable !== undefined ? { unavailableCode: () => unavailable } : {}),
  }
}

describe('McpToolRouter', () => {
  it('định tuyến lời gọi tới đúng source sở hữu tool', async () => {
    const atlassian = fakeSource('jira', ['jira_get_issue'])
    const redmine = fakeSource('redmine', ['redmine_get_issue'])
    const router = new McpToolRouter(() => [
      routed('Atlassian', atlassian),
      routed('Redmine', redmine),
    ])

    const outcome = await router.callTool('redmine_get_issue', {})

    expect(outcome.summary.forModel).toBe('redmine:redmine_get_issue')
    expect(redmine.calls).toEqual(['redmine_get_issue'])
    expect(atlassian.calls).toEqual([])
  })

  it('tên tool trùng giữa hai source ⇒ từ chối thay vì chọn đại', () => {
    const a = fakeSource('jira', ['dup'])
    const b = fakeSource('redmine', ['dup'])
    const router = new McpToolRouter(() => [routed('A', a), routed('B', b)])

    expect(() => router.resolveCallable('dup')).toThrow(NexaError)
    expect(router.canCallReadTool('dup')).toBe(false)
  })

  it('source lỗi chỉ làm tool của nó không gọi được — Jira vẫn chạy', async () => {
    const atlassian = fakeSource('jira', ['jira_get_issue'])
    const redmine = fakeSource('redmine', ['redmine_get_issue'], { ready: false })
    const router = new McpToolRouter(() => [
      routed('Atlassian', atlassian),
      routed('Redmine', redmine, ERROR_CODES.REDMINE_AUTH_FAILED),
    ])

    expect(router.isReady).toBe(true)
    expect(router.availableTools().map((d) => d.name)).toEqual(['jira_get_issue'])
    expect(router.resolveCallable('jira_get_issue').name).toBe('jira_get_issue')

    let caught: unknown
    try {
      router.resolveCallable('redmine_get_issue')
    } catch (error) {
      caught = error
    }
    expect(NexaError.is(caught) && caught.code).toBe(ERROR_CODES.REDMINE_AUTH_FAILED)
    expect(NexaError.is(caught) && caught.safeDetail).toContain('Redmine')
  })

  it('source chưa sẵn sàng và không có mã riêng ⇒ MCP_SERVER_UNAVAILABLE', () => {
    const xwiki = fakeSource('xwiki', ['xwiki_get_document'], { ready: false })
    const router = new McpToolRouter(() => [routed('XWiki', xwiki)])
    expect(() => router.resolveCallable('xwiki_get_document')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.MCP_SERVER_UNAVAILABLE }),
    )
  })

  it('không source nào sẵn sàng ⇒ isReady false và danh mục rỗng', () => {
    const router = new McpToolRouter(() => [
      routed('A', fakeSource('jira', ['a'], { ready: false })),
      null,
    ])
    expect(router.isReady).toBe(false)
    expect(router.availableTools()).toEqual([])
  })

  it('tool không có trong registry nào ⇒ TOOL_NOT_ALLOWED', () => {
    const router = new McpToolRouter(() => [routed('A', fakeSource('jira', ['a']))])
    expect(() => router.resolveCallable('redmine_delete_issue')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TOOL_NOT_ALLOWED }),
    )
  })

  it('đọc danh sách source mỗi lần gọi — source dựng lại có hiệu lực ngay', () => {
    let sources: RoutedMcpSource[] = []
    const router = new McpToolRouter(() => sources)
    expect(router.isReady).toBe(false)
    sources = [routed('Redmine', fakeSource('redmine', ['redmine_get_issue']))]
    expect(router.isReady).toBe(true)
  })

  it('URL đích và tài khoản lấy từ source phục vụ hệ thống đó', () => {
    const router = new McpToolRouter(() => [
      routed('Atlassian', fakeSource('jira', ['j'], { url: 'https://jira.test' })),
      routed(
        'Redmine',
        fakeSource('redmine', ['r'], { url: 'https://redmine.test', account: 'hoang' }),
      ),
    ])
    expect(router.targetSystemUrl('redmine')).toBe('https://redmine.test')
    expect(router.targetSystemUrl('xwiki')).toBe('')
    expect(router.actingAccount('redmine')).toBe('hoang')
    expect(router.actingAccount('jira')).toBeUndefined()
  })
})

describe('assertDisjointToolNames', () => {
  it('chấp nhận registry rời nhau', () => {
    expect(() =>
      assertDisjointToolNames({ a: [def('x', 'jira')], b: [def('y', 'redmine')] }),
    ).not.toThrow()
  })

  it('ném khi hai registry trùng tên', () => {
    expect(() =>
      assertDisjointToolNames({ a: [def('x', 'jira')], b: [def('x', 'redmine')] }),
    ).toThrow(
      expect.objectContaining({
        safeDetail: expect.stringContaining('defined by both a and b') as unknown,
      }),
    )
  })
})
