import { useState } from 'react'
import type { Message } from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { formatFileSize } from './file-block-ui.js'
import type { Toast } from './Toasts.js'
import { NexaMark } from './NexaMark.js'
import { UiIcon } from './UiIcon.js'
import { MessageBody } from './MessageBody.js'

export function MessageBubble(props: {
  message: Message
  onEdit: (content: string) => void
  onDelete: () => void
  onCopy: () => void
  onToast: (toast: Omit<Toast, 'id'>) => void
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element {
  const { message } = props
  const roleLabel: Record<string, string> = {
    user: 'Bạn',
    assistant: 'Nexa',
    tool: 'Công cụ',
    system: 'Hệ thống',
  }
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)

  // Chỉ cho sửa/xoá tin nhắn của người dùng hoặc trả lời của model, đã lưu xong và chưa bị xoá.
  // Không cho với 'tool'/'system' — nội dung đó do vòng lặp tool quản lý, không phải người gõ.
  const editable =
    (message.role === 'user' || message.role === 'assistant') &&
    message.status !== 'streaming' &&
    message.deletedAt === undefined

  if (message.deletedAt !== undefined) {
    return (
      <article className={`message message-${message.role} status-${message.status}`}>
        {message.role === 'assistant' && <NexaMark className="message-avatar" avatar size={50} />}
        <header className="message-header">
          <div className="message-header-left">
            <strong>{roleLabel[message.role] ?? message.role}</strong>
            <span className="muted small">
              {new Date(message.createdAt).toLocaleTimeString('vi-VN')}
            </span>
          </div>
        </header>
        <div className="message-body muted">Tin nhắn đã bị xoá.</div>
      </article>
    )
  }

  return (
    <article className={`message message-${message.role} status-${message.status}`}>
      {message.role === 'assistant' && <NexaMark className="message-avatar" avatar size={50} />}
      <header className="message-header">
        <div className="message-header-left">
          <strong>{roleLabel[message.role] ?? message.role}</strong>
          <span className="muted small">
            {new Date(message.createdAt).toLocaleTimeString('vi-VN')}
            {message.editedAt !== undefined && ' · đã sửa'}
          </span>
        </div>
        {editable && !editing && (
          <span className="message-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label="Sao chép tin nhắn"
              title="Sao chép tin nhắn"
              onClick={props.onCopy}
            >
              <UiIcon name="copy" size={19} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Sửa tin nhắn"
              title="Sửa tin nhắn"
              onClick={() => {
                setDraft(message.content)
                setEditing(true)
              }}
            >
              <UiIcon name="pencil" size={19} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Xoá tin nhắn"
              title="Xoá tin nhắn"
              onClick={props.onDelete}
            >
              <UiIcon name="trash" size={19} />
            </button>
          </span>
        )}
      </header>

      {message.attachments !== undefined && message.attachments.length > 0 && (
        <div className="attachments">
          {message.attachments.map((file) => (
            <span key={file.id} className="chip chip-static">
              {file.fileType === 'image' ? '🖼' : '📎'} {file.fileName}
              {/* Ảnh không sinh ra ký tự nào, nên "0 ký tự" ở đây vừa vô nghĩa vừa đọc như một
                  lỗi trích xuất. Với ảnh, con số nói lên điều gì đó là dung lượng. */}
              <span className="muted">
                {file.fileType === 'image'
                  ? ` · ${formatFileSize(file.fileSize)}`
                  : ` · ${file.extractedChars.toLocaleString('vi-VN')} ký tự`}
              </span>
              {file.suspectedScan === true && (
                <span className="warning-tag" title="PDF có thể là bản scan, không có lớp văn bản">
                  nghi bản scan
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {editing ? (
        <div className="message-body message-edit">
          <textarea
            className="composer-input"
            aria-label="Nội dung tin nhắn đang sửa"
            lang="vi"
            spellCheck
            autoCorrect="on"
            autoCapitalize="sentences"
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <div className="message-edit-actions">
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={draft.trim() === ''}
              onClick={() => {
                if (draft.trim() !== '' && draft !== message.content) props.onEdit(draft.trim())
                setEditing(false)
              }}
            >
              Lưu
            </button>
            <button type="button" className="btn btn-small" onClick={() => setEditing(false)}>
              Huỷ
            </button>
          </div>
        </div>
      ) : (
        <div className="message-body">
          {message.content === '' && message.status === 'streaming' ? (
            <span className="typing">Đang trả lời…</span>
          ) : (
            <MessageBody
              message={message}
              onToast={props.onToast}
              onError={props.onError}
            />
          )}
        </div>
      )}

      {message.toolCalls !== undefined && message.toolCalls.length > 0 && (
        <ul className="tool-calls">
          {message.toolCalls.map((call) => (
            <li key={call.id} className={`tool-call op-${call.operationStatus}`}>
              <code>{call.toolName}</code>
              <span className={`risk-badge risk-${call.riskLevel.toLowerCase()}`}>
                {call.riskLevel}
              </span>
              <span className="muted">
                {describeToolCall(call.operationStatus, call.approvalStatus)}
              </span>
              {call.resultSummary !== undefined && <span> — {call.resultSummary}</span>}
              {call.operationStatus === 'failed' && call.errorCode !== undefined && (
                <span className="error-inline">
                  Không hoàn tất được thao tác · mã lỗi <code>{call.errorCode}</code>
                </span>
              )}
              {call.targetUrl !== undefined && (
                // §7.4 bước 8: hiển thị liên kết hoặc mã đối tượng vừa tạo/cập nhật.
                <a href={call.targetUrl} target="_blank" rel="noreferrer">
                  {call.targetKey ?? 'Mở'}
                </a>
              )}
              {call.operationStatus === 'uncertain' && call.operationId !== undefined && (
                <UncertainAction operationId={call.operationId} />
              )}
            </li>
          ))}
        </ul>
      )}

      {message.errorCode !== undefined && (
        <p className="error-inline">
          Lỗi: {message.errorCode}
          {message.requestId !== undefined && ` · mã yêu cầu ${message.requestId}`}
        </p>
      )}

      {message.truncatedContextCount !== undefined && message.truncatedContextCount > 0 && (
        <p className="muted small">
          Đã lược bỏ {message.truncatedContextCount} tin nhắn cũ khỏi ngữ cảnh của lượt này.
        </p>
      )}
    </article>
  )
}

/** §16: thao tác write không rõ kết quả — Nexa tra cứu hộ thay vì cho retry ngay. */
function UncertainAction(props: { operationId: string }): React.JSX.Element {
  const [state, setState] = useState<{ busy: boolean; message: string | null }>({
    busy: false,
    message: null,
  })

  return (
    <span className="uncertain-action">
      <button
        type="button"
        className="btn btn-small"
        disabled={state.busy}
        onClick={() => {
          void (async () => {
            setState({ busy: true, message: null })
            try {
              const result = await api.tools.lookupUncertain(props.operationId)
              setState({ busy: false, message: result.message })
            } catch (error) {
              setState({
                busy: false,
                message: error instanceof Error ? error.message : 'Không tra cứu được.',
              })
            }
          })()
        }}
      >
        {state.busy ? 'Đang kiểm tra…' : 'Kiểm tra kết quả'}
      </button>
      {state.message !== null && <span className="muted"> {state.message}</span>}
    </span>
  )
}

function describeToolCall(operationStatus: string, approvalStatus: string): string {
  if (approvalStatus === 'pending') return 'đang chờ bạn xác nhận'
  if (approvalStatus === 'cancelled') return 'bạn đã huỷ'
  if (approvalStatus === 'expired') return 'xác nhận đã hết hạn'
  const map: Record<string, string> = {
    pending: 'đang chuẩn bị',
    running: 'đang chạy',
    success: 'hoàn tất',
    failed: 'thất bại',
    uncertain: 'không rõ kết quả',
  }
  return map[operationStatus] ?? operationStatus
}
