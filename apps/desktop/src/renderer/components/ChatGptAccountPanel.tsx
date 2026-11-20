import { useCallback, useEffect, useState } from 'react'
import type { ChatGptAccountStatus, ChatGptModel } from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import type { Toast } from './Toasts.js'

export function ChatGptAccountPanel(props: {
  disabledReason?: string
  onModelsChanged: (models: ChatGptModel[]) => void
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const { disabledReason, onError, onModelsChanged, onToast } = props
  const [status, setStatus] = useState<ChatGptAccountStatus | null>(null)
  const [models, setModels] = useState<ChatGptModel[]>([])
  const [modelState, setModelState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [busy, setBusy] = useState<'loading' | 'login' | 'logout' | null>('loading')

  const loadModels = useCallback(async (): Promise<void> => {
    setModelState('loading')
    try {
      const nextModels = await api.chatgpt.models()
      setModels(nextModels)
      onModelsChanged(nextModels)
      setModelState('ready')
    } catch (error) {
      setModels([])
      onModelsChanged([])
      setModelState('error')
      onError(error, 'Không tải được danh sách model Codex.')
    }
  }, [onError, onModelsChanged])

  const refresh = useCallback(async (): Promise<void> => {
    setBusy('loading')
    try {
      const next = await api.chatgpt.status()
      setStatus(next)
      if (next.authenticated && disabledReason === undefined) {
        await loadModels()
      } else {
        setModels([])
        onModelsChanged([])
        setModelState('idle')
      }
    } catch (error) {
      onError(error, 'Không đọc được trạng thái tài khoản ChatGPT.')
    } finally {
      setBusy(null)
    }
  }, [disabledReason, loadModels, onError, onModelsChanged])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = (): void => {
    void (async () => {
      setBusy('login')
      try {
        const next = await api.chatgpt.login()
        setStatus(next)
        onToast({
          kind: 'success',
          title: `Đã đăng nhập ChatGPT${next.planType === null ? '' : ` — gói ${formatPlan(next.planType)}`}.`,
        })
        if (next.authenticated) await loadModels()
      } catch (error) {
        onError(error, 'Không đăng nhập được bằng ChatGPT.')
      } finally {
        setBusy(null)
      }
    })()
  }

  const logout = (): void => {
    void (async () => {
      setBusy('logout')
      try {
        setStatus(await api.chatgpt.logout())
        setModels([])
        onModelsChanged([])
        setModelState('idle')
        onToast({ kind: 'success', title: 'Đã đăng xuất tài khoản ChatGPT.' })
      } catch (error) {
        onError(error, 'Không đăng xuất được tài khoản ChatGPT.')
      } finally {
        setBusy(null)
      }
    })()
  }

  const authenticated = status?.authenticated === true
  return (
    <section className="panel" aria-labelledby="chatgpt-account-title">
      <h2 id="chatgpt-account-title">Đăng nhập bằng ChatGPT</h2>
      <p className="external-warning">
        Tài khoản và hạn mức Codex nằm ngoài hạ tầng tổ chức. Không dùng phiên này với dữ liệu nhạy
        cảm nếu chưa được cho phép.
      </p>
      {disabledReason !== undefined && (
        <p className="external-warning">
          <strong>Chính sách tổ chức:</strong> {disabledReason}
        </p>
      )}
      <p className="muted">
        Nexa mở luồng đăng nhập chính thức của Codex trong trình duyệt. Codex tự lưu và làm mới
        token; Nexa không đọc hoặc lưu token ChatGPT. Phiên này dùng quyền lợi Codex của gói
        ChatGPT. Sau khi đăng nhập, các model Codex sẽ xuất hiện trong bộ chọn model ở màn hình Chat
        và không dùng API key ở mục bên dưới.
      </p>

      <div className="account-status" aria-live="polite">
        {busy === 'loading' && status === null && <p>Đang kiểm tra Codex CLI…</p>}
        {status !== null && !status.appServerAvailable && (
          <p className="warning-inline">
            Chưa tìm thấy hoặc không khởi động được Codex CLI. Hãy cài/cập nhật Codex CLI rồi mở lại
            Nexa.
          </p>
        )}
        {status?.appServerAvailable === true && !authenticated && (
          <p>Chưa có tài khoản ChatGPT được kết nối qua Codex.</p>
        )}
        {authenticated && status !== null && (
          <dl className="account-details">
            <div>
              <dt>Tài khoản</dt>
              <dd>{status.email ?? 'Không có email hiển thị'}</dd>
            </div>
            <div>
              <dt>Gói ChatGPT</dt>
              <dd>{formatPlan(status.planType)}</dd>
            </div>
            <div>
              <dt>Hạn mức Codex</dt>
              <dd>{formatRateLimit(status)}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="account-model-catalog" aria-labelledby="chatgpt-models-title">
        <div className="account-model-catalog-head">
          <h3 id="chatgpt-models-title">Model Codex khả dụng</h3>
          {modelState === 'ready' && authenticated && (
            <span className="tag">{models.length.toLocaleString('vi-VN')} model</span>
          )}
        </div>
        <div className="account-model-state" aria-live="polite">
          {disabledReason !== undefined ? (
            <p className="muted">Chính sách tổ chức đang khoá danh sách model ChatGPT.</p>
          ) : status === null || (busy === 'loading' && modelState === 'idle') ? (
            <p className="muted">Đang kiểm tra tài khoản trước khi tải model…</p>
          ) : !status.appServerAvailable ? (
            <p className="muted">Cài hoặc cập nhật Codex CLI để đọc danh sách model.</p>
          ) : !authenticated ? (
            <p className="muted">Đăng nhập ChatGPT để xem các model Codex tài khoản được dùng.</p>
          ) : modelState === 'loading' ? (
            <p>Đang tải model Codex…</p>
          ) : modelState === 'error' ? (
            <p className="warning-inline">
              Chưa tải được danh sách model. Hãy cập nhật Codex CLI rồi làm mới lại.
            </p>
          ) : models.length === 0 ? (
            <p className="muted">Tài khoản không trả về model picker-visible nào.</p>
          ) : (
            <div className="account-model-table-wrap">
              <table className="table account-model-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Reasoning</th>
                    <th>Đầu vào</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => (
                    <tr key={model.id}>
                      <td>
                        <strong>{model.displayName}</strong>
                        {model.isDefault && <span className="tag">mặc định</span>}
                        <br />
                        <code className="muted small">{model.modelId}</code>
                      </td>
                      <td>{formatReasoningEfforts(model)}</td>
                      <td>{model.inputModalities.join(', ') || 'Không công bố'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="muted small account-model-note">
          Danh sách này phản ánh quyền Codex của tài khoản và được đồng bộ với bộ chọn model ở màn
          hình Chat. Chat Codex hiện chỉ nhận văn bản; file đính kèm vẫn bị chặn.
        </p>
      </div>

      <div className="actions">
        {!authenticated ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null || disabledReason !== undefined}
            onClick={login}
          >
            {busy === 'login' ? 'Đang chờ trình duyệt…' : 'Đăng nhập bằng ChatGPT'}
          </button>
        ) : (
          <button type="button" className="btn" disabled={busy !== null} onClick={logout}>
            {busy === 'logout' ? 'Đang đăng xuất…' : 'Đăng xuất ChatGPT'}
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => void refresh()}
        >
          Làm mới tài khoản và model
        </button>
      </div>
    </section>
  )
}

function formatReasoningEfforts(model: ChatGptModel): string {
  const efforts = model.supportedReasoningEfforts.map((item) => item.reasoningEffort)
  if (efforts.length > 0) return efforts.join(', ')
  return model.defaultReasoningEffort ?? 'Không công bố'
}

function formatPlan(planType: string | null): string {
  if (planType === null || planType.trim() === '') return 'Không xác định'
  const known: Readonly<Record<string, string>> = {
    free: 'Free',
    plus: 'Plus',
    pro: 'Pro',
    team: 'Team',
    business: 'Business',
    enterprise: 'Enterprise',
    edu: 'Edu',
  }
  return known[planType.toLowerCase()] ?? planType
}

function formatRateLimit(status: ChatGptAccountStatus): string {
  const limit = status.rateLimit
  if (limit === null) return 'Chưa có dữ liệu hạn mức'
  const reset = new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(limit.resetsAt * 1000))
  return `Đã dùng ${String(Math.round(limit.usedPercent))}% / ${String(limit.windowDurationMins)} phút; đặt lại ${reset}`
}
