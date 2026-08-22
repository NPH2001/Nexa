import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DEFAULT_APP_SETTINGS, ERROR_CODES } from '@nexa/shared-types'
import { AtlassianMcpManager } from './manager.js'
import { GATEWAY_HEADER_KEYS } from './server-spec.js'
import { testLogger } from '../../../tests/support/factories.js'

const JIRA_URL = 'https://jira.internal'
const CONFLUENCE_URL = 'https://confluence.internal'
const GATEWAY_TOKEN = 'gw-secret-0123456789'

const credentials = {
  jira: { baseUrl: JIRA_URL, username: 'nguyen.van.a', token: 'PAT-jira-0123456789abcdef' },
  confluence: { baseUrl: CONFLUENCE_URL, username: 'nguyen.van.a', token: 'PAT-conf-0123456789abcdef' },
}

/**
 * Gateway MCP giả — nói JSON-RPC qua POST, ghi lại header nhận được để test kiểm tra.
 *
 * `toolNamePrefix`: mô phỏng một gateway thêm tiền tố namespace vào tên tool (đúng hành vi thật
 * đã gặp — `jira_get_issue` xuất hiện thành `atlassian-jira_get_issue`). `tools/call` cố tình
 * TỪ CHỐI nếu tên gửi lên không khớp CHÍNH XÁC tên đã công bố ở `tools/list` — giống một gateway
 * thật sẽ làm — để test phải chứng minh Nexa gọi đúng tên thật, không phải tên quy ước của nó.
 */
function startMockGateway(
  opts: { toolNamePrefix?: string } = {},
): Promise<{
  server: Server
  url: string
  headersLog: Record<string, string>[]
  receivedToolCallNames: string[]
}> {
  const headersLog: Record<string, string>[] = []
  const receivedToolCallNames: string[] = []
  const prefix = opts.toolNamePrefix ?? ''
  const realToolNames = [`${prefix}jira_get_issue`, `${prefix}jira_search`]

  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString('utf8')))
      req.on('end', () => {
        headersLog.push(req.headers as Record<string, string>)
        const parsed = JSON.parse(body) as { id?: number; method: string; params?: { name?: string } }
        res.writeHead(200, { 'content-type': 'application/json' })
        if (parsed.method === 'initialize') {
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id,
              result: { serverInfo: { name: 'mock-atlassian-gateway' } },
            }),
          )
        } else if (parsed.method === 'notifications/initialized') {
          res.end()
        } else if (parsed.method === 'tools/list') {
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id,
              result: { tools: realToolNames.map((name) => ({ name })) },
            }),
          )
        } else if (parsed.method === 'tools/call') {
          const calledName = parsed.params?.name ?? ''
          receivedToolCallNames.push(calledName)
          if (!realToolNames.includes(calledName)) {
            res.end(
              JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -32602, message: 'unknown tool' } }),
            )
            return
          }
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id,
              result: {
                content: [{ type: 'text', text: JSON.stringify({ key: 'PRJ-1', url: `${JIRA_URL}/browse/PRJ-1` }) }],
                isError: false,
              },
            }),
          )
        } else {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -32601, message: 'unknown' } }))
        }
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolvePromise({
        server,
        url: `http://127.0.0.1:${String(port)}/mcp/`,
        headersLog,
        receivedToolCallNames,
      })
    })
  })
}

let servers: Server[] = []
let managers: AtlassianMcpManager[] = []
afterEach(async () => {
  await Promise.all(managers.map((m) => m.stop()))
  managers = []
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))))
  servers = []
})

describe('AtlassianMcpManager — transport HTTP gateway (ADR-0005)', () => {
  it('resolves a gateway-namespaced tool name (e.g. "atlassian-jira_get_issue") and calls the REAL name', async () => {
    // Bug thật đã gặp: gateway LiteLLM đặt tên tool có tiền tố "atlassian-" (khác quy ước
    // "jira_get_issue" của Nexa). Trước bản vá, availableTools() rỗng và callTool() gửi tên
    // sai (không tồn tại trên server) dù kết nối HTTP đã hoạt động đúng.
    const { server, url, receivedToolCallNames } = await startMockGateway({ toolNamePrefix: 'atlassian-' })
    servers.push(server)
    const { logger } = testLogger()

    const manager = new AtlassianMcpManager({
      gateway: { url, token: () => GATEWAY_TOKEN, allowInsecureLoopback: true },
      logger,
      credentials: () => credentials,
      features: () => DEFAULT_APP_SETTINGS.features,
      jiraBaseUrl: JIRA_URL,
      confluenceBaseUrl: CONFLUENCE_URL,
    })
    managers.push(manager)

    await manager.start()
    expect(manager.availableTools().map((t) => t.name)).toContain('jira_get_issue')

    const outcome = await manager.callTool('jira_get_issue', { issue_key: 'PRJ-1' })
    expect(outcome.summary.targetKey).toBe('PRJ-1')
    expect(receivedToolCallNames).toEqual(['atlassian-jira_get_issue'])
  })

  it('starts over the gateway, lists tools and calls one — same public API as stdio', async () => {
    const { server, url, headersLog } = await startMockGateway()
    servers.push(server)
    const { logger } = testLogger()

    const manager = new AtlassianMcpManager({
      gateway: { url, token: () => GATEWAY_TOKEN, allowInsecureLoopback: true },
      logger,
      credentials: () => credentials,
      features: () => ({ ...DEFAULT_APP_SETTINGS.features, jiraUpdate: true }),
      jiraBaseUrl: JIRA_URL,
      confluenceBaseUrl: CONFLUENCE_URL,
    })
    managers.push(manager)

    await manager.start()
    expect(manager.isReady).toBe(true)
    expect(manager.availableTools().map((t) => t.name)).toContain('jira_get_issue')

    const outcome = await manager.callTool('jira_get_issue', { issue_key: 'PRJ-1' })
    expect(outcome.summary.targetKey).toBe('PRJ-1')

    // Mọi request đều mang đúng bearer token + PAT — header dựng lại mỗi lần, không cache.
    expect(headersLog.length).toBeGreaterThan(0)
    for (const headers of headersLog) {
      expect(headers['authorization']).toBe(`Bearer ${GATEWAY_TOKEN}`)
      expect(headers[GATEWAY_HEADER_KEYS.jiraToken]).toBe(credentials.jira.token)
      // Chặng gateway → Jira thật luôn xác thực TLS — Nexa không cấp cách nào tắt nó.
      expect(headers[GATEWAY_HEADER_KEYS.jiraSslVerify]).toBe('true')
    }
  })

  it('keeps the gateway token and both PATs out of every log line', async () => {
    const { server, url } = await startMockGateway()
    servers.push(server)
    const { logger, sink, redactor } = testLogger()
    redactor.registerSecret(GATEWAY_TOKEN)
    redactor.registerSecret(credentials.jira.token)
    redactor.registerSecret(credentials.confluence.token)

    const manager = new AtlassianMcpManager({
      gateway: { url, token: () => GATEWAY_TOKEN, allowInsecureLoopback: true },
      logger,
      credentials: () => credentials,
      features: () => DEFAULT_APP_SETTINGS.features,
      jiraBaseUrl: JIRA_URL,
      confluenceBaseUrl: CONFLUENCE_URL,
    })
    managers.push(manager)
    await manager.start()
    await manager.callTool('jira_get_issue', { issue_key: 'PRJ-1' })

    const logText = sink.asText()
    expect(logText).not.toContain(GATEWAY_TOKEN)
    expect(logText).not.toContain(credentials.jira.token)
    expect(logText).not.toContain(credentials.confluence.token)
  })

  it('sends ssl-verify=false only when the user opted in, and logs a security event', async () => {
    // ADR-0008: đường thoát cho CA nội bộ chưa được gateway tin cậy. Phải TẮT theo mặc định
    // (test ở trên khẳng định 'true'), và khi bật thì phải để lại dấu vết cho ATTT.
    const { server, url, headersLog } = await startMockGateway()
    servers.push(server)
    const { logger, sink } = testLogger()

    const manager = new AtlassianMcpManager({
      gateway: {
        url,
        token: () => GATEWAY_TOKEN,
        allowInsecureLoopback: true,
        skipAtlassianTlsVerify: () => true,
      },
      logger,
      credentials: () => credentials,
      features: () => DEFAULT_APP_SETTINGS.features,
      jiraBaseUrl: JIRA_URL,
      confluenceBaseUrl: CONFLUENCE_URL,
    })
    managers.push(manager)
    await manager.start()

    for (const headers of headersLog) {
      expect(headers[GATEWAY_HEADER_KEYS.jiraSslVerify]).toBe('false')
      expect(headers[GATEWAY_HEADER_KEYS.confluenceSslVerify]).toBe('false')
    }
    const logText = sink.asText()
    expect(logText).toContain('atlassian-tls-verify-skipped')
    // Host được ghi để biết CHẶNG nào đang không xác thực chứng chỉ; PAT thì không bao giờ.
    expect(logText).toContain('jira.internal')
    expect(logText).not.toContain(credentials.jira.token)
  })

  it('defaults to verifying TLS when the option is absent', async () => {
    const { server, url, headersLog } = await startMockGateway()
    servers.push(server)
    const { logger, sink } = testLogger()

    const manager = new AtlassianMcpManager({
      gateway: { url, token: () => GATEWAY_TOKEN, allowInsecureLoopback: true },
      logger,
      credentials: () => credentials,
      features: () => DEFAULT_APP_SETTINGS.features,
      jiraBaseUrl: JIRA_URL,
      confluenceBaseUrl: CONFLUENCE_URL,
    })
    managers.push(manager)
    await manager.start()

    for (const headers of headersLog) {
      expect(headers[GATEWAY_HEADER_KEYS.jiraSslVerify]).toBe('true')
    }
    // Không bật ⇒ tuyệt đối không có dòng log nào, để sự hiện diện của nó luôn có nghĩa.
    expect(sink.asText()).not.toContain('atlassian-tls-verify-skipped')
  })

  it('keeps the default at ssl-verify=true in DEFAULT_APP_SETTINGS', () => {
    // Cờ nằm trong appSettingsSchema nên mặc định của nó là mặc định của MỌI bản cài mới.
    expect(DEFAULT_APP_SETTINGS.mcpGatewaySkipAtlassianTlsVerify).toBe(false)
  })

  it('reports MCP_SERVER_UNAVAILABLE when the gateway url is unreachable', async () => {
    const { logger } = testLogger()
    const manager = new AtlassianMcpManager({
      gateway: { url: 'https://127.0.0.1:1/mcp/', token: () => GATEWAY_TOKEN },
      logger,
      credentials: () => credentials,
      features: () => DEFAULT_APP_SETTINGS.features,
      jiraBaseUrl: JIRA_URL,
      confluenceBaseUrl: CONFLUENCE_URL,
    })
    managers.push(manager)
    await expect(manager.start()).rejects.toMatchObject({ code: ERROR_CODES.MCP_SERVER_UNAVAILABLE })
  })
})
