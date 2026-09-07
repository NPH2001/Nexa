import { describe, expect, it } from 'vitest'
import type { ProcessedDocument } from '@nexa/document-processor'
import { buildContext } from './index.js'

/**
 * Cửa sổ trượt ngữ cảnh (openspec `add-memory`, spec `short-term-memory`).
 *
 * `buildContext` được bốn file test khác gọi tới, nhưng cả bốn đều kiểm một khối riêng — memory,
 * cam kết, tri thức BA, hiệu năng. Chính phần cắt lịch sử thì chưa file nào khẳng định, và đó là
 * phần hỏng âm thầm nhất trong toàn bộ đường chat: cắt nhầm không ném lỗi, không hiện lên màn
 * hình, chỉ làm câu trả lời tệ đi một cách không ai truy được.
 */

/** Ngân sách phẳng: không chừa chỗ trả lời, không hệ số an toàn — số vào đúng bằng số dùng được. */
function budget(contextWindowTokens: number) {
  return { contextWindowTokens, reserveForCompletionTokens: 0, safetyMargin: 1 }
}

/** Mỗi lượt tốn đúng 105 token: ceil(404/4) + 4 token bao gói. Đánh số để truy được thứ tự. */
function turn(index: number): { role: 'user' | 'assistant'; content: string } {
  return {
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${String(index).padStart(3, '0')} ${'x'.repeat(400)}`,
  }
}

const TOKENS_PER_TURN = 105

function history(count: number): { role: 'user' | 'assistant'; content: string }[] {
  return Array.from({ length: count }, (_, i) => turn(i))
}

function textDoc(): ProcessedDocument {
  return {
    fileName: 'bao-cao.txt',
    kind: 'txt',
    sizeBytes: 128,
    sourcePathHash: 'c'.repeat(64),
    text: 'Doanh thu quý ba tăng 12%.',
    chunks: [],
    charCount: 26,
    estimatedTokens: 7,
    truncated: false,
  }
}

describe('lịch sử nằm trong ngân sách', () => {
  it('giữ nguyên mọi message và không báo cắt', () => {
    const built = buildContext({
      history: history(5),
      systemPrompt: 'S',
      budget: budget(4_000),
    })

    expect(built.truncatedCount).toBe(0)
    // 1 system + 5 lượt.
    expect(built.messages).toHaveLength(6)
    expect(built.messages[1]?.content).toContain('000')
    expect(built.messages[5]?.content).toContain('004')
  })
})

describe('lịch sử vượt ngân sách', () => {
  it('bỏ message cũ nhất và giữ lại đúng phần mới nhất', () => {
    const built = buildContext({
      history: history(60),
      systemPrompt: 'S',
      budget: budget(4_000),
    })

    expect(built.truncatedCount).toBeGreaterThan(0)

    const kept = built.messages.slice(1)
    // Bất biến quan trọng nhất: không message nào bốc hơi mà không được đếm.
    expect(built.truncatedCount + kept.length).toBe(60)

    // Phần giữ lại phải là một dải LIỀN ở cuối, không phải một tập chọn lọc rải rác.
    const firstKept = built.truncatedCount
    kept.forEach((message, offset) => {
      expect(message.content).toContain(String(firstKept + offset).padStart(3, '0'))
    })
    expect(kept.at(-1)?.content).toContain('059')
  })

  it('không bao giờ vượt ngân sách đã cho', () => {
    const built = buildContext({
      history: history(60),
      systemPrompt: 'S',
      budget: budget(4_000),
    })

    expect(built.estimatedTokens).toBeLessThanOrEqual(4_000)
    // Và có dùng gần hết chỗ, chứ không cắt thừa tay: còn dư thì phải dư ít hơn một lượt.
    expect(built.estimatedTokens).toBeGreaterThan(4_000 - TOKENS_PER_TURN)
  })

  it('lịch sử rỗng không phải là lịch sử bị cắt', () => {
    const built = buildContext({ history: [], systemPrompt: 'S', budget: budget(4_000) })

    expect(built.truncatedCount).toBe(0)
    expect(built.messages).toHaveLength(1)
  })
})

describe('ngân sách bám theo cửa sổ ngữ cảnh của model', () => {
  it('đổi sang model có cửa sổ lớn hơn thì giữ được nhiều lượt hơn', () => {
    const conversation = history(60)

    const small = buildContext({ history: conversation, systemPrompt: 'S', budget: budget(4_000) })
    const large = buildContext({ history: conversation, systemPrompt: 'S', budget: budget(16_000) })

    // Cùng một hội thoại, chỉ đổi model: phần bị bỏ phải ít đi, không được y nguyên.
    expect(large.truncatedCount).toBeLessThan(small.truncatedCount)
    expect(large.messages.length).toBeGreaterThan(small.messages.length)
  })

  it('cửa sổ đủ rộng thì không cắt gì cả', () => {
    const built = buildContext({
      history: history(60),
      systemPrompt: 'S',
      budget: budget(64_000),
    })

    expect(built.truncatedCount).toBe(0)
    expect(built.messages).toHaveLength(61)
  })
})

describe('tài liệu của lượt hiện tại được ưu tiên trước lịch sử cũ', () => {
  it('tài liệu vẫn tới model ngay cả khi lịch sử phải cắt', () => {
    const built = buildContext({
      history: history(60),
      documents: [textDoc()],
      systemPrompt: 'S',
      budget: budget(4_000),
    })

    expect(built.truncatedCount).toBeGreaterThan(0)
    expect(built.documentsTruncated).toBe(false)

    // Người dùng vừa chủ động đính kèm tài liệu này cho câu hỏi này. Nó phải đứng TRƯỚC lịch sử
    // còn lại — nếu nó bị xếp sau, nó sẽ là thứ đầu tiên bị đẩy ra khi ngân sách hẹp lại.
    const documentIndex = built.messages.findIndex(
      (message) => typeof message.content === 'string' && message.content.includes('bao-cao.txt'),
    )
    expect(documentIndex).toBe(1)
    expect(built.messages[documentIndex]?.content).toContain('Doanh thu quý ba tăng 12%.')

    const firstHistoryIndex = built.messages.findIndex(
      (message) => typeof message.content === 'string' && message.content.includes('xxx'),
    )
    expect(firstHistoryIndex).toBeGreaterThan(documentIndex)
  })

  it('tài liệu chiếm chỗ nên lịch sử giữ được ít hơn', () => {
    const conversation = history(60)

    const without = buildContext({ history: conversation, systemPrompt: 'S', budget: budget(4_000) })
    const withDoc = buildContext({
      history: conversation,
      documents: [textDoc()],
      systemPrompt: 'S',
      budget: budget(4_000),
    })

    // Ngân sách là một cái chăn hẹp: kéo về phía tài liệu thì lịch sử phải hụt đi.
    expect(withDoc.truncatedCount).toBeGreaterThanOrEqual(without.truncatedCount)
  })
})
