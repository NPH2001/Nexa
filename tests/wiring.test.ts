import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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
  const mainFiles = ['apps/desktop/src/main/index.ts', 'apps/desktop/src/main/chat-controller.ts']
    .map(read)
    .join('\n')

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

describe('bundler biết mọi workspace package', () => {
  /**
   * Package trong repo này là source-only TypeScript. Thiếu tên trong `WORKSPACE_PACKAGES` của
   * electron-vite thì import bị coi là external, Node không nạp được file .ts, và **main process
   * chết trước cả khi logger kịp mở file** — không có log, không có DB, chỉ có một cửa sổ không
   * bao giờ hiện ra. Unit test vẫn xanh vì vitest có alias riêng.
   *
   * Test này là chốt chặn cho đúng lỗi đó.
   */
  it('WORKSPACE_PACKAGES liệt kê đủ mọi package trong packages/', () => {
    const config = read('apps/desktop/electron.vite.config.ts')
    const declared = new Set(
      [...config.matchAll(/^\s+'([a-z0-9-]+)',$/gm)].map((match) => match[1]),
    )

    const onDisk = readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      // ui-components có trong tsconfig paths nhưng chưa tồn tại; chỉ kiểm cái đã có trên đĩa.
      .filter((name) => existsSync(join(root, 'packages', name, 'src/index.ts')))

    const missing = onDisk.filter((name) => !declared.has(name))
    expect(missing, 'package chưa được bundler biết tới').toEqual([])
  })
})

/**
 * Vòng đời tiến trình (openspec `add-os-checkin-notifications`).
 *
 * Tray và thông báo OS là đúng loại tính năng dễ kéo theo một "đóng để thu nhỏ" — thứ sẽ giữ
 * tiến trình sống vô thời hạn với credential đã giải mã trong RAM, tức là lật ngược một quyết
 * định bảo mật có chủ ý. Những test dưới đây đọc chính mã nguồn để khẳng định ranh giới đó
 * chưa bị dịch, vì `index.ts` gọi `app.whenReady()` lúc import nên không nạp được trong vitest.
 */
describe('vòng đời tiến trình', () => {
  const main = read('apps/desktop/src/main/index.ts')

  it('đóng cửa sổ cuối vẫn thoát app trên Windows/Linux', () => {
    const handler = /app\.on\('window-all-closed',[\s\S]*?\n\}\)/.exec(main)?.[0] ?? ''
    expect(handler, "không tìm thấy handler 'window-all-closed'").not.toBe('')
    expect(handler).toContain("process.platform !== 'darwin'")
    expect(handler).toContain('app.quit()')
    // Một tray "đóng để thu nhỏ" trông giống hệt như thêm `preventDefault` vào đây.
    expect(handler).not.toContain('preventDefault')
    expect(handler).not.toContain('hide()')
  })

  it('không có handler nào chặn việc đóng cửa sổ', () => {
    // `minimize` có thể ẩn cửa sổ xuống tray; `close` thì không được — đó là ranh giới.
    expect(main).not.toMatch(/on\('close',/)
  })

  it('tray bị huỷ trên đường thoát', () => {
    const handler = /app\.on\('before-quit',[\s\S]*?\n\}\)/.exec(main)?.[0] ?? ''
    expect(handler, "không tìm thấy handler 'before-quit'").not.toBe('')
    expect(handler).toContain('tray?.dispose()')
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
        // Gate cả một bề mặt sản phẩm (đích Nghiệp vụ, IPC `ba:*`, registry tool `nexa_ba_*`),
        // không gate tool Atlassian nào. Tool BA nằm ở registry cục bộ trong main, không có
        // `requiredFeature` vì chúng không thuộc `ToolDefinition` (openspec `add-ba-workbench`).
        'baWorkbench',
        // Điều khiển việc gửi BAO NHIÊU tool cho model, không điều khiển tool nào cụ thể
        // (ADR 0009). Nó gate preset, và preset là hợp của các cờ khác trong danh sách này —
        // nên nó không bao giờ xuất hiện trong `requiredFeature` của một tool.
        'toolScoping',
      ].sort(),
    )
  })
})

/**
 * Bề mặt tool của agent (openspec `add-memory`, spec `long-term-memory`: "Agent không tự lưu
 * fact ngầm").
 *
 * Cam kết này hiện đúng vì một sự VẮNG MẶT: không có tool memory nào để model gọi. Sự vắng mặt
 * không tự bảo vệ được nó — thêm một registry mới vào lượt chat là chuyện của ba dòng, và không
 * test nào ở nơi khác sẽ đỏ. Các vùng khác của repo đã khẳng định đúng kiểu này
 * (`commitment-tools.test.ts`: "no delete"; `ba-tools.test.ts`: "không có tool nào xoá tri thức").
 *
 * `services.memory` là `MemoryRepository` đầy đủ quyền ghi, nên ranh giới KHÔNG nằm ở kiểu dữ
 * liệu. Nó nằm ở đúng một chỗ: danh sách registry được ghép vào khối `tools`.
 */
describe('bề mặt tool của agent', () => {
  const controller = read('apps/desktop/src/main/chat-controller.ts')
  const MEMORY_LIKE = /memory|fact|ghi[_-]?nho|ghi[_-]?nhớ/i

  it('đúng hai registry tool cục bộ được ghép vào một lượt chat', () => {
    const block = /composeLocalToolRegistries\(\[([\s\S]*?)\n\s*\]\)/.exec(controller)?.[1] ?? ''
    expect(block, 'không tìm thấy chỗ ghép registry tool cục bộ').not.toBe('')

    const factories = [...block.matchAll(/create(\w+?)ToolRegistry/g)]
      .map((match) => match[1])
      .sort()
    expect(factories).toEqual(['Ba', 'Commitment'])
  })

  it('không tool cục bộ nào là tool memory', () => {
    const names = ['apps/desktop/src/main/commitment-tools.ts', 'apps/desktop/src/main/ba-tools.ts']
      .flatMap((file) => [...read(file).matchAll(/export const \w*_TOOL = '([^']+)'/g)])
      .map((match) => match[1])

    // 2 tool cam kết + 5 tool BA. Con số cứng để việc thêm tool phải đi qua test này.
    expect(names).toHaveLength(7)
    expect(names.filter((name) => MEMORY_LIKE.test(name ?? ''))).toEqual([])
  })

  it('không tool Atlassian nào là tool memory', () => {
    const registry = buildToolRegistry({
      jiraBaseUrl: 'https://jira.internal',
      confluenceBaseUrl: 'https://confluence.internal',
    })

    expect(registry.filter((tool) => MEMORY_LIKE.test(tool.name))).toEqual([])
  })

  it('chat controller không chạm tới đường ghi của MemoryRepository', () => {
    // Đọc memory để dựng context là ĐÚNG (`listForContext`). Ghi thì không — fact chỉ vào kho
    // qua hành động xác nhận của người dùng, đi đường IPC `memory:*`.
    const memoryCalls = [...controller.matchAll(/services\.memory\s*\.\s*(\w+)/g)].map(
      (match) => match[1],
    )
    expect([...new Set(memoryCalls)]).toEqual(['listForContext'])
  })
})

/**
 * Async state của Activity (openspec `add-proactive-check-ins-and-agent-activity`, spec
 * `agent-activity`: "lần tải đầu trả lỗi và lần retry thành công ⇒ UI chuyển từ error sang
 * list/empty MÀ KHÔNG reset filter").
 *
 * Vì sao test này nằm ở đây chứ không cạnh component: vitest chạy `environment: 'node'` nên không
 * render được React, và eslint cấm renderer chạm `node:fs` (§5.3) nên một test đọc mã nguồn cũng
 * không được phép sống trong thư mục renderer. Cả hai ràng buộc đều đúng, và chúng đẩy loại test
 * này về đúng file cấu trúc này.
 *
 * GIỚI HẠN: đây KHÔNG thay được một test render. Nó bắt cách hỏng thật sự có khả năng xảy ra —
 * ai đó "dọn dẹp" trạng thái trong nhánh lỗi hoặc nối nút thử lại vào một đường tải khác — chứ
 * không chứng minh được chuyển trạng thái error → list. Muốn chứng minh điều đó phải thêm jsdom
 * và testing-library, và đó là một quyết định về hạ tầng test.
 */
describe('nhánh lỗi của Activity không đụng tới filter', () => {
  const view = read('apps/desktop/src/renderer/components/ActivityTimelineView.tsx')

  /** Ba filter là trạng thái NGƯỜI DÙNG đặt. Không đường lỗi nào được phép tự dọn chúng. */
  const FILTER_SETTERS = ['setTypeFilter', 'setStatusFilter', 'setActorFilter']

  it('khối catch chỉ đặt cờ lỗi, không reset filter nào', () => {
    const block = /\} catch \(error\) \{([\s\S]*?)\n {4}\} finally/.exec(view)?.[1] ?? ''
    expect(block, 'không tìm thấy khối catch của hàm load').not.toBe('')

    for (const setter of FILTER_SETTERS) {
      expect(block, `nhánh lỗi reset filter: ${setter}`).not.toContain(setter)
    }
    expect(block).toContain('setLoadFailed(true)')
  })

  it('filter chỉ đổi từ chính handler của ô chọn', () => {
    // Mỗi setter xuất hiện đúng hai lần: một lần khai `useState`, một lần trong `onChange`.
    // Con số cứng buộc mọi lần gọi mới phải đi qua test này và giải thích được vì sao.
    for (const setter of FILTER_SETTERS) {
      const uses = view.split(setter).length - 1
      expect(uses, `${setter} được gọi ở chỗ ngoài dự kiến`).toBe(2)
    }
  })

  it('thử lại chạy đúng hàm load hiện tại, không dựng đường tải thứ hai', () => {
    // `load` là useCallback phụ thuộc ba filter, nên gọi lại nó là tự khắc giữ nguyên filter.
    // Một nút thử lại gọi thẳng `api.activity.list` sẽ lách mất tính chất đó.
    expect(view).toMatch(/onClick=\{[^}]*\bload\b[^}]*\}/)
    expect(view.split('api.activity.list').length - 1, 'có nhiều hơn một đường gọi list').toBe(1)
  })
})

/**
 * Số message bị lược bỏ phải đi hết đường (openspec `add-memory`, spec `short-term-memory`:
 * "Số message bị loại bỏ được ghi lại VÀ HIỂN THỊ cho người dùng").
 *
 * `context-builder.test.ts` khẳng định con số được TÍNH đúng. Test này khẳng định nửa còn lại:
 * nó không chết dọc đường. Một ngữ cảnh bị cắt âm thầm là thứ người dùng không có cách nào biết —
 * câu trả lời chỉ đơn giản là tệ hơn, và không ai truy được vì sao.
 */
describe('số message bị lược bỏ đi hết đường tới người dùng', () => {
  const runtime = read('packages/agent-runtime/src/agent-runtime.ts')
  const controller = read('apps/desktop/src/main/chat-controller.ts')
  const chatView = read('apps/desktop/src/renderer/components/ChatView.tsx')
  const app = read('apps/desktop/src/renderer/App.tsx')

  it('runtime tính rồi trả con số ra ngoài', () => {
    expect(runtime).toContain('truncatedContextCount: context.truncatedCount')
  })

  it('main lưu con số vào chính message đã hoàn tất', () => {
    expect(controller).toMatch(/finalizeMessage\([\s\S]{0,200}truncatedContextCount/)
  })

  it('renderer nói ra bằng tiếng Việt, ở cả tin nhắn lẫn thông báo', () => {
    expect(chatView).toContain('message.truncatedContextCount')
    expect(chatView).toContain('Đã lược bỏ')
    expect(app).toContain('event.truncatedContextCount')
  })
})
