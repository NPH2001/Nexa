import { describe, expect, it } from 'vitest'
import { getMemoryLimitState, validateMemoryDraft } from './MemoryPanel.helpers.js'

describe('memory panel helpers', () => {
  it('cảnh báo khi số memory active tiến sát ngưỡng context', () => {
    expect(getMemoryLimitState(12)).toMatchObject({ tone: 'normal' })
    expect(getMemoryLimitState(45)).toMatchObject({ tone: 'warning' })
    expect(getMemoryLimitState(50)).toMatchObject({ tone: 'danger' })
  })

  it('bắt buộc chọn hội thoại cho memory theo conversation', () => {
    expect(
      validateMemoryDraft({
        content: 'Nhớ theo hội thoại',
        kind: 'goal',
        scope: 'conversation',
        sourceConversationId: '',
        allowExternal: false,
      }),
    ).toContain('hội thoại')

    expect(
      validateMemoryDraft({
        content: 'Nhớ toàn cục',
        kind: 'preference',
        scope: 'global',
        sourceConversationId: '',
        allowExternal: false,
      }),
    ).toBeNull()
  })
})
