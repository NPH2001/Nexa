import { useCallback, useEffect, useState } from 'react'
import type {
  CheckInSuggestion,
  Commitment,
  Conversation,
  MemoryFact,
} from '@nexa/shared-types/renderer'
import { api, events } from '../bridge.js'
import { getCommitmentAttention, sortCommitmentsForToday } from './commitment-ui.js'

const SNOOZE_OPTIONS = [
  { value: 60 as const, label: '1 giờ' },
  { value: 1440 as const, label: '1 ngày' },
  { value: 10080 as const, label: '1 tuần' },
] as const

export function greetingForHour(hour: number): string {
  if (hour < 11) return 'Chào buổi sáng'
  if (hour < 18) return 'Chào buổi chiều'
  return 'Chào buổi tối'
}

export function describeCheckInReason(
  triggerKind: CheckInSuggestion['triggerKind'],
  triggerAt: string,
): string {
  return triggerKind === 'due'
    ? `Đến hạn từ ${formatRelativeDate(triggerAt)}`
    : `Đã tới lúc check-in từ ${formatRelativeDate(triggerAt)}`
}

export function TodayView(props: {
  conversations: readonly Conversation[]
  onOpenConversation: (id: string) => void
  onCreateConversation: () => void
  onOpenGoals: () => void
  onOpenSettings: () => void
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element {
  const { onError } = props
  const [memories, setMemories] = useState<MemoryFact[]>([])
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewFailed, setOverviewFailed] = useState(false)
  const [checkInsEnabled, setCheckInsEnabled] = useState(false)
  const [checkIns, setCheckIns] = useState<CheckInSuggestion[]>([])
  const [checkInLoading, setCheckInLoading] = useState(true)
  const [checkInFailed, setCheckInFailed] = useState(false)
  const [busyCheckInId, setBusyCheckInId] = useState<string | null>(null)
  const [busyToggle, setBusyToggle] = useState(false)
  const [snoozeMinutesById, setSnoozeMinutesById] = useState<Record<string, 60 | 1440 | 10080>>({})

  const loadOverview = useCallback(async (): Promise<void> => {
    setOverviewLoading(true)
    setOverviewFailed(false)
    try {
      const [memoryResult, commitmentResult] = await Promise.all([
        api.memory.list(false),
        api.commitments.list(false),
      ])
      setMemories(memoryResult)
      setCommitments(commitmentResult)
    } catch (error) {
      setOverviewFailed(true)
      onError(error, 'Không tải được tổng quan Today.')
    } finally {
      setOverviewLoading(false)
    }
  }, [onError])

  const loadCheckIns = useCallback(async (): Promise<void> => {
    setCheckInLoading(true)
    setCheckInFailed(false)
    try {
      const result = await api.checkIns.list()
      setCheckInsEnabled(result.enabled)
      setCheckIns(result.suggestions)
    } catch (error) {
      setCheckInFailed(true)
      onError(error, 'Không tải được check-in hôm nay.')
    } finally {
      setCheckInLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void loadOverview()
    void loadCheckIns()
  }, [loadCheckIns, loadOverview])

  useEffect(() => events.onCheckInsChanged(() => void loadCheckIns()), [loadCheckIns])

  const active = memories.filter((fact) => fact.status === 'active')
  const goals = sortCommitmentsForToday(commitments).slice(0, 5)
  const internalOnlyCount = active.filter((fact) => fact.sharingPolicy === 'internal_only').length
  const recentConversations = props.conversations.slice(0, 5)
  const pendingCheckIns = checkIns.filter((suggestion) => suggestion.state === 'pending')

  const toggleCheckIns = (enabled: boolean): void => {
    void (async () => {
      setBusyToggle(true)
      try {
        const result = await api.checkIns.setEnabled(enabled)
        setCheckInsEnabled(result.enabled)
        setCheckIns(result.suggestions)
      } catch (error) {
        onError(error, enabled ? 'Không bật được nhắc việc.' : 'Không tắt được nhắc việc.')
      } finally {
        setBusyToggle(false)
      }
    })()
  }

  const respondToCheckIn = (
    suggestion: CheckInSuggestion,
    action: 'acted' | 'snoozed' | 'dismissed' | 'muted',
  ): void => {
    void (async () => {
      setBusyCheckInId(suggestion.id)
      try {
        await api.checkIns.respond(
          suggestion.id,
          action,
          action === 'snoozed' ? (snoozeMinutesById[suggestion.id] ?? 60) : undefined,
        )
        await loadCheckIns()
        if (action === 'acted') {
          if (suggestion.sourceConversationId !== null)
            props.onOpenConversation(suggestion.sourceConversationId)
          else props.onOpenGoals()
        }
      } catch (error) {
        onError(error, 'Không cập nhật được trạng thái check-in.')
      } finally {
        setBusyCheckInId(null)
      }
    })()
  }

  return (
    <section className="today" aria-labelledby="today-title">
      <header className="today-hero">
        <div>
          <p className="today-eyebrow">{greetingForHour(new Date().getHours())}</p>
          <h1 id="today-title">Mình tiếp tục việc gì hôm nay?</h1>
          <p className="muted">
            Nexa giữ context bạn đã xác nhận và đưa những cam kết cần chú ý lên trước.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={props.onCreateConversation}>
          Bắt đầu một việc mới
        </button>
      </header>

      <div className="today-grid">
        <section className="today-card today-card-wide" aria-labelledby="today-continue-title">
          <div className="today-card-head">
            <div>
              <p className="today-kicker">Tiếp tục</p>
              <h2 id="today-continue-title">Hội thoại gần đây</h2>
            </div>
          </div>
          {recentConversations.length === 0 ? (
            <div className="today-empty">
              <p>Chưa có mạch công việc nào đang chờ.</p>
              <button type="button" className="btn" onClick={props.onCreateConversation}>
                Tạo hội thoại đầu tiên
              </button>
            </div>
          ) : (
            <ul className="today-list" aria-label="Hội thoại gần đây">
              {recentConversations.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    className="today-row"
                    onClick={() => props.onOpenConversation(conversation.id)}
                  >
                    <span>
                      <strong>{conversation.title}</strong>
                      <span className="muted small">
                        {String(conversation.messageCount)} tin nhắn ·{' '}
                        {formatRelativeDate(conversation.updatedAt)}
                      </span>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="today-card today-card-wide" aria-labelledby="today-checkins-title">
          <div className="today-card-head">
            <div>
              <p className="today-kicker">Proactive check-in</p>
              <h2 id="today-checkins-title">Cần check-in</h2>
            </div>
            <div className="today-card-tools">
              <span className="today-count">
                {checkInsEnabled ? String(pendingCheckIns.length) : 'Tắt'}
              </span>
              {checkInsEnabled && !checkInLoading && !checkInFailed && (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busyToggle}
                  onClick={() => toggleCheckIns(false)}
                >
                  {busyToggle ? 'Đang tắt…' : 'Tắt nhắc việc'}
                </button>
              )}
            </div>
          </div>
          <p className="muted small">
            Chỉ nhắc khi Nexa đang mở. Chưa có background process hay OS notification ở phiên bản
            này.
          </p>
          {checkInLoading ? (
            <p className="muted" role="status">
              Đang tải check-in…
            </p>
          ) : checkInFailed ? (
            <div className="today-empty">
              <p>Không tải được danh sách check-in.</p>
              <button type="button" className="btn" onClick={() => void loadCheckIns()}>
                Thử lại
              </button>
            </div>
          ) : !checkInsEnabled ? (
            <div className="today-empty">
              <p>
                Nexa đang không nhắc việc chủ động. Bạn cần bật opt-in trước khi Today surface các
                check-in đến hạn.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busyToggle}
                  onClick={() => toggleCheckIns(true)}
                >
                  {busyToggle ? 'Đang bật…' : 'Bật nhắc việc'}
                </button>
                <button type="button" className="btn" onClick={props.onOpenGoals}>
                  Xem cam kết
                </button>
              </div>
            </div>
          ) : pendingCheckIns.length === 0 ? (
            <div className="today-empty">
              <p>Chưa có check-in nào cần chú ý ngay lúc này.</p>
              <div className="actions">
                <button type="button" className="btn" onClick={props.onOpenGoals}>
                  Mở Mục tiêu
                </button>
              </div>
            </div>
          ) : (
            <ul className="today-checkins" aria-label="Check-in cần chú ý">
              {pendingCheckIns.map((suggestion) => {
                const busy = busyCheckInId === suggestion.id
                const selectedSnooze = snoozeMinutesById[suggestion.id] ?? 60
                return (
                  <li key={suggestion.id} className="today-checkin-item">
                    <div className="today-checkin-copy">
                      <div className="goal-tags">
                        <span className="commitment-attention attention-soon">
                          {suggestion.triggerKind === 'due' ? 'Đến hạn' : 'Check-in'}
                        </span>
                      </div>
                      <strong>{suggestion.title}</strong>
                      <p className="muted small">
                        {describeCheckInReason(suggestion.triggerKind, suggestion.triggerAt)}
                      </p>
                      <p className="today-checkin-next">
                        {suggestion.nextAction ?? 'Chưa có bước tiếp theo cho cam kết này.'}
                      </p>
                    </div>
                    <div className="today-checkin-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => respondToCheckIn(suggestion, 'acted')}
                      >
                        {busy ? 'Đang cập nhật…' : 'Thực hiện'}
                      </button>
                      <div className="today-snooze-row">
                        <label className="field">
                          <span>Nhắc lại sau</span>
                          <select
                            className="input"
                            value={selectedSnooze}
                            disabled={busy}
                            onChange={(event) =>
                              setSnoozeMinutesById((current) => ({
                                ...current,
                                [suggestion.id]: Number(event.target.value) as 60 | 1440 | 10080,
                              }))
                            }
                          >
                            {SNOOZE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => respondToCheckIn(suggestion, 'snoozed')}
                        >
                          Nhắc lại sau
                        </button>
                      </div>
                      <div className="today-inline-actions">
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => respondToCheckIn(suggestion, 'dismissed')}
                        >
                          Bỏ qua
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => respondToCheckIn(suggestion, 'muted')}
                        >
                          Không nhắc việc này nữa
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="today-card" aria-labelledby="today-goals-title">
          <div className="today-card-head">
            <div>
              <p className="today-kicker">Đang theo</p>
              <h2 id="today-goals-title">Mục tiêu</h2>
            </div>
            <span className="today-count">{String(goals.length)}</span>
          </div>
          {overviewLoading ? (
            <p className="muted" role="status">
              Đang tải mục tiêu…
            </p>
          ) : overviewFailed ? (
            <button type="button" className="btn" onClick={() => void loadOverview()}>
              Thử tải lại
            </button>
          ) : goals.length === 0 ? (
            <div className="today-empty">
              <p>Chưa có cam kết nào đang được theo dõi.</p>
              <button type="button" className="link" onClick={props.onOpenGoals}>
                Tạo cam kết đầu tiên
              </button>
            </div>
          ) : (
            <ul className="today-goals" aria-label="Cam kết cần chú ý">
              {goals.map((goal) => {
                const attention = getCommitmentAttention(goal)
                return (
                  <li key={goal.id}>
                    <button type="button" className="today-goal-row" onClick={props.onOpenGoals}>
                      <span>
                        <strong>{goal.title}</strong>
                        <span className="muted small">
                          {goal.nextAction === null ? 'Chưa đặt bước tiếp theo' : goal.nextAction}
                        </span>
                      </span>
                      <span className={`commitment-attention attention-${attention.tone}`}>
                        {attention.label}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="today-card" aria-labelledby="today-trust-title">
          <div className="today-card-head">
            <div>
              <p className="today-kicker">Ranh giới rõ ràng</p>
              <h2 id="today-trust-title">Nexa đang nhớ</h2>
            </div>
            <span className="today-count">
              {overviewLoading || overviewFailed ? '…' : String(active.length)}
            </span>
          </div>
          <dl className="today-facts">
            <div>
              <dt>Chỉ dùng nội bộ</dt>
              <dd>{overviewLoading || overviewFailed ? '—' : String(internalOnlyCount)}</dd>
            </div>
            <div>
              <dt>Cho phép provider ngoài</dt>
              <dd>
                {overviewLoading || overviewFailed
                  ? '—'
                  : String(active.length - internalOnlyCount)}
              </dd>
            </div>
          </dl>
          <p className="muted small">
            Nexa không tự lưu memory, không tự tạo cam kết và chưa chạy tác vụ nền thay bạn. Mọi
            hành động thay đổi dữ liệu vẫn chờ bạn xác nhận.
          </p>
          <button type="button" className="btn" onClick={props.onOpenSettings}>
            Quản lý Nexa nhớ
          </button>
        </section>
      </div>
    </section>
  )
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return `hôm nay lúc ${date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
  }
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
