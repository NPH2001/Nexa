export interface Toast {
  readonly id: number
  readonly kind: 'info' | 'success' | 'warning' | 'error'
  readonly title: string
  readonly detail?: string
}

/**
 * Thông báo nổi.
 *
 * §9.3 yêu cầu lỗi phải kèm request_id để đối chiếu với log LiteLLM/Atlassian (§15.2), nên
 * `detail` gần như luôn chứa mã yêu cầu — người dùng cần copy được nó khi báo lỗi.
 */
export function Toasts(props: {
  toasts: readonly Toast[]
  onDismiss: (id: number) => void
}): React.JSX.Element {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {props.toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <div className="toast-body">
            <strong>{toast.title}</strong>
            {toast.detail !== undefined && toast.detail !== '' && (
              <span className="toast-detail">{toast.detail}</span>
            )}
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="Đóng thông báo"
            onClick={() => props.onDismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
