import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { z } from 'zod'
import {
  DEFAULT_APP_SETTINGS,
  ERROR_CODES,
  type AppSettings,
  type ApprovalStatus,
  type ConfirmationRequest,
  type MessageRole,
  type OperationStatus,
  type LocalToolDefinition,
  type LocalToolRegistry,
  type RiskLevel,
  type ToolPreview,
} from '@nexa/shared-types'
import { AtlassianMcpManager } from '@nexa/atlassian-mcp-manager'
import { computePayloadHash } from '@nexa/security'
import { EXPAND_TOOLS_TOOL_NAME } from '@nexa/shared-types'
import {
  AgentRuntime,
  ConfirmationGuard,
  OperationTracker,
  assertModelMayReceiveDocuments,
  mayReceiveDocuments,
  type ToolCallSink,
} from './index.js'
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
  run(overrides?: {
    signal?: AbortSignal
    history?: readonly { role: MessageRole; content: string }[]
  }): Promise<Awaited<ReturnType<AgentRuntime['runTurn']>>>
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
  /** Tool cục bộ khả dụng cho lượt này. */
  localTools?: LocalToolRegistry
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
    ...(opts.localTools !== undefined ? { localTools: opts.localTools } : {}),
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
        modelProvider: 'litellm',
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
    name: 'jira_create_issue',
    args: { project_key: 'PRJ', summary: 'Sửa lỗi đăng nhập', issue_type: 'Bug' },
  }

  it('1. PAT thiếu quyền → hệ thống đích từ chối, Nexa hiển thị lỗi đã chuẩn hoá', async () => {
    const h = await makeHarness({
      script: [{ toolCalls: [createCall] }, { text: 'Không tạo được task.' }],
      scenario: 'auth-failed',
    })

    const result = await h.run()

    const record = h.sink.byTool('jira_create_issue')[0]
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
      expect(h.sink.byTool('jira_create_issue')[0]?.approvalStatus).toBe('cancelled')
    } finally {
      callTool.mockRestore()
    }
  })

  it('3. Payload bị thay đổi sau preview → approval không hợp lệ', async () => {
    const { logger } = testLogger()
    const guard = new ConfirmationGuard({ logger })

    const request = guard.open({
      conversationId: 'c1',
      toolName: 'jira_create_issue',
      validatedPayload: { project_key: 'PRJ', summary: 'Bản gốc', issue_type: 'Task' },
      preview: fakePreview(),
    })
    guard.approve(request.operationId, request.payloadHash)

    // Payload sắp gửi đã khác thứ người dùng nhìn thấy.
    expect(() =>
      guard.consume(request.operationId, 'jira_create_issue', {
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
      toolName: 'jira_create_issue',
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
      h.guard.consume(operationId, 'jira_create_issue', {
        project_key: 'PRJ',
        summary: 'Sửa lỗi đăng nhập',
        issue_type: 'Bug',
        description: '',
      }),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.OPERATION_ALREADY_RUNNING }))

    expect(h.sink.byTool('jira_create_issue')).toHaveLength(1)
    expect(h.sink.byTool('jira_create_issue')[0]?.operationStatus).toBe('success')
  })

  it('5. Timeout sau khi gửi → giữ trạng thái uncertain và KHÔNG tự retry', async () => {
    const h = await makeHarness({
      script: [{ toolCalls: [createCall] }, { text: 'không nên tới đây' }],
      scenario: 'slow', // tool call vượt toolTimeoutMs
    })

    const result = await h.run()

    const record = h.sink.byTool('jira_create_issue')[0]
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

    const record = h.sink.byTool('jira_create_issue')[0]
    expect(record?.operationId).toBeDefined()
    expect(h.confirmations[0]?.operationId).toBe(record?.operationId)
  })

  it('7. Không có API key, PAT hay payload nhạy cảm trong local log', async () => {
    const h = await makeHarness({
      script: [
        {
          toolCalls: [
            {
              name: 'jira_create_issue',
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
      toolName: 'jira_create_issue',
      validatedPayload: { a: 1 },
      preview: fakePreview(),
    })

    expect(() => guard.consume(request.operationId, 'jira_create_issue', { a: 1 })).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TOOL_APPROVAL_REQUIRED }),
    )
  })

  it('approval hết hạn thì vô hiệu, kể cả đã được duyệt', () => {
    const clock = fakeClock()
    const { logger } = testLogger()
    const guard = new ConfirmationGuard({ logger, ttlSeconds: 60, now: clock.now })

    const request = guard.open({
      conversationId: 'c1',
      toolName: 'jira_create_issue',
      validatedPayload: { a: 1 },
      preview: fakePreview(),
    })
    guard.approve(request.operationId, request.payloadHash)

    clock.advance(61_000)

    expect(() => guard.consume(request.operationId, 'jira_create_issue', { a: 1 })).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TOOL_APPROVAL_EXPIRED }),
    )
  })

  it('approval của tool này không dùng được cho tool khác', () => {
    const { logger } = testLogger()
    const guard = new ConfirmationGuard({ logger })
    const request = guard.open({
      conversationId: 'c1',
      toolName: 'jira_add_comment',
      validatedPayload: { a: 1 },
      preview: fakePreview(),
    })
    guard.approve(request.operationId, request.payloadHash)

    expect(() => guard.consume(request.operationId, 'jira_create_issue', { a: 1 })).toThrow(
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
        { toolCalls: [{ name: 'jira_get_issue', args: { issue_key: 'PRJ-1' } }] },
        { text: 'Issue PRJ-1 đang ở trạng thái In Progress.' },
      ],
    })

    const result = await h.run()

    expect(h.confirmations).toHaveLength(0)
    expect(result.text).toContain('In Progress')
    expect(h.sink.byTool('jira_get_issue')[0]?.approvalStatus).toBe('not_required')
  })

  it('chặn tool write thứ hai trong cùng một lượt', async () => {
    const h = await makeHarness({
      script: [
        {
          toolCalls: [
            {
              name: 'jira_create_issue',
              args: { project_key: 'PRJ', summary: 'A', issue_type: 'Task' },
            },
            {
              name: 'jira_create_issue',
              args: { project_key: 'PRJ', summary: 'B', issue_type: 'Task' },
            },
          ],
        },
        { text: 'Đã tạo một task.' },
      ],
    })

    await h.run()

    // Chỉ cái đầu được đưa ra xác nhận; cái thứ hai bị chặn trước cả bước preview.
    expect(h.confirmations).toHaveLength(1)
    expect(h.sink.byTool('jira_create_issue')).toHaveLength(1)
  })

  it('trả lỗi lại cho model khi model gọi tool không tồn tại', async () => {
    const h = await makeHarness({
      script: [
        { toolCalls: [{ name: 'jira_xoa_het', args: {} }] },
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
        { toolCalls: [{ name: 'jira_get_issue', args: { issue_key: 'sai-định-dạng' } }] },
        { text: 'Bạn cho tôi xin key đúng định dạng nhé.' },
      ],
    })

    const result = await h.run()
    expect(result.text).toContain('đúng định dạng')
  })

  it('dừng bằng MAX_TOOL_ITERATIONS thay vì lặp vô hạn', async () => {
    const loop: ScriptedTurn = {
      toolCalls: [{ name: 'jira_get_issue', args: { issue_key: 'PRJ-1' } }],
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
        { toolCalls: [{ name: 'jira_get_issue', args: { issue_key: 'PRJ-1' } }] },
        { text: 'không nên tới đây' },
      ],
      scenario: 'auth-failed',
    })

    const result = await h.run()
    expect(h.llm.turnsConsumed).toBe(1)
    expect(result.text).toContain('chưa thể hoàn tất')
    expect(result.text).toContain('Kiểm tra lại PAT')
  })

  it('nói rõ khi câu trả lời bị cắt bởi giới hạn output của model', async () => {
    const h = await makeHarness({
      script: [{ text: 'Đây là phần đầu câu trả lời.', finishReason: 'length' }],
    })

    const result = await h.run()

    expect(result.text).toContain('Đây là phần đầu câu trả lời.')
    expect(result.text).toContain('chưa đầy đủ')
    expect(result.text).toContain('tiếp tục')
    expect(h.emitted).toContainEqual(
      expect.objectContaining({
        type: 'text-delta',
        delta: expect.stringContaining('chưa đầy đủ'),
      }),
    )
  })

  it('không hoàn tất bằng câu trả lời rỗng khi model dừng mà không trả text', async () => {
    const h = await makeHarness({ script: [{ text: '' }] })

    const result = await h.run()

    expect(result.text).toContain('không nhận được nội dung trả lời')
    expect(result.text).toContain('thử lại')
    expect(h.emitted).toContainEqual(
      expect.objectContaining({
        type: 'text-delta',
        delta: expect.stringContaining('không nhận được nội dung trả lời'),
      }),
    )
  })

  it('gắn cảnh báo có cấu trúc vào tool result bị rút gọn trước khi gọi model lần hai', async () => {
    const h = await makeHarness({
      script: [
        { toolCalls: [{ name: 'jira_get_issue', args: { issue_key: 'PRJ-1' } }] },
        { text: 'Tôi chỉ kết luận trên phần dữ liệu đã nhận.' },
      ],
    })
    const callTool = vi.spyOn(AtlassianMcpManager.prototype, 'callTool').mockResolvedValueOnce({
      rawText: 'raw-result',
      summary: {
        forModel: 'phần dữ liệu còn giữ lại',
        forUser: 'Đã đọc issue PRJ-1',
        incomplete: true,
        completenessNote: '2.000 ký tự chưa được đưa vào ngữ cảnh.',
      },
    })

    try {
      await h.run()
    } finally {
      callTool.mockRestore()
    }

    const messages = h.llm.requests[1]?.messages ?? []
    const toolResult = messages.find((message) => message.role === 'tool')
    expect(toolResult?.content).toContain('[KẾT QUẢ CÔNG CỤ CHƯA ĐẦY ĐỦ]')
    expect(toolResult?.content).toContain('2.000 ký tự chưa được đưa vào ngữ cảnh')
    expect(h.sink.byTool('jira_get_issue')[0]?.resultSummary).toContain('chưa đầy đủ')
  })

  it('chỉ gửi cho model những tool đang thực sự bật', async () => {
    const h = await makeHarness({
      script: [{ text: 'Xin chào' }],
      settings: {
        features: { ...DEFAULT_APP_SETTINGS.features, jiraCreate: false, jiraUpdate: false },
      },
    })

    await h.run()

    const names = (h.llm.requests[0]?.tools ?? []).map((t) => t.function.name)
    expect(names).toContain('jira_get_issue')
    expect(names).not.toContain('jira_create_issue')
    expect(names).not.toContain('jira_update_issue')
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
        modelProvider: 'litellm',
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
              name: 'jira_create_issue',
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

    const definition = h.mcp.resolveCallable('jira_create_issue')
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
              name: 'jira_create_issue',
              args: { project_key: 'PRJ', summary: 'X', issue_type: 'Task' },
            },
          ],
        },
      ],
    })
    await h.run()

    const operationId = h.confirmations[0]!.operationId
    h.tracker.markUncertain(operationId, ERROR_CODES.MCP_SERVER_UNAVAILABLE)

    const definition = h.mcp.resolveCallable('jira_create_issue')
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
              name: 'jira_create_issue',
              args: { project_key: 'PRJ', summary: 'Không bao giờ tạo', issue_type: 'Task' },
            },
          ],
        },
      ],
      scenario: 'slow',
    })
    await h.run()

    const operationId = h.confirmations[0]!.operationId
    const definition = h.mcp.resolveCallable('jira_create_issue')

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
    toolName: 'jira_create_issue',
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

// ═══════════════════════════════════════════════════════════════════════════
// Provider ngoài tổ chức — chính sách tài liệu FAIL-CLOSED (OPEN-QUESTIONS F1)
// ═══════════════════════════════════════════════════════════════════════════

describe('chính sách tài liệu theo provider', () => {
  const doc = {
    fileName: 'bao-cao-noi-bo.txt',
    kind: 'txt' as const,
    sizeBytes: 100,
    sourcePathHash: 'a'.repeat(64),
    text: 'Số liệu doanh thu nội bộ',
    chunks: [],
    charCount: 24,
    estimatedTokens: 6,
    truncated: false,
  }

  function runWithDocument(h: Harness, provider: 'litellm' | 'openai', modelId: string) {
    return h.runtime.runTurn({
      requestId: 'req_doc',
      conversationId: '00000000-0000-4000-8000-00000000000d',
      modelId,
      modelProvider: provider,
      contextWindowTokens: 128_000,
      history: [{ role: 'user', content: 'tóm tắt tài liệu' }],
      documents: [doc],
      emit: () => undefined,
      toolCalls: h.sink,
    })
  }

  it('provider NỘI BỘ: allowlist rỗng ⇒ cho phép (fail-open)', async () => {
    const h = await makeHarness({ script: [{ text: 'Đã tóm tắt.' }] })
    const result = await runWithDocument(h, 'litellm', 'model-a')
    expect(result.text).toBe('Đã tóm tắt.')
  })

  it('provider NGOÀI: allowlist rỗng ⇒ TỪ CHỐI (fail-closed)', async () => {
    const h = await makeHarness({ script: [{ text: 'không nên tới đây' }] })

    await expect(runWithDocument(h, 'openai', 'gpt-4o')).rejects.toMatchObject({
      code: ERROR_CODES.EXTERNAL_MODEL_NOT_ALLOWED_FOR_DOCUMENTS,
    })
    // Bất biến quan trọng nhất: KHÔNG byte nào rời máy.
    expect(h.llm.requests).toHaveLength(0)
  })

  it('provider NGOÀI: chỉ cho phép khi model được allowlist TƯỜNG MINH', async () => {
    const h = await makeHarness({
      script: [{ text: 'Đã tóm tắt.' }],
      settings: { externalDocumentAllowedModels: ['openai:gpt-4o'] },
    })
    const result = await runWithDocument(h, 'openai', 'gpt-4o')
    expect(result.text).toBe('Đã tóm tắt.')
  })

  it('allowlist cho model KHÁC không mở đường cho model ngoài đang chọn', async () => {
    const h = await makeHarness({
      script: [{ text: 'không nên tới đây' }],
      settings: { externalDocumentAllowedModels: ['openai:gpt-4o-mini'] },
    })

    await expect(runWithDocument(h, 'openai', 'gpt-4o')).rejects.toMatchObject({
      code: ERROR_CODES.EXTERNAL_MODEL_NOT_ALLOWED_FOR_DOCUMENTS,
    })
    expect(h.llm.requests).toHaveLength(0)
  })

  it('chat KHÔNG kèm tài liệu vẫn chạy với provider ngoài', async () => {
    // Chính sách này chặn rò rỉ hàng loạt do đính kèm file, không phải kiểm duyệt nội dung.
    const h = await makeHarness({ script: [{ text: 'Xin chào từ model ngoài.' }] })

    const result = await h.runtime.runTurn({
      requestId: 'req_chat',
      conversationId: '00000000-0000-4000-8000-00000000000e',
      modelId: 'gpt-4o',
      modelProvider: 'openai',
      contextWindowTokens: 128_000,
      history: [{ role: 'user', content: 'xin chào' }],
      emit: () => undefined,
      toolCalls: h.sink,
    })
    expect(result.text).toBe('Xin chào từ model ngoài.')
  })

  it('provider ngoài chỉ nhận memory đã được người dùng cho phép', async () => {
    const h = await makeHarness({ script: [{ text: 'Đã cá nhân hoá an toàn.' }] })

    await h.runtime.runTurn({
      requestId: 'req_external_memory',
      conversationId: '00000000-0000-4000-8000-00000000000f',
      modelId: 'gpt-4o',
      modelProvider: 'openai',
      contextWindowTokens: 128_000,
      history: [{ role: 'user', content: 'hãy lập kế hoạch' }],
      memoryFacts: [
        {
          kind: 'constraint',
          content: 'Mã dự án tuyệt mật nội bộ',
          sharingPolicy: 'internal_only',
        },
        {
          kind: 'preference',
          content: 'Ưu tiên câu trả lời dạng checklist',
          sharingPolicy: 'allow_external',
        },
      ],
      emit: () => undefined,
      toolCalls: h.sink,
    })

    const sent = JSON.stringify(h.llm.requests[0]?.messages ?? [])
    expect(sent).toContain('Ưu tiên câu trả lời dạng checklist')
    expect(sent).not.toContain('Mã dự án tuyệt mật nội bộ')
  })
})

describe('mayReceiveDocuments (dùng cho UI)', () => {
  const settings = {
    ...DEFAULT_APP_SETTINGS,
    externalDocumentAllowedModels: ['openai:gpt-4o'],
  }

  it.each([
    // Hai danh sách độc lập: cho phép một model NGOÀI không được làm hẹp model NỘI BỘ.
    ['litellm', 'bat-ky-model-nao', true],
    ['litellm', 'gpt-4o', true],
    ['openai', 'gpt-4o', true],
    ['openai', 'gpt-4o-mini', false],
  ] as const)('%s / %s → %s', (provider, modelId, expected) => {
    expect(mayReceiveDocuments(provider, modelId, settings)).toBe(expected)
  })

  it('cho phép model ngoài KHÔNG làm hẹp chính sách của model nội bộ', () => {
    // Đây là lỗi thiết kế đã gặp khi dùng chung một danh sách: admin thêm 'gpt-4o' để mở cho
    // model ngoài, và vô tình chặn mọi model nội bộ khác.
    expect(mayReceiveDocuments('litellm', 'model-noi-bo-bat-ky', settings)).toBe(true)
  })

  it('khớp với hàm assert ở main — UI không được nói khác chốt chặn thật', () => {
    for (const provider of ['litellm', 'openai'] as const) {
      for (const modelId of ['gpt-4o', 'gpt-4o-mini']) {
        const allowedByHelper = mayReceiveDocuments(provider, modelId, settings)
        let allowedByAssert = true
        try {
          assertModelMayReceiveDocuments(provider, modelId, settings)
        } catch {
          allowedByAssert = false
        }
        expect(allowedByHelper).toBe(allowedByAssert)
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ADR 0009 — thu hẹp danh mục tool theo ngữ cảnh
// ═══════════════════════════════════════════════════════════════════════════

/** Tên tool trong khối `tools` của request thứ `index`. */
function toolNames(h: Harness, index = 0): string[] {
  return (h.llm.requests[index]?.tools ?? []).map((t) => t.function.name)
}

const HOI_JIRA_READ = 'Cho tôi xem issue PRJ-1 đang ở trạng thái nào'
const HOI_CONFLUENCE_READ = 'Tìm trang wiki về quy trình onboarding'
const HOI_KHONG_TIN_HIEU = 'Tóm tắt đoạn văn này giúp tôi'

describe('ADR 0009 — preset quyết định khối `tools`', () => {
  it('câu hỏi Jira chỉ tra cứu ⇒ không gửi tool Confluence và không gửi tool write', async () => {
    const h = await makeHarness({ script: [{ text: 'ok' }] })
    await h.run({ history: [{ role: 'user', content: HOI_JIRA_READ }] })

    const names = toolNames(h)
    expect(names).toContain('jira_get_issue')
    expect(names).toContain('jira_search')
    expect(names).not.toContain('jira_create_issue')
    expect(names).not.toContain('jira_update_issue')
    expect(names).not.toContain('confluence_get_page')
  })

  it('câu hỏi Confluence chỉ tra cứu ⇒ không gửi tool Jira', async () => {
    const h = await makeHarness({ script: [{ text: 'ok' }] })
    await h.run({ history: [{ role: 'user', content: HOI_CONFLUENCE_READ }] })

    const names = toolNames(h)
    expect(names).toContain('confluence_get_page')
    expect(names).toContain('confluence_search')
    expect(names).not.toContain('jira_get_issue')
  })

  it('câu hỏi có ý định write ⇒ gửi cả tool write của đúng hệ đó', async () => {
    const h = await makeHarness({ script: [{ text: 'ok' }] })
    await h.run({ history: [{ role: 'user', content: 'Tạo một issue mới trong Jira' }] })

    const names = toolNames(h)
    expect(names).toContain('jira_create_issue')
    expect(names).toContain('jira_update_issue')
    expect(names).not.toContain('confluence_get_page')
  })

  it('câu hỏi không có tín hiệu hệ đích ⇒ read của cả hai hệ, không tool write nào', async () => {
    const h = await makeHarness({ script: [{ text: 'ok' }] })
    await h.run({ history: [{ role: 'user', content: HOI_KHONG_TIN_HIEU }] })

    const names = toolNames(h)
    expect(names).toContain('jira_get_issue')
    expect(names).toContain('confluence_get_page')
    expect(names).not.toContain('jira_create_issue')
    expect(names).not.toContain('jira_update_issue')
  })

  it('hai câu hỏi khác nhau cùng preset ⇒ khối `tools` giống nhau hoàn toàn (prefix ổn định)', async () => {
    // Đây là bất biến giữ cho prompt cache còn dùng lại được. Nếu ai đó biến preset thành động,
    // test này đỏ. Xem ADR 0009.
    const a = await makeHarness({ script: [{ text: 'ok' }] })
    await a.run({ history: [{ role: 'user', content: HOI_JIRA_READ }] })

    const b = await makeHarness({ script: [{ text: 'ok' }] })
    await b.run({ history: [{ role: 'user', content: 'Liệt kê các bug trong sprint này' }] })

    expect(a.llm.requests[0]?.tools).toEqual(b.llm.requests[0]?.tools)
  })

  it('thứ tự tool được sort theo tên, kể cả khi cờ thu hẹp bị tắt', async () => {
    const h = await makeHarness({
      script: [{ text: 'ok' }],
      settings: { features: { ...DEFAULT_APP_SETTINGS.features, toolScoping: false } },
    })
    await h.run({ history: [{ role: 'user', content: HOI_JIRA_READ }] })

    const names = toolNames(h)
    expect(names).toEqual([...names].sort())
  })

  it('preset không nới quyền: cờ tắt thì tool vẫn không xuất hiện dù preset chứa nhóm đó', async () => {
    const h = await makeHarness({
      script: [{ text: 'ok' }],
      settings: { features: { ...DEFAULT_APP_SETTINGS.features, jiraCreate: false } },
    })
    await h.run({ history: [{ role: 'user', content: 'Tạo một issue mới trong Jira' }] })

    const names = toolNames(h)
    expect(names).not.toContain('jira_create_issue')
    expect(names).toContain('jira_update_issue')
  })

  it('tắt cờ thu hẹp ⇒ gửi toàn bộ tool khả dụng như trước ADR 0009', async () => {
    const h = await makeHarness({
      script: [{ text: 'ok' }],
      settings: { features: { ...DEFAULT_APP_SETTINGS.features, toolScoping: false } },
    })
    await h.run({ history: [{ role: 'user', content: HOI_JIRA_READ }] })

    const names = toolNames(h)
    expect(names).toContain('jira_get_issue')
    expect(names).toContain('jira_create_issue')
    expect(names).toContain('confluence_get_page')
    expect(names).not.toContain(EXPAND_TOOLS_TOOL_NAME)
  })

  it('ghi log preset và số tool, không ghi nội dung câu hỏi', async () => {
    const h = await makeHarness({ script: [{ text: 'ok' }] })
    await h.run({
      history: [{ role: 'user', content: `${HOI_JIRA_READ} MARKER-BI-MAT-KHONG-DUOC-LOG` }],
    })

    const entry = h.logSink.records.find((r) => r.event === 'tool-preset')
    expect(entry?.fields).toMatchObject({ preset: 'jira-read', expanded: false })
    expect(entry?.fields?.toolCount).toBeGreaterThan(0)
    expect(h.logSink.asText()).not.toContain('MARKER-BI-MAT-KHONG-DUOC-LOG')
  })
})

describe('ADR 0009 — mở rộng danh mục qua tool meta', () => {
  it('preset hẹp có tool meta, preset đầy đủ thì không', async () => {
    const hep = await makeHarness({ script: [{ text: 'ok' }] })
    await hep.run({ history: [{ role: 'user', content: HOI_JIRA_READ }] })
    expect(toolNames(hep)).toContain(EXPAND_TOOLS_TOOL_NAME)

    const day = await makeHarness({ script: [{ text: 'ok' }] })
    await day.run({
      history: [{ role: 'user', content: 'Đọc bug trong sprint rồi tạo một trang Confluence' }],
    })
    expect(toolNames(day)).not.toContain(EXPAND_TOOLS_TOOL_NAME)
  })

  it('gọi tool meta ⇒ vòng sau nhận toàn bộ tool khả dụng', async () => {
    const h = await makeHarness({
      script: [
        { toolCalls: [{ name: EXPAND_TOOLS_TOOL_NAME, args: {} }] },
        { text: 'Giờ tôi thấy đủ công cụ' },
      ],
    })
    await h.run({ history: [{ role: 'user', content: HOI_JIRA_READ }] })

    expect(toolNames(h, 0)).not.toContain('confluence_get_page')
    const sau = toolNames(h, 1)
    expect(sau).toContain('confluence_get_page')
    expect(sau).toContain('jira_create_issue')
    expect(sau).not.toContain(EXPAND_TOOLS_TOOL_NAME)
  })

  it('lời gọi meta không đi tới MCP: tool result là danh mục, không phải lỗi tool lạ', async () => {
    const h = await makeHarness({
      script: [{ toolCalls: [{ name: EXPAND_TOOLS_TOOL_NAME, args: {} }] }, { text: 'xong' }],
    })
    await h.run({ history: [{ role: 'user', content: HOI_JIRA_READ }] })

    const messages = h.llm.requests[1]?.messages ?? []
    const toolResult = messages[messages.length - 1]
    expect(toolResult?.role).toBe('tool')
    expect(String(toolResult?.content)).toContain('Danh mục đầy đủ')
    expect(String(toolResult?.content)).not.toContain('unknown tool')
    expect(String(toolResult?.content)).not.toContain('Lỗi')
  })

  it('tên meta không có trong registry và vẫn bị cổng thực thi từ chối', async () => {
    const h = await makeHarness({ script: [{ text: 'ok' }] })
    expect(h.mcp.findTool(EXPAND_TOOLS_TOOL_NAME)).toBeNull()
    expect(() => h.mcp.resolveCallable(EXPAND_TOOLS_TOOL_NAME)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.TOOL_NOT_ALLOWED }),
    )
  })

  it('lời gọi meta không sinh xác nhận, không bản ghi tool call, không operation', async () => {
    const h = await makeHarness({
      script: [{ toolCalls: [{ name: EXPAND_TOOLS_TOOL_NAME, args: {} }] }, { text: 'xong' }],
    })
    await h.run({ history: [{ role: 'user', content: HOI_JIRA_READ }] })

    expect(h.confirmations).toHaveLength(0)
    expect(h.sink.records).toHaveLength(0)
  })

  it('gọi meta hai lần trong một lượt không ném lỗi', async () => {
    const h = await makeHarness({
      script: [
        { toolCalls: [{ name: EXPAND_TOOLS_TOOL_NAME, args: {} }] },
        { toolCalls: [{ name: EXPAND_TOOLS_TOOL_NAME, args: {} }] },
        { text: 'xong' },
      ],
    })
    const result = await h.run({ history: [{ role: 'user', content: HOI_JIRA_READ }] })

    expect(result.text).toBe('xong')
    expect(result.toolCallCount).toBe(2)
  })

  it('lời gọi meta không chiếm hạn mức một write mỗi lượt', async () => {
    const h = await makeHarness({
      script: [
        {
          toolCalls: [
            { name: EXPAND_TOOLS_TOOL_NAME, args: {} },
            {
              name: 'jira_create_issue',
              args: { project_key: 'PRJ', summary: 'Sau khi mở rộng', issue_type: 'Task' },
            },
          ],
        },
        { text: 'đã tạo' },
      ],
    })
    await h.run({ history: [{ role: 'user', content: HOI_JIRA_READ }] })

    // Write đi qua đủ preview + xác nhận, không bị chặn bởi hạn mức.
    expect(h.confirmations).toHaveLength(1)
    const record = h.sink.byTool('jira_create_issue')[0]
    expect(record?.approvalStatus).toBe('approved')
    expect(record?.operationStatus).toBe('success')
  })

  it('mở rộng chỉ có hiệu lực trong một lượt', async () => {
    const h = await makeHarness({
      script: [
        { toolCalls: [{ name: EXPAND_TOOLS_TOOL_NAME, args: {} }] },
        { text: 'xong lượt 1' },
        { text: 'xong lượt 2' },
      ],
    })
    await h.run({ history: [{ role: 'user', content: HOI_JIRA_READ }] })
    expect(toolNames(h, 1)).toContain('confluence_get_page')

    await h.run({ history: [{ role: 'user', content: HOI_JIRA_READ }] })
    const luot2 = toolNames(h, 2)
    expect(luot2).not.toContain('confluence_get_page')
    expect(luot2).toContain(EXPAND_TOOLS_TOOL_NAME)
  })

  it('ghi log lần mở rộng để đo độ chính xác của bộ chọn', async () => {
    const h = await makeHarness({
      script: [{ toolCalls: [{ name: EXPAND_TOOLS_TOOL_NAME, args: {} }] }, { text: 'xong' }],
    })
    await h.run({ history: [{ role: 'user', content: HOI_JIRA_READ }] })

    const entries = h.logSink.records.filter((r) => r.event === 'tool-preset')
    expect(entries).toHaveLength(2)
    expect(entries[0]?.fields).toMatchObject({ preset: 'jira-read', expanded: false })
    expect(entries[1]?.fields).toMatchObject({ preset: 'all', expanded: true })
  })
})

describe('ADR 0009 — mở rộng khi chưa kết nối được MCP', () => {
  it('trả tool result nói rõ không có công cụ nào, lượt vẫn tiếp tục thay vì lỗi', async () => {
    const { logger } = testLogger()
    const llm = new FakeLlmClient([
      { toolCalls: [{ name: EXPAND_TOOLS_TOOL_NAME, args: {} }] },
      { text: 'Chưa kết nối được Jira/Confluence' },
    ])
    const sink = new MemoryToolCallSink()
    const confirmations: ConfirmationRequest[] = []

    const runtime = new AgentRuntime({
      llm: llm.asClient(),
      // Người dùng chưa cấu hình Atlassian — chat vẫn phải chạy được.
      mcp: null,
      guard: new ConfirmationGuard({ logger, ttlSeconds: 120 }),
      tracker: new OperationTracker(logger),
      logger,
      settings: () => DEFAULT_APP_SETTINGS,
      actingAccount: () => ACCOUNT,
      jiraBaseUrl: () => JIRA_URL,
      confluenceBaseUrl: () => CONFLUENCE_URL,
      requestConfirmation: (request) => {
        confirmations.push(request)
        return Promise.resolve('cancelled')
      },
    })

    const result = await runtime.runTurn({
      requestId: 'req_no_mcp',
      conversationId: '00000000-0000-4000-8000-000000000003',
      modelId: 'model-a',
      modelProvider: 'litellm',
      contextWindowTokens: 128_000,
      history: [{ role: 'user', content: 'Cho tôi xem issue PRJ-1' }],
      emit: () => undefined,
      toolCalls: sink,
    })

    expect(result.text).toBe('Chưa kết nối được Jira/Confluence')
    const messages = llm.requests[1]?.messages ?? []
    expect(String(messages[messages.length - 1]?.content)).toContain(
      'không có công cụ nào khả dụng',
    )
    expect(sink.records).toHaveLength(0)
    expect(confirmations).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Tool cục bộ — cùng cổng bảo mật với tool ngoài
// ═══════════════════════════════════════════════════════════════════════════

describe('tool cục bộ', () => {
  const CONVERSATION = '00000000-0000-4000-8000-000000000004'

  /** Tool cục bộ giả: ghi vào một mảng thay vì DB, để test quan sát được "đã ghi hay chưa". */
  function fakeLocalTool(writes: Record<string, unknown>[]): LocalToolDefinition {
    return {
      kind: 'local',
      name: 'commitment_tao',
      riskLevel: 'WRITE_LOW',
      description: 'Tạo cam kết trên máy người dùng',
      inputSchema: z.object({ title: z.string().min(1) }),
      jsonSchema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      },
      buildPreview: (input, ctx) =>
        Promise.resolve({
          toolName: 'commitment_tao',
          targetSystem: 'local',
          targetSystemUrl: '',
          action: 'Tạo cam kết mới',
          actingAccount: ctx.actingAccount,
          payloadFields: [
            { label: 'Kết quả muốn đạt', value: String((input as { title: string }).title) },
          ],
          changes: [],
          impactWarning: 'Chỉ ghi vào dữ liệu trên máy bạn.',
          reversible: true,
          riskLevel: 'WRITE_LOW',
        }),
      execute: (input) => {
        writes.push(input as Record<string, unknown>)
        return Promise.resolve({ forModel: 'Đã tạo cam kết.', forUser: 'Đã tạo cam kết.' })
      },
    }
  }

  function registryOf(definition: LocalToolDefinition): LocalToolRegistry {
    return {
      list: () => [definition],
      get: (name) => (name === definition.name ? definition : undefined),
    }
  }

  /** Runtime không có Atlassian — tool cục bộ phải tự đứng được. */
  function makeLocalHarness(opts: {
    script: readonly ScriptedTurn[]
    decision?: 'approve' | 'cancel'
    onConfirm?: (request: ConfirmationRequest, guard: ConfirmationGuard) => void
  }): {
    runtime: AgentRuntime
    llm: FakeLlmClient
    sink: MemoryToolCallSink
    guard: ConfirmationGuard
    writes: Record<string, unknown>[]
    confirmations: ConfirmationRequest[]
    run: () => Promise<Awaited<ReturnType<AgentRuntime['runTurn']>>>
  } {
    const { logger } = testLogger()
    const guard = new ConfirmationGuard({ logger })
    const llm = new FakeLlmClient(opts.script)
    const sink = new MemoryToolCallSink()
    const writes: Record<string, unknown>[] = []
    const confirmations: ConfirmationRequest[] = []

    const runtime = new AgentRuntime({
      llm: llm.asClient(),
      mcp: null,
      guard,
      tracker: new OperationTracker(logger),
      logger,
      settings: () => DEFAULT_APP_SETTINGS,
      actingAccount: () => ACCOUNT,
      jiraBaseUrl: () => JIRA_URL,
      confluenceBaseUrl: () => CONFLUENCE_URL,
      localTools: registryOf(fakeLocalTool(writes)),
      requestConfirmation: (request) => {
        confirmations.push(request)
        opts.onConfirm?.(request, guard)
        if (opts.decision === 'cancel') {
          guard.cancel(request.operationId)
          return Promise.resolve('cancelled')
        }
        guard.approve(request.operationId, request.payloadHash)
        return Promise.resolve('approved')
      },
    })

    return {
      runtime,
      llm,
      sink,
      guard,
      writes,
      confirmations,
      run: () =>
        runtime.runTurn({
          requestId: 'req_local',
          conversationId: CONVERSATION,
          modelId: 'model-a',
          modelProvider: 'litellm',
          contextWindowTokens: 128_000,
          history: [{ role: 'user', content: 'Tuần sau tôi phải xong báo cáo' }],
          emit: () => undefined,
          toolCalls: sink,
        }),
    }
  }

  const proposeCall = {
    toolCalls: [{ name: 'commitment_tao', args: { title: 'Xong báo cáo quý' } }],
  }

  it('publishes local tools even when Atlassian is not configured', async () => {
    const h = makeLocalHarness({ script: [{ text: 'ok' }] })
    await h.run()

    const names = (h.llm.requests[0]?.tools ?? []).map((t) => t.function.name)
    expect(names).toEqual(['commitment_tao'])
  })

  it('survives a narrowed tool preset alongside the MCP catalogue', async () => {
    // Preset phân hoạch 98 tool Atlassian theo feature flag; tool cục bộ không thuộc cờ nào,
    // nên nó phải nằm ngoài phép lọc đó thay vì biến mất khi câu hỏi trông giống việc Jira.
    const definition = fakeLocalTool([])
    const h = await makeHarness({
      script: [{ text: 'ok' }],
      localTools: registryOf(definition),
      settings: { features: { toolScoping: true } as never },
    })
    await h.run({ history: [{ role: 'user', content: 'Tìm trang Confluence về quy trình' }] })

    const names = (h.llm.requests[0]?.tools ?? []).map((t) => t.function.name)
    expect(names).toContain('commitment_tao')
    expect(names.some((name) => name.startsWith('confluence_'))).toBe(true)
    expect(names.some((name) => name.startsWith('jira_'))).toBe(false)
  })

  it('requires confirmation before writing anything', async () => {
    const h = makeLocalHarness({ script: [proposeCall, { text: 'Đã tạo xong.' }] })
    await h.run()

    expect(h.confirmations).toHaveLength(1)
    expect(h.confirmations[0]?.preview.targetSystem).toBe('local')
    expect(h.writes).toEqual([{ title: 'Xong báo cáo quý' }])
  })

  it('writes nothing when the user cancels', async () => {
    const h = makeLocalHarness({
      script: [proposeCall, { text: 'Mình đã huỷ.' }],
      decision: 'cancel',
    })
    await h.run()

    expect(h.writes).toEqual([])
    expect(h.sink.byTool('commitment_tao')[0]?.approvalStatus).toBe('cancelled')
  })

  it('refuses an approval whose payload no longer matches the preview', async () => {
    // Cùng bất biến TOCTOU với tool ngoài: hash người dùng đã nhìn thấy phải khớp payload thật.
    const h = makeLocalHarness({
      script: [proposeCall, { text: 'Không thực hiện được.' }],
      onConfirm: (request, guard) => {
        guard.approve(request.operationId, computePayloadHash('commitment_tao', { title: 'Khác' }))
      },
    })
    await expect(h.run()).rejects.toThrow(
      expect.objectContaining({ code: ERROR_CODES.TOOL_PAYLOAD_MISMATCH }),
    )
    expect(h.writes).toEqual([])
  })

  it('spends the single write slot per turn like any external write', async () => {
    const h = makeLocalHarness({
      script: [
        {
          toolCalls: [
            { name: 'commitment_tao', args: { title: 'Việc một' } },
            { name: 'commitment_tao', args: { title: 'Việc hai' } },
          ],
        },
        { text: 'Xong.' },
      ],
    })
    await h.run()

    expect(h.writes).toEqual([{ title: 'Việc một' }])
    expect(h.confirmations).toHaveLength(1)
  })

  it('returns a schema error to the model instead of opening a confirmation', async () => {
    const h = makeLocalHarness({
      script: [
        { toolCalls: [{ name: 'commitment_tao', args: { title: '' } }] },
        { text: 'Bạn muốn đặt tên cam kết là gì?' },
      ],
    })
    await h.run()

    expect(h.confirmations).toHaveLength(0)
    expect(h.writes).toEqual([])
    expect(h.sink.records).toHaveLength(0)
  })
})
