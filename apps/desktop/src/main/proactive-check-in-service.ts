import type { CheckInSuggestion, CheckInTriggerKind, Commitment } from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'
import type {
  ActivityRepository,
  CommitmentCheckIn,
  CheckInRepository,
  CommitmentRepository,
  LocalStore,
} from '@nexa/local-store'
import type { SettingsService } from '@nexa/connection-config'

const CHECK_INTERVAL_MS = 60_000

export type CheckInResponseAction = 'acted' | 'snoozed' | 'dismissed' | 'muted'
export type CheckInSnoozeMinutes = 60 | 1440 | 10080

interface CheckInServiceOptions {
  readonly profileId: string
  readonly store: LocalStore
  readonly repository: CheckInRepository
  readonly commitments: CommitmentRepository
  readonly activity: ActivityRepository
  readonly settings: SettingsService
  readonly logger: Logger
  readonly now?: () => Date
  readonly setIntervalFn?: (callback: () => void, delayMs: number) => NodeJS.Timeout
  readonly clearIntervalFn?: (timer: NodeJS.Timeout) => void
  readonly onChanged?: (changedAt: string) => void
}

/**
 * Scheduler check-in chỉ sống trong main process đang mở.
 *
 * Service không biết gì về Notification API. `onChanged` là output port duy nhất để Today cập
 * nhật; một adapter OS notification tương lai có thể subscribe cùng port sau khi có background
 * process thật, không cần đổi semantics derive/respond ở đây.
 */
export class ProactiveCheckInService {
  private readonly log: Logger
  private readonly now: () => Date
  private readonly setIntervalFn: NonNullable<CheckInServiceOptions['setIntervalFn']>
  private readonly clearIntervalFn: NonNullable<CheckInServiceOptions['clearIntervalFn']>
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly opts: CheckInServiceOptions) {
    this.log = opts.logger.child({ module: 'proactive-check-in' })
    this.now = opts.now ?? (() => new Date())
    this.setIntervalFn =
      opts.setIntervalFn ?? ((callback, delayMs) => setInterval(callback, delayMs))
    this.clearIntervalFn = opts.clearIntervalFn ?? ((timer) => clearInterval(timer))
  }

  get enabled(): boolean {
    return this.opts.settings.get().proactiveCheckInsEnabled
  }

  start(): void {
    this.reconfigure()
  }

  stop(): void {
    if (this.timer === null) return
    this.clearIntervalFn(this.timer)
    this.timer = null
    this.log.info('proactive-check-in-stopped', {})
  }

  /** Áp lại setting sau khi người dùng bật/tắt. Setting tắt đồng nghĩa không có interval. */
  reconfigure(): void {
    if (!this.enabled) {
      this.stop()
      this.log.info('proactive-check-in-disabled', {})
      return
    }

    this.reconcile()
    if (this.timer !== null) return
    this.timer = this.setIntervalFn(() => this.reconcile(), CHECK_INTERVAL_MS)
    this.timer.unref?.()
    this.log.info('proactive-check-in-started', { intervalMs: CHECK_INTERVAL_MS })
  }

  /**
   * Derive idempotent từ commitment. Không tạo/sửa commitment và không gọi network/tool.
   */
  reconcile(): void {
    if (!this.enabled) return

    const nowIso = this.now().toISOString()
    let changed = false

    this.opts.store.transaction(() => {
      for (const released of this.opts.repository.releaseSnoozed(this.opts.profileId, nowIso)) {
        this.recordSuggestionActivity(released, 'generated', 'pending')
        changed = true
      }

      const commitments = this.opts.commitments.list(this.opts.profileId, {
        includeCompleted: true,
      })
      for (const commitment of commitments) {
        if (commitment.status !== 'active' && commitment.status !== 'blocked') continue
        const trigger = selectCurrentTrigger(commitment, nowIso)
        if (trigger === null) continue

        const reconciled = this.opts.repository.reconcileTrigger(
          this.opts.profileId,
          commitment.id,
          trigger.kind,
          trigger.at,
        )
        if (!reconciled.changed) continue
        // Mute vẫn cập nhật snapshot trigger để unmute dùng mốc mới nhất, nhưng không được phát
        // một "generated/pending" giả khi người dùng đã yêu cầu ngừng nhắc commitment này.
        if (reconciled.record.state === 'pending') {
          this.recordSuggestionActivity(reconciled.record, 'generated', 'pending')
          changed = true
        }
      }
    })

    if (changed) this.notifyChanged(nowIso)
  }

  list(): { enabled: boolean; suggestions: CheckInSuggestion[] } {
    if (this.enabled) this.reconcile()
    const nowIso = this.now().toISOString()
    const suggestions = this.opts.repository.list(this.opts.profileId).flatMap((record) => {
      const commitment = this.opts.commitments.get(record.commitmentId)
      if (commitment === null || commitment.profileId !== this.opts.profileId) return []
      // Mute phải còn đọc được trong Goals để người dùng bật lại, kể cả khi commitment đang
      // pause/complete hoặc mốc đã được dời sang tương lai. Các state khác chỉ là suggestion
      // hiện hành khi commitment vẫn đủ điều kiện và snapshot trigger còn đúng.
      if (record.state !== 'muted') {
        if (commitment.status !== 'active' && commitment.status !== 'blocked') return []
        const currentTrigger = selectCurrentTrigger(commitment, nowIso)
        if (
          currentTrigger === null ||
          currentTrigger.kind !== record.triggerKind ||
          currentTrigger.at !== record.triggerAt
        ) {
          return []
        }
      }
      return [toSuggestion(record, commitment)]
    })
    return { enabled: this.enabled, suggestions }
  }

  respond(
    id: string,
    action: CheckInResponseAction,
    snoozeMinutes?: CheckInSnoozeMinutes,
  ): CheckInSuggestion {
    const now = this.now()
    const snoozedUntil =
      action === 'snoozed' && snoozeMinutes !== undefined
        ? new Date(now.getTime() + snoozeMinutes * 60_000).toISOString()
        : undefined

    const record = this.opts.store.transaction(() => {
      const updated = this.opts.repository.respond(this.opts.profileId, id, action, snoozedUntil)
      this.recordSuggestionActivity(updated, action, activityStatusForResponse(action))
      return updated
    })

    const commitment = this.opts.commitments.get(record.commitmentId)
    if (commitment === null || commitment.profileId !== this.opts.profileId) {
      // FK cascade khiến nhánh này chỉ có thể xảy ra nếu record bị xoá ở một transaction khác.
      throw new Error('check-in commitment disappeared')
    }
    this.notifyChanged(now.toISOString())
    return toSuggestion(record, commitment)
  }

  unmute(commitmentId: string): CheckInSuggestion | null {
    const changedAt = this.now().toISOString()
    const record = this.opts.store.transaction(() => {
      const updated = this.opts.repository.unmute(this.opts.profileId, commitmentId)
      if (updated !== null) this.recordSuggestionActivity(updated, 'unmuted', 'success')
      return updated
    })
    if (record === null) return null

    const commitment = this.opts.commitments.get(record.commitmentId)
    if (commitment === null || commitment.profileId !== this.opts.profileId) return null
    this.notifyChanged(changedAt)
    return toSuggestion(record, commitment)
  }

  private recordSuggestionActivity(
    record: CommitmentCheckIn,
    action: 'generated' | 'acted' | 'snoozed' | 'dismissed' | 'muted' | 'unmuted',
    status: 'pending' | 'success' | 'snoozed' | 'dismissed' | 'muted',
  ): void {
    this.opts.activity.record({
      profileId: this.opts.profileId,
      type: 'suggestion',
      action,
      status,
      subjectType: 'commitment',
      subjectId: record.commitmentId,
    })
  }

  private notifyChanged(changedAt: string): void {
    this.opts.onChanged?.(changedAt)
  }
}

function selectCurrentTrigger(
  commitment: Commitment,
  nowIso: string,
): { kind: CheckInTriggerKind; at: string } | null {
  const now = Date.parse(nowIso)
  const candidates: { kind: CheckInTriggerKind; at: string; time: number }[] = []

  const due = parseDueTimestamp(commitment.dueAt, now)
  if (due !== null) candidates.push({ kind: 'due', at: commitment.dueAt as string, time: due })
  const checkIn = parseDueTimestamp(commitment.checkInAt, now)
  if (checkIn !== null) {
    candidates.push({ kind: 'check_in', at: commitment.checkInAt as string, time: checkIn })
  }

  candidates.sort((left, right) => {
    const timeDiff = right.time - left.time
    if (timeDiff !== 0) return timeDiff
    return left.kind === 'check_in' ? -1 : 1
  })
  const selected = candidates[0]
  return selected === undefined ? null : { kind: selected.kind, at: selected.at }
}

function parseDueTimestamp(value: string | null, now: number): number | null {
  if (value === null) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) || parsed > now ? null : parsed
}

function toSuggestion(record: CommitmentCheckIn, commitment: Commitment): CheckInSuggestion {
  return {
    id: record.id,
    commitmentId: record.commitmentId,
    title: commitment.title,
    nextAction: commitment.nextAction,
    sourceConversationId: commitment.sourceConversationId,
    triggerKind: record.triggerKind,
    triggerAt: record.triggerAt,
    state: record.state,
    snoozedUntil: record.snoozedUntil,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function activityStatusForResponse(
  action: CheckInResponseAction,
): 'success' | 'snoozed' | 'dismissed' | 'muted' {
  switch (action) {
    case 'acted':
      return 'success'
    case 'snoozed':
      return 'snoozed'
    case 'dismissed':
      return 'dismissed'
    case 'muted':
      return 'muted'
  }
}

export const PROACTIVE_CHECK_IN_INTERVAL_MS = CHECK_INTERVAL_MS
