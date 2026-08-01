#!/usr/bin/env node
/**
 * MCP Atlassian server giả — nói đúng JSON-RPC 2.0 trên stdio.
 *
 * ĐÂY KHÔNG PHẢI SERVER THẬT. Package thật chưa được chốt (docs/OPEN-QUESTIONS.md A4), nên
 * contract test hiện chạy với server này. Nó cố ý bắt chước những hành vi khó chịu của server
 * thật để test có giá trị:
 *   - in log ra stdout lẫn với JSON-RPC
 *   - trả `isError: true` cho lỗi nghiệp vụ thay vì lỗi JSON-RPC
 *   - đòi credential qua environment và từ chối nếu thiếu
 *
 * Kịch bản điều khiển bằng env `MOCK_SCENARIO`:
 *   ok (mặc định) | auth-failed | slow | crash-on-call | no-tools | garbage-stdout
 */

const scenario = process.env.MOCK_SCENARIO ?? 'ok'
const jiraUrl = process.env.JIRA_URL ?? ''
const jiraUser = process.env.JIRA_USERNAME ?? ''
const jiraToken = process.env.JIRA_PERSONAL_TOKEN ?? ''

/** Bộ nhớ tạm: issue đã tạo, để test double-submit đếm được. */
const created = []
let issueCounter = 0

const TOOLS = [
  {
    name: 'jira_get_issue',
    description: 'Đọc một Jira issue theo key',
    inputSchema: {
      type: 'object',
      properties: { issue_key: { type: 'string' } },
      required: ['issue_key'],
    },
  },
  {
    name: 'jira_search',
    description: 'Tìm Jira issue bằng JQL',
    inputSchema: {
      type: 'object',
      properties: { jql: { type: 'string' }, limit: { type: 'number' } },
      required: ['jql'],
    },
  },
  {
    name: 'jira_create_issue',
    description: 'Tạo Jira issue mới',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        summary: { type: 'string' },
        description: { type: 'string' },
        issue_type: { type: 'string' },
      },
      required: ['project_key', 'summary', 'issue_type'],
    },
  },
  {
    name: 'jira_update_issue',
    description: 'Cập nhật Jira issue',
    inputSchema: {
      type: 'object',
      properties: { issue_key: { type: 'string' }, fields: { type: 'object' } },
      required: ['issue_key', 'fields'],
    },
  },
  {
    name: 'confluence_get_page',
    description: 'Đọc một trang Confluence',
    inputSchema: {
      type: 'object',
      properties: { page_id: { type: 'string' } },
      required: ['page_id'],
    },
  },
  {
    name: 'confluence_search',
    description: 'Tìm trang Confluence bằng CQL',
    inputSchema: { type: 'object', properties: { cql: { type: 'string' } }, required: ['cql'] },
  },
]

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function textResult(id, text, isError = false) {
  ok(id, { content: [{ type: 'text', text }], isError })
}

function credentialsMissing() {
  return jiraUrl === '' || jiraUser === '' || jiraToken === ''
}

async function handleToolCall(id, params) {
  const name = params?.name
  const args = params?.arguments ?? {}

  if (scenario === 'auth-failed') {
    return textResult(id, 'HTTP 401: Unauthorized — invalid personal access token', true)
  }
  if (credentialsMissing()) {
    return textResult(id, 'Missing Jira credentials in environment', true)
  }
  if (scenario === 'crash-on-call') {
    process.exit(3)
  }
  if (scenario === 'slow') {
    await new Promise((r) => setTimeout(r, 5_000))
  }

  switch (name) {
    case 'jira_get_issue': {
      const key = String(args.issue_key ?? '')
      if (key === 'MISSING-1') return textResult(id, 'HTTP 404: issue does not exist', true)
      return textResult(
        id,
        JSON.stringify({
          key,
          summary: `Tiêu đề của ${key}`,
          status: 'In Progress',
          assignee: jiraUser,
          description: 'Mô tả chi tiết của issue.',
          url: `${jiraUrl}/browse/${key}`,
        }),
      )
    }
    case 'jira_search': {
      const jql = String(args.jql ?? '')
      // Cho phép test tra cứu "uncertain": tìm theo summary trả về đúng issue đã tạo.
      const matches = created.filter((issue) => jql.includes(issue.summary))
      return textResult(id, JSON.stringify({ total: matches.length, issues: matches }))
    }
    case 'jira_create_issue': {
      issueCounter += 1
      const key = `${String(args.project_key ?? 'PRJ')}-${String(100 + issueCounter)}`
      const issue = {
        key,
        summary: String(args.summary ?? ''),
        url: `${jiraUrl}/browse/${key}`,
      }
      created.push(issue)
      return textResult(id, JSON.stringify(issue))
    }
    case 'jira_update_issue':
      return textResult(
        id,
        JSON.stringify({ key: String(args.issue_key ?? ''), updated: true }),
      )
    case 'confluence_get_page': {
      const pageId = String(args.page_id ?? '')
      return textResult(
        id,
        JSON.stringify({
          id: pageId,
          title: `Trang ${pageId}`,
          space: 'DOC',
          body: 'Nội dung trang Confluence.',
          url: `${process.env.CONFLUENCE_URL ?? ''}/pages/${pageId}`,
        }),
      )
    }
    case 'confluence_search':
      return textResult(id, JSON.stringify({ total: 0, results: [] }))
    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool ${String(name)}` } })
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let nl
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (line === '') continue

    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    void dispatch(message)
  }
})

async function dispatch(message) {
  const { id, method, params } = message

  if (scenario === 'garbage-stdout') {
    // Server thật hay in log ra stdout; client phải bỏ qua được.
    process.stdout.write('INFO  starting request handler\n')
    process.stdout.write('not json at all\n')
  }

  switch (method) {
    case 'initialize':
      ok(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-atlassian-mcp', version: '0.0.1' },
      })
      return
    case 'notifications/initialized':
      return
    case 'tools/list':
      ok(id, { tools: scenario === 'no-tools' ? [] : TOOLS })
      return
    case 'tools/call':
      await handleToolCall(id, params)
      return
    default:
      if (typeof id === 'number') {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } })
      }
  }
}
