import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  ConfirmationRequest,
  Conversation,
  McpStatusEvent,
  Message,
  ModelConfig,
} from '@nexa/shared-types'
import { BridgeError, api, events } from './bridge.js'
import { Sidebar } from './components/Sidebar.js'
import { ChatView } from './components/ChatView.js'
import { SettingsView } from './components/SettingsView.js'
import { ConfirmationDialog } from './components/ConfirmationDialog.js'
import { Toasts, type Toast } from './components/Toasts.js'
import { UncertainBanner } from './components/UncertainBanner.js'

export type View = 'chat' | 'settings'

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>('chat')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [models, setModels] = useState<ModelConfig[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [mcpStatus, setMcpStatus] = useState<McpStatusEvent | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [streamingRequestId, setStreamingRequestId] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [booting, setBooting] = useState(true)

  const toastSeq = useRef(0)

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++toastSeq.current
    setToasts((prev) => [...prev, { ...toast, id }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 8_000)
  }, [])

  const reportError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof BridgeError) {
        pushToast({
          kind: 'error',
          title: error.message,
          detail: [error.hint, error.requestId === undefined ? null : `Mã yêu cầu: ${error.requestId}`]
            .filter((v): v is string => typeof v === 'string')
            .join(' · '),
        })
      } else {
        pushToast({ kind: 'error', title: fallback })
      }
    },
    [pushToast],
  )

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await api.conversations.list())
    } catch (error) {
      reportError(error, 'Không tải được danh sách hội thoại.')
    }
  }, [reportError])

  const loadMessages = useCallback(
    async (conversationId: string) => {
      try {
        setMessages(await api.conversations.messages(conversationId))
      } catch (error) {
        reportError(error, 'Không tải được nội dung hội thoại.')
      }
    },
    [reportError],
  )

  // ── Khởi động ─────────────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const [conversationList, modelList, settingsResult, status] = await Promise.all([
          api.conversations.list(),
          api.models.list(),
          api.settings.get(),
          api.mcp.status().catch(() => null),
        ])
        setConversations(conversationList)
        setModels(modelList)
        setSettings(settingsResult.settings)
        setMcpStatus(status)

        const first = conversationList[0]
        if (first !== undefined) {
          setActiveId(first.id)
          await loadMessages(first.id)
        }
        // Chưa có kết nối LiteLLM thì đưa thẳng vào Settings — không để người dùng
        // gõ câu hỏi rồi mới nhận lỗi cấu hình.
        const connections = await api.connections.list()
        if (!connections.some((c) => c.type === 'litellm' && c.hasCredential)) {
          setView('settings')
        }
      } catch (error) {
        reportError(error, 'Nexa khởi động chưa hoàn tất.')
      } finally {
        setBooting(false)
      }
    })()
  }, [loadMessages, reportError])

  // ── Sự kiện từ main ───────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribers = [
      events.onChatDelta((event) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId
              ? { ...m, content: m.content + event.delta, status: 'streaming' }
              : m,
          ),
        )
      }),

      events.onChatDone((event) => {
        setStreamingRequestId(null)
        setMessages((prev) =>
          prev.map((m) => (m.id === event.messageId ? { ...m, status: 'complete' } : m)),
        )
        if (event.truncatedContextCount > 0) {
          pushToast({
            kind: 'info',
            title: `Đã lược bỏ ${String(event.truncatedContextCount)} tin nhắn cũ khỏi ngữ cảnh`,
            detail: 'Hội thoại đã vượt giới hạn ngữ cảnh của model đang chọn.',
          })
        }
        void refreshConversations()
        void loadMessages(event.conversationId)
      }),

      events.onChatError((event) => {
        setStreamingRequestId(null)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId
              ? { ...m, status: 'error', errorCode: event.error.code }
              : m,
          ),
        )
        pushToast({
          kind: event.error.code === 'LLM_CANCELLED' ? 'info' : 'error',
          title: event.error.message,
          detail: `Mã yêu cầu: ${event.request_id}`,
        })
      }),

      events.onToolConfirmation((request) => setConfirmation(request)),

      events.onToolStatus((event) => {
        if (event.phase === 'uncertain') {
          pushToast({
            kind: 'warning',
            title: `Không rõ kết quả của ${event.toolName}`,
            detail: 'Hãy mở hội thoại và bấm “Kiểm tra kết quả” trước khi thử lại.',
          })
        }
        if (event.phase === 'done' && event.detail !== undefined) {
          pushToast({ kind: 'success', title: event.detail })
        }
      }),

      events.onMcpStatus((status) => setMcpStatus(status)),
    ]

    return () => {
      for (const off of unsubscribers) off()
    }
  }, [loadMessages, pushToast, refreshConversations])

  // ── Hành động ─────────────────────────────────────────────────────────

  const selectConversation = async (id: string): Promise<void> => {
    setActiveId(id)
    await loadMessages(id)
  }

  const createConversation = async (): Promise<void> => {
    try {
      const defaultModel = models.find((m) => m.isDefault) ?? models[0]
      const created = await api.conversations.create(
        'Hội thoại mới',
        defaultModel?.modelId ?? null,
      )
      setConversations((prev) => [created, ...prev])
      setActiveId(created.id)
      setMessages([])
      setView('chat')
    } catch (error) {
      reportError(error, 'Không tạo được hội thoại.')
    }
  }

  const sendMessage = async (
    content: string,
    fileTokens: string[],
    modelId?: string,
  ): Promise<void> => {
    if (activeId === null) return
    try {
      const { requestId } = await api.chat.send({
        conversationId: activeId,
        content,
        fileTokens,
        ...(modelId !== undefined ? { modelId } : {}),
      })
      setStreamingRequestId(requestId)
      await loadMessages(activeId)
    } catch (error) {
      reportError(error, 'Không gửi được tin nhắn.')
    }
  }

  const cancelStreaming = async (): Promise<void> => {
    if (streamingRequestId === null) return
    try {
      await api.chat.cancel(streamingRequestId)
    } catch (error) {
      reportError(error, 'Không huỷ được yêu cầu.')
    }
  }

  const approveTool = (operationId: string, payloadHash: string): void => {
    void (async () => {
      try {
        await api.tools.approve(operationId, payloadHash)
      } catch (error) {
        reportError(error, 'Không xác nhận được thao tác.')
      } finally {
        setConfirmation(null)
      }
    })()
  }

  const cancelTool = (operationId: string): void => {
    void (async () => {
      try {
        await api.tools.cancel(operationId)
      } catch {
        // Huỷ luôn thành công về mặt người dùng, kể cả khi main đã tự huỷ vì hết hạn.
      } finally {
        setConfirmation(null)
      }
    })()
  }

  if (booting) {
    return (
      <div className="boot">
        <div className="boot-logo">Nexa</div>
        <p>Đang khởi động…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <Sidebar
        view={view}
        conversations={conversations}
        activeId={activeId}
        mcpStatus={mcpStatus}
        onSelect={(id) => void selectConversation(id)}
        onCreate={() => void createConversation()}
        onDelete={(id) => {
          void (async () => {
            try {
              await api.conversations.remove(id)
              await refreshConversations()
              if (activeId === id) {
                setActiveId(null)
                setMessages([])
              }
            } catch (error) {
              reportError(error, 'Không xoá được hội thoại.')
            }
          })()
        }}
        onRename={(id, title) => {
          void (async () => {
            try {
              await api.conversations.rename(id, title)
              await refreshConversations()
            } catch (error) {
              reportError(error, 'Không đổi tên được hội thoại.')
            }
          })()
        }}
        onChangeView={setView}
        onError={reportError}
      />

      <main className="main">
        {/* §16: thao tác chưa rõ kết quả phải hiện ở chỗ người dùng nhìn thấy ngay, không
            chỉ nằm trong bong bóng tin nhắn cũ. */}
        <UncertainBanner
          onOpenConversation={(id) => {
            setView('chat')
            void selectConversation(id)
          }}
          onNotice={(message) => pushToast({ kind: 'info', title: message })}
          onError={reportError}
        />

        {view === 'chat' ? (
          <ChatView
            conversation={conversations.find((c) => c.id === activeId) ?? null}
            messages={messages}
            models={models}
            settings={settings}
            streaming={streamingRequestId !== null}
            onSend={(content, tokens, modelId) => void sendMessage(content, tokens, modelId)}
            onCancel={() => void cancelStreaming()}
            onCreateConversation={() => void createConversation()}
            onError={reportError}
            onToast={pushToast}
          />
        ) : (
          <SettingsView
            models={models}
            settings={settings}
            onModelsChanged={(next) => setModels(next)}
            onSettingsChanged={(next) => setSettings(next)}
            onError={reportError}
            onToast={pushToast}
          />
        )}
      </main>

      {confirmation !== null && (
        <ConfirmationDialog
          request={confirmation}
          onApprove={approveTool}
          onCancel={cancelTool}
        />
      )}

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />
    </div>
  )
}
