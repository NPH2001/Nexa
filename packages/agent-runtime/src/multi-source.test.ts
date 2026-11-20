import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  ERROR_CODES,
  type ApprovalStatus,
  type ConfirmationRequest,
  type OperationStatus,
  type ToolPreview,
} from '@nexa/shared-types'
import type { McpToolDescriptor, McpToolResult } from '@nexa/mcp-client'
import {
  RemoteMcpServer,
  buildXwikiTools,
  classifyXwikiError,
  type RemoteMcpTransport,
} from '@nexa/work-mcp-servers'
import {
  AgentRuntime,
  ConfirmationGuard,
  McpToolRouter,
  OperationTracker,
  type ToolCallSink,
} from './index.js'
import { testLogger } from '../../../tests/support/factories.js'
import { FakeLlmClient, type ScriptedTurn } from '../../../tests/support/fake-llm.js'

const ORIGIN = 'https://wiki.example.test'
const DOC = `Reference: xwiki:Sales.Plan\nURL: ${ORIGIN}/bin/view/Sales/Plan\nVersion: 4.3\n`

class Sink implements ToolCallSink {
  readonly records: {
    id: string
    toolName: string
    approvalStatus: ApprovalStatus
    operationStatus: OperationStatus
    preview?: ToolPreview
    errorCode?: string
  }[] = []
  begin(info: Parameters<ToolCallSink['begin']>[0]): string {
    const id = `tc_${String(this.records.length)}`
    this.records.push({ id, ...info })
    return id
  }
  update(id: string, patch: Parameters<ToolCallSink['update']>[1]): void {
    const r = this.records.find((x) => x.id === id)
    if (r !== undefined) Object.assign(r, patch)
  }
}

function xwikiTransport(
  respond: (name: string, args: Record<string, unknown>) => McpToolResult,
): RemoteMcpTransport & {
  calls: { name: string; args: Record<string, unknown> }[]
} {
  let ready = false
  const calls: { name: string; args: Record<string, unknown> }[] = []
  return {
    calls,
    get isReady() {
      return ready
    },
    start: () => {
      ready = true
      return Promise.resolve()
    },
    stop: () => {
      ready = false
      return Promise.resolve()
    },
    listTools: () =>
      Promise.resolve(
        ['get_document', 'write_document', 'edit_document'].map((name): McpToolDescriptor => ({
          name,
          inputSchema: { type: 'object' },
        })),
      ),
    callTool: (name, args) => {
      calls.push({ name, args })
      return Promise.resolve(respond(name, args))
    },
  }
}

const text = (t: string, isError = false): McpToolResult => ({
  content: [{ type: 'text', text: t }],
  isError,
})

async function harness(
  script: readonly ScriptedTurn[],
  respond: Parameters<typeof xwikiTransport>[0],
) {
  const { logger } = testLogger()
  const transport = xwikiTransport(respond)
  const xwiki = new RemoteMcpServer({
    system: 'xwiki',
    label: 'XWiki',
    url: `${ORIGIN}/rest/wikis/xwiki/aiLLM/mcp`,
    headers: () => ({ authorization: 'Bearer test' }),
    registry: buildXwikiTools(ORIGIN),
    features: () => DEFAULT_APP_SETTINGS.features,
    logger,
    targetSystemUrl: ORIGIN,
    classifyError: classifyXwikiError,
    transportAuthFailedCode: ERROR_CODES.XWIKI_AUTH_FAILED,
    actingAccountFallback: 'Chủ token XWiki',
    createTransport: () => transport,
  })
  await xwiki.start()

  const router = new McpToolRouter(() => [{ label: 'XWiki', source: xwiki }])
  const guard = new ConfirmationGuard({ logger })
  const confirmations: ConfirmationRequest[] = []
  const sink = new Sink()
  const runtime = new AgentRuntime({
    llm: new FakeLlmClient(script).asClient(),
    mcp: router,
    guard,
    tracker: new OperationTracker(logger),
    logger,
    settings: () => DEFAULT_APP_SETTINGS,
    actingAccount: () => 'jira.user',
    jiraBaseUrl: () => 'https://jira.internal',
    confluenceBaseUrl: () => 'https://confluence.internal',
    requestConfirmation: (request) => {
      confirmations.push(request)
      guard.approve(request.operationId, request.payloadHash)
      return Promise.resolve('approved')
    },
  })
  const run = () =>
    runtime.runTurn({
      requestId: 'req_test',
      conversationId: '00000000-0000-4000-8000-000000000001',
      modelId: 'model-a',
      modelProvider: 'litellm',
      contextWindowTokens: 128_000,
      history: [{ role: 'user', content: 'Cập nhật trang wiki kế hoạch' }],
      emit: () => undefined,
      toolCalls: sink,
    })
  return { run, transport, confirmations, sink }
}

describe('AgentRuntime + router + XWiki (ADR 0010)', () => {
  it('ghi đè: base_version đọc được là thứ được xem trước, duyệt và gửi đi — model không tự chọn được', async () => {
    const h = await harness(
      [
        {
          toolCalls: [
            {
              name: 'xwiki_write_document',
              args: { reference: 'Sales.Plan', content: '= Mới =', base_version: '1.1' },
            },
          ],
        },
        { text: 'Đã cập nhật.' },
      ],
      (name) => (name === 'get_document' ? text(DOC) : text('Saved Sales.Plan as version 4.4')),
    )

    await h.run()

    const preview = h.confirmations[0]?.preview
    expect(preview?.targetSystem).toBe('xwiki')
    expect(preview?.targetSystemUrl).toBe(ORIGIN)
    // Tài khoản lấy từ source XWiki, KHÔNG mượn username Jira của host.
    expect(preview?.actingAccount).toBe('Chủ token XWiki')
    expect(preview?.action).toContain('GHI ĐÈ')

    const write = h.transport.calls.find((c) => c.name === 'write_document')
    expect(write?.args).toMatchObject({ reference: 'Sales.Plan', base_version: '4.3' })
    expect(h.sink.records[0]?.operationStatus).toBe('success')
  })

  it('xung đột phiên bản lúc thực thi ⇒ XWIKI_VERSION_CONFLICT, không phải lỗi mạng', async () => {
    const h = await harness(
      [
        {
          toolCalls: [
            { name: 'xwiki_write_document', args: { reference: 'Sales.Plan', content: 'x' } },
          ],
        },
        { text: 'Không ghi được.' },
      ],
      (name) =>
        name === 'get_document'
          ? text(DOC)
          : text('Version conflict: Sales.Plan is at 4.4, not 4.3', true),
    )

    await h.run()

    expect(h.sink.records[0]?.operationStatus).toBe('failed')
    expect(h.sink.records[0]?.errorCode).toBe(ERROR_CODES.XWIKI_VERSION_CONFLICT)
  })

  it('không đọc được phiên bản trang ⇒ dừng trước preview, không có xác nhận, không ghi', async () => {
    const h = await harness(
      [
        {
          toolCalls: [
            { name: 'xwiki_write_document', args: { reference: 'Sales.Plan', content: 'x' } },
          ],
        },
        { text: 'Không đọc được trang.' },
      ],
      (name) => (name === 'get_document' ? text('HTTP 500 internal error', true) : text('saved')),
    )

    await h.run()

    expect(h.confirmations).toHaveLength(0)
    expect(h.transport.calls.some((c) => c.name === 'write_document')).toBe(false)
  })
})
