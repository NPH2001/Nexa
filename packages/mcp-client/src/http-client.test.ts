import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ERROR_CODES } from '@nexa/shared-types'
import { McpHttpClient } from './http-client.js'
import { testLogger } from '../../../tests/support/factories.js'

const TOOLS = [
  { name: 'jira_get_issue', inputSchema: { type: 'object' } },
  { name: 'jira_search', inputSchema: { type: 'object' } },
]

/**
 * Gateway MCP giả nói "Streamable HTTP" (JSON-RPC 2.0 qua POST, phản hồi application/json).
 * Ghi lại mọi header nhận được để test khẳng định bearer token/PAT có tới đúng chỗ.
 */
function startMockGateway(opts: {
  requireBearer?: string
  scenario?: 'ok' | 'redirect' | '500' | 'huge' | 'garbage' | 'slow'
}): Promise<{
  server: Server
  url: string
  receivedHeaders: Record<string, string>[]
  receivedBodies: { id?: number; method: string }[]
}> {
  const receivedHeaders: Record<string, string>[] = []
  const receivedBodies: { id?: number; method: string }[] = []
  const scenario = opts.scenario ?? 'ok'

  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
      req.on('end', () => {
        receivedHeaders.push(req.headers as Record<string, string>)

        if (opts.requireBearer !== undefined && req.headers.authorization !== `Bearer ${opts.requireBearer}`) {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'unauthorized' } }))
          return
        }

        if (scenario === 'redirect') {
          res.writeHead(302, { location: 'https://evil.example/steal' })
          res.end()
          return
        }
        if (scenario === '500') {
          // Hình dạng thân lỗi của gateway thật (LiteLLM): một object JSON có `error.message`.
          // Đây là thứ duy nhất giải thích được vì sao 500 — test dưới khẳng định nó tới được log.
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              error: { message: "MCP server 'atlassian' is not reachable", type: 'internal_server_error' },
            }),
          )
          return
        }
        if (scenario === 'garbage') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('not json at all')
          return
        }
        if (scenario === 'huge') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { blob: 'x'.repeat(20 * 1024 * 1024) } }))
          return
        }
        if (scenario === 'slow') {
          setTimeout(() => {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }))
          }, 5_000)
          return
        }

        const parsed = JSON.parse(body) as { id?: number; method: string; params?: { name?: string } }
        receivedBodies.push(parsed)
        res.writeHead(200, { 'content-type': 'application/json' })

        // Mô phỏng đúng lỗi thật đã gặp với gateway thật: một số router JSON-RPC coi
        // notification MANG `id` là request cần trả lời và từ chối vì tham số không khớp kỳ
        // vọng của nó cho method đó — trả -32602 (Invalid params).
        if (parsed.method.startsWith('notifications/') && 'id' in parsed) {
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -32602, message: 'invalid params' } }))
          return
        }

        switch (parsed.method) {
          case 'initialize':
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: parsed.id,
                result: { protocolVersion: '2024-11-05', serverInfo: { name: 'mock-gateway' } },
              }),
            )
            return
          case 'notifications/initialized':
            res.end()
            return
          case 'tools/list':
            res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { tools: TOOLS } }))
            return
          case 'tools/call':
            if (!TOOLS.some((t) => t.name === parsed.params?.name)) {
              res.end(
                JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -32601, message: 'unknown tool' } }),
              )
              return
            }
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: parsed.id,
                result: { content: [{ type: 'text', text: 'ok' }], isError: false },
              }),
            )
            return
          default:
            res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -32601, message: 'unknown' } }))
        }
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolvePromise({ server, url: `http://127.0.0.1:${String(port)}/mcp/`, receivedHeaders, receivedBodies })
    })
  })
}

let servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))))
  servers = []
})

describe('McpHttpClient — transport HTTP remote (ADR-0005)', () => {
  it('rejects a non-https url unless allowInsecureLoopback is explicitly set', () => {
    const { logger } = testLogger()
    expect(
      () => new McpHttpClient({ url: 'http://gateway.internal/mcp/', headers: () => ({}), logger }),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.INVALID_URL }))
  })

  it('completes initialize → tools/list → tools/call over the loopback mock gateway', async () => {
    const { server, url } = await startMockGateway({})
    servers.push(server)
    const { logger } = testLogger()

    const client = new McpHttpClient({ url, headers: () => ({}), logger, allowInsecureLoopback: true })
    await client.start()
    expect(client.isReady).toBe(true)

    const tools = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('jira_get_issue')

    const result = await client.callTool('jira_get_issue', { issue_key: 'PRJ-1' })
    expect(result.isError).toBe(false)
  })

  it('sends notifications/initialized WITHOUT an id — a notification is not a request', async () => {
    // Bug thật đã gặp: gửi `id` cho một notification khiến gateway coi nó là request cần trả
    // lời và từ chối bằng -32602, làm start() thất bại ngay sau khi initialize đã thành công.
    const { server, url, receivedBodies } = await startMockGateway({})
    servers.push(server)
    const { logger } = testLogger()
    const client = new McpHttpClient({ url, headers: () => ({}), logger, allowInsecureLoopback: true })
    await client.start()

    const notification = receivedBodies.find((b) => b.method === 'notifications/initialized')
    expect(notification).toBeDefined()
    expect(notification).not.toHaveProperty('id')
  })

  it('sends the bearer token and Atlassian headers built by the caller on every request', async () => {
    const { server, url, receivedHeaders } = await startMockGateway({ requireBearer: 'gw-secret-token' })
    servers.push(server)
    const { logger } = testLogger()

    const client = new McpHttpClient({
      url,
      headers: () => ({
        authorization: 'Bearer gw-secret-token',
        'x-mcp-servers': 'atlassian',
        'x-mcp-atlassian-x-atlassian-jira-personal-token': 'PAT-jira-xyz',
      }),
      logger,
      allowInsecureLoopback: true,
    })
    await client.start()

    expect(receivedHeaders.length).toBeGreaterThan(0)
    for (const headers of receivedHeaders) {
      expect(headers['authorization']).toBe('Bearer gw-secret-token')
      expect(headers['x-mcp-atlassian-x-atlassian-jira-personal-token']).toBe('PAT-jira-xyz')
    }
  })

  it('fails MCP_GATEWAY-style auth rejection as MCP_SERVER_UNAVAILABLE, never hangs', async () => {
    const { server, url } = await startMockGateway({ requireBearer: 'correct-token' })
    servers.push(server)
    const { logger } = testLogger()

    const client = new McpHttpClient({
      url,
      headers: () => ({ authorization: 'Bearer wrong-token' }),
      logger,
      allowInsecureLoopback: true,
    })
    await expect(client.start()).rejects.toMatchObject({ code: ERROR_CODES.MCP_SERVER_UNAVAILABLE })
  })

  it('refuses to follow a redirect — never resends Authorization to a different host', async () => {
    const { server, url } = await startMockGateway({ scenario: 'redirect' })
    servers.push(server)
    const { logger } = testLogger()

    const client = new McpHttpClient({
      url,
      headers: () => ({ authorization: 'Bearer secret' }),
      logger,
      allowInsecureLoopback: true,
    })
    await expect(client.start()).rejects.toMatchObject({ code: ERROR_CODES.MCP_SERVER_UNAVAILABLE })
  })

  it('surfaces a 5xx from the gateway as MCP_SERVER_UNAVAILABLE', async () => {
    const { server, url } = await startMockGateway({ scenario: '500' })
    servers.push(server)
    const { logger } = testLogger()
    const client = new McpHttpClient({ url, headers: () => ({}), logger, allowInsecureLoopback: true })
    await expect(client.start()).rejects.toMatchObject({ code: ERROR_CODES.MCP_SERVER_UNAVAILABLE })
  })

  it('logs WHY the gateway failed — status alone is not diagnosable', async () => {
    // Lỗi thật đã gặp: mọi `initialize` trả 500 và log chỉ có "gateway responded with http 500",
    // không phân biệt được gateway crash, key bị từ chối, hay MCP server phía sau chết.
    const { server, url } = await startMockGateway({ scenario: '500' })
    servers.push(server)
    const { logger, sink, redactor } = testLogger()
    redactor.registerSecret('gw-secret-value-0123456789')

    const client = new McpHttpClient({
      url,
      headers: () => ({ authorization: 'Bearer gw-secret-value-0123456789' }),
      logger,
      allowInsecureLoopback: true,
    })
    await expect(client.start()).rejects.toMatchObject({ code: ERROR_CODES.MCP_SERVER_UNAVAILABLE })

    const logText = sink.asText()
    expect(logText).toContain('http 500')
    expect(logText).toContain("MCP server 'atlassian' is not reachable")
    // Path + TÊN header: gateway thật trả cùng một 500 cho "thiếu Authorization" và cho lỗi nội
    // bộ của nó, nên hai thứ này là cách duy nhất phân biệt mà không ghi secret ra log.
    expect(logText).toContain('/mcp/')
    expect(logText).toContain('authorization')
    // Snippet và tên header đều đi qua Redactor như mọi field khác — giá trị thì không bao giờ.
    expect(logText).not.toContain('gw-secret-value-0123456789')
  })

  it('logs the rpc error message, not just the numeric code', async () => {
    // Nhánh song song: gateway trả 200 kèm JSON-RPC error. Một `-32602` trần không nói được là
    // "notification mang id" hay "thiếu header cấu hình".
    const { server, url } = await startMockGateway({})
    servers.push(server)
    const { logger, sink } = testLogger()
    const client = new McpHttpClient({ url, headers: () => ({}), logger, allowInsecureLoopback: true })
    await client.start()

    await expect(client.callTool('nope', {})).rejects.toMatchObject({
      code: ERROR_CODES.MCP_SERVER_UNAVAILABLE,
    })
    expect(sink.asText()).toContain('rpc code -32601: unknown tool')
  })

  it('rejects a non-JSON response instead of crashing', async () => {
    const { server, url } = await startMockGateway({ scenario: 'garbage' })
    servers.push(server)
    const { logger } = testLogger()
    const client = new McpHttpClient({ url, headers: () => ({}), logger, allowInsecureLoopback: true })
    await expect(client.start()).rejects.toMatchObject({ code: ERROR_CODES.MCP_SERVER_UNAVAILABLE })
  })

  it('cuts off a response that exceeds the size cap rather than buffering it all', async () => {
    const { server, url } = await startMockGateway({ scenario: 'huge' })
    servers.push(server)
    const { logger } = testLogger()
    const client = new McpHttpClient({
      url,
      headers: () => ({}),
      logger,
      allowInsecureLoopback: true,
      maxResponseBytes: 1024,
    })
    await expect(client.start()).rejects.toMatchObject({ code: ERROR_CODES.MCP_SERVER_UNAVAILABLE })
  })

  it('times out a slow gateway rather than hanging forever', async () => {
    const { server, url } = await startMockGateway({ scenario: 'slow' })
    servers.push(server)
    const { logger } = testLogger()
    const client = new McpHttpClient({
      url,
      headers: () => ({}),
      logger,
      allowInsecureLoopback: true,
      startupTimeoutMs: 500,
    })
    await expect(client.start()).rejects.toMatchObject({ code: ERROR_CODES.MCP_SERVER_UNAVAILABLE })
  }, 10_000)

  it('never writes header values into the log sink', async () => {
    const { server, url } = await startMockGateway({})
    servers.push(server)
    const { logger, sink } = testLogger()
    const client = new McpHttpClient({
      url,
      headers: () => ({ authorization: 'Bearer super-secret-value-0123456789' }),
      logger,
      allowInsecureLoopback: true,
    })
    await client.start()
    await client.listTools()

    expect(sink.asText()).not.toContain('super-secret-value-0123456789')
  })
})
