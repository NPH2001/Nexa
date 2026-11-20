import { useEffect, useState } from 'react'
import type { Connection, ConnectionTestResult, ConnectionType } from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { commitThenRefresh } from '../committed-mutation.js'
import { DestructiveActionDialog } from './DestructiveActionDialog.js'
import type { Toast } from './Toasts.js'

export function ConnectionForm(props: {
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
        // Main đã ghi kết quả vào `lastTest`; tải lại để chấm trạng thái ở danh sách bên trái
        // và khung "Bắt đầu với Nexa" khớp với kết quả vừa có.
        await props.onChanged()
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
