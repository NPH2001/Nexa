import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CheckInSuggestion,
  Commitment,
  CommitmentStatus,
  Conversation,
} from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { commitThenRefresh } from '../committed-mutation.js'
import { DestructiveActionDialog } from './DestructiveActionDialog.js'
import type { Toast } from './Toasts.js'
import {
  dateTimeLocalToIso,
  formatCommitmentDate,
  getCommitmentAttention,
  toDateTimeLocalValue,
} from './commitment-ui.js'

interface CommitmentDraft {
  readonly title: string
  readonly nextAction: string
  readonly status: CommitmentStatus
  readonly dueAt: string
  readonly checkInAt: string
  readonly sourceConversationId: string
}

const STATUS_LABELS: Record<CommitmentStatus, string> = {
  active: 'Đang thực hiện',
  blocked: 'Đang bị chặn',
  paused: 'Tạm dừng',
  completed: 'Hoàn thành',
}

const emptyDraft = (): CommitmentDraft => ({
  title: '',
  nextAction: '',
  status: 'active',
  dueAt: '',
  checkInAt: '',
  sourceConversationId: '',
})

export function GoalPanel(props: {
  conversations: readonly Conversation[]
  onOpenConversation: (id: string) => void
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const { onError } = props
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [checkIns, setCheckIns] = useState<CheckInSuggestion[]>([])
  const [draft, setDraft] = useState<CommitmentDraft>(() => emptyDraft())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Commitment | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [titleTouched, setTitleTouched] = useState(false)
  const titleRef = useRef<HTMLInputElement | null>(null)

  const activeCommitments = commitments.filter((item) => item.status !== 'completed')
  const completedCommitments = commitments.filter((item) => item.status === 'completed')
  const conversationMap = new Map(props.conversations.map((item) => [item.id, item]))
  const validationMessage = validateDraft(draft)
  const mutedCommitmentIds = new Set(
    checkIns.filter((item) => item.state === 'muted').map((item) => item.commitmentId),
  )

  const refreshCommitments = useCallback(async (): Promise<void> => {
    const [nextCommitments, nextCheckIns] = await Promise.all([
      api.commitments.list(true),
      api.checkIns.list(),
    ])
    setCommitments(nextCommitments)
    setCheckIns(nextCheckIns.suggestions)
    setLoadError(false)
  }, [])

  const reload = useCallback(async (): Promise<void> => {
    try {
      await refreshCommitments()
    } catch (error) {
      setLoadError(true)
      onError(error, 'Không tải được mục tiêu và cam kết.')
      throw error
    } finally {
      setLoading(false)
    }
  }, [onError, refreshCommitments])

  useEffect(() => {
    void reload().catch(() => undefined)
  }, [reload])

  useEffect(() => {
    if (editingId !== null) titleRef.current?.focus()
  }, [editingId])

  const resetForm = (): void => {
    setDraft(emptyDraft())
    setEditingId(null)
    setTitleTouched(false)
  }

  const startEditing = (commitment: Commitment): void => {
    setEditingId(commitment.id)
    setTitleTouched(false)
    setDraft({
      title: commitment.title,
      nextAction: commitment.nextAction ?? '',
      status: commitment.status,
      dueAt: toDateTimeLocalValue(commitment.dueAt),
      checkInAt: toDateTimeLocalValue(commitment.checkInAt),
      sourceConversationId: commitment.sourceConversationId ?? '',
    })
  }

  const submit = (): void => {
    if (validationMessage !== null || busyAction !== null) return
    const payload = {
      title: draft.title.trim(),
      nextAction: draft.nextAction.trim() === '' ? null : draft.nextAction.trim(),
      status: draft.status,
      dueAt: dateTimeLocalToIso(draft.dueAt),
      checkInAt: dateTimeLocalToIso(draft.checkInAt),
      sourceConversationId:
        draft.sourceConversationId.trim() === '' ? null : draft.sourceConversationId,
    } as const

    void (async () => {
      const targetId = editingId
      const actionKey = targetId === null ? 'create' : `save:${targetId}`
      setBusyAction(actionKey)
      try {
        await commitThenRefresh({
          commit: () =>
            targetId === null
              ? api.commitments.create(payload)
              : api.commitments.update(targetId, payload),
          onCommitted: () => {
            resetForm()
            props.onToast({
              kind: 'success',
              title: targetId === null ? 'Đã tạo cam kết.' : 'Đã cập nhật cam kết.',
            })
          },
          refresh: refreshCommitments,
          onRefreshError: () =>
            props.onToast({
              kind: 'warning',
              title: 'Đã lưu cam kết nhưng chưa làm mới được danh sách.',
            }),
        })
      } catch (error) {
        props.onError(
          error,
          targetId === null ? 'Không tạo được cam kết.' : 'Không cập nhật được cam kết.',
        )
      } finally {
        setBusyAction(null)
      }
    })()
  }

  const setStatus = (commitment: Commitment, status: CommitmentStatus): void => {
    void (async () => {
      const actionKey = `status:${commitment.id}`
      setBusyAction(actionKey)
      try {
        await commitThenRefresh({
          commit: () => api.commitments.update(commitment.id, { status }),
          onCommitted: () =>
            props.onToast({
              kind: 'success',
              title: status === 'completed' ? 'Đã hoàn thành cam kết.' : 'Đã mở lại cam kết.',
            }),
          refresh: refreshCommitments,
          onRefreshError: () =>
            props.onToast({
              kind: 'warning',
              title: 'Đã đổi trạng thái nhưng chưa làm mới được danh sách.',
            }),
        })
      } catch (error) {
        props.onError(error, 'Không đổi được trạng thái cam kết.')
      } finally {
        setBusyAction(null)
      }
    })()
  }

  const remove = (): void => {
    if (deleteTarget === null || busyAction !== null) return
    const target = deleteTarget
    void (async () => {
      setBusyAction(`delete:${target.id}`)
      try {
        await commitThenRefresh({
          commit: () => api.commitments.remove(target.id),
          onCommitted: () => {
            setCommitments((current) => current.filter((item) => item.id !== target.id))
            setDeleteTarget(null)
            if (editingId === target.id) resetForm()
            props.onToast({ kind: 'success', title: 'Đã xoá vĩnh viễn cam kết.' })
          },
          refresh: refreshCommitments,
          onRefreshError: () =>
            props.onToast({
              kind: 'warning',
              title: 'Đã xoá cam kết nhưng chưa làm mới được danh sách.',
            }),
        })
      } catch (error) {
        props.onError(error, 'Không xoá được cam kết.')
      } finally {
        setBusyAction(null)
      }
    })()
  }

  const unmuteCommitment = (commitment: Commitment): void => {
    void (async () => {
      const actionKey = `unmute:${commitment.id}`
      setBusyAction(actionKey)
      try {
        await commitThenRefresh({
          commit: () => api.checkIns.unmute(commitment.id),
          onCommitted: () =>
            props.onToast({
              kind: 'success',
              title: 'Đã bật lại nhắc việc cho cam kết.',
            }),
          refresh: refreshCommitments,
          onRefreshError: () =>
            props.onToast({
              kind: 'warning',
              title: 'Đã bật lại nhắc việc nhưng chưa làm mới được danh sách.',
            }),
        })
      } catch (error) {
        props.onError(error, 'Không bật lại được nhắc việc cho cam kết.')
      } finally {
        setBusyAction(null)
      }
    })()
  }

  return (
    <div className="goals-page">
      <header className="goals-header">
        <div>
          <p className="today-eyebrow">Continuity có chủ đích</p>
          <h1>Mục tiêu &amp; cam kết</h1>
          <p className="muted">
            Nexa chỉ theo dõi những cam kết bạn tự tạo. Chat và memory không tự biến thành nghĩa vụ.
          </p>
        </div>
        <div className="goal-stats" aria-label="Thống kê cam kết">
          <span className="tag">{String(activeCommitments.length)} đang theo</span>
          <span className="tag">{String(completedCommitments.length)} hoàn thành</span>
        </div>
      </header>

      <section className="panel goal-editor" aria-labelledby="goal-editor-title">
        <h2 id="goal-editor-title">{editingId === null ? 'Tạo cam kết mới' : 'Sửa cam kết'}</h2>
        <div className="goal-form">
          <label className="field goal-form-full">
            <span>Kết quả muốn đạt ({String(draft.title.length)}/200)</span>
            <input
              ref={titleRef}
              className="input"
              maxLength={200}
              value={draft.title}
              placeholder="Ví dụ: Hoàn tất kế hoạch pilot Nexa cho phòng Vận hành"
              onBlur={() => setTitleTouched(true)}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
            />
          </label>

          <label className="field goal-form-full">
            <span>Bước tiếp theo ({String(draft.nextAction.length)}/500)</span>
            <textarea
              className="input goal-next-action"
              maxLength={500}
              rows={3}
              value={draft.nextAction}
              placeholder="Một hành động cụ thể đủ nhỏ để bắt đầu"
              onChange={(event) =>
                setDraft((current) => ({ ...current, nextAction: event.target.value }))
              }
            />
          </label>

          <label className="field">
            <span>Trạng thái</span>
            <select
              className="input"
              value={draft.status}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  status: event.target.value as CommitmentStatus,
                }))
              }
            >
              {(Object.keys(STATUS_LABELS) as CommitmentStatus[]).map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Hội thoại nguồn</span>
            <select
              className="input"
              value={draft.sourceConversationId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  sourceConversationId: event.target.value,
                }))
              }
            >
              <option value="">Không gắn hội thoại</option>
              {props.conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.title}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Hạn hoàn thành</span>
            <input
              className="input"
              type="datetime-local"
              value={draft.dueAt}
              onChange={(event) =>
                setDraft((current) => ({ ...current, dueAt: event.target.value }))
              }
            />
          </label>

          <label className="field">
            <span>Thời điểm check-in</span>
            <input
              className="input"
              type="datetime-local"
              value={draft.checkInAt}
              onChange={(event) =>
                setDraft((current) => ({ ...current, checkInAt: event.target.value }))
              }
            />
          </label>

          {titleTouched && validationMessage !== null && (
            <p className="error-inline goal-form-full">{validationMessage}</p>
          )}

          <div className="actions goal-form-full">
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={validationMessage !== null || busyAction !== null}
            >
              {busyAction === 'create'
                ? 'Đang tạo…'
                : busyAction?.startsWith('save:')
                  ? 'Đang cập nhật…'
                  : editingId === null
                    ? 'Tạo cam kết'
                    : 'Lưu thay đổi'}
            </button>
            {editingId !== null && (
              <button
                type="button"
                className="btn"
                onClick={resetForm}
                disabled={busyAction !== null}
              >
                Huỷ sửa
              </button>
            )}
          </div>
        </div>
      </section>

      {loading ? (
        <section className="panel">
          <p className="muted" role="status">
            Đang tải cam kết…
          </p>
        </section>
      ) : loadError ? (
        <section className="panel danger-zone">
          <h2>Không tải được cam kết</h2>
          <button
            type="button"
            className="btn"
            onClick={() => void reload().catch(() => undefined)}
          >
            Thử lại
          </button>
        </section>
      ) : (
        <>
          <CommitmentSection
            title="Đang theo dõi"
            empty="Chưa có cam kết nào. Hãy bắt đầu bằng một kết quả bạn thật sự muốn tiếp tục qua nhiều phiên làm việc."
            items={activeCommitments}
            mutedCommitmentIds={mutedCommitmentIds}
            conversations={conversationMap}
            busyAction={busyAction}
            onEdit={startEditing}
            onStatus={setStatus}
            onDelete={setDeleteTarget}
            onUnmute={unmuteCommitment}
            onOpenConversation={props.onOpenConversation}
          />
          <CommitmentSection
            title="Đã hoàn thành"
            empty="Chưa có cam kết hoàn thành."
            items={completedCommitments}
            mutedCommitmentIds={mutedCommitmentIds}
            conversations={conversationMap}
            busyAction={busyAction}
            onEdit={startEditing}
            onStatus={setStatus}
            onDelete={setDeleteTarget}
            onUnmute={unmuteCommitment}
            onOpenConversation={props.onOpenConversation}
          />
        </>
      )}

      {deleteTarget !== null && (
        <DestructiveActionDialog
          title="Xoá vĩnh viễn cam kết?"
          description={`“${deleteTarget.title}” sẽ bị xoá khỏi máy. Nếu chỉ chưa muốn theo dõi lúc này, hãy dùng trạng thái Tạm dừng.`}
          confirmLabel="Xoá cam kết"
          busy={busyAction === `delete:${deleteTarget.id}`}
          onConfirm={remove}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function CommitmentSection(props: {
  title: string
  empty: string
  items: readonly Commitment[]
  mutedCommitmentIds: ReadonlySet<string>
  conversations: ReadonlyMap<string, Conversation>
  busyAction: string | null
  onEdit: (commitment: Commitment) => void
  onStatus: (commitment: Commitment, status: CommitmentStatus) => void
  onDelete: (commitment: Commitment) => void
  onUnmute: (commitment: Commitment) => void
  onOpenConversation: (id: string) => void
}): React.JSX.Element {
  return (
    <section className="panel goal-section">
      <h2>{props.title}</h2>
      {props.items.length === 0 ? (
        <p className="muted small">{props.empty}</p>
      ) : (
        <ul className="goal-list" aria-label={props.title}>
          {props.items.map((commitment) => {
            const attention = getCommitmentAttention(commitment)
            const source =
              commitment.sourceConversationId === null
                ? null
                : (props.conversations.get(commitment.sourceConversationId) ?? null)
            const muted = props.mutedCommitmentIds.has(commitment.id)
            return (
              <li key={commitment.id} className="goal-card">
                <div className="goal-card-head">
                  <div className="goal-title-wrap">
                    <div className="goal-tags">
                      <span className={`commitment-attention attention-${attention.tone}`}>
                        {commitment.status === 'completed'
                          ? STATUS_LABELS.completed
                          : attention.label}
                      </span>
                      {muted && <span className="tag">Đã tắt nhắc</span>}
                      {commitment.createdBy === 'agent' && (
                        <span className="tag" title="Nexa đề xuất, bạn đã xác nhận">
                          Nexa đề xuất
                        </span>
                      )}
                    </div>
                    <h3>{commitment.title}</h3>
                  </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => props.onEdit(commitment)}
                      disabled={props.busyAction !== null}
                    >
                      Sửa
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() =>
                        props.onStatus(
                          commitment,
                          commitment.status === 'completed' ? 'active' : 'completed',
                        )
                      }
                      disabled={props.busyAction !== null}
                    >
                      {props.busyAction === `status:${commitment.id}`
                        ? 'Đang cập nhật…'
                        : commitment.status === 'completed'
                          ? 'Mở lại'
                          : 'Hoàn thành'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={() => props.onDelete(commitment)}
                      disabled={props.busyAction !== null}
                    >
                      Xoá
                    </button>
                    {muted && (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => props.onUnmute(commitment)}
                        disabled={props.busyAction !== null}
                      >
                        {props.busyAction === `unmute:${commitment.id}`
                          ? 'Đang bật lại…'
                          : 'Bật lại nhắc'}
                      </button>
                    )}
                  </div>
                </div>

                {commitment.nextAction !== null && (
                  <p className="goal-next">
                    <strong>Bước tiếp:</strong> {commitment.nextAction}
                  </p>
                )}

                <dl className="goal-meta">
                  <div>
                    <dt>Hạn</dt>
                    <dd>{formatCommitmentDate(commitment.dueAt)}</dd>
                  </div>
                  <div>
                    <dt>Check-in</dt>
                    <dd>{formatCommitmentDate(commitment.checkInAt)}</dd>
                  </div>
                  <div>
                    <dt>Nguồn</dt>
                    <dd>
                      {commitment.sourceConversationId === null ? (
                        'Không gắn hội thoại'
                      ) : source === null ? (
                        'Hội thoại nguồn đã bị xoá'
                      ) : (
                        <button
                          type="button"
                          className="link"
                          onClick={() => props.onOpenConversation(source.id)}
                        >
                          {source.title}
                        </button>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Cập nhật</dt>
                    <dd>{formatCommitmentDate(commitment.updatedAt)}</dd>
                  </div>
                </dl>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function validateDraft(draft: CommitmentDraft): string | null {
  if (draft.title.trim() === '') return 'Kết quả muốn đạt không được để trống.'
  if (draft.title.trim().length > 200) return 'Kết quả muốn đạt tối đa 200 ký tự.'
  if (draft.nextAction.trim().length > 500) return 'Bước tiếp theo tối đa 500 ký tự.'
  return null
}
