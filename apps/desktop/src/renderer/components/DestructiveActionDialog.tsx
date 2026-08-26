import { useModalDialog } from './useModalDialog.js'

export function DestructiveActionDialog(props: {
  title: string
  description: string
  confirmLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const busy = props.busy === true
  const { dialogRef, initialFocusRef } = useModalDialog(props.onCancel, busy)

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        className="modal modal-compact risk-destructive"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="destructive-title"
        aria-describedby="destructive-description"
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2 id="destructive-title">{props.title}</h2>
          <span className="risk-badge risk-destructive">KHÔNG THỂ HOÀN TÁC</span>
        </header>
        <div className="modal-body">
          <p id="destructive-description">{props.description}</p>
          <p className="danger">Thao tác này không thể hoàn tác trong Nexa.</p>
        </div>
        <footer className="modal-footer modal-footer-end">
          <div className="modal-actions">
            <button
              ref={initialFocusRef}
              type="button"
              className="btn"
              onClick={props.onCancel}
              disabled={busy}
            >
              Huỷ
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={props.onConfirm}
              disabled={busy}
            >
              {busy ? 'Đang xoá…' : (props.confirmLabel ?? 'Xoá')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
