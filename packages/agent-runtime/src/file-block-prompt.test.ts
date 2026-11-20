import { describe, expect, it } from 'vitest'
import { EXPAND_TOOLS_TOOL_NAME } from '@nexa/shared-types'
import { DEFAULT_SYSTEM_PROMPT, buildContext } from './context-builder.js'

/**
 * Quy ước khối file (openspec `add-generated-file-download`) là MỘT dòng thêm vào system prompt.
 *
 * Test này khoá hai điều: dòng đó có mặt và nói đủ, và nó không đẩy nguyên tắc nào cũ ra ngoài —
 * system prompt là chỗ dễ mất nội dung nhất khi có người sửa nhanh một dòng.
 */

describe('quy ước khối file trong system prompt', () => {
  it('nêu cách bọc fence kèm định dạng và tên file', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('```drawio filename=')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('một code fence duy nhất')
  })

  it('nói rõ chỉ tạo fence khi người dùng cần một file', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Chỉ tạo fence như vậy khi người dùng thực sự cần')
  })

  it('liệt kê định dạng nằm trong allowlist và không mời định dạng ngoài allowlist', () => {
    for (const extension of ['.drawio', '.txt', '.md', '.csv', '.json', '.svg']) {
      expect(DEFAULT_SYSTEM_PROMPT).toContain(extension)
    }
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain('.html')
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain('.exe')
  })

  it('giữ nguyên các nguyên tắc cũ', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Trả lời bằng tiếng Việt tự nhiên')
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      'Mọi thao tác thay đổi dữ liệu đều phải được người dùng',
    )
    expect(DEFAULT_SYSTEM_PROMPT).toContain('[KẾT QUẢ CÔNG CỤ CHƯA ĐẦY ĐỦ]')
    expect(DEFAULT_SYSTEM_PROMPT).toContain(EXPAND_TOOLS_TOOL_NAME)
  })

  it('không chen vào system prompt do caller tự truyền', () => {
    const custom = 'Bạn là trợ lý rà soát tài liệu BA. Chỉ trả về JSON.'

    const built = buildContext({
      history: [{ role: 'user', content: 'rà soát giúp tôi' }],
      systemPrompt: custom,
      budget: { contextWindowTokens: 8_000 },
    })

    expect(built.messages[0]).toEqual({ role: 'system', content: custom })
    expect(JSON.stringify(built.messages)).not.toContain('filename=')
  })
})
