import {
  ERROR_CODES,
  NexaError,
  type OperationStatus,
  type ToolDefinition,
  type UncertainLookupResult,
} from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'

/**
 * Theo dõi thao tác write (§10.3, §16).
 *
 * Vấn đề cốt lõi: khi một lệnh tạo Jira issue timeout, ta KHÔNG biết issue đã được tạo hay chưa.
 * §9.3 cấm tự retry trong tình huống đó. §16 nói phải "tra cứu object/result trước khi cho phép
 * retry" nhưng không nói ai tra — Nexa tra hộ, xem docs/OPEN-QUESTIONS.md B9.
 */

export interface TrackedOperation {
  readonly operationId: string
  readonly toolName: string
  readonly conversationId: string
  readonly toolCallRecordId: string
  readonly startedAt: string
  readonly payload: Record<string, unknown>
  status: OperationStatus
  targetKey?: string
  targetUrl?: string
  errorCode?: string
}

export interface ResolveOutcome {
  readonly status: OperationStatus
  /** Nhiều hơn một kết quả khớp: không tự kết luận, phải hỏi người dùng. */
  readonly ambiguousMatches?: readonly { key: string; url: string; summary: string }[]
  readonly targetKey?: string
  readonly targetUrl?: string
  /** Thông điệp tiếng Việt để hiển thị nguyên văn trong UI. */
  readonly message: string
}

export class OperationTracker {
  private readonly operations = new Map<string, TrackedOperation>()
  private readonly log: Logger

  constructor(logger: Logger) {
    this.log = logger.child({ module: 'operation-tracker' })
  }

  begin(op: Omit<TrackedOperation, 'status'>): TrackedOperation {
    const tracked: TrackedOperation = { ...op, status: 'running' }
    this.operations.set(op.operationId, tracked)
    this.log.tool('operation-started', {
      toolName: op.toolName,
      phase: 'running',
      operationId: op.operationId,
    })
    return tracked
  }

  succeed(operationId: string, target: { key?: string; url?: string }): void {
    const op = this.operations.get(operationId)
    if (op === undefined) return
    op.status = 'success'
    if (target.key !== undefined) op.targetKey = target.key
    if (target.url !== undefined) op.targetUrl = target.url
    this.log.tool('operation-succeeded', {
      toolName: op.toolName,
      phase: 'done',
      operationId,
      hasTargetKey: target.key !== undefined,
    })
  }

  fail(operationId: string, errorCode: string): void {
    const op = this.operations.get(operationId)
    if (op === undefined) return
    op.status = 'failed'
    op.errorCode = errorCode
    this.log.tool('operation-failed', {
      toolName: op.toolName,
      phase: 'failed',
      operationId,
      errorCode,
    })
  }

  /**
   * Kết quả không rõ (§16 "Tool write trả kết quả không rõ").
   *
   * Chỉ những lỗi thực sự mơ hồ mới vào đây — timeout, mất kết nối giữa chừng. Lỗi 403 hay
   * lỗi validate là `failed` rõ ràng, đưa vào `uncertain` chỉ làm người dùng hoang mang.
   */
  markUncertain(operationId: string, errorCode: string): void {
    const op = this.operations.get(operationId)
    if (op === undefined) return
    op.status = 'uncertain'
    op.errorCode = errorCode
    this.log.tool('operation-uncertain', {
      toolName: op.toolName,
      phase: 'uncertain',
      operationId,
      errorCode,
    })
  }

  get(operationId: string): TrackedOperation | null {
    return this.operations.get(operationId) ?? null
  }

  listUncertain(): TrackedOperation[] {
    return [...this.operations.values()].filter((op) => op.status === 'uncertain')
  }

  /**
   * Người dùng bấm "Kiểm tra kết quả" trên một operation đang `uncertain`.
   *
   * Ba kết cục:
   *  - đúng một kết quả khớp  ⇒ success, hiện link
   *  - không kết quả nào       ⇒ failed (chưa tạo), cho phép thử lại
   *  - nhiều kết quả / tra cứu hỏng ⇒ vẫn uncertain, KHÔNG tự quyết
   */
  async resolveUncertain(
    operationId: string,
    definition: ToolDefinition,
    lookup: (
      input: unknown,
      ctx: { actingAccount: string; startedAt: string; readTool: (n: string, i: unknown) => Promise<unknown> },
    ) => Promise<UncertainLookupResult>,
    ctx: { actingAccount: string; readTool: (n: string, i: unknown) => Promise<unknown> },
  ): Promise<ResolveOutcome> {
    const op = this.operations.get(operationId)
    if (op === undefined) {
      throw new NexaError(ERROR_CODES.INTERNAL_ERROR, {
        operationId,
        safeDetail: 'unknown operation',
      })
    }
    if (op.status !== 'uncertain') {
      return {
        status: op.status,
        message: `Thao tác đang ở trạng thái "${op.status}", không cần tra cứu.`,
        ...(op.targetKey !== undefined ? { targetKey: op.targetKey } : {}),
        ...(op.targetUrl !== undefined ? { targetUrl: op.targetUrl } : {}),
      }
    }

    const result = await lookup(op.payload, {
      actingAccount: ctx.actingAccount,
      startedAt: op.startedAt,
      readTool: ctx.readTool,
    })

    if (result.inconclusive) {
      this.log.tool('operation-lookup-inconclusive', {
        toolName: definition.name,
        phase: 'uncertain',
        operationId,
      })
      return {
        status: 'uncertain',
        message:
          'Không tra cứu được tại hệ thống đích. Hãy kiểm tra thủ công trên Jira/Confluence trước khi thử lại, để tránh tạo trùng.',
      }
    }

    if (result.matches.length === 1) {
      const match = result.matches[0] as { key: string; url: string; summary: string }
      this.succeed(operationId, { key: match.key, url: match.url })
      return {
        status: 'success',
        targetKey: match.key,
        targetUrl: match.url,
        message: `Thao tác đã hoàn tất trước đó. Đối tượng: ${match.key}.`,
      }
    }

    if (result.matches.length === 0) {
      op.status = 'failed'
      this.log.tool('operation-lookup-not-found', {
        toolName: definition.name,
        phase: 'failed',
        operationId,
      })
      return {
        status: 'failed',
        message: 'Không tìm thấy đối tượng nào tại hệ thống đích. Thao tác chưa được thực hiện.',
      }
    }

    // Nhiều kết quả: có thể người dùng đã tạo sẵn issue trùng tên từ trước.
    this.log.tool('operation-lookup-ambiguous', {
      toolName: definition.name,
      phase: 'uncertain',
      operationId,
      matchCount: result.matches.length,
    })
    return {
      status: 'uncertain',
      ambiguousMatches: result.matches,
      message: `Tìm thấy ${String(result.matches.length)} đối tượng khớp. Hãy chọn đúng đối tượng hoặc kiểm tra thủ công trước khi thử lại.`,
    }
  }
}

/**
 * Lỗi nào là "không rõ kết quả"?
 *
 * Nguyên tắc: chỉ khi request ĐÃ ĐI nhưng ta không nhận được phản hồi kết luận. Nếu chắc chắn
 * request chưa rời máy (thiếu cấu hình, tool bị chặn, validate hỏng) thì là `failed`.
 */
export function isUncertainOutcome(error: unknown): boolean {
  if (!NexaError.is(error)) return true // lỗi lạ ⇒ giả định xấu nhất
  switch (error.code) {
    case ERROR_CODES.MCP_SERVER_UNAVAILABLE:
    case ERROR_CODES.UPSTREAM_UNAVAILABLE:
    case ERROR_CODES.LLM_TIMEOUT:
      return true
    case ERROR_CODES.ATLASSIAN_AUTH_FAILED:
    case ERROR_CODES.ATLASSIAN_CONFIG_REQUIRED:
    case ERROR_CODES.TOOL_NOT_ALLOWED:
    case ERROR_CODES.TOOL_APPROVAL_REQUIRED:
    case ERROR_CODES.TOOL_APPROVAL_EXPIRED:
    case ERROR_CODES.TOOL_PAYLOAD_MISMATCH:
    case ERROR_CODES.VALIDATION_FAILED:
    case ERROR_CODES.OPERATION_ALREADY_RUNNING:
      return false
    default:
      return true
  }
}
