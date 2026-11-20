import { describe, expect, it } from 'vitest'
import type { Agent, ToolPreset } from '@nexa/shared-types/renderer'
import {
  AGENT_INSTRUCTIONS_LIMIT,
  AGENT_NAME_LIMIT,
  TOOL_CEILING_LABELS,
  TOOL_CEILING_OPTIONS,
  agentToDraft,
  describeActiveAgent,
  describeToolCeiling,
  draftToPayload,
  emptyAgentDraft,
  selectableAgents,
  shouldWarnExternalInstructions,
  splitModelKey,
  toModelKey,
  validateAgentDraft,
} from './agent-ui.js'

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    profileId: 'p',
    name: 'Trợ lý BA',
    icon: '📝',
    instructions: 'Trả lời ngắn.',
    toolCeiling: 'redmine-read',
    localGroups: { commitments: true, baWorkbench: false },
    modelId: null,
    modelProvider: null,
    archived: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  }
}

/**
 * Danh sách preset chép tay có chủ đích: entry renderer không export giá trị từ `tools.ts`.
 * `Record<ToolPreset, …>` làm trình biên dịch báo lỗi nếu thêm preset mà quên nhãn; test này giữ
 * cho chiều ngược lại (nhãn thừa, hoặc thiếu trong ô chọn) cũng không lệch.
 */
const EVERY_PRESET: readonly ToolPreset[] = [
  'jira-read',
  'jira-full',
  'confluence-read',
  'confluence-full',
  'redmine-read',
  'redmine-full',
  'xwiki-read',
  'xwiki-full',
  'all-read',
  'all',
]

describe('nhãn trần tool', () => {
  it('phủ đủ mọi preset, không thừa không thiếu', () => {
    expect(Object.keys(TOOL_CEILING_LABELS).sort()).toEqual([...EVERY_PRESET].sort())
    expect([...TOOL_CEILING_OPTIONS].sort()).toEqual([...EVERY_PRESET].sort())
  })

  it('đặt lựa chọn an toàn nhất lên đầu và toàn quyền ở cuối', () => {
    expect(TOOL_CEILING_OPTIONS[0]).toBe('all-read')
    expect(TOOL_CEILING_OPTIONS[TOOL_CEILING_OPTIONS.length - 1]).toBe('all')
  })

  it('nói rõ chỉ đọc hay đọc và ghi', () => {
    expect(describeToolCeiling('jira-read')).toContain('chỉ đọc')
    expect(describeToolCeiling('jira-full')).toContain('đọc và ghi')
  })
})

describe('validateAgentDraft', () => {
  const ok = { ...emptyAgentDraft(), name: 'BA' }

  it('chấp nhận draft hợp lệ', () => {
    expect(validateAgentDraft(ok)).toBeNull()
  })

  it('từ chối tên rỗng hoặc chỉ có khoảng trắng', () => {
    expect(validateAgentDraft({ ...ok, name: '   ' })).toMatch(/không được để trống/)
  })

  it('từ chối tên và hướng dẫn vượt giới hạn, chấp nhận đúng giới hạn', () => {
    expect(validateAgentDraft({ ...ok, name: 'a'.repeat(AGENT_NAME_LIMIT + 1) })).toMatch(/tối đa/)
    expect(validateAgentDraft({ ...ok, name: 'a'.repeat(AGENT_NAME_LIMIT) })).toBeNull()
    expect(
      validateAgentDraft({ ...ok, instructions: 'x'.repeat(AGENT_INSTRUCTIONS_LIMIT + 1) }),
    ).toMatch(/tối đa/)
    expect(
      validateAgentDraft({ ...ok, instructions: 'x'.repeat(AGENT_INSTRUCTIONS_LIMIT) }),
    ).toBeNull()
  })
})

describe('khoá model', () => {
  it('tách provider và model id, chịu được model id chứa dấu hai chấm', () => {
    expect(splitModelKey('litellm:gpt-x')).toEqual({
      modelProvider: 'litellm',
      modelId: 'gpt-x',
    })
    expect(splitModelKey('openai:ft:gpt-4o:org')).toEqual({
      modelProvider: 'openai',
      modelId: 'ft:gpt-4o:org',
    })
  })

  it('khoá rỗng hoặc thiếu một nửa thì không có model', () => {
    expect(splitModelKey('')).toBeNull()
    expect(splitModelKey('litellm:')).toBeNull()
    expect(splitModelKey(':gpt-x')).toBeNull()
    expect(splitModelKey('khong-co-dau')).toBeNull()
  })

  it('toModelKey đi ngược splitModelKey, và rỗng khi agent không có model', () => {
    expect(toModelKey(agent())).toBe('')
    expect(toModelKey(agent({ modelId: 'm', modelProvider: 'openai' }))).toBe('openai:m')
  })
})

describe('draft ↔ payload', () => {
  it('payload luôn có model đi theo cặp', () => {
    const none = draftToPayload({ ...emptyAgentDraft(), name: 'a' })
    expect(none.modelId).toBeNull()
    expect(none.modelProvider).toBeNull()

    const some = draftToPayload({ ...emptyAgentDraft(), name: 'a', modelKey: 'litellm:m' })
    expect(some.modelId).toBe('m')
    expect(some.modelProvider).toBe('litellm')
  })

  it('cắt khoảng trắng đầu cuối của tên nhưng giữ nguyên hướng dẫn', () => {
    const payload = draftToPayload({
      ...emptyAgentDraft(),
      name: '  BA  ',
      instructions: '  giữ nguyên  ',
    })
    expect(payload.name).toBe('BA')
    expect(payload.instructions).toBe('  giữ nguyên  ')
  })

  it('round-trip agent → draft → payload không đổi cấu hình', () => {
    const source = agent({ modelId: 'm', modelProvider: 'litellm' })
    const payload = draftToPayload(agentToDraft(source))
    expect(payload).toEqual({
      name: source.name,
      icon: source.icon,
      instructions: source.instructions,
      toolCeiling: source.toolCeiling,
      localGroups: source.localGroups,
      modelId: 'm',
      modelProvider: 'litellm',
    })
  })

  it('draft mới mặc định không thu hẹp tool cục bộ và không gắn model', () => {
    const draft = emptyAgentDraft()
    expect(draft.toolCeiling).toBe('all')
    expect(draft.commitments).toBe(true)
    expect(draft.baWorkbench).toBe(true)
    expect(draft.modelKey).toBe('')
  })
})

describe('shouldWarnExternalInstructions', () => {
  const base = { ...emptyAgentDraft(), name: 'a', instructions: 'Nội dung nhạy cảm' }

  it('cảnh báo khi có hướng dẫn và model nằm ngoài tổ chức', () => {
    expect(shouldWarnExternalInstructions({ ...base, modelKey: 'openai:gpt' })).toBe(true)
    expect(shouldWarnExternalInstructions({ ...base, modelKey: 'chatgpt:gpt' })).toBe(true)
  })

  it('không cảnh báo với model nội bộ, không model, hoặc hướng dẫn rỗng', () => {
    expect(shouldWarnExternalInstructions({ ...base, modelKey: 'litellm:gpt' })).toBe(false)
    expect(shouldWarnExternalInstructions({ ...base, modelKey: '' })).toBe(false)
    expect(
      shouldWarnExternalInstructions({ ...base, instructions: '  ', modelKey: 'openai:gpt' }),
    ).toBe(false)
  })
})

describe('chọn agent cho hội thoại', () => {
  const dangDung = agent({ id: 'a', archived: false })
  const daLuuTru = agent({ id: 'b', archived: true })
  const daLuuTruVaDangDung = agent({ id: 'c', archived: true })

  it('ẩn agent đã archive khỏi lựa chọn', () => {
    expect(selectableAgents([dangDung, daLuuTru], null).map((a) => a.id)).toEqual(['a'])
  })

  it('vẫn giữ agent đã archive nếu hội thoại đang dùng nó', () => {
    expect(selectableAgents([dangDung, daLuuTruVaDangDung], 'c').map((a) => a.id)).toEqual([
      'a',
      'c',
    ])
  })

  it('mô tả agent đang áp gồm tên và trần tool', () => {
    expect(describeActiveAgent(agent())).toBe('Trợ lý BA · Redmine — chỉ đọc')
  })
})
