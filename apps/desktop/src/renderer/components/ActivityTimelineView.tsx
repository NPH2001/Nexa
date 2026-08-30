import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActivityAction,
  ActivityActor,
  ActivityEvent,
  ActivityStatus,
  ActivityType,
} from '@nexa/shared-types/renderer'
import { api, BridgeError } from '../bridge.js'

const TYPE_OPTIONS: Array<{ value: ActivityType | 'all'; label: string }> = [
  { value: 'all', label: 'Tất cả loại' },
  { value: 'suggestion', label: 'Gợi ý check-in' },
  { value: 'memory_mutation', label: 'Memory' },
  { value: 'commitment_mutation', label: 'Cam kết' },
  { value: 'tool_preview', label: 'Tool preview' },
  { value: 'confirmation', label: 'Xác nhận' },
  { value: 'tool_result', label: 'Kết quả tool' },
  { value: 'uncertain_operation', label: 'Tác vụ chưa chắc chắn' },
  { value: 'ba_document_mutation', label: 'Tài liệu nghiệp vụ' },
  { value: 'document_checklist_mutation', label: 'Checklist chứng từ' },
] as const

const ACTOR_OPTIONS: Array<{ value: ActivityActor | 'all'; label: string }> = [
  { value: 'all', label: 'Tất cả nguồn' },
  { value: 'user', label: 'Bạn thực hiện' },
  { value: 'agent', label: 'Nexa đề xuất' },
]

const STATUS_OPTIONS: Array<{ value: ActivityStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'pending', label: 'Đang chờ' },
  { value: 'success', label: 'Thành công' },
  { value: 'failed', label: 'Thất bại' },
  { value: 'cancelled', label: 'Đã huỷ' },
  { value: 'uncertain', label: 'Chưa chắc chắn' },
  { value: 'snoozed', label: 'Nhắc lại sau' },
  { value: 'dismissed', label: 'Đã bỏ qua' },
  { value: 'muted', label: 'Đã tắt nhắc' },
] as const

export function labelForActivityAction(action: ActivityAction): string {
  const labels: Record<ActivityAction, string> = {
    generated: 'Đã gợi ý',
    acted: 'Đã thực hiện',
    snoozed: 'Đã nhắc lại sau',
    dismissed: 'Đã bỏ qua',
    muted: 'Đã tắt nhắc',
    unmuted: 'Đã bật lại nhắc',
    created: 'Đã tạo',
    updated: 'Đã cập nhật',
    archived: 'Đã lưu trữ',
    restored: 'Đã khôi phục',
    deleted: 'Đã xoá',
    requested: 'Đã yêu cầu',
    approved: 'Đã xác nhận',
    cancelled: 'Đã huỷ',
    expired: 'Đã hết hạn',
    completed: 'Đã hoàn tất',
    failed: 'Đã thất bại',
    became_uncertain: 'Chưa xác nhận được kết quả',
    resolved: 'Đã đối chiếu lại',
  }
  return labels[action]
}

export function labelForActivityType(type: ActivityType): string {
  const labels: Record<ActivityType, string> = {
    suggestion: 'Gợi ý check-in',
    memory_mutation: 'Memory',
    commitment_mutation: 'Cam kết',
    tool_preview: 'Tool preview',
    confirmation: 'Xác nhận',
    tool_result: 'Kết quả tool',
    uncertain_operation: 'Tác vụ chưa chắc chắn',
    ba_document_mutation: 'Tài liệu nghiệp vụ',
    document_checklist_mutation: 'Checklist chứng từ',
  }
  return labels[type]
}

function labelForActivityStatus(status: ActivityStatus): string {
  const labels: Record<ActivityStatus, string> = {
    pending: 'Đang chờ',
    success: 'Thành công',
    failed: 'Thất bại',
    cancelled: 'Đã huỷ',
    uncertain: 'Chưa chắc chắn',
    snoozed: 'Nhắc lại sau',
    dismissed: 'Đã bỏ qua',
    muted: 'Đã tắt nhắc',
  }
  return labels[status]
}

function formatActivityTimestamp(value: string): string {
  return new Date(value).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Record ghi trước khi có cột actor không có nguồn để hiển thị — nói vậy, đừng đoán là "bạn". */
export function labelForActivityActor(actor: ActivityActor | null): string {
  if (actor === 'agent') return 'Nexa đề xuất'
  if (actor === 'user') return 'Bạn thực hiện'
  return 'Không rõ'
}

function formatSubject(event: ActivityEvent): string {
  if (event.subjectLabel !== null) return event.subjectLabel
  if (event.subjectType === 'memory') return 'Memory'
  if (event.subjectType === 'commitment') return 'Cam kết'
  if (event.subjectType === 'tool') return event.subjectId ?? 'Tool'
  if (event.subjectType === 'ba_document') return event.subjectLabel ?? 'Tài liệu nghiệp vụ'
  if (event.subjectType === 'document_checklist') return 'Checklist chứng từ'
  return 'Hoạt động hệ thống'
}

export function ActivityTimelineView(props: {
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element {
  const { onError } = props
  const [typeFilter, setTypeFilter] = useState<ActivityType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<ActivityStatus | 'all'>('all')
  const [actorFilter, setActorFilter] = useState<ActivityActor | 'all'>('all')
  const [items, setItems] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [errorRequestId, setErrorRequestId] = useState<string | null>(null)
  const loadSequenceRef = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const loadSequence = loadSequenceRef.current + 1
    loadSequenceRef.current = loadSequence
    setLoading(true)
    setLoadFailed(false)
    setErrorRequestId(null)
    try {
      const next = await api.activity.list({
        ...(typeFilter === 'all' ? {} : { type: typeFilter }),
        ...(statusFilter === 'all' ? {} : { status: statusFilter }),
        ...(actorFilter === 'all' ? {} : { actor: actorFilter }),
        limit: 200,
        offset: 0,
      })
      if (loadSequence !== loadSequenceRef.current) return
      setItems(next)
    } catch (error) {
      if (loadSequence !== loadSequenceRef.current) return
      setLoadFailed(true)
      setErrorRequestId(error instanceof BridgeError ? (error.requestId ?? null) : null)
      onError(error, 'Không tải được timeline hoạt động.')
    } finally {
      if (loadSequence === loadSequenceRef.current) setLoading(false)
    }
  }, [actorFilter, onError, statusFilter, typeFilter])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="activity-page" aria-labelledby="activity-title">
      <header className="activity-header">
        <div>
          <p className="today-eyebrow">Dấu vết tác tử</p>
          <h1 id="activity-title">Hoạt động</h1>
          <p className="muted">
            Timeline này chỉ hiển thị metadata an toàn: không có secret, payload thô hay nội dung
            memory nhạy cảm.
          </p>
        </div>
      </header>

      <section className="panel activity-filters" aria-label="Bộ lọc hoạt động">
        <label className="field">
          <span>Loại hoạt động</span>
          <select
            className="input"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as ActivityType | 'all')}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Trạng thái</span>
          <select
            className="input"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ActivityStatus | 'all')}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Nguồn</span>
          <select
            className="input"
            value={actorFilter}
            onChange={(event) => setActorFilter(event.target.value as ActivityActor | 'all')}
          >
            {ACTOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="panel activity-panel">
        {loading ? (
          <p className="muted" role="status">
            Đang tải hoạt động…
          </p>
        ) : loadFailed ? (
          <div className="today-empty">
            <p>Không tải được hoạt động với bộ lọc hiện tại.</p>
            {errorRequestId !== null && (
              <p className="muted small">
                Mã yêu cầu: <code>{errorRequestId}</code>
              </p>
            )}
            <button type="button" className="btn" onClick={() => void load()}>
              Thử lại
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="today-empty">
            <p>Chưa có hoạt động nào khớp bộ lọc này.</p>
          </div>
        ) : (
          <ol className="activity-list" aria-label="Timeline hoạt động">
            {items.map((event) => (
              <li key={event.id} className="activity-item">
                <div className="activity-item-head">
                  <div>
                    <strong>{labelForActivityAction(event.action)}</strong>
                    <p className="muted small">{labelForActivityType(event.type)}</p>
                  </div>
                  <span className={`commitment-attention activity-status status-${event.status}`}>
                    {labelForActivityStatus(event.status)}
                  </span>
                </div>
                <dl className="activity-meta">
                  <div>
                    <dt>Thời điểm</dt>
                    <dd>{formatActivityTimestamp(event.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Đối tượng</dt>
                    <dd>{formatSubject(event)}</dd>
                  </div>
                  <div>
                    <dt>Nguồn</dt>
                    <dd>{labelForActivityActor(event.actor)}</dd>
                  </div>
                  <div>
                    <dt>Request ID</dt>
                    <dd>{event.requestId ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Operation ID</dt>
                    <dd>{event.operationId ?? '—'}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  )
}
