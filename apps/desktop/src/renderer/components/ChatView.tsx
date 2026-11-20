import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  PROVIDER_LABELS,
  isExternalProvider,
  type AppSettings,
  type ChatGptModel,
  type ChatModelProvider,
  type Conversation,
  type ModelConfig,
  type Message,
} from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { formatFileSize } from './file-block-ui.js'
import { sendBlockedReason } from './composer-ui.js'
import type { Toast } from './Toasts.js'
import { NexaMark } from './NexaMark.js'
import { UiIcon } from './UiIcon.js'
import { MessageBubble } from './MessageBubble.js'
import { AgentSelector } from './AgentSelector.js'

interface Attachment {
  readonly token: string
  readonly fileName: string
  readonly sizeBytes: number
}

interface ChatModelOption {
  readonly key: string
  readonly source: 'configured' | 'chatgpt'
  readonly provider: ChatModelProvider
  readonly modelId: string
  readonly displayName: string
  readonly isDefault: boolean
  readonly verified: boolean
  readonly supportsVision: boolean
  readonly defaultReasoningEffort?: string
}

/**
 * Phần mở rộng của những file được xử lý như ảnh.
 *
 * Renderer không đọc được file (§5.3) nên chỉ có tên để dựa vào. Chấp nhận được: đây là để
 * hiện đúng biểu tượng và cảnh báo sớm, còn kết luận thật vẫn do main process rút ra từ magic
 * bytes. Đoán sai theo tên chỉ làm cảnh báo hiện thừa hoặc thiếu, không mở thêm đường nào.
 */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

function looksLikeImage(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

export function ChatView(props: {
  conversation: Conversation | null
  messages: readonly Message[]
  models: readonly ModelConfig[]
  chatGptModels: readonly ChatGptModel[]
  settings: AppSettings | null
  busy: boolean
  streaming: boolean
  canCancel: boolean
  onSend: (
    content: string,
    fileTokens: string[],
    model?: {
      modelId: string
      provider: ChatModelProvider
      reasoningEffort?: string
    },
  ) => void
  onCancel: () => void
  onCreateConversation: () => void
  /** Tải lại hội thoại sau khi đổi agent (gắn agent có thể đổi cả model). */
  onConversationChanged: () => Promise<void>
  onEditMessage: (id: string, content: string) => void
  onDeleteMessage: (id: string) => void
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  // Model chọn ở dropdown áp cho lượt gửi KẾ TIẾP; các lượt đã xong giữ nguyên model của chúng.
  const [modelOverride, setModelOverride] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const composerIsComposing = useRef(false)

  const modelOptions = useMemo<ChatModelOption[]>(
    () => [
      ...props.models.map((model) => ({
        key: `${model.provider}:${model.modelId}`,
        source: 'configured' as const,
        provider: model.provider,
        modelId: model.modelId,
        displayName: model.displayName,
        isDefault: model.isDefault,
        verified: model.verified,
        supportsVision: model.supportsVision,
      })),
      ...props.chatGptModels.map((model) => ({
        key: `chatgpt:${model.modelId}`,
        source: 'chatgpt' as const,
        provider: 'chatgpt' as const,
        modelId: model.modelId,
        displayName: model.displayName,
        isDefault: model.isDefault,
        verified: true,
        // Chat qua tài khoản ChatGPT hiện không nhận đính kèm nào, kể cả ảnh.
        supportsVision: false,
        ...(model.defaultReasoningEffort === null
          ? {}
          : { defaultReasoningEffort: model.defaultReasoningEffort }),
      })),
    ],
    [props.chatGptModels, props.models],
  )

  /**
   * Model đang chọn, xác định bằng khoá tổng hợp `provider:modelId`.
   *
   * Không dùng riêng model id: cùng một id có thể tồn tại ở LiteLLM và ở OpenAI, và hai lựa
   * chọn đó gửi dữ liệu tới hai nơi khác nhau. Nhầm ở đây là gửi sai đích.
   */
  const conversationKey =
    props.conversation?.modelId !== null &&
    props.conversation?.modelId !== undefined &&
    props.conversation.modelProvider !== null
      ? `${props.conversation.modelProvider}:${props.conversation.modelId}`
      : null
  const configuredDefault = modelOptions.find(
    (model) => model.source === 'configured' && model.isDefault,
  )
  const configuredFirst = modelOptions.find((model) => model.source === 'configured')
  const chatGptDefault = modelOptions.find((model) => model.source === 'chatgpt' && model.isDefault)
  const chatGptFirst = modelOptions.find((model) => model.source === 'chatgpt')
  const defaultModel = configuredDefault ?? configuredFirst ?? chatGptDefault ?? chatGptFirst
  const selectedKey =
    modelOverride ?? conversationKey ?? (defaultModel === undefined ? '' : defaultModel.key)
  const selectedModel = modelOptions.find((model) => model.key === selectedKey) ?? null
  const selectedModelUnavailable = selectedKey !== '' && selectedModel === null

  useEffect(() => {
    setModelOverride(null)
  }, [props.conversation?.id])

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    bottomRef.current?.scrollIntoView({
      behavior: reduceMotion || props.streaming ? 'auto' : 'smooth',
    })
  }, [props.messages, props.streaming])

  /**
   * Chính sách tài liệu, phản chiếu đúng logic ở main (`document-policy.ts`).
   *
   * Provider ngoài là FAIL-CLOSED: phải được allowlist tường minh. Kiểm tra ở đây để khoá nút
   * Gửi trước khi người dùng bấm — main vẫn là chốt chặn thật, đây chỉ là để không dẫn người
   * dùng vào một hành động sẽ bị từ chối.
   */
  const documentPolicy = useMemo(() => {
    if (selectedModel === null) return { blocked: false, reason: '' }
    if (selectedModel.provider === 'chatgpt') {
      return {
        blocked: true,
        reason:
          'Chat bằng tài khoản ChatGPT Plus hiện chỉ hỗ trợ văn bản. Hãy bỏ file hoặc chọn model API đã cấu hình.',
      }
    }
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
  const imageAttachmentCount = attachments.filter((file) => looksLikeImage(file.fileName)).length

  /**
   * Năng lực đọc ảnh, phản chiếu `assertModelSupportsImages` ở main.
   *
   * Tách khỏi `documentPolicy` đúng như bên main: một bên là được phép hay không, một bên là
   * làm được hay không. Gộp lại thì thông báo cho người dùng sẽ sai một nửa.
   */
  const imageBlocked =
    imageAttachmentCount > 0 && selectedModel !== null && !selectedModel.supportsVision

  const sendReason = sendBlockedReason({
    busy: props.busy,
    draft,
    modelMissing: selectedModel === null,
    documentBlocked: attachments.length > 0 && documentPolicy.blocked,
    imageBlocked,
  })

  if (props.conversation === null) {
    return (
      <div className="empty-state">
        <NexaMark size={64} />
        <h2>Chưa có hội thoại nào đang mở</h2>
        <p className="muted">Tạo một hội thoại mới để bắt đầu.</p>
        <button type="button" className="btn btn-primary" onClick={props.onCreateConversation}>
          <UiIcon name="plus" />
          Hội thoại mới
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
    void api.files
      .release(token)
      .catch((error: unknown) => props.onError(error, 'Không giải phóng được file đính kèm.'))
    setAttachments((prev) => prev.filter((a) => a.token !== token))
  }

  const submit = (): void => {
    const content = draft.trim()
    if (content === '' || props.busy || selectedModel === null) return
    props.onSend(
      content,
      attachments.map((a) => a.token),
      {
        modelId: selectedModel.modelId,
        provider: selectedModel.provider,
        ...(selectedModel.defaultReasoningEffort === undefined
          ? {}
          : { reasoningEffort: selectedModel.defaultReasoningEffort }),
      },
    )
    setDraft('')
    setAttachments([])
  }

  return (
    <div className="chat">
      <header className="chat-header">
        <div className="chat-heading">
          <h2>{props.conversation.title}</h2>
          <span className="muted small">
            {props.conversation.messageCount} tin nhắn
            {selectedModel !== null && ` · ${selectedModel.modelId}`}
          </span>
        </div>
        <div className="chat-header-right">
          {externalSelected && (
            <span className="external-tag" title="Dữ liệu gửi ra ngoài tổ chức">
              <UiIcon name="building" size={18} />
              Ngoài tổ chức
            </span>
          )}
          <AgentSelector
            conversation={props.conversation}
            disabled={props.busy}
            onChanged={props.onConversationChanged}
            onError={props.onError}
          />
          <ModelSelector
            models={modelOptions}
            value={selectedKey}
            onChange={(key) => {
              setModelOverride(key)
              const picked = modelOptions.find((model) => model.key === key)
              props.onToast({
                kind:
                  picked !== undefined && isExternalProvider(picked.provider) ? 'warning' : 'info',
                title:
                  picked === undefined
                    ? 'Đã đổi model'
                    : `Lượt sau dùng ${picked.modelId} — ${PROVIDER_LABELS[picked.provider]}`,
              })
            }}
          />
          <span className="chat-avatar" aria-hidden="true">
            N
          </span>
        </div>
      </header>

      <div className="messages">
        {props.messages.length === 0 && (
          <ChatStarters
            onPick={(prompt) => {
              setDraft(prompt)
              composerRef.current?.focus()
            }}
          />
        )}
        {props.messages.map((message, index) => {
          const date = new Date(message.createdAt)
          const previous = props.messages[index - 1]
          const startsDay =
            previous === undefined ||
            new Date(previous.createdAt).toDateString() !== date.toDateString()
          return (
            <Fragment key={message.id}>
              {startsDay && (
                <div className="message-date">
                  <time dateTime={message.createdAt}>
                    {date.toDateString() === new Date().toDateString()
                      ? 'Hôm nay'
                      : date.toLocaleDateString('vi-VN')}
                  </time>
                </div>
              )}
              <MessageBubble
                message={message}
                onEdit={(content) => props.onEditMessage(message.id, content)}
                onDelete={() => props.onDeleteMessage(message.id)}
                onCopy={() => {
                  void navigator.clipboard.writeText(message.content).then(
                    () => props.onToast({ kind: 'info', title: 'Đã sao chép tin nhắn' }),
                    (error: unknown) => props.onError(error, 'Không sao chép được tin nhắn.'),
                  )
                }}
                onToast={props.onToast}
                onError={props.onError}
              />
            </Fragment>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        {selectedModelUnavailable && (
          <p className="error-inline">
            Model đã lưu cho hội thoại này hiện không còn khả dụng. Hãy đăng nhập lại trong Cài đặt
            hoặc chọn một model khác.
          </p>
        )}

        {attachments.length > 0 && (
          <div className="attachments">
            {/* §7.2 bước 4: hiển thị file đã chọn và lượng nội dung dự kiến gửi. */}
            {attachments.map((file) => (
              <span key={file.token} className="chip">
                {looksLikeImage(file.fileName) ? '🖼' : '📎'} {file.fileName}{' '}
                <span className="muted">({formatFileSize(file.sizeBytes)})</span>
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
              {selectedModel === null ? 'model' : PROVIDER_LABELS[selectedModel.provider]}. Chỉ đính
              kèm tài liệu mà bạn được phép chia sẻ.
            </p>
          )}

        {documentPolicy.blocked && attachments.length > 0 && (
          <p className="error-inline">{documentPolicy.reason}</p>
        )}

        {imageBlocked && !documentPolicy.blocked && (
          <p className="error-inline">
            Model đang chọn chỉ đọc văn bản, không xem được ảnh. Hãy chọn model khác, hoặc đánh dấu
            “Đọc được ảnh” cho model này trong Cài đặt → Model nếu nó thật sự hỗ trợ.
          </p>
        )}

        {externalSelected && attachments.length === 0 && (
          <p className="warning-inline">
            Model đang chọn nằm ngoài tổ chức. Câu hỏi của bạn sẽ được gửi tới{' '}
            {PROVIDER_LABELS[selectedModel.provider]} — đừng dán dữ liệu nhạy cảm.
          </p>
        )}

        <div className="composer-row">
          <button
            type="button"
            className="icon-btn composer-attach"
            aria-label="Đính kèm tài liệu hoặc ảnh"
            title={
              selectedModel?.provider === 'chatgpt'
                ? 'ChatGPT Plus / Codex hiện chỉ hỗ trợ chat văn bản'
                : 'Đính kèm tài liệu hoặc ảnh (Word, Excel, PowerPoint, PDF, TXT, PNG/JPEG/WebP/GIF)'
            }
            onClick={pickFiles}
            disabled={selectedModel === null || selectedModel.provider === 'chatgpt'}
          >
            <UiIcon name="attach" />
          </button>
          <textarea
            ref={composerRef}
            className="composer-input"
            aria-label="Nội dung câu hỏi"
            placeholder="Nhập câu hỏi… (Ctrl+Enter để gửi)"
            lang="vi"
            spellCheck
            autoCorrect="on"
            autoCapitalize="sentences"
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onCompositionStart={() => {
              composerIsComposing.current = true
            }}
            onCompositionEnd={() => {
              composerIsComposing.current = false
            }}
            onBlur={() => {
              composerIsComposing.current = false
            }}
            onKeyDown={(e) => {
              // Telex/VNI và các IME có thể phát Enter/keyCode 229 trong lúc đang ghép dấu.
              // Không preventDefault hay submit cho tới khi compositionend kết thúc.
              if (
                composerIsComposing.current ||
                e.nativeEvent.isComposing ||
                e.nativeEvent.keyCode === 229
              ) {
                return
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                submit()
              }
            }}
          />
          {props.streaming ? (
            <button
              type="button"
              className="btn btn-danger composer-submit"
              onClick={props.onCancel}
              disabled={!props.canCancel}
            >
              <UiIcon name="stop" size={20} />
              {props.canCancel ? 'Dừng' : 'Đang gửi…'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary composer-submit"
              onClick={submit}
              disabled={sendReason !== null}
              title={sendReason ?? 'Gửi (Ctrl+Enter)'}
            >
              <UiIcon name="send" size={21} />
              {props.busy ? 'Đang xử lý…' : 'Gửi'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ModelSelector(props: {
  models: readonly ChatModelOption[]
  value: string
  onChange: (modelId: string) => void
}): React.JSX.Element {
  if (props.models.length === 0) {
    return <span className="muted small">Chưa có model để chat</span>
  }
  const configuredModels = props.models.filter((model) => model.source === 'configured')
  const chatGptModels = props.models.filter((model) => model.source === 'chatgpt')
  const valueExists = props.models.some((model) => model.key === props.value)

  const renderOption = (model: ChatModelOption): React.JSX.Element => (
    <option key={model.key} value={model.key}>
      {model.displayName}
      {model.provider === 'chatgpt' ? ' · Plus' : ''}
      {model.source === 'configured' && isExternalProvider(model.provider)
        ? ' ⚠ ngoài tổ chức'
        : ''}
      {model.verified ? '' : ' (chưa kiểm chứng)'}
    </option>
  )

  return (
    <select
      className="input input-compact"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      aria-label="Chọn model"
    >
      {!valueExists && props.value !== '' && (
        <option value={props.value} disabled>
          Model không còn khả dụng
        </option>
      )}
      {configuredModels.length > 0 && (
        <optgroup label="Model đã cấu hình">{configuredModels.map(renderOption)}</optgroup>
      )}
      {chatGptModels.length > 0 && (
        <optgroup label="ChatGPT Plus / Codex">{chatGptModels.map(renderOption)}</optgroup>
      )}
    </select>
  )
}

/**
 * Gợi ý mở đầu cho hội thoại trống.
 *
 * Thay cho câu "Hãy đặt câu hỏi để bắt đầu.", câu kiểu "bắt đầu gõ…" chung chung mà DESIGN.md
 * tránh. Gợi ý xoay quanh việc nối tiếp công việc, không phải trò chuyện cho vui. Bấm vào chỉ
 * điền sẵn vào ô nhập để người dùng sửa trước khi gửi; không gửi gì thay họ.
 */
const CHAT_STARTERS: readonly string[] = [
  'Tóm tắt giúp mình những việc nên ưu tiên hôm nay',
  'Soạn email ngắn cập nhật tiến độ cho nhóm',
  'Rà soát tài liệu mình sắp đính kèm và chỉ ra chỗ còn thiếu',
  'Chia mục tiêu tuần này thành các bước nhỏ',
]

function ChatStarters(props: { onPick: (prompt: string) => void }): React.JSX.Element {
  return (
    <div className="chat-starters">
      <NexaMark size={48} />
      <h2>Mình bắt đầu từ đâu?</h2>
      <p className="muted">Chọn một gợi ý để điền sẵn câu hỏi, sửa lại nếu cần rồi gửi.</p>
      <ul className="chat-starter-list">
        {CHAT_STARTERS.map((prompt) => (
          <li key={prompt}>
            <button type="button" className="chat-starter" onClick={() => props.onPick(prompt)}>
              {prompt}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
