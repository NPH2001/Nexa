import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  ERROR_CODES,
  NexaError,
  type FeatureFlags,
  type McpStatusEvent,
} from '@nexa/shared-types'
import type { McpToolDescriptor, McpToolResult } from '@nexa/mcp-client'
import { testLogger } from '../../../tests/support/factories.js'
import { RemoteMcpServer, type RemoteMcpTransport } from './remote-server.js'
import {
  buildRedmineGatewayHeaders,
  buildRedmineTools,
  classifyRedmineError,
  identifyRedmineUser,
} from './redmine.js'

const SECRET_KEY = 'redmine-api-key-0123456789abcdef0123456789abcdef'

/** Transport giả: công bố tool dưới tên có tiền tố gateway, trả kết quả theo kịch bản. */
function fakeTransport(opts: {
  startError?: NexaError
  tools?: string[]
  respond?: (name: string, args: Record<string, unknown>) => McpToolResult
}): RemoteMcpTransport & { calls: { name: string; args: Record<string, unknown> }[] } {
  let ready = false
  const calls: { name: string; args: Record<string, unknown> }[] = []
  return {
    calls,
    get isReady() {
      return ready
    },
    start: () => {
      if (opts.startError !== undefined) return Promise.reject(opts.startError)
      ready = true
      return Promise.resolve()
    },
    stop: () => {
      ready = false
      return Promise.resolve()
    },
    listTools: () =>
      Promise.resolve(
        (opts.tools ?? ['redmine-get_current_user', 'redmine-get_issue', 'redmine-update_issue']).map(
          (name): McpToolDescriptor => ({ name, inputSchema: { type: 'object' } }),
        ),
      ),
    callTool: (name, args) => {
      calls.push({ name, args })
      return Promise.resolve(
        opts.respond?.(name, args) ?? {
          content: [{ type: 'text', text: JSON.stringify({ id: 7, login: 'tester', api_key: SECRET_KEY }) }],
          isError: false,
        },
      )
    },
  }
}

function server(
  transport: RemoteMcpTransport,
  features: Partial<FeatureFlags> = {},
): { s: RemoteMcpServer; statuses: McpStatusEvent[]; sink: ReturnType<typeof testLogger>['sink'] } {
  const { logger, sink } = testLogger()
  const statuses: McpStatusEvent[] = []
  const s = new RemoteMcpServer({
    system: 'redmine',
    label: 'Redmine',
    url: 'https://gateway.example.test/mcp/',
    headers: () => buildRedmineGatewayHeaders({ gatewayToken: 'gw', apiKey: SECRET_KEY }),
    registry: buildRedmineTools('https://redmine.example.test'),
    features: () => ({ ...DEFAULT_APP_SETTINGS.features, ...features }),
    logger,
    targetSystemUrl: 'https://redmine.example.test',
    classifyError: classifyRedmineError,
    transportAuthFailedCode: ERROR_CODES.MCP_GATEWAY_AUTH_FAILED,
    identify: identifyRedmineUser,
    actingAccountFallback: 'Chủ API key Redmine',
    onStatus: (e) => statuses.push(e),
    createTransport: () => transport,
  })
  return { s, statuses, sink }
}

describe('RemoteMcpServer', () => {
  it('khớp tool qua tiền tố gateway và lấy login từ get_current_user', async () => {
    const t = fakeTransport({})
    const { s, statuses } = server(t)
    await s.start()

    expect(s.isReady).toBe(true)
    expect(s.availableTools().map((d) => d.name).sort()).toEqual([
      'redmine_get_current_user',
      'redmine_get_issue',
      'redmine_update_issue',
    ])
    expect(s.actingAccount('redmine')).toBe('tester')
    expect(s.actingAccount('jira')).toBeUndefined()
    expect(s.targetSystemUrl('redmine')).toBe('https://redmine.example.test')
    expect(t.calls[0]?.name).toBe('redmine-get_current_user')
    expect(statuses.at(-1)).toMatchObject({ system: 'redmine', state: 'ready' })
  })

  it('cờ tắt ⇒ tool biến khỏi danh mục và bị cổng thực thi từ chối', async () => {
    const { s } = server(fakeTransport({}), { redmineUpdate: false })
    await s.start()
    expect(s.availableTools().map((d) => d.name)).not.toContain('redmine_update_issue')
    expect(() => s.resolveCallable('redmine_update_issue')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TOOL_NOT_ALLOWED }),
    )
  })

  it('gọi tool bằng tên thật trên server', async () => {
    const t = fakeTransport({})
    const { s } = server(t)
    await s.start()
    await s.callTool('redmine_get_issue', { issue_id: 5 })
    expect(t.calls.at(-1)).toEqual({ name: 'redmine-get_issue', args: { issue_id: 5 } })
  })

  it('gateway từ chối bearer (http 401) ⇒ MCP_GATEWAY_AUTH_FAILED, router nhận được mã đó', async () => {
    const { s, statuses } = server(
      fakeTransport({
        startError: new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
          safeDetail: 'gateway responded with http 401: unauthorized',
        }),
      }),
    )
    await expect(s.start()).rejects.toMatchObject({ code: ERROR_CODES.MCP_GATEWAY_AUTH_FAILED })
    expect(s.isReady).toBe(false)
    expect(s.unavailableCode).toBe(ERROR_CODES.MCP_GATEWAY_AUTH_FAILED)
    expect(statuses.at(-1)).toMatchObject({ state: 'error', errorCode: ERROR_CODES.MCP_GATEWAY_AUTH_FAILED })
  })

  it('API key Redmine sai ⇒ REDMINE_AUTH_FAILED ngay lúc khởi chạy', async () => {
    const { s } = server(
      fakeTransport({
        respond: () => ({
          content: [{ type: 'text', text: 'Error executing tool get_current_user: GET /users/current.json: HTTP 401 - Unauthorized' }],
          isError: true,
        }),
      }),
    )
    await expect(s.start()).rejects.toMatchObject({ code: ERROR_CODES.REDMINE_AUTH_FAILED })
    expect(s.unavailableCode).toBe(ERROR_CODES.REDMINE_AUTH_FAILED)
  })

  it('lỗi tool được phân loại; log không chứa API key', async () => {
    const t = fakeTransport({
      respond: (name) =>
        name === 'redmine-get_current_user'
          ? { content: [{ type: 'text', text: '{"login":"tester"}' }], isError: false }
          : { content: [{ type: 'text', text: 'GET /issues/5.json: HTTP 403 - forbidden' }], isError: true },
    })
    const { s, sink } = server(t)
    await s.start()
    await expect(s.callTool('redmine_get_issue', { issue_id: 5 })).rejects.toMatchObject({
      code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
    })
    expect(sink.asText()).not.toContain(SECRET_KEY)
  })

  it('stop ⇒ không còn tool khả dụng', async () => {
    const { s } = server(fakeTransport({}))
    await s.start()
    await s.stop()
    expect(s.isReady).toBe(false)
    expect(s.availableTools()).toEqual([])
    expect(s.actingAccount('redmine')).toBe('Chủ API key Redmine')
  })
})
