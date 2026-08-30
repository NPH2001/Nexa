import { z } from 'zod'
import {
  ERROR_CODES,
  NexaError,
  type Commitment,
  type LocalToolDefinition,
  type LocalToolRegistry,
  type PreviewField,
  type ToolPreview,
  type ToolResultSummary,
} from '@nexa/shared-types'
import type { ActivityRepository, CommitmentRepository } from '@nexa/local-store'
import type { Logger } from '@nexa/observability'
import { resolveCommitmentTimestamp } from './commitment-time.js'

export const COMMITMENT_CREATE_TOOL = 'nexa_tao_cam_ket'
export const COMMITMENT_UPDATE_TOOL = 'nexa_cap_nhat_cam_ket'

/**
 * Tool cho phép agent ĐỀ XUẤT cam kết từ hội thoại.
 *
 * Ba giới hạn cố ý, không phải thiếu sót:
 *   1. Không có tool xoá. Xoá là hành động một chiều; người dùng làm trong màn hình Mục tiêu.
 *   2. Không đặt được `completed`. Chỉ người dùng mới tuyên bố việc của mình đã xong.
 *   3. Mốc thời gian được phân giải ở đây, theo giờ máy — model không được tự quyết ngày.
 *
 * Cái KHÔNG nằm ở đây: quyết định có được ghi hay không. Đó là việc của Confirmation Guard
 * trong agent-runtime; `execute` chỉ chạy sau khi guard đã tiêu một approval hợp lệ.
 */

export interface CommitmentToolDeps {
  readonly profileId: string
  /** Hội thoại đang chạy — gắn làm provenance cho cam kết được tạo. */
  readonly conversationId: string
  readonly commitments: CommitmentRepository
  readonly activity: ActivityRepository
  readonly logger: Logger
  readonly now?: () => Date
}

/** Trạng thái agent được phép đặt. `completed` vắng mặt có chủ ý. */
const AGENT_SETTABLE_STATUS = z.enum(['active', 'blocked', 'paused'])

const titleSchema = z.string().trim().min(1).max(200)
const nextActionSchema = z.string().trim().min(1).max(500)
/** ISO hoặc mô tả tương đối tiếng Việt; `resolveCommitmentTimestamp` là nơi chốt nghĩa. */
const whenSchema = z.string().trim().min(1).max(100)

const createInputSchema = z.object({
  title: titleSchema,
  next_action: nextActionSchema.nullish(),
  due_at: whenSchema.nullish(),
  check_in_at: whenSchema.nullish(),
  status: AGENT_SETTABLE_STATUS.optional(),
})

const updateInputSchema = z.object({
  commitment_id: z.string().uuid(),
  title: titleSchema.optional(),
  next_action: nextActionSchema.nullish(),
  due_at: whenSchema.nullish(),
  check_in_at: whenSchema.nullish(),
  status: AGENT_SETTABLE_STATUS.optional(),
})

type CreateInput = z.infer<typeof createInputSchema>
type UpdateInput = z.infer<typeof updateInputSchema>

const CREATE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Kết quả người dùng muốn đạt, viết như người dùng đã nói. Tối đa 200 ký tự.',
    },
    next_action: {
      type: 'string',
      description: 'Bước tiếp theo cụ thể, nếu người dùng đã nêu.',
    },
    due_at: {
      type: 'string',
      description:
        'Hạn hoàn thành. Chấp nhận ISO 8601 hoặc mô tả tương đối tiếng Việt như "thứ 6 tuần sau", "cuối tháng", "3 ngày nữa". Bỏ trống nếu người dùng chưa nói rõ — không được đoán.',
    },
    check_in_at: {
      type: 'string',
      description: 'Thời điểm muốn Nexa nhắc lại, cùng định dạng với due_at.',
    },
    status: {
      type: 'string',
      enum: ['active', 'blocked', 'paused'],
      description: 'Mặc định active. Dùng blocked khi người dùng nói đang bị chặn.',
    },
  },
  required: ['title'],
  additionalProperties: false,
}

const UPDATE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    commitment_id: { type: 'string', description: 'ID của cam kết cần cập nhật.' },
    title: { type: 'string', description: 'Kết quả muốn đạt, nếu người dùng đổi ý.' },
    next_action: { type: 'string', description: 'Bước tiếp theo mới.' },
    due_at: { type: 'string', description: 'Hạn mới, ISO hoặc mô tả tương đối tiếng Việt.' },
    check_in_at: { type: 'string', description: 'Mốc nhắc lại mới.' },
    status: {
      type: 'string',
      enum: ['active', 'blocked', 'paused'],
      description:
        'Chỉ ba trạng thái này. Người dùng tự đánh dấu hoàn thành trong màn hình Mục tiêu.',
    },
  },
  required: ['commitment_id'],
  additionalProperties: false,
}

export function createCommitmentToolRegistry(deps: CommitmentToolDeps): LocalToolRegistry {
  const now = deps.now ?? ((): Date => new Date())

  const createTool: LocalToolDefinition<CreateInput> = {
    kind: 'local',
    name: COMMITMENT_CREATE_TOOL,
    riskLevel: 'WRITE_LOW',
    description:
      'Đề xuất tạo một cam kết mới trong danh sách việc của người dùng, kèm hạn hoàn thành hoặc mốc nhắc lại. Chỉ gọi khi người dùng thực sự phát biểu một việc mình sẽ làm; người dùng vẫn phải xác nhận trước khi lưu.',
    inputSchema: createInputSchema,
    jsonSchema: CREATE_JSON_SCHEMA,
    buildPreview: (input, ctx) => {
      const resolved = resolveWhen(input, now())
      return Promise.resolve(
        buildPreview({
          toolName: COMMITMENT_CREATE_TOOL,
          action: 'Tạo một cam kết mới trong danh sách việc của bạn',
          actingAccount: ctx.actingAccount,
          fields: [
            { label: 'Kết quả muốn đạt', value: input.title },
            ...optionalField('Bước tiếp theo', input.next_action),
            ...optionalField('Hạn hoàn thành', formatWhen(resolved.dueAt)),
            ...optionalField('Mốc nhắc lại', formatWhen(resolved.checkInAt)),
            { label: 'Trạng thái', value: input.status ?? 'active' },
          ],
          changes: [],
        }),
      )
    },
    execute: (input) => {
      const resolved = resolveWhen(input, now())
      const created = deps.commitments.create({
        profileId: deps.profileId,
        title: input.title,
        nextAction: input.next_action ?? null,
        status: input.status ?? 'active',
        dueAt: resolved.dueAt,
        checkInAt: resolved.checkInAt,
        sourceConversationId: deps.conversationId,
        createdBy: 'agent',
      })
      recordMutation(deps, 'created', created.id)
      return Promise.resolve(summarize(created, 'Đã thêm cam kết vào danh sách việc'))
    },
  }

  const updateTool: LocalToolDefinition<UpdateInput> = {
    kind: 'local',
    name: COMMITMENT_UPDATE_TOOL,
    riskLevel: 'WRITE_LOW',
    description:
      'Đề xuất cập nhật một cam kết đang có: đổi bước tiếp theo, hạn, mốc nhắc lại hoặc trạng thái. Không dùng để đánh dấu hoàn thành hay xoá.',
    inputSchema: updateInputSchema,
    jsonSchema: UPDATE_JSON_SCHEMA,
    buildPreview: (input, ctx) => {
      const current = requireOwnCommitment(deps, input.commitment_id)
      const resolved = resolveWhen(input, now())

      // Giá trị "trước" đọc từ record thật, không phải từ thứ model nhớ được trong hội thoại.
      const changes = [
        ...changeIfPresent('Kết quả muốn đạt', current.title, input.title),
        ...changeIfPresent('Bước tiếp theo', current.nextAction, input.next_action),
        ...changeIfPresent('Hạn hoàn thành', formatWhen(current.dueAt), formatWhen(resolved.dueAt)),
        ...changeIfPresent(
          'Mốc nhắc lại',
          formatWhen(current.checkInAt),
          formatWhen(resolved.checkInAt),
        ),
        ...changeIfPresent('Trạng thái', current.status, input.status),
      ]
      if (changes.length === 0) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: 'commitment update changes nothing',
        })
      }

      return Promise.resolve(
        buildPreview({
          toolName: COMMITMENT_UPDATE_TOOL,
          action: `Cập nhật cam kết "${current.title}"`,
          actingAccount: ctx.actingAccount,
          fields: [{ label: 'Cam kết', value: current.title }],
          changes,
        }),
      )
    },
    execute: (input) => {
      requireOwnCommitment(deps, input.commitment_id)
      const resolved = resolveWhen(input, now())
      const updated = deps.commitments.update(input.commitment_id, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.next_action !== undefined ? { nextAction: input.next_action ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.due_at !== undefined ? { dueAt: resolved.dueAt } : {}),
        ...(input.check_in_at !== undefined ? { checkInAt: resolved.checkInAt } : {}),
      })
      recordMutation(deps, 'updated', updated.id)
      return Promise.resolve(summarize(updated, 'Đã cập nhật cam kết'))
    },
  }

  const byName = new Map<string, LocalToolDefinition>([
    [createTool.name, createTool as LocalToolDefinition],
    [updateTool.name, updateTool as LocalToolDefinition],
  ])

  return {
    list: () => [...byName.values()],
    get: (name) => byName.get(name),
  }
}

// ── Helper ─────────────────────────────────────────────────────────────────

/**
 * Ownership gate. Đọc trước khi ghi, và so `profileId` ở main process — id do model đưa ra là
 * dữ liệu không tin cậy, kể cả khi nó đến từ chính hội thoại này.
 */
function requireOwnCommitment(deps: CommitmentToolDeps, id: string): Commitment {
  const commitment = deps.commitments.get(id)
  if (commitment === null || commitment.profileId !== deps.profileId) {
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
      safeDetail: 'commitment does not belong to the current profile',
    })
  }
  return commitment
}

interface ResolvedWhen {
  readonly dueAt: string | null
  readonly checkInAt: string | null
}

function resolveWhen(
  input: { due_at?: string | null; check_in_at?: string | null },
  now: Date,
): ResolvedWhen {
  return {
    dueAt: input.due_at === undefined || input.due_at === null
      ? null
      : resolveCommitmentTimestamp(input.due_at, now),
    checkInAt:
      input.check_in_at === undefined || input.check_in_at === null
        ? null
        : resolveCommitmentTimestamp(input.check_in_at, now),
  }
}

/** Hiển thị mốc theo giờ máy: người dùng phải bắt được lỗi lệch ngày ngay trên preview. */
function formatWhen(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('vi-VN', { dateStyle: 'full', timeStyle: 'short' })
}

function optionalField(label: string, value: string | null | undefined): PreviewField[] {
  return value === null || value === undefined || value === '' ? [] : [{ label, value }]
}

function changeIfPresent(
  field: string,
  before: string | null,
  after: string | null | undefined,
): { field: string; before: string | null; after: string }[] {
  if (after === undefined) return []
  const next = after ?? '(bỏ trống)'
  if (next === (before ?? '(bỏ trống)')) return []
  return [{ field, before, after: next }]
}

function buildPreview(opts: {
  toolName: string
  action: string
  actingAccount: string
  fields: readonly PreviewField[]
  changes: readonly { field: string; before: string | null; after: string }[]
}): ToolPreview {
  return {
    toolName: opts.toolName,
    targetSystem: 'local',
    targetSystemUrl: '',
    action: opts.action,
    actingAccount: opts.actingAccount,
    payloadFields: opts.fields,
    changes: opts.changes,
    impactWarning:
      'Chỉ ghi vào dữ liệu cam kết trên máy bạn. Không có gì được gửi tới Jira, Confluence hay bất kỳ hệ thống nào bên ngoài.',
    reversible: true,
    riskLevel: 'WRITE_LOW',
  }
}

function summarize(commitment: Commitment, prefix: string): ToolResultSummary {
  const parts = [`${prefix}: "${commitment.title}"`]
  if (commitment.nextAction !== null) parts.push(`Bước tiếp theo: ${commitment.nextAction}`)
  const due = formatWhen(commitment.dueAt)
  if (due !== null) parts.push(`Hạn: ${due}`)
  const checkIn = formatWhen(commitment.checkInAt)
  if (checkIn !== null) parts.push(`Nhắc lại: ${checkIn}`)

  const text = parts.join('. ')
  return {
    // `commitment_id` để model cập nhật đúng record ở lượt sau mà không phải đoán.
    forModel: `${text}. commitment_id=${commitment.id}`,
    forUser: text,
  }
}

function recordMutation(
  deps: CommitmentToolDeps,
  action: 'created' | 'updated',
  commitmentId: string,
): void {
  // Chỉ id và enum — title/next action vẫn chỉ tồn tại dạng ciphertext trong bảng commitments.
  deps.activity.record({
    profileId: deps.profileId,
    type: 'commitment_mutation',
    action,
    status: 'success',
    subjectType: 'commitment',
    subjectId: commitmentId,
    actor: 'agent',
  })
  deps.logger.info('commitment-tool-mutation', { action, commitmentId, actor: 'agent' })
}
