import {
  ERROR_CODES,
  NexaError,
  isWriteRisk,
  type ApprovalRecord,
  type ConfirmationRequest,
  type RiskLevel,
  type ToolPreview,
} from '@nexa/shared-types'
import { SECURITY_EVENTS, newOperationId, type Logger } from '@nexa/observability'
import { computePayloadHash } from '@nexa/security'

/**
 * Confirmation Guard (§5.2, §10.2, §10.3).
 *
 * Đây là thành phần mà §19 nói rõ phải hoàn thiện TRƯỚC khi bật tool write. Bốn bất biến nó
 * phải giữ, tương ứng với các kịch bản bắt buộc ở §17.2:
 *
 *   1. Tool có side effect không chạy nếu chưa có approval hợp lệ.        (kịch bản 2)
 *   2. Approval gắn cứng với `payload_hash`; payload đổi ⇒ vô hiệu.       (kịch bản 3)
 *   3. Approval dùng MỘT LẦN và có hạn ngắn.                              (§10.2)
 *   4. Một operation_id chỉ thực thi được một lần.                        (kịch bản 4)
 *
 * Guard KHÔNG biết cách gọi tool — nó chỉ nói "được" hay "không". Việc thực thi nằm ở
 * AtlassianMcpManager. Tách vậy để không có đường tắt nào vừa kiểm tra vừa thực thi.
 */

export type ApprovalDecision = 'approved' | 'cancelled'

interface PendingApproval {
  readonly request: ConfirmationRequest
  readonly toolName: string
  readonly expiresAtMs: number
  decision: ApprovalDecision | null
  /** Đã bị `consume()` lấy đi chưa — chốt chặn dùng-một-lần. */
  consumed: boolean
}

export interface ConfirmationGuardOptions {
  readonly logger: Logger
  /** §10.2 "approval có thời hạn ngắn". Mặc định 120s — xem OPEN-QUESTIONS B8. */
  readonly ttlSeconds?: number
  readonly now?: () => Date
}

export class ConfirmationGuard {
  private readonly pending = new Map<string, PendingApproval>()
  /** operation_id đang thực thi — chốt chặn double-submit ở tầng bộ nhớ. */
  private readonly executing = new Set<string>()
  /** operation_id đã thực thi xong, giữ lại để chặn gọi lại. */
  private readonly completed = new Set<string>()
  private readonly log: Logger
  private readonly ttlMs: number
  private readonly now: () => Date

  constructor(opts: ConfirmationGuardOptions) {
    this.log = opts.logger.child({ module: 'confirmation-guard' })
    this.ttlMs = (opts.ttlSeconds ?? 120) * 1000
    this.now = opts.now ?? (() => new Date())
  }

  /** §10.1: READ chạy thẳng, mọi mức khác phải xác nhận. */
  requiresApproval(risk: RiskLevel): boolean {
    return isWriteRisk(risk)
  }

  /**
   * Mở một yêu cầu xác nhận. Trả về thứ UI cần để hiển thị §10.2.
   *
   * `payloadHash` tính từ payload ĐÃ VALIDATE (sau khi Zod điền default), vì đó chính là
   * payload sẽ được gửi đi. Hash payload thô trước validate là một lỗ hổng: default có thể
   * đổi giữa preview và execute.
   */
  open(params: {
    conversationId: string
    toolName: string
    validatedPayload: unknown
    preview: ToolPreview
  }): ConfirmationRequest {
    const operationId = newOperationId()
    const payloadHash = computePayloadHash(params.toolName, params.validatedPayload)
    const expiresAtMs = this.now().getTime() + this.ttlMs

    const request: ConfirmationRequest = {
      operationId,
      payloadHash,
      conversationId: params.conversationId,
      preview: params.preview,
      expiresAt: new Date(expiresAtMs).toISOString(),
    }

    this.pending.set(operationId, {
      request,
      toolName: params.toolName,
      expiresAtMs,
      decision: null,
      consumed: false,
    })

    this.log.tool('approval-requested', {
      toolName: params.toolName,
      phase: 'awaiting-approval',
      approvalStatus: 'pending',
      operationId,
      riskLevel: params.preview.riskLevel,
    })

    return request
  }

  /**
   * Người dùng bấm Xác nhận.
   *
   * `payloadHash` do renderer gửi lại là hash mà UI ĐÃ HIỂN THỊ. So với hash guard đang giữ:
   * lệch nghĩa là màn hình người dùng nhìn thấy không phải thứ sắp được gửi đi.
   */
  approve(operationId: string, payloadHashFromUi: string): ApprovalRecord {
    const entry = this.requirePending(operationId)

    if (entry.request.payloadHash !== payloadHashFromUi) {
      this.pending.delete(operationId)
      this.log.security(SECURITY_EVENTS.approvalMismatch, { operationId }, 'error')
      throw new NexaError(ERROR_CODES.TOOL_PAYLOAD_MISMATCH, { operationId })
    }
    if (this.isExpired(entry)) {
      this.pending.delete(operationId)
      this.log.security(SECURITY_EVENTS.approvalExpired, { operationId })
      throw new NexaError(ERROR_CODES.TOOL_APPROVAL_EXPIRED, { operationId })
    }
    if (entry.decision !== null) {
      throw new NexaError(ERROR_CODES.OPERATION_ALREADY_RUNNING, { operationId })
    }

    entry.decision = 'approved'
    const record: ApprovalRecord = {
      operationId,
      payloadHash: entry.request.payloadHash,
      toolName: entry.toolName,
      approvedAt: this.now().toISOString(),
      expiresAt: entry.request.expiresAt,
    }
    this.log.tool('approval-granted', {
      toolName: entry.toolName,
      phase: 'awaiting-approval',
      approvalStatus: 'approved',
      operationId,
    })
    return record
  }

  /** Người dùng bấm Huỷ. §17.2 kịch bản 2: không được có bất kỳ request nào gửi đi. */
  cancel(operationId: string): void {
    const entry = this.pending.get(operationId)
    if (entry === undefined) return
    entry.decision = 'cancelled'
    this.log.tool('approval-cancelled', {
      toolName: entry.toolName,
      phase: 'done',
      approvalStatus: 'cancelled',
      operationId,
    })
  }

  decisionOf(operationId: string): ApprovalDecision | null {
    return this.pending.get(operationId)?.decision ?? null
  }

  /**
   * Cổng cuối cùng trước khi thực thi.
   *
   * Kiểm tra lại TOÀN BỘ điều kiện — không tin vào kết quả của `approve()` trước đó, vì giữa
   * hai thời điểm có thể đã hết hạn, payload có thể đã bị sửa, hoặc ai đó gọi lại lần hai.
   *
   * Thành công ⇒ approval bị tiêu huỷ và operation vào trạng thái "đang chạy".
   */
  consume(operationId: string, toolName: string, payloadAboutToBeSent: unknown): ApprovalRecord {
    if (this.completed.has(operationId)) {
      throw new NexaError(ERROR_CODES.OPERATION_ALREADY_RUNNING, {
        operationId,
        safeDetail: 'operation already finished',
      })
    }
    if (this.executing.has(operationId)) {
      throw new NexaError(ERROR_CODES.OPERATION_ALREADY_RUNNING, { operationId })
    }

    const entry = this.requirePending(operationId)

    if (entry.consumed) {
      throw new NexaError(ERROR_CODES.OPERATION_ALREADY_RUNNING, {
        operationId,
        safeDetail: 'approval already used',
      })
    }
    if (entry.decision !== 'approved') {
      throw new NexaError(ERROR_CODES.TOOL_APPROVAL_REQUIRED, { operationId })
    }
    if (this.isExpired(entry)) {
      this.pending.delete(operationId)
      this.log.security(SECURITY_EVENTS.approvalExpired, { operationId })
      throw new NexaError(ERROR_CODES.TOOL_APPROVAL_EXPIRED, { operationId })
    }
    if (entry.toolName !== toolName) {
      this.log.security(SECURITY_EVENTS.approvalMismatch, { operationId }, 'error')
      throw new NexaError(ERROR_CODES.TOOL_PAYLOAD_MISMATCH, {
        operationId,
        safeDetail: 'approval belongs to a different tool',
      })
    }

    // §17.2 kịch bản 3, kiểm tra lần cuối trên payload THẬT SỰ sắp gửi.
    const actualHash = computePayloadHash(toolName, payloadAboutToBeSent)
    if (actualHash !== entry.request.payloadHash) {
      this.pending.delete(operationId)
      this.log.security(SECURITY_EVENTS.approvalMismatch, { operationId }, 'error')
      throw new NexaError(ERROR_CODES.TOOL_PAYLOAD_MISMATCH, { operationId })
    }

    entry.consumed = true
    this.pending.delete(operationId)
    this.executing.add(operationId)

    return {
      operationId,
      payloadHash: entry.request.payloadHash,
      toolName,
      approvedAt: this.now().toISOString(),
      expiresAt: entry.request.expiresAt,
    }
  }

  /**
   * Đánh dấu operation đã kết thúc.
   *
   * `uncertain` KHÔNG được đưa vào `completed`: §16 yêu cầu tra cứu trước khi cho retry, và
   * việc tra cứu có thể kết luận là chưa tạo — khi đó phải cho phép thử lại.
   */
  finishExecution(operationId: string, outcome: 'success' | 'failed' | 'uncertain'): void {
    this.executing.delete(operationId)
    if (outcome === 'success') this.completed.add(operationId)
  }

  /** Dọn approval quá hạn. Gọi định kỳ để Map không phình theo phiên làm việc. */
  sweepExpired(): number {
    const nowMs = this.now().getTime()
    let removed = 0
    for (const [id, entry] of this.pending) {
      if (entry.expiresAtMs < nowMs) {
        this.pending.delete(id)
        removed++
      }
    }
    return removed
  }

  get pendingCount(): number {
    return this.pending.size
  }

  private requirePending(operationId: string): PendingApproval {
    const entry = this.pending.get(operationId)
    if (entry === undefined) {
      throw new NexaError(ERROR_CODES.TOOL_APPROVAL_REQUIRED, {
        operationId,
        safeDetail: 'no pending approval for this operation',
      })
    }
    return entry
  }

  private isExpired(entry: PendingApproval): boolean {
    return this.now().getTime() > entry.expiresAtMs
  }
}
