import { describe, expect, it, vi } from 'vitest'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import { Logger, MemorySink } from '@nexa/observability'
import type { AtlassianMcpManager } from '@nexa/atlassian-mcp-manager'
import {
  BRIEFING_JIRA_LIMIT,
  BRIEFING_JQL,
  fetchBriefingIssues,
  parseBriefingIssues,
} from './briefing-jira.js'

const NOW = new Date('2026-09-01T03:00:00.000Z')

function loggerWithSink() {
  const sink = new MemorySink()
  return { logger: new Logger({ sink, minLevel: 'debug' }), sink }
}

function fakeMcp(callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>) {
  return { callTool } as unknown as AtlassianMcpManager
}

function payload(issues: unknown[], total?: number): string {
  return JSON.stringify({ total: total ?? issues.length, issues })
}

describe('parseBriefingIssues', () => {
  it('đọc được payload phẳng của mcp-atlassian', () => {
    const { issues, truncatedCount } = parseBriefingIssues(
      payload([
        {
          key: 'DT-1',
          summary: 'Sửa lỗi đăng nhập',
          status: 'In Progress',
          duedate: '2026-09-01',
          updated: '2026-08-31T10:00:00.000Z',
        },
      ]),
    )
    expect(truncatedCount).toBe(0)
    expect(issues).toEqual([
      {
        key: 'DT-1',
        summary: 'Sửa lỗi đăng nhập',
        statusName: 'In Progress',
        dueAt: '2026-09-01T12:00:00.000Z',
        updatedAt: '2026-08-31T10:00:00.000Z',
        inActiveSprint: false,
      },
    ])
  })

  it('đọc được payload lồng trong fields và status dạng object', () => {
    const { issues } = parseBriefingIssues(
      payload([
        {
          key: 'DT-2',
          fields: {
            summary: 'Viết tài liệu',
            status: { name: 'To Do' },
            duedate: '2026-09-10',
            updated: '2026-08-20T02:00:00.000Z',
          },
        },
      ]),
    )
    expect(issues[0]).toMatchObject({
      key: 'DT-2',
      summary: 'Viết tài liệu',
      statusName: 'To Do',
      dueAt: '2026-09-10T12:00:00.000Z',
    })
  })

  it('neo ngày chỉ có YYYY-MM-DD vào giữa trưa UTC để không lệch một ngày', () => {
    const { issues } = parseBriefingIssues(
      payload([{ key: 'DT-3', summary: 'X', duedate: '2026-09-01' }]),
    )
    expect(issues[0]?.dueAt).toBe('2026-09-01T12:00:00.000Z')
  })

  it('nhận diện sprint đang chạy khi payload có nói, và chỉ khi đó', () => {
    const { issues } = parseBriefingIssues(
      payload([
        { key: 'DT-4', summary: 'A', sprint: { state: 'active', name: 'Sprint 9' } },
        { key: 'DT-5', summary: 'B', sprint: { state: 'closed', name: 'Sprint 8' } },
        { key: 'DT-6', summary: 'C' },
      ]),
    )
    expect(issues.map((i) => i.inActiveSprint)).toEqual([true, false, false])
  })

  it('bỏ qua issue hỏng lẻ nhưng vẫn giữ phần còn lại', () => {
    const { issues } = parseBriefingIssues(
      payload([{ key: 'DT-7', summary: 'Giữ lại' }, { summary: 'Không có key' }, null]),
    )
    expect(issues.map((i) => i.key)).toEqual(['DT-7'])
  })

  it('đếm phần Jira nói là có nhưng không nằm trong trang này', () => {
    const { issues, truncatedCount } = parseBriefingIssues(
      payload([{ key: 'DT-8', summary: 'A' }], 120),
    )
    expect(issues).toHaveLength(1)
    expect(truncatedCount).toBe(119)
  })

  it('payload không phải JSON là lỗi nguồn, không phải danh sách rỗng', () => {
    expect(() => parseBriefingIssues('<html>502 Bad Gateway</html>')).toThrow(NexaError)
  })

  it('payload JSON nhưng không có danh sách issue cũng là lỗi nguồn', () => {
    expect(() => parseBriefingIssues(JSON.stringify({ message: 'nope' }))).toThrow(
      expect.objectContaining({
        code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
        safeDetail: expect.stringMatching(/issue list/i),
      }),
    )
  })
})

describe('fetchBriefingIssues', () => {
  it('gọi đúng jira_search với JQL do code dựng và trần của tool', async () => {
    const callTool = vi.fn().mockResolvedValue({ rawText: payload([{ key: 'DT-1', summary: 'A' }]) })
    const { logger } = loggerWithSink()

    const result = await fetchBriefingIssues({
      mcp: fakeMcp(callTool),
      jiraSearchEnabled: true,
      logger,
      now: () => NOW,
    })

    expect(callTool).toHaveBeenCalledExactlyOnceWith('jira_search', {
      jql: BRIEFING_JQL,
      limit: BRIEFING_JIRA_LIMIT,
    })
    expect(BRIEFING_JIRA_LIMIT).toBeLessThanOrEqual(50)
    expect(result.status).toBe('ok')
    expect(result.fetchedAt).toBe(NOW.toISOString())
  })

  it('không gọi tool ghi nào', async () => {
    const callTool = vi.fn().mockResolvedValue({ rawText: payload([]) })
    const { logger } = loggerWithSink()
    await fetchBriefingIssues({
      mcp: fakeMcp(callTool),
      jiraSearchEnabled: true,
      logger,
      now: () => NOW,
    })
    for (const [name] of callTool.mock.calls) {
      expect(name).toBe('jira_search')
    }
  })

  it('phân biệt rỗng thật với hỏng', async () => {
    const { logger } = loggerWithSink()
    const empty = await fetchBriefingIssues({
      mcp: fakeMcp(vi.fn().mockResolvedValue({ rawText: payload([]) })),
      jiraSearchEnabled: true,
      logger,
      now: () => NOW,
    })
    expect(empty.status).toBe('empty')

    const broken = await fetchBriefingIssues({
      mcp: fakeMcp(vi.fn().mockResolvedValue({ rawText: 'not json' })),
      jiraSearchEnabled: true,
      logger,
      now: () => NOW,
    })
    expect(broken.status).toBe('error')
    expect(broken.issues).toEqual([])
  })

  it('cờ jiraSearch tắt thì không chạm tới MCP', async () => {
    const callTool = vi.fn()
    const { logger } = loggerWithSink()
    const result = await fetchBriefingIssues({
      mcp: fakeMcp(callTool),
      jiraSearchEnabled: false,
      logger,
      now: () => NOW,
    })
    expect(result.status).toBe('disabled_by_policy')
    expect(callTool).not.toHaveBeenCalled()
  })

  it('chưa cấu hình MCP là một trạng thái riêng, không phải lỗi', async () => {
    const { logger } = loggerWithSink()
    const result = await fetchBriefingIssues({
      mcp: null,
      jiraSearchEnabled: true,
      logger,
      now: () => NOW,
    })
    expect(result.status).toBe('not_configured')
  })

  it.each([
    [ERROR_CODES.MCP_SERVER_UNAVAILABLE, 'unavailable'],
    [ERROR_CODES.ATLASSIAN_AUTH_FAILED, 'unauthenticated'],
    [ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED, 'not_configured'],
    [ERROR_CODES.TOOL_NOT_ALLOWED, 'disabled_by_policy'],
    [ERROR_CODES.UPSTREAM_UNAVAILABLE, 'error'],
  ])('ánh xạ %s thành trạng thái nguồn %s', async (code, expected) => {
    const { logger } = loggerWithSink()
    const result = await fetchBriefingIssues({
      mcp: fakeMcp(vi.fn().mockRejectedValue(new NexaError(code))),
      jiraSearchEnabled: true,
      logger,
      now: () => NOW,
    })
    expect(result.status).toBe(expected)
    expect(result.issues).toEqual([])
  })

  it('không ghi tiêu đề issue vào log', async () => {
    const { logger, sink } = loggerWithSink()
    await fetchBriefingIssues({
      mcp: fakeMcp(
        vi.fn().mockResolvedValue({
          rawText: payload([{ key: 'DT-1', summary: 'Bí mật thương vụ ABBANK' }]),
        }),
      ),
      jiraSearchEnabled: true,
      logger,
      now: () => NOW,
    })
    expect(sink.asText()).not.toContain('ABBANK')
    expect(sink.asText()).not.toContain('DT-1')
  })
})
