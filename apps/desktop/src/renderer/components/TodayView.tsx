import { useCallback, useEffect, useState } from 'react'
import type { Commitment, Conversation, MemoryFact } from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { getCommitmentAttention, sortCommitmentsForToday } from './commitment-ui.js'

export function greetingForHour(hour: number): string {
  if (hour < 11) return 'Chào buổi sáng'
  if (hour < 18) return 'Chào buổi chiều'
  return 'Chào buổi tối'
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
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const loadOverview = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const [memoryResult, commitmentResult] = await Promise.all([
        api.memory.list(false),
        api.commitments.list(false),
      ])
      setMemories(memoryResult)
      setCommitments(commitmentResult)
    } catch (error) {
      setLoadFailed(true)
      onError(error, 'Không tải được tổng quan Today.')
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  const active = memories.filter((fact) => fact.status === 'active')
  const goals = sortCommitmentsForToday(commitments).slice(0, 5)
  const internalOnlyCount = active.filter((fact) => fact.sharingPolicy === 'internal_only').length
  const recentConversations = props.conversations.slice(0, 5)

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

        <section className="today-card" aria-labelledby="today-goals-title">
          <div className="today-card-head">
            <div>
              <p className="today-kicker">Đang theo</p>
              <h2 id="today-goals-title">Mục tiêu</h2>
            </div>
            <span className="today-count">{String(goals.length)}</span>
          </div>
          {loading ? (
            <p className="muted" role="status">
              Đang tải mục tiêu…
            </p>
          ) : loadFailed ? (
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
              {loading || loadFailed ? '…' : String(active.length)}
            </span>
          </div>
          <dl className="today-facts">
            <div>
              <dt>Chỉ dùng nội bộ</dt>
              <dd>{loading || loadFailed ? '—' : String(internalOnlyCount)}</dd>
            </div>
            <div>
              <dt>Cho phép provider ngoài</dt>
              <dd>{loading || loadFailed ? '—' : String(active.length - internalOnlyCount)}</dd>
            </div>
          </dl>
          <p className="muted small">
            Nexa không tự lưu memory, không tự tạo cam kết và chưa chạy tác vụ nền thay bạn.
            Mọi hành động thay đổi dữ liệu vẫn chờ bạn xác nhận.
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
