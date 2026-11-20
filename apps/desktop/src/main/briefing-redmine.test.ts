import { describe, expect, it, vi } from 'vitest'
import { ERROR_CODES, NexaError, type McpToolSource } from '@nexa/shared-types'
import { Logger, MemorySink } from '@nexa/observability'
import {
  BRIEFING_REDMINE_LIMIT,
  BRIEFING_REDMINE_QUERY,
  BRIEFING_REDMINE_TOOL,
  fetchBriefingIssues,
  parseBriefingIssues,
} from './briefing-redmine.js'

const NOW = new Date('2026-09-01T03:00:00.000Z')

function loggerWithSink() {
  const sink = new MemorySink()
  return { logger: new Logger({ sink, minLevel: 'debug' }), sink }
}

function fakeRedmine(callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>) {
  return { callTool } as unknown as Pick<McpToolSource, 'callTool'>
}

function payload(issues: unknown[], total?: number): string {
  return JSON.stringify({ total_count: total ?? issues.length, issues })
}

function options(
  redmine: Pick<McpToolSource, 'callTool'> | null,
  over: { redmineReadEnabled?: boolean } = {},
) {
  return {
    redmine,
    redmineReadEnabled: over.redmineReadEnabled ?? true,
    logger: loggerWithSink().logger,
    now: () => NOW,
  }
}

describe('parseBriefingIssues', () => {
  it('đọc payload search_issues: id thành #id, status là object, hạn neo giữa trưa UTC', () => {
    const { issues, truncatedCount } = parseBriefingIssues(
      payload([
        {
          id: 123,
          subject: 'Sửa lỗi đăng nhập',
          status: { id: 2, name: 'In Progress' },
          due_date: '2026-09-01',
          updated_on: '2026-08-31T10:00:00Z',
        },
      ]),
    )
    expect(truncatedCount).toBe(0)
    expect(issues).toEqual([
      {
        key: '#123',
        summary: 'Sửa lỗi đăng nhập',
        statusName: 'In Progress',
        dueAt: '2026-09-01T12:00:00.000Z',
        updatedAt: '2026-08-31T10:00:00.000Z',
      },
    ])
  })

  it('issue chưa đặt hạn có dueAt là null và vẫn giữ trạng thái mặc định khi thiếu', () => {
    const { issues } = parseBriefingIssues(payload([{ id: 7, subject: 'Việc không hạn' }]))
    expect(issues[0]).toMatchObject({
      key: '#7',
      dueAt: null,
      statusName: 'Không rõ trạng thái',
    })
  })

  it('nhận id dạng chuỗi số', () => {
    const { issues } = parseBriefingIssues(payload([{ id: '15', subject: 'A' }]))
    expect(issues[0]?.key).toBe('#15')
  })

  it('bỏ qua issue hỏng lẻ nhưng vẫn giữ phần còn lại', () => {
    const { issues } = parseBriefingIssues(
      payload([
        { id: 1, subject: 'Giữ lại' },
        { subject: 'Không có id' },
        { id: 'abc', subject: 'Id không phải số' },
        { id: -3, subject: 'Id âm' },
        { id: 2 },
        null,
      ]),
    )
    expect(issues.map((i) => i.key)).toEqual(['#1'])
  })

  it('đếm phần Redmine nói là có nhưng không nằm trong trang này', () => {
    const { issues, truncatedCount } = parseBriefingIssues(payload([{ id: 1, subject: 'A' }], 120))
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
  it('gọi đúng một lần redmine_search_issues với bộ lọc do code dựng', async () => {
    const callTool = vi.fn().mockResolvedValue({ rawText: payload([{ id: 1, subject: 'A' }]) })

    const result = await fetchBriefingIssues(options(fakeRedmine(callTool)))

    expect(callTool).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledWith(BRIEFING_REDMINE_TOOL, {
      assigned_to_id: 'me',
      status: 'open',
      sort: 'due_date:asc',
      limit: BRIEFING_REDMINE_LIMIT,
    })
    expect(result.status).toBe('ok')
    expect(result.fetchedAt).toBe(NOW.toISOString())
  })

  it('bộ lọc chỉ lấy việc của tôi, còn mở, trong trần của tool', () => {
    expect(BRIEFING_REDMINE_QUERY.assigned_to_id).toBe('me')
    expect(BRIEFING_REDMINE_QUERY.status).toBe('open')
    expect(BRIEFING_REDMINE_LIMIT).toBeLessThanOrEqual(100)
  })

  it('chỉ gọi tool đọc và không bao giờ gọi Jira', async () => {
    const callTool = vi.fn().mockResolvedValue({ rawText: payload([]) })
    await fetchBriefingIssues(options(fakeRedmine(callTool)))
    for (const [name] of callTool.mock.calls) {
      expect(name).toBe('redmine_search_issues')
      expect(name).not.toMatch(/jira/i)
    }
  })

  it('phân biệt rỗng thật với hỏng', async () => {
    const empty = await fetchBriefingIssues(
      options(fakeRedmine(vi.fn().mockResolvedValue({ rawText: payload([]) }))),
    )
    expect(empty.status).toBe('empty')

    const broken = await fetchBriefingIssues(
      options(fakeRedmine(vi.fn().mockResolvedValue({ rawText: 'not json' }))),
    )
    expect(broken.status).toBe('error')
    expect(broken.issues).toEqual([])
  })

  it('cờ redmineRead tắt thì không chạm tới Redmine', async () => {
    const callTool = vi.fn()
    const result = await fetchBriefingIssues(
      options(fakeRedmine(callTool), { redmineReadEnabled: false }),
    )
    expect(result.status).toBe('disabled_by_policy')
    expect(callTool).not.toHaveBeenCalled()
  })

  it('chưa cấu hình Redmine là một trạng thái riêng, không phải lỗi', async () => {
    const result = await fetchBriefingIssues(options(null))
    expect(result.status).toBe('not_configured')
  })

  it.each([
    [ERROR_CODES.MCP_SERVER_UNAVAILABLE, 'unavailable'],
    [ERROR_CODES.REDMINE_AUTH_FAILED, 'unauthenticated'],
    [ERROR_CODES.MCP_GATEWAY_AUTH_FAILED, 'unauthenticated'],
    [ERROR_CODES.REDMINE_CONFIG_REQUIRED, 'not_configured'],
    [ERROR_CODES.REDMINE_GATEWAY_REQUIRED, 'not_configured'],
    [ERROR_CODES.TOOL_NOT_ALLOWED, 'disabled_by_policy'],
    [ERROR_CODES.UPSTREAM_UNAVAILABLE, 'error'],
  ])('ánh xạ %s thành trạng thái nguồn %s', async (code, expected) => {
    const result = await fetchBriefingIssues(
      options(fakeRedmine(vi.fn().mockRejectedValue(new NexaError(code)))),
    )
    expect(result.status).toBe(expected)
    expect(result.issues).toEqual([])
  })

  it('không ghi tiêu đề issue vào log', async () => {
    const { logger, sink } = loggerWithSink()
    await fetchBriefingIssues({
      redmine: fakeRedmine(
        vi.fn().mockResolvedValue({
          rawText: payload([{ id: 4242, subject: 'Bí mật thương vụ ABBANK' }]),
        }),
      ),
      redmineReadEnabled: true,
      logger,
      now: () => NOW,
    })
    expect(sink.asText()).not.toContain('ABBANK')
    expect(sink.asText()).not.toContain('4242')
  })
})
