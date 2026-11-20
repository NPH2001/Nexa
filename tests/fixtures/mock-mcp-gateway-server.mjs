#!/usr/bin/env node
/**
 * MCP Gateway giả cho Redmine — nói JSON-RPC 2.0 qua HTTP POST (Streamable HTTP, trả JSON thường).
 *
 * ĐÂY KHÔNG PHẢI GATEWAY THẬT (LiteLLM). Nó bắt chước đúng những điều đã quan sát ở gateway thật
 * (2026-11-17, ADR 0010) để E2E có giá trị:
 *   - tool công bố có tiền tố server: `redmine-search_issues`, không phải `search_issues`;
 *   - cần ba header: `authorization: Bearer <token gateway>`, `x-mcp-servers: redmine` và
 *     `x-mcp-redmine-x-redmine-api-key: <api key>`; thiếu hoặc sai thì 401;
 *   - `search_issues` trả `{ total_count, issues: [{ id, subject, status:{id,name}, due_date,
 *     updated_on }] }`;
 *   - `get_current_user` trả cả `api_key` của người dùng (Nexa phải gỡ nó khỏi context model).
 *
 * Bộ lọc của bản tin được kiểm CHẶT: sai `assigned_to_id`/`status` thì trả `isError`, để E2E đỏ nếu
 * truy vấn do main dựng bị lệch khỏi hợp đồng "việc của tôi, còn mở".
 *
 * In `LISTENING <port>` ra stdout khi đã sẵn sàng. Mọi request được ghi vào mảng nhớ trong tiến
 * trình; `GET /__calls` trả về danh sách để test đếm số lần gọi.
 */
import { createServer } from 'node:http'

const GATEWAY_TOKEN = 'GW-e2e-0123456789'
const REDMINE_API_KEY = 'RM-e2e-0123456789'
const LOGIN = 'nguyen.van.a'

/** Mỗi lời gọi tool: `{ tool, args }`. */
const calls = []

const TOOLS = [
  {
    name: 'redmine-get_current_user',
    description: 'Return the Redmine user that owns the supplied API key.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'redmine-search_issues',
    description: 'Search Redmine issues with server-side filters.',
    inputSchema: {
      type: 'object',
      properties: {
        assigned_to_id: { type: 'string' },
        status: { type: 'string' },
        sort: { type: 'string' },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
    },
    annotations: { readOnlyHint: true },
  },
]

function dateOffset(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

/** Ba việc đủ ba mức khẩn: quá hạn, đến hạn hôm nay, đang làm không hạn. */
function assignedIssues() {
  return [
    {
      id: 501,
      subject: 'Rà soát log pilot tuần này',
      status: { id: 2, name: 'In Progress' },
      due_date: dateOffset(-1),
      updated_on: '2026-08-28T02:00:00Z',
    },
    {
      id: 502,
      subject: 'Chuẩn bị số liệu cho báo cáo vận hành',
      status: { id: 1, name: 'New' },
      due_date: dateOffset(0),
      updated_on: '2026-08-29T02:00:00Z',
    },
    {
      id: 503,
      subject: 'Dọn backlog kỹ thuật',
      status: { id: 1, name: 'New' },
      updated_on: '2026-08-20T02:00:00Z',
    },
  ]
}

function headersAreValid(req) {
  return (
    req.headers['authorization'] === `Bearer ${GATEWAY_TOKEN}` &&
    req.headers['x-mcp-servers'] === 'redmine' &&
    req.headers['x-mcp-redmine-x-redmine-api-key'] === REDMINE_API_KEY
  )
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function toolText(id, text, isError = false) {
  return rpcResult(id, { content: [{ type: 'text', text }], isError })
}

function callTool(id, params) {
  const name = String(params?.name ?? '')
  const args = params?.arguments ?? {}
  calls.push({ tool: name, args })

  if (name === 'redmine-get_current_user') {
    return toolText(id, JSON.stringify({ id: 7, login: LOGIN, api_key: REDMINE_API_KEY }))
  }
  if (name === 'redmine-search_issues') {
    if (args.assigned_to_id !== 'me' || args.status !== 'open') {
      return toolText(
        id,
        `Error executing tool search_issues: unexpected filter ${JSON.stringify(args)}`,
        true,
      )
    }
    const issues = assignedIssues()
    return toolText(id, JSON.stringify({ total_count: issues.length, issues }))
  }
  return toolText(id, `Error: unknown tool ${name}`, true)
}

function handleRpc(message) {
  switch (message.method) {
    case 'initialize':
      return rpcResult(message.id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-litellm-gateway', version: '0.0.0' },
      })
    case 'tools/list':
      return rpcResult(message.id, { tools: TOOLS })
    case 'tools/call':
      return callTool(message.id, message.params)
    default:
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `method not found: ${String(message.method)}` },
      }
  }
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__calls') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(calls))
    return
  }

  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  if (!headersAreValid(req)) {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    let message
    try {
      message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      res.writeHead(400).end()
      return
    }
    // Notification (không có id): chỉ cần xác nhận đã nhận.
    if (message.id === undefined) {
      res.writeHead(202).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(handleRpc(message)))
  })
})

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`LISTENING ${String(server.address().port)}\n`)
})

process.on('SIGTERM', () => server.close(() => process.exit(0)))
