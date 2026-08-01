import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import {
  DEFAULT_APP_SETTINGS,
  ERROR_CODES,
  type AppSettings,
  type ApprovalStatus,
  type ConfirmationRequest,
  type OperationStatus,
  type RiskLevel,
  type ToolPreview,
} from '@nexa/shared-types'
import { AtlassianMcpManager } from '@nexa/atlassian-mcp-manager'
import { computePayloadHash } from '@nexa/security'
import { AgentRuntime, ConfirmationGuard, OperationTracker, type ToolCallSink } from './index.js'
import { testLogger, fakeClock } from '../../../tests/support/factories.js'
import { FakeLlmClient, type ScriptedTurn } from '../../../tests/support/fake-llm.js'

const MOCK_SERVER = join(process.cwd(), 'tests/fixtures/mock-mcp-server.mjs')
const JIRA_URL = 'https://jira.internal'
const CONFLUENCE_URL = 'https://confluence.internal'
const ACCOUNT = 'nguyen.van.a'

interface RecordedToolCall {
  id: string
  toolName: string
  riskLevel: RiskLevel
  approvalStatus: ApprovalStatus
  operationStatus: OperationStatus
  preview?: ToolPreview
  operationId?: string
  resultSummary?: string
  targetKey?: string
  targetUrl?: string
  errorCode?: string
}

/** Sink ghi nhớ trong RAM — thay cho ConversationRepository trong test. */
class MemoryToolCallSink implements ToolCallSink {
  readonly records: RecordedToolCall[] = []
  private seq = 0

  begin(info: Parameters<ToolCallSink['begin']>[0]): string {
    const id = `tc_${String(this.seq++)}`
    this.records.push({ id, ...info })
    return id
  }

  update(recordId: string, patch: Parameters<ToolCallSink['update']>[1]): void {
    const record = this.records.find((r) => r.id === recordId)
    if (record !== undefined) Object.assign(record, patch)
  }

  byTool(name: string): RecordedToolCall[] {
    return this.records.filter((r) => r.toolName === name)
  }
}

interface Harness {
  runtime: AgentRuntime
  mcp: AtlassianMcpManager
  guard: ConfirmationGuard
  tracker: OperationTracker
  llm: FakeLlmClient
  sink: MemoryToolCallSink
  logSink: ReturnType<typeof testLogger>['sink']
  /** Ghi lại mọi ConfirmationRequest UI nhận được. */
  confirmations: ConfirmationRequest[]
  emitted: unknown[]
  run(overrides?: { signal?: AbortSignal }): Promise<Awaited<ReturnType<AgentRuntime['runTurn']>>>
}

const managers: AtlassianMcpManager[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.stop()))
})

async function makeHarness(opts: {
  script: readonly ScriptedTurn[]
  /** Quyết định của người dùng cho mỗi lần xác nhận, theo thứ tự. */
  decisions?: readonly ('approve' | 'cancel' | 'ignore')[]
  settings?: Partial<AppSettings>
  scenario?: string
  now?: () => Date
  /** Can thiệp vào request ngay trước khi người dùng bấm Xác nhận (test TOCTOU). */
  onConfirm?: (request: ConfirmationRequest, guard: ConfirmationGuard) => void
}): Promise<Harness> {
  const { logger, sink: logSink, redactor } = testLogger()
  redactor.registerSecret('PAT-jira-0123456789abcdef')

  const settings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    ...opts.settings,
    features: {
      ...DEFAULT_APP_SETTINGS.features,
      jiraComment: true,
      jiraUpdate: true,
      ...opts.settings?.features,
    },
  }

  const mcp = new AtlassianMcpManager({
    spec: {
      command: process.execPath,
      args: [MOCK_SERVER],
      env: { MOCK_SCENARIO: opts.scenario ?? 'ok' },
      startupTimeoutMs: 15_000,
    },
    logger,
    credentials: () => ({
      jira: { baseUrl: JIRA_URL, username: ACCOUNT, token: 'PAT-jira-0123456789abcdef' },
      confluence: { baseUrl: CONFLUENCE_URL, username: ACCOUNT, token: 'PAT-conf-0123456789abc' },
    }),
    features: () => settings.features,
    jiraBaseUrl: JIRA_URL,
    confluenceBaseUrl: CONFLUENCE_URL,
    toolTimeoutMs: 3_000,
  })
  managers.push(mcp)
  await mcp.start()

  const guard = new ConfirmationGuard({
    logger,
    ttlSeconds: settings.approvalTtlSeconds,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })
  const tracker = new OperationTracker(logger)
  const llm = new FakeLlmClient(opts.script)
  const toolSink = new MemoryToolCallSink()
  const confirmations: ConfirmationRequest[] = []
  const emitted: unknown[] = []
  const decisions = [...(opts.decisions ?? [])]

  const runtime = new AgentRuntime({
    llm: llm.asClient(),
    mcp,
    guard,
    tracker,
    logger,
    settings: () => settings,
    actingAccount: () => ACCOUNT,
    jiraBaseUrl: () => JIRA_URL,
    confluenceBaseUrl: () => CONFLUENCE_URL,
    requestConfirmation: (request) => {
      confirmations.push(request)
      opts.onConfirm?.(request, guard)
      const decision = decisions.shift() ?? 'approve'
      if (decision === 'cancel') {
        guard.cancel(request.operationId)
        return Promise.resolve('cancelled')
      }
      if (decision === 'ignore') return Promise.resolve('cancelled')
      guard.approve(request.operationId, request.payloadHash)
      return Promise.resolve('approved')
    },
  })

  return {
    runtime,
    mcp,
    guard,
    tracker,
    llm,
    sink: toolSink,
    logSink,
    confirmations,
    emitted,
    run: (overrides = {}) =>
      runtime.runTurn({
        requestId: 'req_test',
        conversationId: '00000000-0000-4000-8000-000000000001',
        modelId: 'model-a',
        contextWindowTokens: 128_000,
        history: [{ role: 'user', content: 'Tạo cho tôi một task' }],
        emit: (e) => emitted.push(e),
        toolCalls: toolSink,
        ...overrides,
      }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// §17.2 — bảy kịch bản BẮT BUỘC cho tool write
// ═══════════════════════════════════════════════════════════════════════════

describe('§17.2 — kịch bản bắt buộc cho tool write', () => {
  const createCall = {
    name: 'jira.create_issue',
    args: { project_key: 'PRJ', summary: 'Sửa lỗi đăng nhập', issue_type: 'Bug' },
  }

  it('1. PAT thiếu quyền → hệ thống đích từ chối, Nexa hiển thị lỗi đã chuẩn hoá', async () => {
    const h = await makeHarness({
      script: [{ toolCalls: [createCall] }, { text: 'Không tạo được task.' }],
      scenario: 'auth-failed',
    })

    const result = await h.run()

    const record = h.sink.byTool('jira.create_issue')[0]
    expect(record?.operationStatus).toBe('failed')
    expect(record?.errorCode).toBe(ERROR_CODES.ATLASSIAN_AUTH_FAILED)
    expect(result.uncertainOperationIds).toHaveLength(0)
  })

  it('2. Người dùng huỷ → KHÔNG có request nào gửi tới hệ thống đích', async () => {
    const callTool = vi.spyOn(AtlassianMcpManager.prototype, 'callTool')
    try {
      const h = await makeHarness({
        script: [{ toolCalls: [createCall] }, { text: 'Đã huỷ theo yêu cầu.' }],
        decisions: ['cancel'],
      })

      await h.run()

      expect(h.confirmations).toHaveLength(1)
      expect(callTool).not.toHaveBeenCalled()
      expect(h.sink.byTool('jira.create_issue')[0]?.approvalStatus).toBe('cancelled')
    } finally {
      callTool.mockRestore()
    }
  })

  it('3. Payload bị thay đổi sau preview → approval không hợp lệ', async () => {
    const { logger } = testLogger()
    const guard = new ConfirmationGuard({ logger })

    const request = guard.open({
      conversationId: 'c1',
      toolName: 'jira.create_issue',
      validatedPayload: { project_key: 'PRJ', summary: 'Bản gốc', issue_type: 'Task' },
      preview: fakePreview(),
    })
    guard.approve(request.operationId, request.payloadHash)

    // Payload sắp gửi đã khác thứ người dùng nhìn thấy.
    expect(() =>
      guard.consume(request.operationId, 'jira.create_issue', {
        project_key: 'PRJ',
        summary: 'ĐÃ BỊ SỬA',
        issue_type: 'Task',
      }),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.TOOL_PAYLOAD_MISMATCH }))
  })

  it('3b. UI gửi lại hash khác với hash guard đang giữ → từ chối ngay ở bước approve', () => {
    const { logger } = testLogger()
    const guard = new ConfirmationGuard({ logger })
    const request = guard.open({
      conversationId: 'c1',
      toolName: 'jira.create_issue',
      validatedPayload: { a: 1 },
      preview: fakePreview(),
    })

    expect(() => guard.approve(request.operationId, 'f'.repeat(64))).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TOOL_PAYLOAD_MISMATCH }),
    )
  })

  it('4. Bấm xác nhận hai lần → chỉ tạo MỘT đối tượng', async () => {
    const h = await makeHarness({
      script: [{ toolCalls: [createCall] }, { text: 'Đã tạo.' }],
    })

    await h.run()

    const operationId = h.confirmations[0]!.operationId
    // Lần "bấm" thứ hai: approval đã bị tiêu, operation đã hoàn tất.
    expect(() =>
      h.guard.consume(operationId, 'jira.create_issue', {
        project_key: 'PRJ',
        summary: 'Sửa lỗi đăng nhập',
        issue_type: 'Bug',
        description: '',
      }),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.OPERATION_ALREADY_RUNNING }))

    expect(h.sink.byTool('jira.create_issue')).toHaveLength(1)
    expect(h.sink.byTool('jira.create_issue')[0]?.operationStatus).toBe('success')
  })

  it('5. Timeout sau khi gửi → giữ trạng thái uncertain và KHÔNG tự retry', async () => {
    const h = await makeHarness({
      script: [{ toolCalls: [createCall] }, { text: 'không nên tới đây' }],
      scenario: 'slow', // tool call vượt toolTimeoutMs
    })

    const result = await h.run()

    const record = h.sink.byTool('jira.create_issue')[0]
    expect(record?.operationStatus).toBe('uncertain')
    expect(record?.errorCode).toBe(ERROR_CODES.TOOL_EXECUTION_UNCERTAIN)
    expect(result.uncertainOperationIds).toHaveLength(1)
    // Runtime dừng hẳn sau uncertain — không gọi model thêm để nó "thử lại".
    expect(h.llm.turnsConsumed).toBe(1)
    expect(h.tracker.listUncertain()).toHaveLength(1)
  }, 20_000)

  it('6. Lỗi từ hệ thống đích → có request_id/operation_id để đối chiếu', async () => {
    const h = await makeHarness({
      script: [{ toolCalls: [createCall] }, { text: 'Có lỗi xảy ra.' }],
      scenario: 'auth-failed',
    })
    await h.run()

    const record = h.sink.byTool('jira.create_issue')[0]
    expect(record?.operationId).toBeDefined()
    expect(h.confirmations[0]?.operationId).toBe(record?.operationId)
  })

  it('7. Không có API key, PAT hay payload nhạy cảm trong local log', async () => {
    const h = await makeHarness({
      script: [
        {
          toolCalls: [
            {
              name: 'jira.create_issue',
              args: {
                project_key: 'PRJ',
                summary: 'Mật khẩu VPN mới là hunter2',
                issue_type: 'Task',
              },
            },
          ],
        },
        { text: 'Đã tạo.' },
      ],
    })
    await h.run()

    const logText = h.logSink.asText()
    expect(logText).not.toContain('PAT-jira-0123456789abcdef')
    expect(logText).not.toContain('hunter2')
    expect(logText).not.toContain('Mật khẩu VPN')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ConfirmationGuard — bất biến còn lại
// ═══════════════════════════════════════════════════════════════════════════

describe('ConfirmationGuard', () => {
  it('không cho thực thi khi chưa được xác nhận', () => {
    const { logger } = testLogger()
    const guard = new ConfirmationGuard({ logger })
    const request = guard.open({
      conversationId: 'c1',
      toolName: 'jira.create_issue',
      validatedPayload: { a: 1 },
      preview: fakePreview(),
    })

    expect(() => guard.consume(request.operationId, 'jira.create_issue', { a: 1 })).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TOOL_APPROVAL_REQUIRED }),
    )
  })

  it('approval hết hạn thì vô hiệu, kể cả đã được duyệt', () => {
    const clock = fakeClock()
    const { logger } = testLogger()
    const guard = new ConfirmationGuard({ logger, ttlSeconds: 60, now: clock.now })

    const request = guard.open({
      conversationId: 'c1',
      toolName: 'jira.create_issue',
      validatedPayload: { a: 1 },
      preview: fakePreview(),
    })
    guard.approve(request.operationId, request.payloadHash)

    clock.advance(61_000)

    expect(() => guard.consume(request.operationId, 'jira.create_issue', { a: 1 })).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TOOL_APPROVAL_EXPIRED }),
    )
  })

  it('approval của tool này không dùng được cho tool khác', () => {
    const { logger } = testLogger()
    const guard = new ConfirmationGuard({ logger })
    const request = guard.open({
      conversationId: 'c1',
      toolName: 'jira.add_comment',
      validatedPayload: { a: 1 },
      preview: fakePreview(),
    })
    guard.approve(request.operationId, request.payloadHash)

    expect(() => guard.consume(request.operationId, 'jira.create_issue', { a: 1 })).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TOOL_PAYLOAD_MISMATCH }),
    )
  })

  it('hash không phụ thuộc thứ tự khoá trong payload', () => {
    const a = computePayloadHash('t', { b: 2, a: 1, nested: { y: 2, x: 1 } })
    const b = computePayloadHash('t', { a: 1, nested: { x: 1, y: 2 }, b: 2 })
    expect(a).toBe(b)
  })

  it('hash đổi khi giá trị đổi, dù chỉ một ký tự', () => {
    expect(computePayloadHash('t', { s: 'abc' })).not.toBe(computePayloadHash('t', { s: 'abd' }))
  })

  it('dọn được approval quá hạn', () => {
    const clock = fakeClock()
    const { logger } = testLogger()
    const guard = new ConfirmationGuard({ logger, ttlSeconds: 30, now: clock.now })
    guard.open({
      conversationId: 'c',
      toolName: 't',
      validatedPayload: {},
      preview: fakePreview(),
    })
    expect(guard.pendingCount).toBe(1)

    clock.advance(31_000)
    expect(guard.sweepExpired()).toBe(1)
    expect(guard.pendingCount).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Vòng lặp tool-calling (OPEN-QUESTIONS B3)
// ═══════════════════════════════════════════════════════════════════════════

describe('AgentRuntime — vòng lặp tool', () => {
  it('tool READ chạy thẳng, không hỏi xác nhận (§10.1)', async () => {
    const h = await makeHarness({
      script: [
        { toolCalls: [{ name: 'jira.get_issue', args: { issue_key: 'PRJ-1' } }] },
        { text: 'Issue PRJ-1 đang ở trạng thái In Progress.' },
      ],
    })

    const result = await h.run()

    expect(h.confirmations).toHaveLength(0)
    expect(result.text).toContain('In Progress')
    expect(h.sink.byTool('jira.get_issue')[0]?.approvalStatus).toBe('not_required')
  })

  it('chặn tool write thứ hai trong cùng một lượt', async () => {
    const h = await makeHarness({
      script: [
        {
          toolCalls: [
            { name: 'jira.create_issue', args: { project_key: 'PRJ', summary: 'A', issue_type: 'Task' } },
            { name: 'jira.create_issue', args: { project_key: 'PRJ', summary: 'B', issue_type: 'Task' } },
          ],
        },
        { text: 'Đã tạo một task.' },
      ],
    })

    await h.run()

    // Chỉ cái đầu được đưa ra xác nhận; cái thứ hai bị chặn trước cả bước preview.
    expect(h.confirmations).toHaveLength(1)
    expect(h.sink.byTool('jira.create_issue')).toHaveLength(1)
  })

  it('trả lỗi lại cho model khi model gọi tool không tồn tại', async () => {
    const h = await makeHarness({
      script: [
        { toolCalls: [{ name: 'jira.xoa_het', args: {} }] },
        { text: 'Xin lỗi, tôi không có công cụ đó.' },
      ],
    })

    const result = await h.run()
    expect(result.text).toContain('không có công cụ')
    expect(h.llm.turnsConsumed).toBe(2)
  })

  it('trả lỗi validate lại cho model thay vì gọi tool với tham số sai', async () => {
    const h = await makeHarness({
      script: [
        { toolCalls: [{ name: 'jira.get_issue', args: { issue_key: 'sai-định-dạng' } }] },
        { text: 'Bạn cho tôi xin key đúng định dạng nhé.' },
      ],
    })

    const result = await h.run()
    expect(result.text).toContain('đúng định dạng')
  })

  it('dừng bằng MAX_TOOL_ITERATIONS thay vì lặp vô hạn', async () => {
    const loop: ScriptedTurn = {
      toolCalls: [{ name: 'jira.get_issue', args: { issue_key: 'PRJ-1' } }],
    }
    const h = await makeHarness({
      script: [loop, loop, loop, loop, loop, loop, loop],
      settings: { maxToolIterations: 3 },
    })

    await expect(h.run()).rejects.toMatchObject({ code: ERROR_CODES.MAX_TOOL_ITERATIONS })
    expect(h.llm.turnsConsumed).toBe(3)
  })

  it('dừng hẳn khi Atlassian trả lỗi xác thực ở tool READ (fail closed §3)', async () => {
    const h = await makeHarness({
      script: [
        { toolCalls: [{ name: 'jira.get_issue', args: { issue_key: 'PRJ-1' } }] },
        { text: 'không nên tới đây' },
      ],
      scenario: 'auth-failed',
    })

    await h.run()
    expect(h.llm.turnsConsumed).toBe(1)
  })

  it('chỉ gửi cho model những tool đang thực sự bật', async () => {
    const h = await makeHarness({
      script: [{ text: 'Xin chào' }],
      settings: { features: { ...DEFAULT_APP_SETTINGS.features, jiraCreate: false, jiraUpdate: false } },
    })

    await h.run()

    const names = (h.llm.requests[0]?.tools ?? []).map((t) => t.function.name)
    expect(names).toContain('jira.get_issue')
    expect(names).not.toContain('jira.create_issue')
    expect(names).not.toContain('jira.update_issue')
  })

  it('chặn tài liệu khi model không nằm trong allowlist (§11.2)', async () => {
    const h = await makeHarness({
      script: [{ text: 'x' }],
      settings: { documentAllowedModels: ['model-duoc-phep'] },
    })

    await expect(
      h.runtime.runTurn({
        requestId: 'req_doc',
        conversationId: '00000000-0000-4000-8000-000000000002',
        modelId: 'model-a',
        contextWindowTokens: 128_000,
        history: [{ role: 'user', content: 'tóm tắt file' }],
        documents: [
          {
            fileName: 'a.txt',
            kind: 'txt',
            sizeBytes: 10,
            sourcePathHash: 'x'.repeat(64),
            text: 'nội dung',
            chunks: [],
            charCount: 8,
            estimatedTokens: 2,
            truncated: false,
          },
        ],
        emit: () => undefined,
        toolCalls: h.sink,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.MODEL_NOT_ALLOWED_FOR_DOCUMENTS })

    // Không có request nào rời máy.
    expect(h.llm.requests).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Tra cứu operation uncertain (§16)
// ═══════════════════════════════════════════════════════════════════════════

describe('OperationTracker — tra cứu uncertain', () => {
  it('kết luận success khi tìm đúng một đối tượng khớp', async () => {
    const h = await makeHarness({
      script: [
        {
          toolCalls: [
            {
              name: 'jira.create_issue',
              args: { project_key: 'PRJ', summary: 'Task nghi ngờ', issue_type: 'Task' },
            },
          ],
        },
      ],
    })
    await h.run()

    // Giả lập: thao tác thực ra đã thành công nhưng bị đánh dấu uncertain.
    const operationId = h.confirmations[0]!.operationId
    h.tracker.markUncertain(operationId, ERROR_CODES.MCP_SERVER_UNAVAILABLE)

    const definition = h.mcp.resolveCallable('jira.create_issue')
    const outcome = await h.tracker.resolveUncertain(
      operationId,
      definition,
      definition.lookupResult!,
      {
        actingAccount: ACCOUNT,
        readTool: async (name, input) => {
          const result = await h.mcp.callTool(name, input as Record<string, unknown>)
          return JSON.parse(result.rawText)
        },
      },
    )

    expect(outcome.status).toBe('success')
    expect(outcome.targetKey).toMatch(/^PRJ-\d+$/)
  })

  it('giữ nguyên uncertain khi tra cứu thất bại — không suy ra "chưa tạo"', async () => {
    const h = await makeHarness({
      script: [
        {
          toolCalls: [
            {
              name: 'jira.create_issue',
              args: { project_key: 'PRJ', summary: 'X', issue_type: 'Task' },
            },
          ],
        },
      ],
    })
    await h.run()

    const operationId = h.confirmations[0]!.operationId
    h.tracker.markUncertain(operationId, ERROR_CODES.MCP_SERVER_UNAVAILABLE)

    const definition = h.mcp.resolveCallable('jira.create_issue')
    const outcome = await h.tracker.resolveUncertain(
      operationId,
      definition,
      definition.lookupResult!,
      { actingAccount: ACCOUNT, readTool: () => Promise.reject(new Error('mạng hỏng')) },
    )

    expect(outcome.status).toBe('uncertain')
    expect(outcome.message).toContain('Không tra cứu được')
  })

  it('kết luận failed — cho phép thử lại — khi chắc chắn không có đối tượng nào', async () => {
    const h = await makeHarness({
      script: [
        {
          toolCalls: [
            {
              name: 'jira.create_issue',
              args: { project_key: 'PRJ', summary: 'Không bao giờ tạo', issue_type: 'Task' },
            },
          ],
        },
      ],
      scenario: 'slow',
    })
    await h.run()

    const operationId = h.confirmations[0]!.operationId
    const definition = h.mcp.resolveCallable('jira.create_issue')

    // Mock server 'slow' chưa từng tạo issue nào ⇒ jira_search trả rỗng.
    const fresh = await makeHarness({ script: [{ text: 'x' }] })
    const outcome = await h.tracker.resolveUncertain(
      operationId,
      definition,
      definition.lookupResult!,
      {
        actingAccount: ACCOUNT,
        readTool: async (name, input) => {
          const result = await fresh.mcp.callTool(name, input as Record<string, unknown>)
          return JSON.parse(result.rawText)
        },
      },
    )

    expect(outcome.status).toBe('failed')
  }, 20_000)
})

function fakePreview(): ToolPreview {
  return {
    toolName: 'jira.create_issue',
    targetSystem: 'jira',
    targetSystemUrl: JIRA_URL,
    action: 'Tạo issue',
    actingAccount: ACCOUNT,
    payloadFields: [],
    changes: [],
    impactWarning: 'x',
    reversible: false,
    riskLevel: 'WRITE_LOW',
  }
}
