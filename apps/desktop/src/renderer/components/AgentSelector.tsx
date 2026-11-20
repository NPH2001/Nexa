import { useEffect, useState } from 'react'
import type { Agent, Conversation } from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { describeActiveAgent, selectableAgents } from './agent-ui.js'

/**
 * Bộ chọn agent của một hội thoại.
 *
 * Danh sách tự tải lại mỗi khi đổi hội thoại để agent vừa tạo/archive ở màn hình Agent hiện ngay.
 * Chọn agent có thể đổi cả model của hội thoại (D4), nên sau khi gắn xong phải báo App tải lại
 * hội thoại — không tự suy ra model mới ở đây.
 */
export function AgentSelector(props: {
  conversation: Conversation
  /** Khoá lượt chat đang chạy: main từ chối đổi agent giữa lượt, nên không cho bấm. */
  disabled: boolean
  onChanged: () => Promise<void>
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element {
  const { conversation, onChanged, onError } = props
  const [agents, setAgents] = useState<Agent[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.agents
      .list(true)
      .then((list) => {
        if (!cancelled) setAgents(list)
      })
      .catch((error: unknown) => {
        if (!cancelled) onError(error, 'Không tải được danh sách agent.')
      })
    return () => {
      cancelled = true
    }
  }, [conversation.id, conversation.agentId, onError])

  const options = selectableAgents(agents, conversation.agentId)
  const current = agents.find((agent) => agent.id === conversation.agentId) ?? null

  const change = (value: string): void => {
    setSaving(true)
    void (async () => {
      try {
        await api.conversations.setAgent(conversation.id, value === '' ? null : value)
        await onChanged()
      } catch (error) {
        onError(error, 'Không đổi được agent của hội thoại.')
      } finally {
        setSaving(false)
      }
    })()
  }

  return (
    <select
      className="input input-compact"
      value={conversation.agentId ?? ''}
      disabled={props.disabled || saving}
      aria-label="Chọn agent"
      title={current === null ? 'Persona mặc định của Nexa' : describeActiveAgent(current)}
      onChange={(event) => change(event.target.value)}
    >
      <option value="">Agent: Mặc định</option>
      {options.map((agent) => (
        <option key={agent.id} value={agent.id}>
          {agent.icon} {agent.name}
          {agent.archived ? ' (đã lưu trữ)' : ''}
        </option>
      ))}
    </select>
  )
}
