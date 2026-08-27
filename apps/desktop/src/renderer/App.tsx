import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  ConfirmationRequest,
  Conversation,
  LlmProvider,
  McpStatusEvent,
  Message,
  ModelConfig,
  OrgPolicy,
} from '@nexa/shared-types/renderer'
import { isProviderAllowedByPolicy } from '@nexa/shared-types/renderer'
import { BridgeError, api, events } from './bridge.js'
import { Sidebar } from './components/Sidebar.js'
import { ChatView } from './components/ChatView.js'
import { TodayView } from './components/TodayView.js'
import { GoalPanel } from './components/GoalPanel.js'
import { ActivityTimelineView } from './components/ActivityTimelineView.js'
import { SettingsView } from './components/SettingsView.js'
import { ConfirmationDialog } from './components/ConfirmationDialog.js'
import { DestructiveActionDialog } from './components/DestructiveActionDialog.js'
import { Toasts, type Toast } from './components/Toasts.js'
import { UncertainBanner } from './components/UncertainBanner.js'
import {
  beginChatActivity,
  bindChatRequest,
  completeChatActivity,
  type ChatActivity,
} from './chat-activity.js'
import { commitThenRefresh } from './committed-mutation.js'

export type View = 'today' | 'goals' | 'activity' | 'chat' | 'settings'

const TITLE_LIMIT = 60

type PendingDeletion =
  { kind: 'conversation'; id: string; title: string } | { kind: 'message'; id: string }

function deriveTitleFromMessage(content: string): string {
  const singleLine = content.replace(/\s+/g, ' ').trim()
  return singleLine.length > TITLE_LIMIT
    ? `${singleLine.slice(0, TITLE_LIMIT).trimEnd()}…`
    : singleLine
}

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>('today')
  const [settingsInitialTab, setSettingsInitialTab] = useState<'litellm' | 'memory'>('litellm')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [models, setModels] = useState<ModelConfig[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [policy, setPolicy] = useState<OrgPolicy | null>(null)
  const [mcpStatus, setMcpStatus] = useState<McpStatusEvent | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [chatActivity, setChatActivity] = useState<ChatActivity | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [booting, setBooting] = useState(true)
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null)
  const [deleting, setDeleting] = useState(false)

  const toastSeq = useRef(0)
  const activeIdRef = useRef<string | null>(null)
  const messageLoadSequence = useRef(0)
  const completedChatRequests = useRef(new Set<string>())

  const setActiveConversation = useCallback((id: string | null) => {
    activeIdRef.current = id
    setActiveId(id)
  }, [])

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++toastSeq.current
    setToasts((prev) => [...prev, { ...toast, id }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 8_000)
  }, [])

  const finishChatActivity = useCallback((conversationId: string, requestId: string) => {
    setChatActivity((current) => {
      if (current?.conversationId === conversationId && current.requestId === null) {
        completedChatRequests.current.add(requestId)
      }
      return completeChatActivity(current, conversationId, requestId)
    })
  }, [])

  const reportError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof BridgeError) {
        pushToast({
          kind: 'error',
          title: error.message,
          detail: [
            error.hint,
            error.requestId === undefined ? null : `Mã yêu cầu: ${error.requestId}`,
          ]
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
      const requestSequence = ++messageLoadSequence.current
      try {
        const nextMessages = await api.conversations.messages(conversationId)
        if (
          requestSequence === messageLoadSequence.current &&
          activeIdRef.current === conversationId
        ) {
          setMessages(nextMessages)
        }
      } catch (error) {
        if (
          requestSequence === messageLoadSequence.current &&
          activeIdRef.current === conversationId
        ) {
          reportError(error, 'Không tải được nội dung hội thoại.')
        }
      }
    },
    [reportError],
  )

  // ── Khởi động ─────────────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const [conversationList, modelList, settingsResult, policyResult, status] =
          await Promise.all([
            api.conversations.list(),
            api.models.list(),
            api.settings.get(),
            api.settings.policy(),
            api.mcp.status().catch(() => null),
          ])
        setConversations(conversationList)
        setModels(modelList)
        setSettings(settingsResult.settings)
        setPolicy(policyResult)
        setMcpStatus(status)

        const first = conversationList[0]
        if (first !== undefined) {
          setActiveConversation(first.id)
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
  }, [loadMessages, reportError, setActiveConversation])

  // ── Sự kiện từ main ───────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribers = [
      events.onChatDelta((event) => {
        if (activeIdRef.current !== event.conversationId) return
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId
              ? { ...m, content: m.content + event.delta, status: 'streaming' }
              : m,
          ),
        )
      }),

      events.onChatDone((event) => {
        finishChatActivity(event.conversationId, event.requestId)
        if (activeIdRef.current === event.conversationId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === event.messageId ? { ...m, status: 'complete' } : m)),
          )
        }
        if (event.truncatedContextCount > 0) {
          pushToast({
            kind: 'info',
            title: `Đã lược bỏ ${String(event.truncatedContextCount)} tin nhắn cũ khỏi ngữ cảnh`,
            detail: 'Hội thoại đã vượt giới hạn ngữ cảnh của model đang chọn.',
          })
        }
        void refreshConversations()
        if (activeIdRef.current === event.conversationId) {
          void loadMessages(event.conversationId)
        }
      }),

      events.onChatError((event) => {
        finishChatActivity(event.conversationId, event.request_id)
        if (activeIdRef.current === event.conversationId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.messageId ? { ...m, status: 'error', errorCode: event.error.code } : m,
            ),
          )
        }
        pushToast({
          kind: event.error.code === 'LLM_CANCELLED' ? 'info' : 'error',
          title: event.error.message,
          detail: [event.error.hint, `Mã yêu cầu: ${event.request_id}`]
            .filter((part): part is string => part !== undefined)
            .join(' · '),
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
        if (event.phase === 'failed') {
          pushToast({
            kind: 'error',
            title: event.detail ?? 'Công cụ không hoàn tất được yêu cầu.',
            detail: `Công cụ: ${event.toolName}`,
          })
        }
      }),

      events.onMcpStatus((status) => setMcpStatus(status)),

      // §18.2: bản cập nhật không bắt buộc thì chỉ thông báo. Trường hợp bắt buộc hoặc bản
      // đang chạy bị thu hồi do main process chặn thẳng bằng dialog rồi đóng app.
      events.onUpdateAvailable((event) => {
        pushToast({
          kind: 'info',
          title: event.message,
          detail: event.notes ?? 'Liên hệ bộ phận IT để cập nhật.',
        })
      }),
    ]

    return () => {
      for (const off of unsubscribers) off()
    }
  }, [finishChatActivity, loadMessages, pushToast, refreshConversations])

  // ── Hành động ─────────────────────────────────────────────────────────

  // Không có policy snapshot thì fail closed với provider ngoài; main process vẫn là cổng
  // cưỡng chế cuối cùng nếu renderer bị sửa hoặc IPC được gọi trực tiếp.
  const usableModels = models.filter(
    (model) =>
      model.provider === 'litellm' ||
      (policy !== null && isProviderAllowedByPolicy(model.provider, policy)),
  )

  const selectConversation = async (id: string): Promise<void> => {
    setView('chat')
    setActiveConversation(id)
    setMessages([])
    await loadMessages(id)
  }

  const createConversation = async (): Promise<void> => {
    try {
      const defaultModel = usableModels.find((m) => m.isDefault) ?? usableModels[0]
      const created = await api.conversations.create(
        'Hội thoại mới',
        defaultModel === undefined
          ? null
          : { modelId: defaultModel.modelId, provider: defaultModel.provider },
      )
      setConversations((prev) => [created, ...prev])
      messageLoadSequence.current += 1
      setActiveConversation(created.id)
      setMessages([])
      setView('chat')
    } catch (error) {
      reportError(error, 'Không tạo được hội thoại.')
    }
  }

  const sendMessage = async (
    content: string,
    fileTokens: string[],
    model?: { modelId: string; provider: LlmProvider },
  ): Promise<void> => {
    if (activeId === null || chatActivity !== null) return
    const conversationId = activeId
    setChatActivity(beginChatActivity(conversationId))
    try {
      const active = conversations.find((c) => c.id === conversationId)
      const { requestId } = await api.chat.send({
        conversationId,
        content,
        fileTokens,
        ...(model !== undefined ? { modelId: model.modelId, modelProvider: model.provider } : {}),
      })
      const alreadyCompleted = completedChatRequests.current.delete(requestId)
      setChatActivity((current) =>
        alreadyCompleted
          ? completeChatActivity(current, conversationId, requestId)
          : bindChatRequest(current, conversationId, requestId),
      )
      if (active !== undefined && active.messageCount === 0 && active.title === 'Hội thoại mới') {
        try {
          await api.conversations.rename(conversationId, deriveTitleFromMessage(content))
          await refreshConversations()
        } catch {
          // Đổi tên chỉ là tiện ích sau khi gửi; giữ luồng chat thành công nhưng không che lỗi.
          pushToast({
            kind: 'warning',
            title: 'Tin nhắn đã gửi nhưng chưa đổi tên được hội thoại.',
          })
        }
      }
      await loadMessages(conversationId)
    } catch (error) {
      setChatActivity((current) =>
        current?.conversationId === conversationId && current.requestId === null ? null : current,
      )
      reportError(error, 'Không gửi được tin nhắn.')
    }
  }

  const editMessage = async (id: string, content: string): Promise<void> => {
    try {
      await api.messages.edit(id, content)
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content, editedAt: new Date().toISOString() } : m)),
      )
    } catch (error) {
      reportError(error, 'Không sửa được tin nhắn.')
    }
  }

  const confirmDeletion = (): void => {
    if (pendingDeletion === null || deleting) return
    void (async () => {
      setDeleting(true)
      try {
        if (pendingDeletion.kind === 'conversation') {
          const conversationId = pendingDeletion.id
          await commitThenRefresh({
            commit: () => api.conversations.remove(conversationId),
            onCommitted: () => {
              setConversations((current) => current.filter((item) => item.id !== conversationId))
              if (activeIdRef.current === conversationId) {
                messageLoadSequence.current += 1
                setActiveConversation(null)
                setMessages([])
              }
              setPendingDeletion(null)
              pushToast({ kind: 'success', title: 'Đã xoá hội thoại.' })
            },
            refresh: async () => setConversations(await api.conversations.list()),
            onRefreshError: () =>
              pushToast({
                kind: 'warning',
                title: 'Đã xoá hội thoại nhưng chưa làm mới được danh sách.',
              }),
          })
        } else {
          await api.messages.remove(pendingDeletion.id)
          setMessages((prev) =>
            prev.map((message) =>
              message.id === pendingDeletion.id
                ? { ...message, content: '', deletedAt: new Date().toISOString() }
                : message,
            ),
          )
          pushToast({ kind: 'success', title: 'Đã xoá tin nhắn.' })
          setPendingDeletion(null)
        }
      } catch (error) {
        reportError(
          error,
          pendingDeletion.kind === 'conversation'
            ? 'Không xoá được hội thoại.'
            : 'Không xoá được tin nhắn.',
        )
      } finally {
        setDeleting(false)
      }
    })()
  }

  const cancelStreaming = async (): Promise<void> => {
    const requestId = chatActivity?.requestId
    if (requestId === null || requestId === undefined) return
    try {
      await api.chat.cancel(requestId)
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
      } catch (error) {
        // Main vẫn tự huỷ khi hết hạn, nhưng lỗi bridge cần hiện rõ để người dùng không hiểu
        // nhầm rằng yêu cầu huỷ đã được tiến trình chính tiếp nhận.
        reportError(error, 'Không gửi được yêu cầu huỷ; thao tác sẽ tự huỷ khi hết hạn.')
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
          if (chatActivity?.conversationId === id) {
            pushToast({
              kind: 'warning',
              title: 'Hãy dừng và chờ lượt chat kết thúc trước khi xoá hội thoại.',
            })
            return
          }
          const conversation = conversations.find((item) => item.id === id)
          setPendingDeletion({
            kind: 'conversation',
            id,
            title: conversation?.title ?? 'Hội thoại này',
          })
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
        onChangeView={(nextView) => {
          if (nextView === 'settings') setSettingsInitialTab('litellm')
          setView(nextView)
        }}
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

        {view === 'today' ? (
          <TodayView
            conversations={conversations}
            onOpenConversation={(id) => void selectConversation(id)}
            onCreateConversation={() => void createConversation()}
            onOpenGoals={() => setView('goals')}
            onOpenSettings={() => {
              setSettingsInitialTab('memory')
              setView('settings')
            }}
            onError={reportError}
          />
        ) : view === 'goals' ? (
          <GoalPanel
            conversations={conversations}
            onOpenConversation={(id) => void selectConversation(id)}
            onError={reportError}
            onToast={pushToast}
          />
        ) : view === 'activity' ? (
          <ActivityTimelineView onError={reportError} />
        ) : view === 'chat' ? (
          <ChatView
            conversation={conversations.find((c) => c.id === activeId) ?? null}
            messages={messages}
            models={usableModels}
            settings={settings}
            busy={chatActivity !== null}
            streaming={chatActivity?.conversationId === activeId}
            canCancel={chatActivity?.conversationId === activeId && chatActivity.requestId !== null}
            onSend={(content, tokens, model) => void sendMessage(content, tokens, model)}
            onCancel={() => void cancelStreaming()}
            onCreateConversation={() => void createConversation()}
            onEditMessage={(id, content) => void editMessage(id, content)}
            onDeleteMessage={(id) => setPendingDeletion({ kind: 'message', id })}
            onError={reportError}
            onToast={pushToast}
          />
        ) : (
          <SettingsView
            initialTab={settingsInitialTab}
            models={models}
            settings={settings}
            policy={policy}
            onModelsChanged={setModels}
            onSettingsChanged={setSettings}
            onError={reportError}
            onToast={pushToast}
          />
        )}
      </main>

      {pendingDeletion !== null && (
        <DestructiveActionDialog
          title={pendingDeletion.kind === 'conversation' ? 'Xoá hội thoại?' : 'Xoá tin nhắn?'}
          description={
            pendingDeletion.kind === 'conversation'
              ? `“${pendingDeletion.title}” và toàn bộ tin nhắn bên trong sẽ bị xoá khỏi máy này.`
              : 'Nội dung tin nhắn sẽ bị xoá khỏi lịch sử hội thoại.'
          }
          confirmLabel={pendingDeletion.kind === 'conversation' ? 'Xoá hội thoại' : 'Xoá tin nhắn'}
          busy={deleting}
          onConfirm={confirmDeletion}
          onCancel={() => setPendingDeletion(null)}
        />
      )}

      {/* Tool confirmation có TTL và có thể đến khi một modal khác đang mở, nên luôn đặt cuối
          DOM để nó là dialog trên cùng; focus trap chỉ điều khiển dialog cuối cùng. */}
      {confirmation !== null && (
        <ConfirmationDialog request={confirmation} onApprove={approveTool} onCancel={cancelTool} />
      )}

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />
    </div>
  )
}
