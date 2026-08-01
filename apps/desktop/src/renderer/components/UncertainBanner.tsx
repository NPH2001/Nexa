import { useEffect, useState } from 'react'
import type { ToolCallRecord } from '@nexa/shared-types'
import { api } from '../bridge.js'

/**
 * Banner cho các thao tác write còn treo ở trạng thái không rõ kết quả (§16).
 *
 * Vì sao cần một chỗ tập trung: `OperationTracker` chỉ sống trong RAM của main process. Đóng
 * app là mất. Nếu chỉ hiển thị nút "Kiểm tra kết quả" trong bong bóng tin nhắn, người dùng mở
 * lại app hôm sau sẽ không có cách nào biết là còn một thao tác chưa rõ đã tạo Jira issue hay
 * chưa — đúng tình huống dẫn tới dữ liệu trùng mà §10.3 muốn tránh.
 *
 * Danh sách này đọc thẳng từ bảng `tool_calls` nên sống sót qua các lần khởi động lại.
 */
type UncertainOperation = ToolCallRecord & { conversationId: string }

export function UncertainBanner(props: {
  onOpenConversation: (conversationId: string) => void
  onNotice: (message: string) => void
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element | null {
  const [pending, setPending] = useState<UncertainOperation[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const reload = (): void => {
    void api.tools
      .listUncertain()
      .then(setPending)
      .catch(() => undefined)
  }

  useEffect(() => {
    reload()
    // Làm tươi định kỳ: một thao tác có thể rơi vào uncertain trong lúc banner đang mở.
    const timer = setInterval(reload, 30_000)
    return () => clearInterval(timer)
  }, [])

  if (dismissed || pending.length === 0) return null

  return (
    <div className="uncertain-banner" role="alert">
      <div className="uncertain-banner-head">
        <strong>
          {pending.length} thao tác thay đổi dữ liệu chưa rõ kết quả
        </strong>
        <button
          type="button"
          className="icon-btn"
          aria-label="Ẩn thông báo"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>
      </div>
      <p className="muted small">
        Nexa không xác định được các thao tác dưới đây đã hoàn tất tại Jira/Confluence hay chưa.
        Hãy kiểm tra trước khi thử lại, để tránh tạo dữ liệu trùng.
      </p>

      <ul className="uncertain-list">
        {pending.map((record) => (
          <li key={record.id}>
            <code>{record.toolName}</code>
            <span className="muted small">
              {new Date(record.createdAt).toLocaleString('vi-VN')}
            </span>
            {record.operationId !== undefined && (
              <button
                type="button"
                className="btn btn-small"
                disabled={busyId === record.operationId}
                onClick={() => {
                  const operationId = record.operationId as string
                  void (async () => {
                    setBusyId(operationId)
                    try {
                      const result = await api.tools.lookupUncertain(operationId)
                      // Tra cứu xong thì danh sách đổi — nạp lại thay vì đoán trạng thái mới.
                      reload()
                      props.onNotice(result.message)
                    } catch (error) {
                      props.onError(error, 'Không tra cứu được kết quả.')
                    } finally {
                      setBusyId(null)
                    }
                  })()
                }}
              >
                {busyId === record.operationId ? 'Đang kiểm tra…' : 'Kiểm tra kết quả'}
              </button>
            )}
            <button
              type="button"
              className="link"
              onClick={() => props.onOpenConversation(record.conversationId)}
            >
              Mở hội thoại
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
