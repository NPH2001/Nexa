import { useEffect, useState } from 'react'
import { api } from '../bridge.js'
import { LoadingSkeleton } from './StateBlocks.js'
import type { Toast } from './Toasts.js'

export function DiagnosticsPanel(props: {
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
        <LoadingSkeleton label="Đang tải thông tin chẩn đoán…" rows={4} />
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
