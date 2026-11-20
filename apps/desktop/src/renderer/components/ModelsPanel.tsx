import { useState } from 'react'
import {
  PROVIDER_LABELS,
  isExternalProvider,
  isProviderAllowedByPolicy,
} from '@nexa/shared-types/renderer'
import type { LlmProvider, ModelConfig } from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { commitThenRefresh } from '../committed-mutation.js'
import { DestructiveActionDialog } from './DestructiveActionDialog.js'
import type { Toast } from './Toasts.js'

export function ModelsPanel(props: {
  models: readonly ModelConfig[]
  allowDirectOpenAi: boolean
  onChanged: (models: ModelConfig[]) => void
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const [provider, setProvider] = useState<LlmProvider>('litellm')
  const [modelId, setModelId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [contextWindow, setContextWindow] = useState(128_000)
  const [supportsVision, setSupportsVision] = useState(false)
  const [modelToDelete, setModelToDelete] = useState<ModelConfig | null>(null)
  const [deletingModel, setDeletingModel] = useState(false)

  const refresh = async (): Promise<void> => props.onChanged(await api.models.list())

  const removeModel = (): void => {
    if (modelToDelete === null || deletingModel) return
    void (async () => {
      setDeletingModel(true)
      try {
        const model = modelToDelete
        await commitThenRefresh({
          commit: () => api.models.remove(model.id),
          onCommitted: () => {
            props.onChanged(props.models.filter((item) => item.id !== model.id))
            setModelToDelete(null)
            props.onToast({ kind: 'success', title: `Đã xoá model ${model.displayName}.` })
          },
          refresh,
          onRefreshError: () =>
            props.onToast({
              kind: 'warning',
              title: 'Đã xoá model nhưng chưa làm mới được danh sách.',
            }),
        })
      } catch (error) {
        props.onError(error, 'Không xoá được model.')
      } finally {
        setDeletingModel(false)
      }
    })()
  }

  return (
    <>
      <section className="panel">
        <h2>Model</h2>
        <p className="muted">
          Thêm những model bạn được phép dùng. Danh sách này chỉ để chọn nhanh — quyền thực tế do
          endpoint tương ứng và chính sách của tổ chức quyết định.
        </p>

        <div className="model-add">
          <select
            className="input input-compact"
            value={provider}
            onChange={(e) => setProvider(e.target.value as LlmProvider)}
            aria-label="Provider"
          >
            {Object.entries(PROVIDER_LABELS)
              .filter(([value]) => value !== 'chatgpt')
              .filter(([value]) =>
                isProviderAllowedByPolicy(value as LlmProvider, {
                  allowDirectOpenAi: props.allowDirectOpenAi,
                }),
              )
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
          <input
            className="input"
            aria-label="Model ID"
            placeholder="Model id (ví dụ gpt-5.x-internal)"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          />
          <input
            className="input"
            aria-label="Tên hiển thị của model"
            placeholder="Tên hiển thị"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <input
            className="input input-compact"
            type="number"
            aria-label="Cửa sổ ngữ cảnh theo token"
            min={1024}
            step={1024}
            value={contextWindow}
            onChange={(e) => setContextWindow(Number(e.target.value))}
            title="Cửa sổ ngữ cảnh (token)"
          />
          <label className="checkbox" title="Model này đọc được ảnh đính kèm trong câu hỏi">
            <input
              type="checkbox"
              checked={supportsVision}
              onChange={(e) => setSupportsVision(e.target.checked)}
            />
            Đọc được ảnh
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={modelId.trim() === ''}
            onClick={() => {
              void (async () => {
                try {
                  await api.models.add({
                    provider,
                    modelId: modelId.trim(),
                    displayName: displayName.trim() === '' ? modelId.trim() : displayName.trim(),
                    contextWindowTokens: contextWindow,
                    supportsVision,
                  })
                  setModelId('')
                  setDisplayName('')
                  setSupportsVision(false)
                  await refresh()
                } catch (error) {
                  props.onError(error, 'Không thêm được model.')
                }
              })()
            }}
          >
            Thêm
          </button>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Provider</th>
              <th>Ngữ cảnh</th>
              <th>Ảnh</th>
              <th>Trạng thái</th>
              <th scope="col">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {props.models.map((model) => (
              <tr key={model.id}>
                <td>
                  <strong>{model.displayName}</strong>
                  <br />
                  <code className="muted small">{model.modelId}</code>
                  {model.isDefault && <span className="tag">mặc định</span>}
                </td>
                <td>
                  {isExternalProvider(model.provider) ? (
                    <>
                      <span className="external-tag">{PROVIDER_LABELS[model.provider]}</span>
                      {!props.allowDirectOpenAi && <span className="tag">bị policy khoá</span>}
                    </>
                  ) : (
                    <span className="muted small">{PROVIDER_LABELS[model.provider]}</span>
                  )}
                </td>
                <td>{model.contextWindowTokens.toLocaleString('vi-VN')} token</td>
                <td>
                  {model.supportsVision ? (
                    <span className="ok">✓ đọc được</span>
                  ) : (
                    <span className="muted">chỉ văn bản</span>
                  )}
                </td>
                <td>
                  {model.verified ? (
                    <span className="ok">✓ đã kiểm chứng</span>
                  ) : (
                    <span className="muted">chưa kiểm chứng</span>
                  )}
                </td>
                <td className="row-actions">
                  {!model.isDefault && (
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={
                        !isProviderAllowedByPolicy(model.provider, {
                          allowDirectOpenAi: props.allowDirectOpenAi,
                        })
                      }
                      onClick={() => {
                        void api.models
                          .setDefault(model.id)
                          .then(refresh)
                          .catch((e: unknown) => props.onError(e, 'Không đặt được model mặc định.'))
                      }}
                    >
                      Đặt mặc định
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    onClick={() => setModelToDelete(model)}
                  >
                    Xoá
                  </button>
                </td>
              </tr>
            ))}
            {props.models.length === 0 && (
              <tr>
                <td colSpan={5} className="muted center">
                  Chưa có model nào. Hãy thêm ít nhất một model để bắt đầu chat.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <button
          type="button"
          className="btn"
          onClick={() => {
            void (async () => {
              try {
                // Mỗi provider có endpoint /v1/models riêng — kiểm chứng theo provider đang chọn.
                const result = await api.models.verifyAll(provider)
                await refresh()
                props.onToast({
                  kind: result.unknown.length === 0 ? 'success' : 'warning',
                  title: `Đã kiểm chứng ${String(result.verified.length)} model`,
                  detail:
                    result.unknown.length === 0
                      ? undefined
                      : `Không tìm thấy ở ${PROVIDER_LABELS[provider]}: ${result.unknown.join(', ')}`,
                })
              } catch (error) {
                props.onError(error, 'Không kiểm chứng được model.')
              }
            })()
          }}
        >
          Kiểm chứng với {PROVIDER_LABELS[provider]}
        </button>
      </section>

      {modelToDelete !== null && (
        <DestructiveActionDialog
          title="Xoá model?"
          description={`Model “${modelToDelete.displayName}” sẽ bị xoá khỏi danh sách lựa chọn. Các hội thoại cũ không bị xoá.`}
          confirmLabel="Xoá model"
          busy={deletingModel}
          onConfirm={removeModel}
          onCancel={() => setModelToDelete(null)}
        />
      )}
    </>
  )
}
