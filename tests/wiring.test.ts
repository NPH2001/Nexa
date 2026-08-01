import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NEXA_EVENTS, IPC_CHANNEL_NAMES, IPC_SCHEMAS, featureFlagsSchema } from '@nexa/shared-types'
import { buildToolRegistry } from '@nexa/atlassian-mcp-manager'

/**
 * Test cấu trúc — bắt loại lỗi mà unit test không thấy: một đầu dây được nối, đầu kia không.
 *
 * Xuất phát từ một lỗi thật: main process gửi thông báo "có bản cập nhật" trên một channel mà
 * renderer không hề lắng nghe. Không test nào đỏ, không log nào cảnh báo — người dùng chỉ đơn
 * giản là không bao giờ thấy thông báo. Những test dưới đây đọc chính mã nguồn để khẳng định
 * hai đầu khớp nhau.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (relative: string): string => readFileSync(`${root}${relative}`, 'utf8')

describe('sự kiện main → renderer', () => {
  const bridge = read('apps/desktop/src/renderer/bridge.ts')
  const mainFiles = [
    'apps/desktop/src/main/index.ts',
    'apps/desktop/src/main/chat-controller.ts',
  ].map(read).join('\n')

  it('mọi sự kiện main GỬI đều có chỗ nhận ở bridge', () => {
    const unlistened = Object.entries(NEXA_EVENTS)
      .filter(([key]) => mainFiles.includes(`NEXA_EVENTS.${key}`))
      .filter(([, channel]) => !bridge.includes(`'${channel}'`))
      .map(([key, channel]) => `${key} (${channel})`)

    expect(unlistened, 'main gửi nhưng renderer không nghe').toEqual([])
  })

  it('bridge không expose sự kiện mà main không bao giờ gửi', () => {
    const neverSent = Object.entries(NEXA_EVENTS)
      .filter(([, channel]) => bridge.includes(`'${channel}'`))
      .filter(([key]) => !mainFiles.includes(`NEXA_EVENTS.${key}`))
      .map(([key]) => key)

    expect(neverSent, 'bridge nghe một sự kiện không ai gửi').toEqual([])
  })
})

describe('channel IPC', () => {
  it('hai danh sách channel khớp nhau (channels.ts không có zod, ipc.ts có)', () => {
    expect([...IPC_CHANNEL_NAMES].sort()).toEqual(Object.keys(IPC_SCHEMAS).sort())
  })

  it('mọi channel đều được renderer gọi — không có channel mồ côi ở main', () => {
    const bridge = read('apps/desktop/src/renderer/bridge.ts')
    const unused = IPC_CHANNEL_NAMES.filter((c) => !bridge.includes(`'${c}'`))
    expect(unused, 'channel có handler nhưng không ai gọi').toEqual([])
  })
})

describe('feature flag', () => {
  const flags = Object.keys(featureFlagsSchema.parse({}))
  const registry = buildToolRegistry({
    jiraBaseUrl: 'https://jira.internal',
    confluenceBaseUrl: 'https://confluence.internal',
  })
  const gated = new Set(registry.map((t) => t.requiredFeature))

  it('mọi tool đều gắn với một feature flag có thật', () => {
    for (const feature of gated) {
      expect(flags, `tool gắn vào flag không tồn tại: ${feature}`).toContain(feature)
    }
  })

  it('ghi nhận rõ những flag hiện chưa điều khiển tool nào', () => {
    // Không phải lỗi — nhưng phải là danh sách CÓ Ý THỨC. Thêm flag mới mà quên nối tool
    // thì test này đỏ, buộc phải quyết định: nối tool, hay ghi nó vào danh sách dưới đây.
    const notGatingAnyTool = flags.filter((f) => !gated.has(f as never))
    expect(notGatingAnyTool.sort()).toEqual(
      [
        // Không liên quan tới tool.
        'autoUpdate',
        'storeExtractedText',
        'storeHistory',
        // §22.3 ngoài phạm vi MVP: cờ tồn tại theo Phụ lục A nhưng chưa có tool nào dùng.
        // Bật lên không có tác dụng — xem OPEN-QUESTIONS A6.
        'confluenceWrite',
      ].sort(),
    )
  })
})
