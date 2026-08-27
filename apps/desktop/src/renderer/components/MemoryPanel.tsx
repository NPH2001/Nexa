import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type Conversation,
  type MemoryFact,
  type MemoryFactKind,
  type MemoryFactScope,
} from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { commitThenRefresh } from '../committed-mutation.js'
import { getMemoryLimitState, validateMemoryDraft } from './MemoryPanel.helpers.js'
import { DestructiveActionDialog } from './DestructiveActionDialog.js'
import type { Toast } from './Toasts.js'

interface MemoryDraft {
  readonly content: string
  readonly kind: MemoryFactKind
  readonly scope: MemoryFactScope
  readonly sourceConversationId: string
  readonly allowExternal: boolean
}

const MEMORY_KIND_OPTIONS: readonly MemoryFactKind[] = [
  'identity',
  'preference',
  'goal',
  'constraint',
  'note',
] as const

const KIND_LABELS: Record<MemoryFactKind, string> = {
  identity: 'Nhận diện',
  preference: 'Sở thích',
  goal: 'Mục tiêu',
  constraint: 'Ràng buộc',
  note: 'Ghi chú',
}

const emptyDraft = (): MemoryDraft => ({
  content: '',
  kind: 'preference',
  scope: 'global',
  sourceConversationId: '',
  allowExternal: false,
})

export function MemoryPanel(props: {
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const { onError } = props
  const [memories, setMemories] = useState<MemoryFact[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [draft, setDraft] = useState<MemoryDraft>(() => emptyDraft())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MemoryFact | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const conversationMap = new Map(conversations.map((item) => [item.id, item]))
  const activeMemories = memories.filter((item) => item.status === 'active')
  const archivedMemories = memories.filter((item) => item.status === 'archived')
  const limitState = getMemoryLimitState(activeMemories.length)
  const validationMessage = validateMemoryDraft(draft)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError(null)
    try {
      const [memoryResult, conversationResult] = await Promise.all([
        api.memory.list(true),
        api.conversations.list(true),
      ])
      setMemories(memoryResult)
      setConversations(conversationResult)
    } catch (error) {
      setLoadError('Không tải được memory của Nexa.')
      onError(error, 'Không tải được memory của Nexa.')
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (editingId !== null) textareaRef.current?.focus()
  }, [editingId])

  const resetForm = (): void => {
    setDraft(emptyDraft())
    setEditingId(null)
  }

  const populateDraft = (fact: MemoryFact): void => {
    setEditingId(fact.id)
    setDraft({
      content: fact.content,
      kind: fact.kind,
      scope: fact.scope,
      sourceConversationId: fact.sourceConversationId ?? '',
      allowExternal: fact.sharingPolicy === 'allow_external',
    })
  }

  const submit = (): void => {
    if (validationMessage !== null || busyAction !== null) return
    const now = new Date().toISOString()
    const payload = {
      content: draft.content.trim(),
      kind: draft.kind,
      scope: draft.scope,
      sharingPolicy: draft.allowExternal ? 'allow_external' : 'internal_only',
      sourceConversationId:
        draft.sourceConversationId.trim() === '' ? null : draft.sourceConversationId,
      lastConfirmedAt: now,
    } as const

    void (async () => {
      setBusyAction(editingId === null ? 'create' : `save:${editingId}`)
      try {
        if (editingId === null) {
          await api.memory.create(payload)
          props.onToast({ kind: 'success', title: 'Đã lưu memory cho Nexa.' })
        } else {
          await api.memory.update(editingId, payload)
          props.onToast({ kind: 'success', title: 'Đã cập nhật memory.' })
        }
        resetForm()
        await reload()
      } catch (error) {
        props.onError(
          error,
          editingId === null ? 'Không tạo được memory.' : 'Không cập nhật được memory.',
        )
      } finally {
        setBusyAction(null)
      }
    })()
  }

  const archive = (fact: MemoryFact): void => {
    void mutateFact(
      `archive:${fact.id}`,
      () => api.memory.archive(fact.id),
      'Đã archive memory.',
      reload,
    )
  }

  const restore = (fact: MemoryFact): void => {
    void mutateFact(
      `restore:${fact.id}`,
      () => api.memory.restore(fact.id),
      'Đã khôi phục memory.',
      reload,
    )
  }

  const remove = (): void => {
    if (deleteTarget === null) return
    const target = deleteTarget
    void mutateFact(
      `delete:${target.id}`,
      () =>
        commitThenRefresh({
          commit: () => api.memory.remove(target.id),
          refresh: reload,
          onCommitted: () => {
            setDeleteTarget(null)
            if (editingId === target.id) resetForm()
            props.onToast({ kind: 'success', title: 'Đã xoá vĩnh viễn memory.' })
          },
          onRefreshError: () =>
            props.onToast({
              kind: 'warning',
              title: 'Đã xoá memory nhưng chưa làm mới được danh sách.',
            }),
        }),
      '',
      async () => undefined,
    )
  }

  if (loading) {
    return (
      <section className="panel">
        <h2>Nexa nhớ</h2>
        <p className="muted">Đang tải memory…</p>
      </section>
    )
  }

  return (
    <>
      <section className="panel">
        <div className="memory-panel-head">
          <div>
            <h2>Nexa nhớ</h2>
            <p className="muted">
              Nexa không tự nhớ điều gì cả. Chỉ những memory bạn tạo hoặc xác nhận ở đây mới được
              cân nhắc chèn vào các prompt về sau.
            </p>
          </div>
          <div className="memory-stats" aria-label="Thống kê memory">
            <span className="tag">{String(activeMemories.length)} active</span>
            <span className="tag">{String(archivedMemories.length)} archived</span>
          </div>
        </div>

        <p
          className={
            limitState.tone === 'danger'
              ? 'external-warning'
              : limitState.tone === 'warning'
                ? 'warning-inline'
                : 'muted small'
          }
        >
          {limitState.message}
        </p>
        <p className="muted small">
          Memory có `Chỉ nội bộ` sẽ không được gửi tới provider bên ngoài tổ chức. Memory có `Cho
          phép provider ngoài` chỉ nên chứa thông tin bạn chấp nhận mang ra khỏi hạ tầng nội bộ.
        </p>
      </section>

      <section className="panel">
        <h2>{editingId === null ? 'Thêm memory mới' : 'Sửa memory'}</h2>
        <div className="memory-form">
          <label className="field memory-form-full">
            <span>Nội dung nhớ ({String(draft.content.length)}/500)</span>
            <textarea
              ref={textareaRef}
              className="input memory-textarea"
              maxLength={500}
              rows={4}
              value={draft.content}
              placeholder="Ví dụ: Gọi tôi là Nhi. Tôi ưu tiên câu trả lời ngắn, có checklist."
              onChange={(event) =>
                setDraft((current) => ({ ...current, content: event.target.value }))
              }
            />
          </label>

          <label className="field">
            <span>Loại memory</span>
            <select
              className="input"
              value={draft.kind}
              onChange={(event) =>
                setDraft((current) => ({ ...current, kind: event.target.value as MemoryFactKind }))
              }
            >
              {MEMORY_KIND_OPTIONS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Phạm vi</span>
            <select
              className="input"
              value={draft.scope}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  scope: event.target.value as MemoryFactScope,
                  sourceConversationId:
                    event.target.value === 'global'
                      ? current.sourceConversationId
                      : current.sourceConversationId,
                }))
              }
            >
              <option value="global">Toàn cục</option>
              <option value="conversation">Chỉ một hội thoại</option>
            </select>
          </label>

          <label className="field memory-form-full">
            <span>
              {draft.scope === 'conversation'
                ? 'Hội thoại áp dụng'
                : 'Hội thoại nguồn (không bắt buộc)'}
            </span>
            <select
              className="input"
              value={draft.sourceConversationId}
              onChange={(event) =>
                setDraft((current) => ({ ...current, sourceConversationId: event.target.value }))
              }
            >
              <option value="">
                {draft.scope === 'conversation' ? 'Chọn hội thoại' : 'Không gắn provenance'}
              </option>
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.title}
                  {conversation.archivedAt !== null ? ' (archived)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="checkbox memory-form-full">
            <input
              type="checkbox"
              checked={draft.allowExternal}
              onChange={(event) =>
                setDraft((current) => ({ ...current, allowExternal: event.target.checked }))
              }
            />
            <span>
              Cho phép provider ngoài tổ chức dùng memory này
              <span className="muted small"> — mặc định tắt để giữ memory chỉ ở đường nội bộ</span>
            </span>
          </label>

          {draft.allowExternal && (
            <p className="external-warning">
              Bạn đang chọn cho phép memory này đi cùng prompt tới provider ngoài tổ chức nếu hội
              thoại dùng model bên ngoài. Chỉ bật khi nội dung này không nhạy cảm.
            </p>
          )}

          {validationMessage !== null && <p className="error-inline">{validationMessage}</p>}

          <div className="actions memory-form-full">
            <button
              type="button"
              className="btn btn-primary"
              disabled={validationMessage !== null || busyAction !== null}
              onClick={submit}
            >
              {busyAction === 'create'
                ? 'Đang lưu…'
                : busyAction?.startsWith('save:')
                  ? 'Đang cập nhật…'
                  : editingId === null
                    ? 'Lưu memory'
                    : 'Cập nhật memory'}
            </button>
            {editingId !== null && (
              <button
                type="button"
                className="btn"
                onClick={resetForm}
                disabled={busyAction !== null}
              >
                Hủy sửa
              </button>
            )}
          </div>
        </div>
      </section>

      <MemoryListSection
        title="Memory đang hoạt động"
        empty="Chưa có memory nào. Hãy bắt đầu bằng vài fact thật ngắn, ổn định và hữu ích."
        items={activeMemories}
        conversations={conversationMap}
        busyAction={busyAction}
        onEdit={populateDraft}
        onArchive={archive}
        onRestore={restore}
        onDelete={setDeleteTarget}
      />

      <MemoryListSection
        title="Memory đã archive"
        empty="Chưa có memory archived."
        items={archivedMemories}
        conversations={conversationMap}
        busyAction={busyAction}
        onEdit={populateDraft}
        onArchive={archive}
        onRestore={restore}
        onDelete={setDeleteTarget}
      />

      {loadError !== null && (
        <section className="panel danger-zone">
          <h2>Không tải được memory</h2>
          <p className="muted">{loadError}</p>
          <button type="button" className="btn" onClick={() => void reload()}>
            Tải lại
          </button>
        </section>
      )}

      {deleteTarget !== null && (
        <DestructiveActionDialog
          title="Xoá vĩnh viễn memory?"
          description="Memory này sẽ bị xoá khỏi máy và không còn được chèn vào các prompt sau này."
          confirmLabel="Xoá vĩnh viễn"
          busy={busyAction === `delete:${deleteTarget.id}`}
          onConfirm={remove}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  )

  async function mutateFact(
    actionKey: string,
    commit: () => Promise<unknown>,
    successTitle: string,
    afterSuccess: () => Promise<void>,
  ): Promise<void> {
    setBusyAction(actionKey)
    try {
      await commit()
      await afterSuccess()
      if (successTitle !== '') props.onToast({ kind: 'success', title: successTitle })
    } catch (error) {
      props.onError(error, 'Không cập nhật được memory.')
    } finally {
      setBusyAction(null)
    }
  }
}

function MemoryListSection(props: {
  title: string
  empty: string
  items: readonly MemoryFact[]
  conversations: ReadonlyMap<string, Conversation>
  busyAction: string | null
  onEdit: (fact: MemoryFact) => void
  onArchive: (fact: MemoryFact) => void
  onRestore: (fact: MemoryFact) => void
  onDelete: (fact: MemoryFact) => void
}): React.JSX.Element {
  return (
    <section className="panel">
      <h2>{props.title}</h2>
      {props.items.length === 0 ? (
        <p className="muted small">{props.empty}</p>
      ) : (
        <ul className="memory-list" aria-label={props.title}>
          {props.items.map((fact) => {
            const sourceConversation =
              fact.sourceConversationId === null
                ? null
                : (props.conversations.get(fact.sourceConversationId) ?? null)

            return (
              <li key={fact.id} className="memory-card">
                <div className="memory-card-head">
                  <div className="memory-tags">
                    <span className="tag">{KIND_LABELS[fact.kind]}</span>
                    <span className="tag">
                      {fact.scope === 'global' ? 'Toàn cục' : 'Theo hội thoại'}
                    </span>
                    <span
                      className={fact.sharingPolicy === 'allow_external' ? 'external-tag' : 'tag'}
                    >
                      {fact.sharingPolicy === 'allow_external'
                        ? 'Cho phép provider ngoài'
                        : 'Chỉ nội bộ'}
                    </span>
                    {fact.status === 'archived' && <span className="tag">archived</span>}
                  </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => props.onEdit(fact)}
                      disabled={props.busyAction !== null}
                    >
                      Sửa
                    </button>
                    {fact.status === 'active' ? (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => props.onArchive(fact)}
                        disabled={props.busyAction !== null}
                      >
                        {props.busyAction === `archive:${fact.id}` ? 'Đang archive…' : 'Archive'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => props.onRestore(fact)}
                        disabled={props.busyAction !== null}
                      >
                        {props.busyAction === `restore:${fact.id}`
                          ? 'Đang khôi phục…'
                          : 'Khôi phục'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={() => props.onDelete(fact)}
                      disabled={props.busyAction !== null}
                    >
                      Xoá
                    </button>
                  </div>
                </div>

                <p className="memory-content">{fact.content}</p>

                <dl className="memory-meta">
                  <div>
                    <dt>Cập nhật</dt>
                    <dd>{formatDateTime(fact.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>Xác nhận gần nhất</dt>
                    <dd>
                      {fact.lastConfirmedAt === null
                        ? 'Chưa có'
                        : formatDateTime(fact.lastConfirmedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>Provenance</dt>
                    <dd>
                      {fact.sourceConversationId === null
                        ? 'Không gắn hội thoại nguồn'
                        : (sourceConversation?.title ?? 'Hội thoại nguồn đã bị xoá')}
                    </dd>
                  </div>
                  <div>
                    <dt>Hiệu lực</dt>
                    <dd>
                      {fact.expiresAt === null ? 'Không đặt hạn' : formatDateTime(fact.expiresAt)}
                    </dd>
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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('vi-VN')
}
