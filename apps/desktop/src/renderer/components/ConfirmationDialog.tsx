import { useEffect, useState } from 'react'
import type { ConfirmationRequest } from '@nexa/shared-types'

/**
 * Màn hình xác nhận thao tác thay đổi dữ liệu (§10.2).
 *
 * Tám mục bắt buộc của §10.2 đều có mặt và được đánh dấu trong mã bên dưới. Hai điểm cần
 * giữ nguyên khi sửa giao diện này:
 *   - Nút phải là "Xác nhận" và "Huỷ". §10.2 cấm nhãn mơ hồ kiểu "Tiếp tục".
 *   - Nút Xác nhận bị khoá ngay sau lần bấm đầu (§10.3 chống double-submit). Đây là lớp
 *     phòng vệ đầu; ConfirmationGuard ở main mới là lớp quyết định.
 */
export function ConfirmationDialog(props: {
  request: ConfirmationRequest
  onApprove: (operationId: string, payloadHash: string) => void
  onCancel: (operationId: string) => void
}): React.JSX.Element {
  const { request } = props
  const { preview } = request
  const [submitting, setSubmitting] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(() => remainingSeconds(request.expiresAt))
  const [expandedField, setExpandedField] = useState<string | null>(null)

  // §10.2: approval có thời hạn ngắn. Đếm ngược để người dùng thấy rõ, và tự huỷ khi hết giờ
  // thay vì để họ bấm vào một nút đã vô hiệu ở phía main.
  useEffect(() => {
    const timer = setInterval(() => {
      const left = remainingSeconds(request.expiresAt)
      setSecondsLeft(left)
      if (left <= 0) props.onCancel(request.operationId)
    }, 1000)
    return () => clearInterval(timer)
  }, [request.expiresAt, request.operationId, props])

  const approve = (): void => {
    if (submitting) return
    setSubmitting(true)
    props.onApprove(request.operationId, request.payloadHash)
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className={`modal risk-${preview.riskLevel.toLowerCase()}`}>
        <header className="modal-header">
          {/* Mục 1: tên công cụ và hệ thống đích */}
          <div>
            <h2 id="confirm-title">Xác nhận thao tác thay đổi dữ liệu</h2>
            <p className="modal-subtitle">
              <code>{preview.toolName}</code> →{' '}
              <strong>{preview.targetSystem === 'jira' ? 'Jira' : 'Confluence'}</strong>{' '}
              <span className="muted">{preview.targetSystemUrl}</span>
            </p>
          </div>
          <span className={`risk-badge risk-${preview.riskLevel.toLowerCase()}`}>
            {preview.riskLevel}
          </span>
        </header>

        <div className="modal-body">
          {/* Mục 2: hành động cụ thể */}
          <section>
            <h3>Hành động</h3>
            <p>{preview.action}</p>
          </section>

          {/* Mục 3: tài khoản thực hiện */}
          <section>
            <h3>Thực hiện bằng tài khoản</h3>
            <p>
              <code>{preview.actingAccount}</code>
              <span className="muted"> — quyền cuối cùng do hệ thống đích quyết định</span>
            </p>
          </section>

          {/* Mục 4: dữ liệu sẽ được gửi */}
          {preview.payloadFields.length > 0 && (
            <section>
              <h3>Dữ liệu sẽ được gửi đi</h3>
              <dl className="field-list">
                {preview.payloadFields.map((field) => (
                  <div key={field.label}>
                    <dt>{field.label}</dt>
                    <dd>
                      <pre>{field.value}</pre>
                      {field.truncated === true && expandedField !== field.label && (
                        <button
                          type="button"
                          className="link"
                          onClick={() => setExpandedField(field.label)}
                        >
                          Nội dung đã bị rút gọn trong bản xem trước
                        </button>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* Mục 5: trường hoặc đối tượng sẽ bị thay đổi */}
          {preview.changes.length > 0 && (
            <section>
              <h3>Sẽ bị thay đổi</h3>
              <table className="change-table">
                <thead>
                  <tr>
                    <th>Trường</th>
                    <th>Trước</th>
                    <th>Sau</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.changes.map((change) => (
                    <tr key={change.field}>
                      <td>{change.field}</td>
                      <td className="muted">{change.before ?? '(chưa có / không đọc được)'}</td>
                      <td className="after">{change.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.beforeValuesMayBeStale === true && (
                <p className="warning-inline">
                  Giá trị ở cột “Trước” được đọc lúc tạo bản xem trước và có thể đã thay đổi.
                </p>
              )}
            </section>
          )}

          {/* Mục 6: cảnh báo tác động và khả năng hoàn tác */}
          <section className="impact">
            <h3>Tác động</h3>
            <p>{preview.impactWarning}</p>
            <p className={preview.reversible ? 'ok' : 'danger'}>
              {preview.reversible
                ? 'Thao tác này có thể hoàn tác thủ công tại hệ thống đích.'
                : 'Nexa KHÔNG thể hoàn tác thao tác này.'}
            </p>
          </section>
        </div>

        <footer className="modal-footer">
          <span className="countdown">
            Xác nhận còn hiệu lực {Math.max(0, secondsLeft)} giây
          </span>
          <div className="modal-actions">
            {/* Mục 7: nhãn nút rõ ràng — không dùng "Tiếp tục" */}
            <button
              type="button"
              className="btn"
              onClick={() => props.onCancel(request.operationId)}
              disabled={submitting}
            >
              Huỷ
            </button>
            <button type="button" className="btn btn-danger" onClick={approve} disabled={submitting}>
              {submitting ? 'Đang thực hiện…' : 'Xác nhận'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function remainingSeconds(expiresAt: string): number {
  return Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)
}
