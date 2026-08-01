import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PROVIDER_LABELS,
  isExternalProvider,
  type AppSettings,
  type Conversation,
  type LlmProvider,
  type ModelConfig,
  type Message,
} from '@nexa/shared-types'
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
  onSend: (
    content: string,
    fileTokens: string[],
    model?: { modelId: string; provider: LlmProvider },
  ) => void
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

  /**
   * Model đang chọn, xác định bằng khoá tổng hợp `provider:modelId`.
   *
   * Không dùng riêng model id: cùng một id có thể tồn tại ở LiteLLM và ở OpenAI, và hai lựa
   * chọn đó gửi dữ liệu tới hai nơi khác nhau. Nhầm ở đây là gửi sai đích.
   */
  const modelKey = (m: ModelConfig): string => `${m.provider}:${m.modelId}`
  const conversationKey =
    props.conversation?.modelId !== null &&
    props.conversation?.modelId !== undefined &&
    props.conversation.modelProvider !== null
      ? `${props.conversation.modelProvider}:${props.conversation.modelId}`
      : null
  const defaultModel = props.models.find((m) => m.isDefault) ?? props.models[0]
  const selectedKey =
    modelOverride ?? conversationKey ?? (defaultModel === undefined ? '' : modelKey(defaultModel))
  const selectedModel = props.models.find((m) => modelKey(m) === selectedKey) ?? null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [props.messages])

  /**
   * Chính sách tài liệu, phản chiếu đúng logic ở main (`document-policy.ts`).
   *
   * Provider ngoài là FAIL-CLOSED: phải được allowlist tường minh. Kiểm tra ở đây để khoá nút
   * Gửi trước khi người dùng bấm — main vẫn là chốt chặn thật, đây chỉ là để không dẫn người
   * dùng vào một hành động sẽ bị từ chối.
   */
  const documentPolicy = useMemo(() => {
    if (selectedModel === null) return { blocked: false, reason: '' }
    const allowlist = props.settings?.documentAllowedModels ?? []
    if (isExternalProvider(selectedModel.provider)) {
      // Danh sách RIÊNG và fail-closed — xem document-policy.ts.
      const key = `${selectedModel.provider}:${selectedModel.modelId}`
      return (props.settings?.externalDocumentAllowedModels ?? []).includes(key)
        ? { blocked: false, reason: '' }
        : {
            blocked: true,
            reason:
              'Không thể gửi tài liệu tới model bên ngoài tổ chức. Hãy chọn một model chạy qua LiteLLM nội bộ.',
          }
    }
    if (allowlist.length === 0 || allowlist.includes(selectedModel.modelId)) {
      return { blocked: false, reason: '' }
    }
    return {
      blocked: true,
      reason: 'Model đang chọn không nằm trong danh sách được phép nhận tài liệu nội bộ.',
    }
  }, [props.settings, selectedModel])

  const externalSelected = selectedModel !== null && isExternalProvider(selectedModel.provider)

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
      selectedModel === null
        ? undefined
        : { modelId: selectedModel.modelId, provider: selectedModel.provider },
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
            {selectedModel !== null && ` · ${selectedModel.modelId}`}
          </span>
        </div>
        <div className="chat-header-right">
          {externalSelected && (
            <span className="external-tag" title="Dữ liệu gửi ra ngoài tổ chức">
              ngoài tổ chức
            </span>
          )}
          <ModelSelector
            models={props.models}
            value={selectedKey}
            onChange={(key) => {
              setModelOverride(key)
              const picked = props.models.find((m) => modelKey(m) === key)
              props.onToast({
                kind: picked !== undefined && isExternalProvider(picked.provider) ? 'warning' : 'info',
                title:
                  picked === undefined
                    ? 'Đã đổi model'
                    : `Lượt sau dùng ${picked.modelId} — ${PROVIDER_LABELS[picked.provider]}`,
              })
            }}
          />
        </div>
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

        {attachments.length > 0 &&
          !documentPolicy.blocked &&
          props.settings?.warnBeforeSendingDocuments === true && (
            // §11.2: "Nexa phải hiển thị cảnh báo dữ liệu".
            <p className="warning-inline">
              Nội dung các file này sẽ được gửi tới{' '}
              {selectedModel === null ? 'model' : PROVIDER_LABELS[selectedModel.provider]}. Chỉ
              đính kèm tài liệu mà bạn được phép chia sẻ.
            </p>
          )}

        {documentPolicy.blocked && attachments.length > 0 && (
          <p className="error-inline">{documentPolicy.reason}</p>
        )}

        {externalSelected && attachments.length === 0 && (
          <p className="warning-inline">
            Model đang chọn nằm ngoài tổ chức. Câu hỏi của bạn sẽ được gửi tới{' '}
            {PROVIDER_LABELS[selectedModel.provider]} — đừng dán dữ liệu nhạy cảm.
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
              disabled={
                draft.trim() === '' || (attachments.length > 0 && documentPolicy.blocked)
              }
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
        <option key={model.id} value={`${model.provider}:${model.modelId}`}>
          {model.displayName}
          {isExternalProvider(model.provider) ? ' ⚠ ngoài tổ chức' : ''}
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
