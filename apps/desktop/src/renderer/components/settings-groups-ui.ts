import type { Connection, ConnectionType } from '@nexa/shared-types/renderer'

/**
 * Cấu trúc màn Cài đặt: 12 mục gom vào 4 nhóm, kèm trạng thái kết nối của từng mục.
 *
 * Trước đây 12 tab nằm ngang hàng nhau. Đó đúng kiểu màn quản trị dày đặc mà DESIGN.md tránh,
 * và người dùng mới không biết mục nào phải làm trước. Tách khỏi `SettingsView.tsx` để luật
 * nhóm, thứ tự phím mũi tên và trạng thái test được mà không cần React.
 */

export type SettingsTab =
  | 'litellm'
  | 'openai'
  | 'models'
  | 'jira'
  | 'confluence'
  | 'mcpGateway'
  | 'redmine'
  | 'xwiki'
  | 'memory'
  | 'data'
  | 'appearance'
  | 'about'

interface SettingsGroup {
  readonly id: string
  readonly label: string
  readonly tabs: readonly { readonly id: SettingsTab; readonly label: string }[]
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: 'ai',
    label: 'Kết nối AI',
    tabs: [
      { id: 'litellm', label: 'LiteLLM' },
      { id: 'openai', label: 'OpenAI' },
      { id: 'models', label: 'Model' },
    ],
  },
  {
    id: 'work',
    label: 'Công cụ làm việc',
    tabs: [
      { id: 'jira', label: 'Jira' },
      { id: 'confluence', label: 'Confluence' },
      { id: 'redmine', label: 'Redmine' },
      { id: 'xwiki', label: 'XWiki' },
      { id: 'mcpGateway', label: 'MCP Gateway' },
    ],
  },
  {
    id: 'privacy',
    label: 'Nexa nhớ & quyền riêng tư',
    tabs: [
      { id: 'memory', label: 'Nexa nhớ' },
      { id: 'data', label: 'Dữ liệu & quyền riêng tư' },
    ],
  },
  {
    id: 'app',
    label: 'Ứng dụng',
    tabs: [
      { id: 'appearance', label: 'Giao diện' },
      { id: 'about', label: 'Chẩn đoán' },
    ],
  },
]

/** Thứ tự phẳng mà phím mũi tên đi qua: đúng thứ tự nhìn thấy, từ trên xuống. */
export const SETTINGS_TAB_ORDER: readonly SettingsTab[] = SETTINGS_GROUPS.flatMap((group) =>
  group.tabs.map((tab) => tab.id),
)

export function groupOfTab(tab: SettingsTab): SettingsGroup {
  const group = SETTINGS_GROUPS.find((g) => g.tabs.some((t) => t.id === tab))
  if (group === undefined) throw new Error(`Tab không thuộc nhóm nào: ${tab}`)
  return group
}

/**
 * Tab kế tiếp khi bấm phím. Danh sách giờ là cột dọc, nên Lên/Xuống là phím chính; Trái/Phải
 * vẫn chạy để danh sách nằm ngang ở cửa sổ hẹp dùng được như cũ.
 */
export function nextSettingsTab(current: SettingsTab, key: string): SettingsTab | null {
  const order = SETTINGS_TAB_ORDER
  const index = order.indexOf(current)
  const last = order.length - 1
  switch (key) {
    case 'Home':
      return order[0] ?? null
    case 'End':
      return order[last] ?? null
    case 'ArrowUp':
    case 'ArrowLeft':
      return order[index === 0 ? last : index - 1] ?? null
    case 'ArrowDown':
    case 'ArrowRight':
      return order[index === last ? 0 : index + 1] ?? null
    default:
      return null
  }
}

export type ConnectionStatus = 'ok' | 'error' | 'untested' | 'none'

const TAB_CONNECTION: Partial<Record<SettingsTab, ConnectionType>> = {
  litellm: 'litellm',
  openai: 'openai',
  jira: 'jira',
  confluence: 'confluence',
  mcpGateway: 'mcpGateway',
  redmine: 'redmine',
  xwiki: 'xwiki',
}

/**
 * Trạng thái hiển thị bằng chấm màu cạnh tên mục. `null` cho mục không phải kết nối.
 * "Đã lưu nhưng chưa kiểm tra" là trạng thái riêng: lưu cấu hình không gọi server, nên coi
 * nó là "đã kết nối" sẽ là nói sai.
 */
export function connectionStatusOf(
  tab: SettingsTab,
  connections: readonly Connection[],
): ConnectionStatus | null {
  const type = TAB_CONNECTION[tab]
  if (type === undefined) return null
  const connection = connections.find((c) => c.type === type)
  if (connection === undefined || !connection.hasCredential) return 'none'
  if (connection.lastTest === undefined) return 'untested'
  return connection.lastTest.ok ? 'ok' : 'error'
}

export const CONNECTION_STATUS_LABELS: Readonly<Record<ConnectionStatus, string>> = {
  ok: 'Đã kết nối',
  error: 'Kiểm tra gần nhất bị lỗi',
  untested: 'Đã lưu, chưa kiểm tra',
  none: 'Chưa cấu hình',
}

/**
 * Hai bước bắt đầu cho lần chạy đầu: có một nhà cung cấp AI đã lưu, rồi kiểm tra thành công.
 * `null` khi không cần hiện, tức là đã có một kết nối AI chạy được, hoặc đã đăng nhập ChatGPT và có model dùng được.
 */
export function onboardingSteps(
  connections: readonly Connection[],
  hasChatGptModels: boolean,
): { saved: boolean; tested: boolean } | null {
  if (hasChatGptModels) return null
  const ai = connections.filter(
    (c) => (c.type === 'litellm' || c.type === 'openai') && c.hasCredential,
  )
  const tested = ai.some((c) => c.lastTest?.ok === true)
  if (tested) return null
  return { saved: ai.length > 0, tested }
}
