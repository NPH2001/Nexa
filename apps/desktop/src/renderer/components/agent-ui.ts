import { isExternalProvider } from '@nexa/shared-types/renderer'
import type { Agent, ChatModelProvider } from '@nexa/shared-types/renderer'

/**
 * Logic thuần của màn hình Agent: nhãn, kiểm tra form, quyết định hiện cảnh báo.
 * Tách khỏi component để test được mà không cần DOM.
 */

export interface AgentDraft {
  readonly name: string
  readonly icon: Agent['icon']
  readonly instructions: string
  readonly toolCeiling: Agent['toolCeiling']
  readonly commitments: boolean
  readonly baWorkbench: boolean
  /** `provider:modelId`, hoặc rỗng khi agent không gắn model. */
  readonly modelKey: string
}

export const AGENT_NAME_LIMIT = 60
export const AGENT_INSTRUCTIONS_LIMIT = 4_000

export const emptyAgentDraft = (): AgentDraft => ({
  name: '',
  icon: '🤖',
  instructions: '',
  toolCeiling: 'all',
  commitments: true,
  baWorkbench: true,
  modelKey: '',
})

/** Nhãn tiếng Việt cho từng trần tool; bắt buộc phủ đủ mọi preset (xem test). */
export const TOOL_CEILING_LABELS: Record<Agent['toolCeiling'], string> = {
  all: 'Toàn quyền (đọc và ghi, mọi hệ thống)',
  'all-read': 'Chỉ đọc, mọi hệ thống',
  'jira-read': 'Jira — chỉ đọc',
  'jira-full': 'Jira — đọc và ghi',
  'confluence-read': 'Confluence — chỉ đọc',
  'confluence-full': 'Confluence — đọc và ghi',
  'redmine-read': 'Redmine — chỉ đọc',
  'redmine-full': 'Redmine — đọc và ghi',
  'xwiki-read': 'XWiki — chỉ đọc',
  'xwiki-full': 'XWiki — đọc và ghi',
}

/** Thứ tự hiển thị trong ô chọn: an toàn nhất trước. */
export const TOOL_CEILING_OPTIONS: readonly Agent['toolCeiling'][] = [
  'all-read',
  'jira-read',
  'confluence-read',
  'redmine-read',
  'xwiki-read',
  'jira-full',
  'confluence-full',
  'redmine-full',
  'xwiki-full',
  'all',
]

export function describeToolCeiling(ceiling: Agent['toolCeiling']): string {
  return TOOL_CEILING_LABELS[ceiling]
}

/** `null` khi hợp lệ; ngược lại là câu báo lỗi cho người dùng. */
export function validateAgentDraft(draft: AgentDraft): string | null {
  const name = draft.name.trim()
  if (name === '') return 'Tên agent không được để trống.'
  if (name.length > AGENT_NAME_LIMIT) return `Tên agent tối đa ${String(AGENT_NAME_LIMIT)} ký tự.`
  if (draft.instructions.length > AGENT_INSTRUCTIONS_LIMIT) {
    return `Hướng dẫn tối đa ${String(AGENT_INSTRUCTIONS_LIMIT)} ký tự.`
  }
  return null
}

export function splitModelKey(
  key: string,
): { modelId: string; modelProvider: ChatModelProvider } | null {
  const at = key.indexOf(':')
  if (at <= 0 || at === key.length - 1) return null
  return {
    modelProvider: key.slice(0, at) as ChatModelProvider,
    modelId: key.slice(at + 1),
  }
}

export function toModelKey(agent: Pick<Agent, 'modelId' | 'modelProvider'>): string {
  return agent.modelId !== null && agent.modelProvider !== null
    ? `${agent.modelProvider}:${agent.modelId}`
    : ''
}

/** Draft → payload gửi main. Model luôn đi theo cặp (cùng có hoặc cùng null). */
export function draftToPayload(draft: AgentDraft): {
  name: string
  icon: Agent['icon']
  instructions: string
  toolCeiling: Agent['toolCeiling']
  localGroups: Agent['localGroups']
  modelId: string | null
  modelProvider: ChatModelProvider | null
} {
  const model = splitModelKey(draft.modelKey)
  return {
    name: draft.name.trim(),
    icon: draft.icon,
    instructions: draft.instructions,
    toolCeiling: draft.toolCeiling,
    localGroups: { commitments: draft.commitments, baWorkbench: draft.baWorkbench },
    modelId: model?.modelId ?? null,
    modelProvider: model?.modelProvider ?? null,
  }
}

export function agentToDraft(agent: Agent): AgentDraft {
  return {
    name: agent.name,
    icon: agent.icon,
    instructions: agent.instructions,
    toolCeiling: agent.toolCeiling,
    commitments: agent.localGroups.commitments,
    baWorkbench: agent.localGroups.baWorkbench,
    modelKey: toModelKey(agent),
  }
}

/**
 * Hướng dẫn của agent đi vào system prompt, nên khi model nằm ngoài tổ chức nó rời khỏi máy. Cảnh
 * báo chỉ hiện khi thật sự có hướng dẫn để gửi đi.
 */
export function shouldWarnExternalInstructions(draft: AgentDraft): boolean {
  if (draft.instructions.trim() === '') return false
  const model = splitModelKey(draft.modelKey)
  return model !== null && isExternalProvider(model.modelProvider)
}

/** Dòng mô tả ngắn hiển thị cạnh bộ chọn agent trong chat. */
export function describeActiveAgent(agent: Agent): string {
  return `${agent.name} · ${TOOL_CEILING_LABELS[agent.toolCeiling]}`
}

/** Agent chọn được cho hội thoại: chưa archive, trừ agent hội thoại đang dùng sẵn. */
export function selectableAgents(agents: readonly Agent[], currentAgentId: string | null): Agent[] {
  return agents.filter((agent) => !agent.archived || agent.id === currentAgentId)
}
