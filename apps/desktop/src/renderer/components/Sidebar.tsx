import { useState } from 'react'
import type { Conversation, McpStatusEvent } from '@nexa/shared-types'
import { api } from '../bridge.js'
import type { View } from '../App.js'

interface SearchState {
  query: string
  hits: { conversationId: string; conversationTitle: string; messageId: string; snippet: string }[]
  truncated: boolean
  searching: boolean
}

export function Sidebar(props: {
  view: View
  conversations: readonly Conversation[]
  activeId: string | null
  mcpStatus: McpStatusEvent | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onChangeView: (view: View) => void
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element {
  const [search, setSearch] = useState<SearchState>({
    query: '',
    hits: [],
    truncated: false,
    searching: false,
  })
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const runSearch = (query: string): void => {
    setSearch((prev) => ({ ...prev, query }))
    if (query.trim().length < 2) {
      setSearch({ query, hits: [], truncated: false, searching: false })
      return
    }
    void (async () => {
      setSearch((prev) => ({ ...prev, searching: true }))
      try {
        const result = await api.conversations.search(query)
        setSearch({ query, hits: result.hits, truncated: result.truncated, searching: false })
      } catch (error) {
        props.onError(error, 'Không tìm kiếm được.')
        setSearch((prev) => ({ ...prev, searching: false }))
      }
    })()
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">Nexa</div>
        <button type="button" className="btn btn-primary btn-block" onClick={props.onCreate}>
          + Hội thoại mới
        </button>
        <input
          type="search"
          className="input"
          placeholder="Tìm trong hội thoại…"
          value={search.query}
          onChange={(e) => runSearch(e.target.value)}
        />
      </div>

      <nav className="conversation-list">
        {search.query.trim().length >= 2 ? (
          <>
            {search.searching && <p className="muted small">Đang tìm…</p>}
            {!search.searching && search.hits.length === 0 && (
              <p className="muted small">Không tìm thấy kết quả nào.</p>
            )}
            {search.hits.map((hit) => (
              <button
                key={hit.messageId}
                type="button"
                className="conversation-item"
                onClick={() => props.onSelect(hit.conversationId)}
              >
                <span className="conversation-title">{hit.conversationTitle}</span>
                <span className="snippet">{hit.snippet}</span>
              </button>
            ))}
            {/*
              §8.1 lưu nội dung đã mã hoá nên tìm kiếm phải giải mã và quét theo lô, có trần.
              Chạm trần thì phải nói rõ, không được để người dùng tưởng là đã tìm hết.
            */}
            {search.truncated && (
              <p className="muted small">
                Kết quả chưa đầy đủ — lịch sử quá dài để quét hết. Hãy thu hẹp từ khoá.
              </p>
            )}
          </>
        ) : (
          props.conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`conversation-row ${conversation.id === props.activeId ? 'active' : ''}`}
            >
              {renamingId === conversation.id ? (
                <input
                  className="input input-inline"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    if (renameValue.trim() !== '') props.onRename(conversation.id, renameValue.trim())
                    setRenamingId(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="conversation-item"
                  onClick={() => props.onSelect(conversation.id)}
                  onDoubleClick={() => {
                    setRenamingId(conversation.id)
                    setRenameValue(conversation.title)
                  }}
                >
                  <span className="conversation-title">{conversation.title}</span>
                  <span className="muted small">
                    {conversation.messageCount} tin nhắn · {formatDate(conversation.updatedAt)}
                  </span>
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label="Xoá hội thoại"
                title="Xoá hội thoại"
                onClick={() => props.onDelete(conversation.id)}
              >
                🗑
              </button>
            </div>
          ))
        )}
      </nav>

      <div className="sidebar-bottom">
        <McpBadge status={props.mcpStatus} />
        <button
          type="button"
          className={`btn btn-block ${props.view === 'settings' ? 'btn-active' : ''}`}
          onClick={() => props.onChangeView(props.view === 'settings' ? 'chat' : 'settings')}
        >
          {props.view === 'settings' ? '← Quay lại hội thoại' : '⚙ Cài đặt'}
        </button>
      </div>
    </aside>
  )
}

function McpBadge(props: { status: McpStatusEvent | null }): React.JSX.Element {
  const state = props.status?.state ?? 'stopped'
  const label: Record<string, string> = {
    ready: `Jira/Confluence sẵn sàng (${String(props.status?.toolCount ?? 0)} công cụ)`,
    starting: 'Đang kết nối Jira/Confluence…',
    error: 'Không kết nối được Jira/Confluence',
    stopped: 'Chưa cấu hình Jira/Confluence',
  }
  return (
    <div className={`mcp-badge mcp-${state}`} title={props.status?.errorCode ?? ''}>
      <span className="dot" />
      {label[state]}
    </div>
  )
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}
