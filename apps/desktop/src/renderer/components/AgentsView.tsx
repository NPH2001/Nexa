import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_ICONS } from '@nexa/shared-types/renderer'
import type { Agent, ChatGptModel, ModelConfig } from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { commitThenRefresh } from '../committed-mutation.js'
import { DestructiveActionDialog } from './DestructiveActionDialog.js'
import { EmptyState, InlineError, LoadingSkeleton } from './StateBlocks.js'
import type { Toast } from './Toasts.js'
import {
  AGENT_INSTRUCTIONS_LIMIT,
  AGENT_NAME_LIMIT,
  TOOL_CEILING_LABELS,
  TOOL_CEILING_OPTIONS,
  agentToDraft,
  describeToolCeiling,
  draftToPayload,
  emptyAgentDraft,
  shouldWarnExternalInstructions,
  toModelKey,
  validateAgentDraft,
  type AgentDraft,
} from './agent-ui.js'

/**
 * Màn hình quản lý agent tuỳ biến (openspec `add-custom-agents`).
 *
 * Agent chỉ THU HẸP: trần tool và công tắc nhóm cục bộ giới hạn thứ model nhìn thấy, không cấp
 * quyền mới. Mọi thao tác ghi vẫn phải qua xem trước và xác nhận như thường.
 */
export function AgentsView(props: {
  models: readonly ModelConfig[]
  chatGptModels: readonly ChatGptModel[]
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const { onError, onToast } = props
  const [agents, setAgents] = useState<Agent[]>([])
  const [draft, setDraft] = useState<AgentDraft>(() => emptyAgentDraft())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [nameTouched, setNameTouched] = useState(false)
  const nameRef = useRef<HTMLInputElement | null>(null)

  const validation = validateAgentDraft(draft)
  const activeAgents = agents.filter((agent) => !agent.archived)
  const archivedAgents = agents.filter((agent) => agent.archived)

  const modelChoices = [
    ...props.models.map((model) => ({
      key: `${model.provider}:${model.modelId}`,
      label: model.displayName === '' ? model.modelId : model.displayName,
    })),
    ...props.chatGptModels.map((model) => ({
      key: `chatgpt:${model.modelId}`,
      label: `${model.displayName} (ChatGPT)`,
    })),
  ]
  // Giữ model đã lưu của agent hiển thị được dù nó không còn trong danh sách đã cấu hình.
  const draftModelMissing =
    draft.modelKey !== '' && !modelChoices.some((choice) => choice.key === draft.modelKey)

  const reload = useCallback(async (): Promise<void> => {
    setAgents(await api.agents.list(true))
    setLoadError(false)
  }, [])

  useEffect(() => {
    setLoading(true)
    void reload()
      .catch((error: unknown) => {
        setLoadError(true)
        onError(error, 'Không tải được danh sách agent.')
      })
      .finally(() => setLoading(false))
  }, [reload, onError])

  useEffect(() => {
    if (editingId !== null) nameRef.current?.focus()
  }, [editingId])

  const resetForm = (): void => {
    setDraft(emptyAgentDraft())
    setEditingId(null)
    setNameTouched(false)
  }

  const startEditing = (agent: Agent): void => {
    setEditingId(agent.id)
    setNameTouched(false)
    setDraft(agentToDraft(agent))
  }

  const runMutation = (
    key: string,
    options: {
      commit: () => Promise<unknown>
      onCommitted: () => void
      committedToast: string
      failureMessage: string
    },
  ): void => {
    void (async () => {
      setBusy(key)
      try {
        await commitThenRefresh({
          commit: options.commit,
          onCommitted: () => {
            options.onCommitted()
            onToast({ kind: 'success', title: options.committedToast })
          },
          refresh: reload,
          onRefreshError: () =>
            onToast({
              kind: 'warning',
              title: `${options.committedToast} Nhưng chưa làm mới được danh sách.`,
            }),
        })
      } catch (error) {
        onError(error, options.failureMessage)
      } finally {
        setBusy(null)
      }
    })()
  }

  const save = (): void => {
    setNameTouched(true)
    if (validation !== null) return
    const payload = draftToPayload(draft)
    const target = editingId
    runMutation('save', {
      commit: () =>
        target === null ? api.agents.create(payload) : api.agents.update(target, payload),
      onCommitted: resetForm,
      committedToast: target === null ? 'Đã tạo agent.' : 'Đã lưu agent.',
      failureMessage: target === null ? 'Không tạo được agent.' : 'Không lưu được agent.',
    })
  }

  const toggleArchive = (agent: Agent): void =>
    runMutation(`archive:${agent.id}`, {
      commit: () => (agent.archived ? api.agents.restore(agent.id) : api.agents.archive(agent.id)),
      onCommitted: () => {
        if (editingId === agent.id) resetForm()
      },
      committedToast: agent.archived ? 'Đã khôi phục agent.' : 'Đã lưu trữ agent.',
      failureMessage: agent.archived ? 'Không khôi phục được agent.' : 'Không lưu trữ được agent.',
    })

  const confirmDelete = (): void => {
    const target = deleteTarget
    if (target === null) return
    runMutation(`delete:${target.id}`, {
      commit: () => api.agents.remove(target.id),
      onCommitted: () => {
        setDeleteTarget(null)
        if (editingId === target.id) resetForm()
      },
      committedToast: 'Đã xoá agent. Các hội thoại đang dùng nó về persona mặc định.',
      failureMessage: 'Không xoá được agent.',
    })
  }

  const showNameError = nameTouched && validation !== null
  const saving = busy === 'save'

  return (
    <div className="goals-page">
      <header className="goals-header">
        <div>
          <p className="today-eyebrow">Tuỳ biến có kiểm soát</p>
          <h1>Agent</h1>
          <p className="muted">
            Tạo agent với vai trò và phạm vi công cụ riêng. Agent chỉ thu hẹp những gì Nexa được
            dùng, không bao giờ cấp thêm quyền; thao tác ghi vẫn luôn cần bạn xác nhận.
          </p>
        </div>
        <div className="goal-stats" aria-label="Thống kê agent">
          <span className="tag">{String(activeAgents.length)} đang dùng</span>
          <span className="tag">{String(archivedAgents.length)} lưu trữ</span>
        </div>
      </header>

      <section className="panel goal-editor" aria-labelledby="agent-editor-title">
        <h2 id="agent-editor-title">{editingId === null ? 'Tạo agent mới' : 'Sửa agent'}</h2>
        <div className="goal-form">
          <label className="field goal-form-full">
            <span>
              Tên ({String(draft.name.length)}/{String(AGENT_NAME_LIMIT)})
            </span>
            <input
              ref={nameRef}
              className="input"
              maxLength={AGENT_NAME_LIMIT}
              value={draft.name}
              placeholder="Ví dụ: Trợ lý BA, Người rà soát tài liệu"
              onBlur={() => setNameTouched(true)}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>

          <fieldset className="field goal-form-full">
            <legend>Biểu tượng</legend>
            <div className="agent-icons" role="radiogroup" aria-label="Biểu tượng agent">
              {AGENT_ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  role="radio"
                  aria-checked={draft.icon === icon}
                  className={`btn btn-small ${draft.icon === icon ? 'btn-active' : ''}`}
                  onClick={() => setDraft((current) => ({ ...current, icon }))}
                >
                  {icon}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field goal-form-full">
            <span>
              Hướng dẫn ({String(draft.instructions.length)}/{String(AGENT_INSTRUCTIONS_LIMIT)})
            </span>
            <textarea
              className="input goal-next-action"
              maxLength={AGENT_INSTRUCTIONS_LIMIT}
              rows={5}
              value={draft.instructions}
              placeholder="Ví dụ: Luôn trả lời bằng bảng và nêu rõ nguồn trích dẫn."
              onChange={(event) =>
                setDraft((current) => ({ ...current, instructions: event.target.value }))
              }
            />
            <span className="muted small">
              Hướng dẫn được thêm vào sau các nguyên tắc an toàn của Nexa, không thay thế chúng.
            </span>
          </label>

          <label className="field">
            <span>Phạm vi công cụ tối đa</span>
            <select
              className="input"
              value={draft.toolCeiling}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  toolCeiling: event.target.value as AgentDraft['toolCeiling'],
                }))
              }
            >
              {TOOL_CEILING_OPTIONS.map((ceiling) => (
                <option key={ceiling} value={ceiling}>
                  {TOOL_CEILING_LABELS[ceiling]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Model mặc định</span>
            <select
              className="input"
              value={draft.modelKey}
              onChange={(event) =>
                setDraft((current) => ({ ...current, modelKey: event.target.value }))
              }
            >
              <option value="">Không đặt (dùng model của hội thoại)</option>
              {draftModelMissing && (
                <option value={draft.modelKey} disabled>
                  Model không còn khả dụng
                </option>
              )}
              {modelChoices.map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="field goal-form-full">
            <legend>Nhóm công cụ cục bộ</legend>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.commitments}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, commitments: event.target.checked }))
                }
              />
              <span>Đề xuất cam kết</span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.baWorkbench}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, baWorkbench: event.target.checked }))
                }
              />
              <span>Công cụ Nghiệp vụ (BA)</span>
            </label>
            <span className="muted small">
              Chỉ có tác dụng khi tính năng tương ứng đã được bật trong Cài đặt.
            </span>
          </fieldset>

          {showNameError && <p className="error-inline goal-form-full">{validation}</p>}

          {shouldWarnExternalInstructions(draft) && (
            <p className="state-text goal-form-full" role="note">
              Model này nằm ngoài tổ chức: hướng dẫn của agent sẽ được gửi đi cùng mỗi câu hỏi. Đừng
              đưa dữ liệu nhạy cảm vào hướng dẫn.
            </p>
          )}
        </div>

        <div className="actions goal-form-full">
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || validation !== null}
            onClick={save}
          >
            {saving ? 'Đang lưu…' : editingId === null ? 'Tạo agent' : 'Lưu thay đổi'}
          </button>
          {editingId !== null && (
            <button type="button" className="btn" disabled={saving} onClick={resetForm}>
              Huỷ sửa
            </button>
          )}
        </div>
      </section>

      {loading ? (
        <LoadingSkeleton label="Đang tải danh sách agent" variant="cards" />
      ) : loadError ? (
        <InlineError
          title="Không tải được danh sách agent"
          onRetry={() => {
            setLoading(true)
            void reload()
              .catch((error: unknown) => {
                setLoadError(true)
                onError(error, 'Không tải được danh sách agent.')
              })
              .finally(() => setLoading(false))
          }}
        />
      ) : agents.length === 0 ? (
        <EmptyState title="Chưa có agent nào">
          Tạo agent đầu tiên ở trên, rồi chọn nó trong khung chat để áp dụng cho hội thoại.
        </EmptyState>
      ) : (
        <>
          <AgentList
            title="Đang dùng"
            agents={activeAgents}
            busy={busy}
            onEdit={startEditing}
            onToggleArchive={toggleArchive}
            onDelete={setDeleteTarget}
          />
          {archivedAgents.length > 0 && (
            <AgentList
              title="Đã lưu trữ"
              agents={archivedAgents}
              busy={busy}
              onEdit={startEditing}
              onToggleArchive={toggleArchive}
              onDelete={setDeleteTarget}
            />
          )}
        </>
      )}

      {deleteTarget !== null && (
        <DestructiveActionDialog
          title="Xoá agent?"
          description={`“${deleteTarget.name}” sẽ bị xoá khỏi máy này. Các hội thoại đang dùng nó vẫn còn và chuyển về persona mặc định.`}
          confirmLabel="Xoá agent"
          busy={busy === `delete:${deleteTarget.id}`}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function AgentList(props: {
  title: string
  agents: readonly Agent[]
  busy: string | null
  onEdit: (agent: Agent) => void
  onToggleArchive: (agent: Agent) => void
  onDelete: (agent: Agent) => void
}): React.JSX.Element {
  return (
    <section className="panel goal-section">
      <h2>{props.title}</h2>
      {props.agents.length === 0 ? (
        <p className="muted">Không có agent nào.</p>
      ) : (
        <ul className="goal-list" aria-label={props.title}>
          {props.agents.map((agent) => (
            <li key={agent.id} className="goal-card">
              <div className="goal-card-head">
                <div className="goal-title-wrap">
                  <h3>
                    <span aria-hidden="true">{agent.icon}</span> {agent.name}
                  </h3>
                  <p className="muted small">{describeToolCeiling(agent.toolCeiling)}</p>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={props.busy !== null}
                    onClick={() => props.onEdit(agent)}
                  >
                    Sửa
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={props.busy !== null}
                    onClick={() => props.onToggleArchive(agent)}
                  >
                    {agent.archived ? 'Khôi phục' : 'Lưu trữ'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    disabled={props.busy !== null}
                    onClick={() => props.onDelete(agent)}
                  >
                    Xoá
                  </button>
                </div>
              </div>
              {agent.instructions.trim() !== '' && (
                <p className="goal-next">{agent.instructions}</p>
              )}
              {agent.modelId !== null && agent.modelProvider !== null && (
                <p className="muted small">Model: {toModelKey(agent)}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
