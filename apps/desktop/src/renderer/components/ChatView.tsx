import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, Conversation, Message, ModelConfig } from '@nexa/shared-types'
import { api } from '../bridge.js'
import type { Toast } from './Toasts.js'

interface Attachment {
  readonly token: string
  readonly fileName: string
  readonly sizeBytes: number
}

export function ChatView(props: {
  conversation: Conversation | null
  messages: readonly Message[]
  models: readonly ModelConfig[]
  settings: AppSettings | null
  streaming: boolean
  onSend: (content: string, fileTokens: string[], modelId?: string) => void
  onCancel: () => void
  onCreateConversation: () => void
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  // Model chọn ở dropdown áp cho lượt gửi KẾ TIẾP; các lượt đã xong giữ nguyên model của chúng.
  const [modelOverride, setModelOverride] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const selectedModelId =
    modelOverride ??
    props.conversation?.modelId ??
    props.models.find((m) => m.isDefault)?.modelId ??
    ''

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [props.messages])

  const documentPolicyBlocked = useMemo(() => {
    const allowlist = props.settings?.documentAllowedModels ?? []
    if (allowlist.length === 0) return false
    return !allowlist.includes(selectedModelId)
  }, [props.settings, selectedModelId])

  if (props.conversation === null) {
    return (
      <div className="empty-state">
        <h2>Chưa có hội thoại nào đang mở</h2>
        <p className="muted">Tạo một hội thoại mới để bắt đầu.</p>
        <button type="button" className="btn btn-primary" onClick={props.onCreateConversation}>
          + Hội thoại mới
        </button>
      </div>
    )
  }

  const pickFiles = (): void => {
    void (async () => {
      try {
        const picked = await api.files.pick()
        if (picked.length === 0) return
        const limit = props.settings?.maxFilesPerRequest ?? 5
        const next = [...attachments, ...picked].slice(0, limit)
        if (attachments.length + picked.length > limit) {
          props.onToast({
            kind: 'warning',
            title: `Chỉ đính kèm tối đa ${String(limit)} file mỗi lần gửi`,
          })
        }
        setAttachments(next)
      } catch (error) {
        props.onError(error, 'Không chọn được file.')
      }
    })()
  }

  const removeAttachment = (token: string): void => {
    void api.files.release(token).catch(() => undefined)
    setAttachments((prev) => prev.filter((a) => a.token !== token))
  }

  const submit = (): void => {
    const content = draft.trim()
    if (content === '' || props.streaming) return
    props.onSend(
      content,
      attachments.map((a) => a.token),
      selectedModelId === '' ? undefined : selectedModelId,
    )
    setDraft('')
    setAttachments([])
  }

  return (
    <div className="chat">
      <header className="chat-header">
        <div>
          <h2>{props.conversation.title}</h2>
          <span className="muted small">
            {props.conversation.messageCount} tin nhắn
            {selectedModelId !== '' && ` · model: ${selectedModelId}`}
          </span>
        </div>
        <ModelSelector
          models={props.models}
          value={selectedModelId}
          onChange={(modelId) => {
            setModelOverride(modelId)
            props.onToast({ kind: 'info', title: `Lượt trả lời tiếp theo sẽ dùng ${modelId}` })
          }}
        />
      </header>

      <div className="messages">
        {props.messages.length === 0 && (
          <p className="muted center">Hãy đặt câu hỏi để bắt đầu.</p>
        )}
        {props.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        {attachments.length > 0 && (
          <div className="attachments">
            {/* §7.2 bước 4: hiển thị file đã chọn và lượng nội dung dự kiến gửi. */}
            {attachments.map((file) => (
              <span key={file.token} className="chip">
                📎 {file.fileName} <span className="muted">({formatBytes(file.sizeBytes)})</span>
                <button
                  type="button"
                  className="chip-close"
                  aria-label={`Bỏ ${file.fileName}`}
                  onClick={() => removeAttachment(file.token)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {attachments.length > 0 && props.settings?.warnBeforeSendingDocuments === true && (
          // §11.2: "Nexa phải hiển thị cảnh báo dữ liệu".
          <p className="warning-inline">
            Nội dung các file này sẽ được gửi tới model qua LiteLLM. Chỉ đính kèm tài liệu mà bạn
            được phép chia sẻ với dịch vụ AI của tổ chức.
          </p>
        )}

        {documentPolicyBlocked && attachments.length > 0 && (
          <p className="error-inline">
            Model đang chọn không nằm trong danh sách được phép nhận tài liệu nội bộ. Hãy đổi model
            trước khi gửi.
          </p>
        )}

        <div className="composer-row">
          <button type="button" className="icon-btn" title="Đính kèm tài liệu" onClick={pickFiles}>
            📎
          </button>
          <textarea
            className="composer-input"
            placeholder="Nhập câu hỏi… (Ctrl+Enter để gửi)"
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                submit()
              }
            }}
          />
          {props.streaming ? (
            <button type="button" className="btn btn-danger" onClick={props.onCancel}>
              Dừng
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={draft.trim() === '' || documentPolicyBlocked}
            >
              Gửi
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ModelSelector(props: {
  models: readonly ModelConfig[]
  value: string
  onChange: (modelId: string) => void
}): React.JSX.Element {
  if (props.models.length === 0) {
    return <span className="muted small">Chưa cấu hình model nào</span>
  }
  return (
    <select
      className="input input-compact"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      aria-label="Chọn model"
    >
      {props.models.map((model) => (
        <option key={model.id} value={model.modelId}>
          {model.displayName}
          {model.verified ? '' : ' (chưa kiểm chứng)'}
        </option>
      ))}
    </select>
  )
}

function MessageBubble(props: { message: Message }): React.JSX.Element {
  const { message } = props
  const roleLabel: Record<string, string> = {
    user: 'Bạn',
    assistant: 'Nexa',
    tool: 'Công cụ',
    system: 'Hệ thống',
  }

  return (
    <article className={`message message-${message.role} status-${message.status}`}>
      <header className="message-header">
        <strong>{roleLabel[message.role] ?? message.role}</strong>
        <span className="muted small">
          {new Date(message.createdAt).toLocaleTimeString('vi-VN')}
        </span>
      </header>

      {message.attachments !== undefined && message.attachments.length > 0 && (
        <div className="attachments">
          {message.attachments.map((file) => (
            <span key={file.id} className="chip chip-static">
              📎 {file.fileName}
              <span className="muted"> · {file.extractedChars.toLocaleString('vi-VN')} ký tự</span>
              {file.suspectedScan === true && (
                <span className="warning-tag" title="PDF có thể là bản scan, không có lớp văn bản">
                  nghi bản scan
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="message-body">
        {message.content === '' && message.status === 'streaming' ? (
          <span className="typing">Đang trả lời…</span>
        ) : (
          message.content
        )}
      </div>

      {message.toolCalls !== undefined && message.toolCalls.length > 0 && (
        <ul className="tool-calls">
          {message.toolCalls.map((call) => (
            <li key={call.id} className={`tool-call op-${call.operationStatus}`}>
              <code>{call.toolName}</code>
              <span className={`risk-badge risk-${call.riskLevel.toLowerCase()}`}>
                {call.riskLevel}
              </span>
              <span className="muted">{describeToolCall(call.operationStatus, call.approvalStatus)}</span>
              {call.resultSummary !== undefined && <span> — {call.resultSummary}</span>}
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
