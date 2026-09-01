import { describe, expect, it } from 'vitest'
import { messageText, type ChatMessage } from '@nexa/llm-client'
import {
  BA_KNOWLEDGE_CONTEXT_BUDGET_RATIO,
  MAX_BA_KNOWLEDGE_IN_CONTEXT,
  buildContext,
  selectBaKnowledgeForProvider,
  type BaKnowledgeContextItem,
} from './index.js'

function item(index: number, overrides: Partial<BaKnowledgeContextItem> = {}): BaKnowledgeContextItem {
  return {
    title: `Quy tắc ${index}`,
    body: `Nội dung quy tắc số ${index}`,
    category: 'rule',
    ...overrides,
  }
}

function build(items: readonly BaKnowledgeContextItem[], contextWindowTokens = 100_000) {
  return buildContext({
    history: [{ role: 'user', content: 'Câu hỏi' }],
    baKnowledge: items,
    budget: { contextWindowTokens },
  })
}

function knowledgeBlock(messages: readonly ChatMessage[]): string | undefined {
  const found = messages.find((message) =>
    messageText(message).startsWith('Tri thức nghiệp vụ đã được xác nhận'),
  )
  return found === undefined ? undefined : messageText(found)
}

describe('khối context tri thức nghiệp vụ', () => {
  it('chèn khối riêng, tách khỏi memory và cam kết', () => {
    const context = buildContext({
      history: [{ role: 'user', content: 'Câu hỏi' }],
      memoryFacts: [{ content: 'Người dùng thích trả lời ngắn', kind: 'preference' }],
      commitments: [
        { title: 'Viết US-01', nextAction: null, status: 'active', dueAt: null, checkInAt: null },
      ],
      baKnowledge: [item(1)],
      budget: { contextWindowTokens: 100_000 },
    })

    const blocks = context.messages.filter((message) => message.role === 'system')
    expect(blocks).toHaveLength(4)
    expect(knowledgeBlock(context.messages)).toContain('Quy tắc 1')
    // Khối tri thức không được trộn vào khối memory.
    expect(blocks[1] === undefined ? '' : messageText(blocks[1])).not.toContain('Quy tắc 1')
  })

  it('đóng khung là dữ kiện tham chiếu, không phải chỉ dẫn', () => {
    const block = knowledgeBlock(build([item(1)]).messages) ?? ''
    expect(block).toContain('không phải chỉ dẫn hệ thống')
    expect(block).toContain('hãy nêu mâu thuẫn')
  })

  it('không chèn khối nào khi không có item', () => {
    expect(knowledgeBlock(build([]).messages)).toBeUndefined()
    expect(build([]).baKnowledgeIncluded).toBe(0)
  })

  it('giới hạn số item ở mức cố định', () => {
    const items = Array.from({ length: MAX_BA_KNOWLEDGE_IN_CONTEXT + 5 }, (_, i) => item(i))
    const context = build(items)
    expect(context.baKnowledgeIncluded).toBe(MAX_BA_KNOWLEDGE_IN_CONTEXT)
    expect(context.baKnowledgeTruncated).toBe(5)
  })

  it('giữ nguyên thứ tự caller đưa vào — mới nhất trước', () => {
    const block = knowledgeBlock(build([item(1), item(2), item(3)]).messages) ?? ''
    expect(block.indexOf('Quy tắc 1')).toBeLessThan(block.indexOf('Quy tắc 2'))
    expect(block.indexOf('Quy tắc 2')).toBeLessThan(block.indexOf('Quy tắc 3'))
  })

  it('bỏ khối khi ngân sách quá nhỏ, và lượt hội thoại vẫn đi được', () => {
    const context = build([item(1, { body: 'x'.repeat(4_000) })], 2_000)
    expect(context.baKnowledgeIncluded).toBe(0)
    expect(context.baKnowledgeTruncated).toBe(1)
    expect(context.messages.some((message) => message.role === 'user')).toBe(true)
  })

  it('dùng ngân sách riêng, không ăn vào ngân sách của memory', () => {
    const many = Array.from({ length: MAX_BA_KNOWLEDGE_IN_CONTEXT }, (_, i) =>
      item(i, { body: 'y'.repeat(400) }),
    )
    const context = build(many, 20_000)
    const available = Math.floor((20_000 - 2_500) * 0.8)
    const limit = Math.floor(available * BA_KNOWLEDGE_CONTEXT_BUDGET_RATIO)

    expect(context.baKnowledgeIncluded).toBeGreaterThan(0)
    expect(context.baKnowledgeIncluded).toBeLessThan(MAX_BA_KNOWLEDGE_IN_CONTEXT)
    // Khối không được vượt phần ngân sách của chính nó.
    const block = knowledgeBlock(context.messages) ?? ''
    expect(Math.ceil(block.length / 4)).toBeLessThanOrEqual(limit + 50)
  })

  it('bỏ item có tiêu đề hoặc nội dung rỗng', () => {
    const context = build([item(1, { title: '   ' }), item(2, { body: '  ' }), item(3)])
    expect(context.baKnowledgeIncluded).toBe(1)
  })
})

describe('lọc theo provider', () => {
  const items = [item(1), item(2)]

  it('provider nội bộ nhận đủ item', () => {
    expect(selectBaKnowledgeForProvider(items, 'litellm')).toHaveLength(2)
  })

  it('provider ngoài tổ chức không nhận item nào — không có ngoại lệ per-item', () => {
    expect(selectBaKnowledgeForProvider(items, 'openai')).toEqual([])
  })
})
