import { describe, expect, it } from 'vitest'
import {
  MAX_MEMORY_FACTS_IN_CONTEXT,
  buildContext,
  selectMemoryForProvider,
  type MemoryContextFact,
  type RuntimeMemoryFact,
} from './index.js'

describe('long-term memory context', () => {
  it('places confirmed memory after the base system prompt and before history', () => {
    const result = buildContext({
      history: [{ role: 'user', content: 'Hôm nay nên làm gì?' }],
      memoryFacts: [
        { kind: 'identity', content: 'Gọi người dùng là Minh' },
        { kind: 'goal', content: 'Hoàn tất bản thử nghiệm Nexa trong tháng này' },
      ],
      budget: { contextWindowTokens: 16_000 },
    })

    expect(result.messages).toHaveLength(3)
    expect(result.messages[0]?.role).toBe('system')
    expect(result.messages[1]).toMatchObject({ role: 'system' })
    expect(result.messages[1]?.content).toContain('Thông tin người dùng đã xác nhận')
    expect(result.messages[1]?.content).toContain('[identity] Gọi người dùng là Minh')
    expect(result.messages[2]).toEqual({ role: 'user', content: 'Hôm nay nên làm gì?' })
    expect(result.memoryFactsIncluded).toBe(2)
    expect(result.memoryFactsTruncated).toBe(0)
  })

  it('caps the number of facts and keeps caller order, which is newest first', () => {
    const facts: MemoryContextFact[] = Array.from(
      { length: MAX_MEMORY_FACTS_IN_CONTEXT + 5 },
      (_, i) => ({
        kind: 'note',
        content: `fact-${String(i)}`,
      }),
    )

    const result = buildContext({
      history: [],
      memoryFacts: facts,
      budget: { contextWindowTokens: 128_000 },
    })
    const memory = result.messages[1]?.content ?? ''

    expect(result.memoryFactsIncluded).toBe(MAX_MEMORY_FACTS_IN_CONTEXT)
    expect(result.memoryFactsTruncated).toBe(5)
    expect(memory).toContain('fact-0')
    expect(memory).toContain(`fact-${String(MAX_MEMORY_FACTS_IN_CONTEXT - 1)}`)
    expect(memory).not.toContain(`fact-${String(MAX_MEMORY_FACTS_IN_CONTEXT)}`)
  })

  it('limits memory by token budget instead of starving the current conversation', () => {
    const facts: MemoryContextFact[] = Array.from({ length: 20 }, (_, i) => ({
      kind: 'preference',
      content: `${String(i)} ${'nội dung dài '.repeat(25)}`,
    }))

    const result = buildContext({
      history: [{ role: 'user', content: 'Yêu cầu hiện tại phải được giữ lại.' }],
      memoryFacts: facts,
      budget: { contextWindowTokens: 4_000 },
    })

    expect(result.memoryFactsIncluded).toBeGreaterThan(0)
    expect(result.memoryFactsIncluded).toBeLessThan(facts.length)
    expect(result.memoryFactsTruncated).toBeGreaterThan(0)
    expect(result.messages.at(-1)?.content).toBe('Yêu cầu hiện tại phải được giữ lại.')
  })
})

describe('provider-aware memory firewall', () => {
  const facts: RuntimeMemoryFact[] = [
    {
      kind: 'identity',
      content: 'Thông tin chỉ dùng nội bộ',
      sharingPolicy: 'internal_only',
    },
    {
      kind: 'preference',
      content: 'Thông tin đã cho phép gửi provider ngoài',
      sharingPolicy: 'allow_external',
    },
  ]

  it('keeps all eligible memory for the internal LiteLLM path', () => {
    expect(selectMemoryForProvider(facts, 'litellm')).toEqual(facts)
  })

  it('drops internal-only memory before a request to an external provider', () => {
    expect(selectMemoryForProvider(facts, 'openai')).toEqual([facts[1]])
  })
})
