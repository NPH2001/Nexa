import { useCallback, useEffect, useState } from 'react'
import {
  PROVIDER_LABELS,
  RETENTION_CHOICES,
  isExternalProvider,
  isProviderAllowedByPolicy,
} from '@nexa/shared-types/renderer'
import type {
  AppSettings,
  Connection,
  ConnectionTestResult,
  ConnectionType,
  LlmProvider,
  ModelConfig,
  OrgPolicy,
} from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { commitThenRefresh } from '../committed-mutation.js'
import { DestructiveActionDialog } from './DestructiveActionDialog.js'
import type { Toast } from './Toasts.js'

type Tab = 'litellm' | 'openai' | 'models' | 'jira' | 'confluence' | 'mcpGateway' | 'data' | 'about'

const SETTINGS_TABS: readonly { id: Tab; label: string }[] = [
  { id: 'litellm', label: 'LiteLLM' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'models', label: 'Model' },
  { id: 'jira', label: 'Jira' },
  { id: 'confluence', label: 'Confluence' },
  { id: 'mcpGateway', label: 'MCP Gateway' },
  { id: 'data', label: 'Dữ liệu & quyền riêng tư' },
  { id: 'about', label: 'Chẩn đoán' },
]

export function SettingsView(props: {
  models: readonly ModelConfig[]
  settings: AppSettings | null
  policy: OrgPolicy | null
  onModelsChanged: (models: ModelConfig[]) => void
  onSettingsChanged: (settings: AppSettings) => void
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const { onError, onSettingsChanged } = props
  const [tab, setTab] = useState<Tab>('litellm')
  const [connections, setConnections] = useState<Connection[]>([])
  const [lockedFeatures, setLockedFeatures] = useState<string[]>([])
  const openAiAllowed = props.policy?.allowDirectOpenAi === true

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [conns, settingsResult] = await Promise.all([
        api.connections.list(),
        api.settings.get(),
      ])
      setConnections(conns)
      setLockedFeatures(settingsResult.lockedFeatures)
      onSettingsChanged(settingsResult.settings)
    } catch (error) {
      onError(error, 'Không tải được cấu hình.')
    }
  }, [onError, onSettingsChanged])

  useEffect(() => {
    void reload()
  }, [reload])

  const moveTab = (current: Tab, key: string): void => {
    const currentIndex = SETTINGS_TABS.findIndex((item) => item.id === current)
    const nextIndex =
      key === 'Home'
        ? 0
        : key === 'End'
          ? SETTINGS_TABS.length - 1
          : (currentIndex + (key === 'ArrowLeft' ? -1 : 1) + SETTINGS_TABS.length) %
            SETTINGS_TABS.length
    const next = SETTINGS_TABS[nextIndex]
    if (next === undefined) return
    setTab(next.id)
    requestAnimationFrame(() => document.getElementById(`settings-tab-${next.id}`)?.focus())
  }

  return (
    <div className="settings">
      <div className="tabs" role="tablist" aria-label="Nhóm cài đặt">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            id={`settings-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`settings-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                moveTab(t.id, event.key)
              }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        id={`settings-panel-${tab}`}
        className="settings-body"
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'litellm' && (
          <ConnectionForm
            type="litellm"
            title="Kết nối LiteLLM"
            description="Endpoint và API key do quản trị LiteLLM cấp cho bạn. Key được lưu bằng kho bảo mật của Windows và không bao giờ hiển thị lại."
            urlLabel="Endpoint (https://…)"
            secretLabel="API key"
            requiresUsername={false}
            connection={connections.find((c) => c.type === 'litellm') ?? null}
            onChanged={reload}
            onRemoved={() =>
              setConnections((current) => current.filter((c) => c.type !== 'litellm'))
            }
            onError={props.onError}
            onToast={props.onToast}
          />
        )}

        {tab === 'openai' && (
          <ConnectionForm
            type="openai"
            title="Kết nối OpenAI (ChatGPT)"
            description="Nexa gọi TRỰC TIẾP api.openai.com, không đi qua LiteLLM của tổ chức. Nghĩa là mọi câu hỏi bạn gửi tới model OpenAI đều ra ngoài hạ tầng nội bộ, và không có usage log hay hạn mức của tổ chức áp lên nó."
            urlLabel="Endpoint"
            secretLabel="OpenAI API key"
            requiresUsername={false}
            defaultBaseUrl="https://api.openai.com"
            externalWarning="Đây là dịch vụ bên ngoài tổ chức. Không dán dữ liệu nhạy cảm vào hội thoại dùng model OpenAI, và việc đính kèm tài liệu bị CHẶN theo mặc định."
            disabledReason={
              openAiAllowed
                ? undefined
                : 'Kết nối OpenAI trực tiếp đã bị chính sách của tổ chức vô hiệu hoá. Bạn vẫn có thể xoá cấu hình cũ khỏi máy.'
            }
            connection={connections.find((c) => c.type === 'openai') ?? null}
            onChanged={reload}
            onRemoved={() =>
              setConnections((current) => current.filter((c) => c.type !== 'openai'))
            }
            onError={props.onError}
            onToast={props.onToast}
          />
        )}

        {tab === 'jira' && (
          <ConnectionForm
            type="jira"
            title="Kết nối Jira"
            description="Nexa gọi Jira bằng chính tài khoản và Personal Access Token của bạn. Quyền thao tác đúng bằng quyền tài khoản bạn."
            urlLabel="Jira URL (https://…)"
            secretLabel="Personal Access Token"
            requiresUsername
            connection={connections.find((c) => c.type === 'jira') ?? null}
            onChanged={reload}
            onRemoved={() => setConnections((current) => current.filter((c) => c.type !== 'jira'))}
            onError={props.onError}
            onToast={props.onToast}
          />
        )}

        {tab === 'confluence' && (
          <ConnectionForm
            type="confluence"
            title="Kết nối Confluence"
            description="Cấu hình tách biệt với Jira. Nếu tổ chức dùng chung một tài khoản, hãy nhập lại cùng giá trị."
            urlLabel="Confluence URL (https://…)"
            secretLabel="Personal Access Token"
            requiresUsername
            connection={connections.find((c) => c.type === 'confluence') ?? null}
            onChanged={reload}
            onRemoved={() =>
              setConnections((current) => current.filter((c) => c.type !== 'confluence'))
            }
            onError={props.onError}
            onToast={props.onToast}
          />
        )}

        {tab === 'mcpGateway' && (
          <>
            <ConnectionForm
              type="mcpGateway"
              title="MCP Gateway (Jira/Confluence qua HTTP remote)"
              description="Chỉ cấu hình mục này nếu tổ chức bạn KHÔNG chạy mcp-atlassian cục bộ mà cung cấp một gateway HTTP có sẵn (ví dụ MCP gateway của LiteLLM). Khi bật, Nexa gọi thẳng gateway này thay vì tự khởi chạy tiến trình mcp-atlassian trên máy — URL Jira/Confluence và Personal Access Token vẫn nhập ở hai tab Jira/Confluence như bình thường."
              urlLabel="Gateway URL (https://…)"
              secretLabel="Bearer token"
              requiresUsername={false}
              connection={connections.find((c) => c.type === 'mcpGateway') ?? null}
              onChanged={reload}
              onRemoved={() =>
                setConnections((current) => current.filter((c) => c.type !== 'mcpGateway'))
              }
              onError={props.onError}
              onToast={props.onToast}
            />
            {props.settings !== null && (
              <GatewayTlsPanel
                settings={props.settings}
                onChanged={props.onSettingsChanged}
                onError={props.onError}
              />
            )}
          </>
        )}

        {tab === 'models' && (
          <ModelsPanel
            models={props.models}
            allowDirectOpenAi={openAiAllowed}
            onChanged={props.onModelsChanged}
            onError={props.onError}
            onToast={props.onToast}
          />
        )}

        {tab === 'data' && props.settings !== null && (
          <DataPanel
            settings={props.settings}
            models={props.models}
            lockedFeatures={lockedFeatures}
            onChanged={props.onSettingsChanged}
            onError={props.onError}
            onToast={props.onToast}
          />
        )}

        {tab === 'about' && <DiagnosticsPanel onError={props.onError} onToast={props.onToast} />}
      </div>
    </div>
  )
}

// ── Kết nối ───────────────────────────────────────────────────────────────

function ConnectionForm(props: {
  type: ConnectionType
  title: string
  description: string
  urlLabel: string
  secretLabel: string
  requiresUsername: boolean
  /** Điền sẵn khi chưa có kết nối — endpoint của provider công khai là cố định. */
  defaultBaseUrl?: string
  /** Cảnh báo hiện nổi bật khi provider nằm ngoài tổ chức (§11.2). */
  externalWarning?: string
  /** Policy có thể chặn sửa/test nhưng vẫn cho phép xoá credential cũ. */
  disabledReason?: string
  connection: Connection | null
  onChanged: () => Promise<void>
  onRemoved: () => void
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(props.connection?.baseUrl ?? props.defaultBaseUrl ?? '')
  const [username, setUsername] = useState(props.connection?.username ?? '')
  const [secret, setSecret] = useState('')
  const [enabled, setEnabled] = useState(props.connection?.enabled ?? true)
  const [busy, setBusy] = useState<'saving' | 'testing' | 'deleting' | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(
    props.connection?.lastTest ?? null,
  )

  useEffect(() => {
    setBaseUrl(props.connection?.baseUrl ?? props.defaultBaseUrl ?? '')
    setUsername(props.connection?.username ?? '')
    setEnabled(props.connection?.enabled ?? true)
    setTestResult(props.connection?.lastTest ?? null)
    setSecret('')
  }, [props.connection, props.defaultBaseUrl])

  const save = (): void => {
    void (async () => {
      setBusy('saving')
      try {
        await api.connections.save({
          type: props.type,
          baseUrl: baseUrl.trim(),
          username: props.requiresUsername ? username.trim() : null,
          ...(secret.trim() === '' ? {} : { secret: secret.trim() }),
          enabled,
        })
        setSecret('')
        await props.onChanged()
        props.onToast({ kind: 'success', title: 'Đã lưu cấu hình kết nối.' })
      } catch (error) {
        props.onError(error, 'Không lưu được cấu hình.')
      } finally {
        setBusy(null)
      }
    })()
  }

  const test = (): void => {
    void (async () => {
      setBusy('testing')
      try {
        const result = await api.connections.test(props.type)
        setTestResult(result)
        props.onToast(
          result.ok
            ? { kind: 'success', title: `Kết nối thành công. ${result.detail ?? ''}` }
            : { kind: 'error', title: 'Kết nối thất bại', detail: result.errorCode },
        )
      } catch (error) {
        props.onError(error, 'Không kiểm tra được kết nối.')
      } finally {
        setBusy(null)
      }
    })()
  }

  const remove = (): void => {
    void (async () => {
      setBusy('deleting')
      try {
        await commitThenRefresh({
          commit: () => api.connections.remove(props.type),
          onCommitted: () => {
            props.onRemoved()
            setConfirmingDelete(false)
            props.onToast({ kind: 'success', title: 'Đã xoá kết nối và thông tin đăng nhập.' })
          },
          refresh: props.onChanged,
          onRefreshError: () =>
            props.onToast({
              kind: 'warning',
              title: 'Đã xoá kết nối nhưng chưa làm mới được cấu hình.',
            }),
        })
      } catch (error) {
        props.onError(error, 'Không xoá được kết nối.')
      } finally {
        setBusy(null)
      }
    })()
  }

  return (
    <>
      <section className="panel">
        <h2>{props.title}</h2>
        {props.externalWarning !== undefined && (
          <p className="external-warning">⚠ {props.externalWarning}</p>
        )}
        {props.disabledReason !== undefined && (
          <p className="external-warning">
            <strong>Chính sách tổ chức:</strong> {props.disabledReason}
          </p>
        )}
        <p className="muted">{props.description}</p>

        <label className="field">
          <span>{props.urlLabel}</span>
          <input
            className="input"
            value={baseUrl}
            placeholder="https://..."
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={props.disabledReason !== undefined}
          />
        </label>

        {props.requiresUsername && (
          <label className="field">
            <span>Tên đăng nhập</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={props.disabledReason !== undefined}
            />
          </label>
        )}

        <label className="field">
          <span>{props.secretLabel}</span>
          <input
            className="input"
            type="password"
            value={secret}
            autoComplete="off"
            placeholder={
              props.connection?.hasCredential === true
                ? '•••••••••• (đã lưu — để trống nếu không đổi)'
                : 'Dán giá trị vào đây'
            }
            onChange={(e) => setSecret(e.target.value)}
            disabled={props.disabledReason !== undefined}
          />
          {/* §11.1: mặc định chỉ hiển thị giá trị đã che; Nexa không đọc lại secret ra UI. */}
          <span className="muted small">
            Nexa không hiển thị lại giá trị đã lưu. Muốn đổi thì nhập giá trị mới.
          </span>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={props.disabledReason !== undefined}
          />
          <span>Bật kết nối này</span>
        </label>

        {testResult !== null && (
          <p className={testResult.ok ? 'ok' : 'danger'}>
            {testResult.ok ? '✓ ' : '✗ '}
            Kiểm tra lúc {new Date(testResult.checkedAt).toLocaleString('vi-VN')}
            {testResult.detail !== undefined && ` — ${testResult.detail}`}
            {testResult.errorCode !== undefined && ` — ${testResult.errorCode}`}
          </p>
        )}

        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={save}
            disabled={busy !== null || props.disabledReason !== undefined}
          >
            {busy === 'saving' ? 'Đang lưu…' : 'Lưu'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={test}
            disabled={
              busy !== null || props.connection === null || props.disabledReason !== undefined
            }
          >
            {busy === 'testing' ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy !== null || props.connection === null}
          >
            Xoá kết nối
          </button>
        </div>
      </section>

      {confirmingDelete && (
        <DestructiveActionDialog
          title={`Xoá kết nối ${props.title.replace('Kết nối ', '')}?`}
          description="Endpoint, trạng thái cấu hình và thông tin đăng nhập đã lưu sẽ bị xoá khỏi máy này."
          confirmLabel="Xoá kết nối"
          busy={busy === 'deleting'}
          onConfirm={remove}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  )
}

// ── Model ─────────────────────────────────────────────────────────────────

function ModelsPanel(props: {
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
                  })
                  setModelId('')
                  setDisplayName('')
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

// ── MCP Gateway: xác thực TLS chặng gateway → Jira/Confluence ─────────────

/**
 * Ô tích duy nhất bật được `mcpGatewaySkipAtlassianTlsVerify` (ADR-0008).
 *
 * Đặt ở tab MCP Gateway chứ không ở tab "Dữ liệu & quyền riêng tư" cùng các feature flag khác:
 * đây không phải một tuỳ chọn về quyền riêng tư mà là một thuộc tính của chính transport gateway,
 * và người đi tìm nó sẽ tìm ở đúng chỗ họ vừa nhập URL gateway.
 *
 * Nội dung cảnh báo cố ý nói rõ ba điều — chặng nào bị ảnh hưởng, chặng nào KHÔNG, và cách sửa
 * đúng — để người bật biết mình đang đánh đổi cái gì, thay vì chỉ thấy một chữ "không an toàn".
 */
function GatewayTlsPanel(props: {
  settings: AppSettings
  onChanged: (settings: AppSettings) => void
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element {
  const skipping = props.settings.mcpGatewaySkipAtlassianTlsVerify

  const toggle = (checked: boolean): void => {
    void (async () => {
      try {
        props.onChanged(await api.settings.update({ mcpGatewaySkipAtlassianTlsVerify: checked }))
      } catch (error) {
        props.onError(error, 'Không lưu được cài đặt.')
      }
    })()
  }

  return (
    <section className="panel">
      <h2>Xác thực chứng chỉ TLS</h2>
      <p className="muted">
        Nexa gọi gateway luôn bằng HTTPS có xác thực chứng chỉ, và điều đó không tắt được. Tuỳ chọn
        dưới đây chỉ áp dụng cho chặng tiếp theo: từ gateway tới Jira/Confluence.
      </p>
      <label className="checkbox">
        <input type="checkbox" checked={skipping} onChange={(e) => toggle(e.target.checked)} />
        <span>
          Bỏ qua xác thực chứng chỉ ở chặng gateway → Jira/Confluence
          <span className="muted small"> — mặc định tắt</span>
        </span>
      </label>
      <p className="muted small">
        Chỉ bật nếu Jira/Confluence của tổ chức dùng chứng chỉ do CA nội bộ ký mà gateway chưa tin
        cậy. Dấu hiệu: mọi công cụ Jira/Confluence đều báo lỗi đăng nhập dù PAT còn hiệu lực.
      </p>
      {skipping && (
        <p className="warning-inline">
          Đang bật. Trên chặng gateway → Jira/Confluence, Nexa không còn kiểm tra chứng chỉ, nên một
          máy chen giữa trong mạng nội bộ có thể đọc được Personal Access Token của bạn. Cách sửa
          đúng là để đội hạ tầng cài CA nội bộ vào gateway rồi tắt tuỳ chọn này.
        </p>
      )}
    </section>
  )
}

// ── Dữ liệu & quyền riêng tư ──────────────────────────────────────────────

function DataPanel(props: {
  settings: AppSettings
  models: readonly ModelConfig[]
  lockedFeatures: readonly string[]
  onChanged: (settings: AppSettings) => void
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const [purgeConfirm, setPurgeConfirm] = useState('')
  const externalModels = props.models.filter((m) => isExternalProvider(m.provider))

  const update = (patch: Partial<AppSettings>): void => {
    void (async () => {
      try {
        props.onChanged(await api.settings.update(patch))
      } catch (error) {
        props.onError(error, 'Không lưu được cài đặt.')
      }
    })()
  }

  const featureRows: { key: keyof AppSettings['features']; label: string; note?: string }[] = [
    { key: 'jiraRead', label: 'Đọc Jira' },
    { key: 'jiraSearch', label: 'Tìm kiếm Jira' },
    {
      key: 'jiraServiceDesk',
      label: 'Đọc Jira Service Management',
      note: 'Queue, request type',
    },
    { key: 'jiraCreate', label: 'Tạo Jira issue', note: 'Luôn cần bạn xác nhận' },
    { key: 'jiraComment', label: 'Bình luận Jira', note: 'Luôn cần bạn xác nhận' },
    {
      key: 'jiraLink',
      label: 'Tổ chức lại Jira',
      note: 'Watcher, liên kết issue, sprint',
    },
    {
      key: 'jiraUpdate',
      label: 'Cập nhật Jira issue',
      note: 'Rủi ro cao — luôn cần bạn xác nhận',
    },
    {
      key: 'jiraWorkflow',
      label: 'Chuyển trạng thái / project / xoá Jira issue',
      note: 'Rủi ro cao — bao gồm xoá vĩnh viễn, không thể hoàn tác, luôn cần bạn xác nhận',
    },
    { key: 'confluenceRead', label: 'Đọc Confluence' },
    { key: 'confluenceSearch', label: 'Tìm kiếm Confluence' },
    { key: 'confluenceWrite', label: 'Ghi Confluence', note: 'Tạo trang, comment' },
    {
      key: 'confluenceWriteHigh',
      label: 'Cập nhật/di chuyển/xoá trang Confluence',
      note: 'Rủi ro cao — bao gồm xoá vĩnh viễn, không thể hoàn tác, luôn cần bạn xác nhận',
    },
    { key: 'storeExtractedText', label: 'Lưu nội dung trích xuất từ file (đã mã hoá)' },
    { key: 'storeHistory', label: 'Lưu lịch sử hội thoại' },
  ]

  return (
    <>
      <section className="panel">
        <h2>Lưu giữ dữ liệu</h2>
        <label className="field">
          <span>Tự động xoá hội thoại sau</span>
          <select
            className="input"
            value={props.settings.historyRetentionDays}
            onChange={(e) => update({ historyRetentionDays: Number(e.target.value) })}
          >
            {/* Danh sách lấy từ shared-types để UI và validate ở main không lệch nhau. */}
            {RETENTION_CHOICES.map((days) => (
              <option key={days} value={days}>
                {days === 0 ? 'Không tự xoá' : `${String(days)} ngày`}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Giữ log chẩn đoán</span>
          <select
            className="input"
            value={props.settings.logRetentionDays}
            onChange={(e) => update({ logRetentionDays: Number(e.target.value) })}
          >
            <option value={7}>7 ngày</option>
            <option value={14}>14 ngày</option>
            <option value={30}>30 ngày</option>
          </select>
        </label>

        <label className="field">
          <span>Thời hạn xác nhận thao tác (giây)</span>
          <input
            className="input input-compact"
            type="number"
            min={15}
            max={900}
            value={props.settings.approvalTtlSeconds}
            onChange={(e) => update({ approvalTtlSeconds: Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="panel">
        <h2>Công cụ Jira / Confluence</h2>
        <p className="muted">
          Mọi thao tác thay đổi dữ liệu đều hiển thị bản xem trước và cần bạn xác nhận, kể cả khi đã
          bật ở đây.
        </p>
        {featureRows.map((row) => {
          const locked = props.lockedFeatures.includes(row.key)
          return (
            <label key={row.key} className="checkbox">
              <input
                type="checkbox"
                checked={props.settings.features[row.key]}
                disabled={locked}
                onChange={(e) => update({ features: { [row.key]: e.target.checked } as never })}
              />
              <span>
                {row.label}
                {row.note !== undefined && <span className="muted small"> — {row.note}</span>}
                {locked && <span className="tag">bị khoá bởi chính sách tổ chức</span>}
              </span>
            </label>
          )
        })}
      </section>

      <section className="panel">
        <h2>Tài liệu và provider bên ngoài</h2>
        <p className="muted">
          Model chạy qua LiteLLM nội bộ được nhận tài liệu theo mặc định. Model của provider bên
          ngoài (OpenAI) thì <strong>không</strong> — phải được cho phép từng model một ở đây.
        </p>

        {externalModels.length === 0 ? (
          <p className="muted small">Chưa có model nào thuộc provider bên ngoài.</p>
        ) : (
          externalModels.map((model) => {
            const key = `${model.provider}:${model.modelId}`
            const allowed = props.settings.externalDocumentAllowedModels.includes(key)
            return (
              <label key={model.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={allowed}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...props.settings.externalDocumentAllowedModels, key]
                      : props.settings.externalDocumentAllowedModels.filter((k) => k !== key)
                    update({ externalDocumentAllowedModels: next })
                  }}
                />
                <span>
                  Cho phép gửi tài liệu tới <code>{model.modelId}</code>{' '}
                  <span className="external-tag">{PROVIDER_LABELS[model.provider]}</span>
                </span>
              </label>
            )
          })
        )}

        <p className="external-warning">
          ⚠ Bật một mục ở đây nghĩa là tài liệu nội bộ sẽ được gửi ra ngoài tổ chức, không qua
          LiteLLM, và không có usage log của tổ chức. Chỉ bật khi bộ phận an toàn thông tin đã cho
          phép.
        </p>
      </section>

      <section className="panel danger-zone">
        <h2>Xoá toàn bộ dữ liệu cục bộ</h2>
        <p className="muted">
          Xoá mọi hội thoại, cấu hình và thông tin đăng nhập đã lưu trên máy này. Không thể hoàn
          tác. Dữ liệu tại Jira, Confluence và log của LiteLLM không bị ảnh hưởng.
        </p>
        <label className="field">
          <span>
            Gõ chính xác <code>XOA TOAN BO DU LIEU</code> để xác nhận
          </span>
          <input
            className="input"
            value={purgeConfirm}
            onChange={(e) => setPurgeConfirm(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-danger"
          disabled={purgeConfirm !== 'XOA TOAN BO DU LIEU'}
          onClick={() => {
            void (async () => {
              try {
                await api.data.purge(true)
                props.onToast({ kind: 'success', title: 'Đã xoá toàn bộ dữ liệu cục bộ.' })
                setPurgeConfirm('')
              } catch (error) {
                props.onError(error, 'Không xoá được dữ liệu.')
              }
            })()
          }}
        >
          Xoá tất cả
        </button>
      </section>
    </>
  )
}

// ── Chẩn đoán ─────────────────────────────────────────────────────────────

function DiagnosticsPanel(props: {
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const { onError } = props
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.diagnostics.appInfo>> | null>(null)

  useEffect(() => {
    void api.diagnostics
      .appInfo()
      .then(setInfo)
      .catch((e: unknown) => onError(e, 'Không đọc được thông tin chẩn đoán.'))
  }, [onError])

  return (
    <section className="panel">
      <h2>Chẩn đoán</h2>
      {info === null ? (
        <p className="muted">Đang tải…</p>
      ) : (
        <dl className="field-list">
          <div>
            <dt>Phiên bản Nexa</dt>
            <dd>{info.version}</dd>
          </div>
          <div>
            <dt>Electron</dt>
            <dd>{info.electron}</dd>
          </div>
          <div>
            <dt>Nền tảng</dt>
            <dd>{info.platform}</dd>
          </div>
          <div>
            <dt>Phiên bản lược đồ CSDL</dt>
            <dd>{info.schemaVersion}</dd>
          </div>
          <div>
            <dt>Driver SQLite</dt>
            <dd>{info.sqliteDriver}</dd>
          </div>
          <div>
            <dt>Kho bảo mật</dt>
            <dd>
              {info.secureStorageBackend}
              {!info.secureStorageProductionGrade && (
                <span className="danger"> — KHÔNG dùng cho môi trường thật</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Ghi log ra đĩa</dt>
            <dd>{info.logToDisk ? 'có' : 'không (chỉ trong bộ nhớ)'}</dd>
          </div>
          <div>
            <dt>Thống kê xác nhận</dt>
            <dd>
              {info.approvalStats.approved} đã xác nhận · {info.approvalStats.cancelled} đã huỷ
            </dd>
          </div>
        </dl>
      )}

      <p className="muted small">
        Gói chẩn đoán chỉ chứa log đã che thông tin nhạy cảm, tóm tắt cấu hình và bảng đối chiếu mã
        yêu cầu. Không có nội dung hội thoại, không có nội dung file, không có API key hay PAT.
      </p>

      <button
        type="button"
        className="btn"
        onClick={() => {
          void (async () => {
            try {
              const result = await api.diagnostics.export()
              props.onToast({
                kind: 'success',
                title: 'Đã xuất gói chẩn đoán',
                detail: result.directory,
              })
            } catch (error) {
              props.onError(error, 'Không xuất được gói chẩn đoán.')
            }
          })()
        }}
      >
        Xuất gói chẩn đoán
      </button>
    </section>
  )
}
