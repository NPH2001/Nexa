import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS, type AppSettings, type CheckInSuggestion } from '@nexa/shared-types'
import { Logger, MemorySink } from '@nexa/observability'
import {
  CheckInNotifier,
  buildBody,
  type NotificationHandle,
  type NotificationPort,
  type WindowVisibility,
} from './check-in-notifier.js'

/**
 * Notifier thông báo OS (openspec `add-os-checkin-notifications`).
 *
 * File này cố ý KHÔNG mock `electron`: `check-in-notifier.ts` không import electron, nên mọi
 * quyết định gửi/không gửi kiểm chứng được bằng test thường. Nếu một ngày file đó phải mock
 * electron mới chạy được thì đó là dấu hiệu adapter đã rò rỉ vào lớp quyết định.
 */

interface Harness {
  notifier: CheckInNotifier
  shown: { title: string; body: string }[]
  clicks: () => void
  activations: () => number
  settings: AppSettings
  window: { exists: boolean; visible: boolean; focused: boolean }
  supported: { value: boolean }
  advanceMinutes: (minutes: number) => void
  logText: () => string
}

const BASE_TIME = Date.parse('2026-09-02T09:00:00.000Z')

function harness(overrides: Partial<AppSettings> = {}): Harness {
  const shown: { title: string; body: string }[] = []
  const clickListeners: (() => void)[] = []
  let activations = 0
  let nowMs = BASE_TIME

  const settings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    proactiveCheckInsEnabled: true,
    checkInOsNotificationsEnabled: true,
    ...overrides,
  }
  const window = { exists: true, visible: true, focused: false }
  const supported = { value: true }

  const notifications: NotificationPort = {
    isSupported: () => supported.value,
    create: (options): NotificationHandle => ({
      show: () => shown.push(options),
      onClick: (listener) => clickListeners.push(listener),
    }),
  }

  const sink = new MemorySink()
  const notifier = new CheckInNotifier({
    notifications,
    readSettings: () => settings,
    readWindowVisibility: (): WindowVisibility => window,
    onActivate: () => {
      activations += 1
    },
    logger: new Logger({ sink, minLevel: 'debug' }),
    now: () => new Date(nowMs),
  })

  return {
    notifier,
    shown,
    clicks: () => {
      for (const listener of clickListeners) listener()
    },
    activations: () => activations,
    settings,
    window,
    supported,
    advanceMinutes: (minutes) => {
      nowMs += minutes * 60_000
    },
    logText: () => sink.asText(),
  }
}

let seq = 0
function pending(title: string, extra: Partial<CheckInSuggestion> = {}): CheckInSuggestion {
  seq += 1
  return {
    id: `11111111-1111-4111-8111-${String(seq).padStart(12, '0')}`,
    commitmentId: `22222222-2222-4222-8222-${String(seq).padStart(12, '0')}`,
    title,
    nextAction: `Bước tiếp theo bí mật của ${title}`,
    sourceConversationId: null,
    triggerKind: 'due',
    triggerAt: '2026-09-02T08:00:00.000Z',
    state: 'pending',
    snoozedUntil: null,
    createdAt: '2026-09-02T08:00:00.000Z',
    updatedAt: '2026-09-02T08:00:00.000Z',
    ...extra,
  }
}

beforeEach(() => {
  seq = 0
})

// ═══════════════════════════════════════════════════════════════════════════
// Opt-in kép — hai setting phải cùng bật
// ═══════════════════════════════════════════════════════════════════════════

describe('opt-in kép', () => {
  it('gửi khi cả hai setting bật và cửa sổ không được focus', () => {
    const h = harness()
    h.notifier.onCheckInsChanged([pending('Gửi báo cáo quý')])
    expect(h.shown).toHaveLength(1)
  })

  it('KHÔNG gửi khi chỉ bật nhắc việc mà chưa bật thông báo hệ thống', () => {
    const h = harness({ checkInOsNotificationsEnabled: false })
    h.notifier.onCheckInsChanged([pending('Gửi báo cáo quý')])
    expect(h.shown).toEqual([])
  })

  it('KHÔNG gửi khi proactive check-in bị tắt', () => {
    const h = harness({ proactiveCheckInsEnabled: false })
    h.notifier.onCheckInsChanged([pending('Gửi báo cáo quý')])
    expect(h.shown).toEqual([])
  })

  it('KHÔNG gửi khi nền tảng không hỗ trợ thông báo', () => {
    const h = harness()
    h.supported.value = false
    h.notifier.onCheckInsChanged([pending('Gửi báo cáo quý')])
    expect(h.shown).toEqual([])
    expect(h.notifier.supported).toBe(false)
  })

  it('bật thông báo sau đó thì các suggestion đang chờ được nhắc một lần', () => {
    const h = harness({ checkInOsNotificationsEnabled: false })
    const suggestions = [pending('A'), pending('B')]
    h.notifier.onCheckInsChanged(suggestions)
    expect(h.shown).toEqual([])

    // Bật cờ không hồi tố thành hai thông báo cho hai lần reconcile đã trôi qua.
    Object.assign(h.settings, { checkInOsNotificationsEnabled: true })
    h.notifier.onCheckInsChanged(suggestions)
    expect(h.shown).toHaveLength(1)
    expect(h.shown[0]?.body).toBe('2 việc cần chú ý')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Im lặng khi người dùng đang nhìn thấy màn hình
// ═══════════════════════════════════════════════════════════════════════════

describe('điều kiện cửa sổ', () => {
  it('im lặng khi cửa sổ đang hiện VÀ đang focus — Hôm nay đã nói rồi', () => {
    const h = harness()
    h.window.focused = true
    h.notifier.onCheckInsChanged([pending('Gửi báo cáo quý')])
    expect(h.shown).toEqual([])
  })

  it('gửi khi cửa sổ bị thu nhỏ', () => {
    const h = harness()
    Object.assign(h.window, { visible: false, focused: false })
    h.notifier.onCheckInsChanged([pending('Gửi báo cáo quý')])
    expect(h.shown).toHaveLength(1)
  })

  it('gửi khi cửa sổ mở nhưng nằm sau ứng dụng khác', () => {
    const h = harness()
    Object.assign(h.window, { visible: true, focused: false })
    h.notifier.onCheckInsChanged([pending('Gửi báo cáo quý')])
    expect(h.shown).toHaveLength(1)
  })

  it('gửi khi không còn cửa sổ nào', () => {
    const h = harness()
    Object.assign(h.window, { exists: false, visible: false, focused: false })
    h.notifier.onCheckInsChanged([pending('Gửi báo cáo quý')])
    expect(h.shown).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Gộp và không lặp
// ═══════════════════════════════════════════════════════════════════════════

describe('gộp và chống lặp', () => {
  it('ba việc tới hạn cùng lúc thành ĐÚNG MỘT thông báo nói về ba việc', () => {
    const h = harness()
    h.notifier.onCheckInsChanged([pending('A'), pending('B'), pending('C')])
    expect(h.shown).toHaveLength(1)
    expect(h.shown[0]?.body).toBe('3 việc cần chú ý')
  })

  it('reconcile lặp lại với cùng tập thì không gửi thêm', () => {
    const h = harness()
    const suggestions = [pending('A'), pending('B')]
    h.notifier.onCheckInsChanged(suggestions)
    h.notifier.onCheckInsChanged(suggestions)
    h.notifier.onCheckInsChanged(suggestions)
    expect(h.shown).toHaveLength(1)
  })

  it('suggestion mới sau đó chỉ nhắc về phần chưa từng được thông báo', () => {
    const h = harness()
    const first = pending('A')
    h.notifier.onCheckInsChanged([first])
    expect(h.shown[0]?.body).toBe('1 việc cần chú ý')

    h.notifier.onCheckInsChanged([first, pending('B'), pending('C')])
    expect(h.shown).toHaveLength(2)
    expect(h.shown[1]?.body).toBe('2 việc cần chú ý')
  })

  it('id rời danh sách pending thì rời tập đã-thông-báo, nên mốc mới sau này vẫn nhắc lại', () => {
    const h = harness()
    const suggestion = pending('A')
    h.notifier.onCheckInsChanged([suggestion])
    expect(h.shown).toHaveLength(1)

    // Người dùng hoãn: suggestion rời trạng thái pending.
    h.notifier.onCheckInsChanged([{ ...suggestion, state: 'snoozed' }])
    expect(h.shown).toHaveLength(1)

    // Hết hạn hoãn, cùng id quay lại pending — phải được nhắc lại.
    h.notifier.onCheckInsChanged([suggestion])
    expect(h.shown).toHaveLength(2)
  })

  it('dọn tập đã-thông-báo kể cả trong lúc tạm dừng', () => {
    const h = harness()
    const suggestion = pending('A')
    h.notifier.onCheckInsChanged([suggestion])
    h.notifier.pauseForAnHour()

    // Trong lúc tạm dừng, suggestion được xử lý rồi mốc mới lại tới hạn.
    h.notifier.onCheckInsChanged([{ ...suggestion, state: 'acted' }])
    h.notifier.onCheckInsChanged([suggestion])
    expect(h.shown).toHaveLength(1)

    // Hết tạm dừng: id đó phải còn được coi là chưa thông báo.
    h.advanceMinutes(61)
    h.notifier.onCheckInsChanged([suggestion])
    expect(h.shown).toHaveLength(2)
  })

  it('danh sách rỗng không gửi gì', () => {
    const h = harness()
    h.notifier.onCheckInsChanged([])
    expect(h.shown).toEqual([])
  })

  it('bỏ qua suggestion không ở trạng thái pending', () => {
    const h = harness()
    h.notifier.onCheckInsChanged([
      pending('Đã tắt nhắc', { state: 'muted' }),
      pending('Đã hoãn', { state: 'snoozed' }),
    ])
    expect(h.shown).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Tạm dừng một giờ — chỉ chặn thông báo
// ═══════════════════════════════════════════════════════════════════════════

describe('tạm dừng một giờ', () => {
  it('chặn thông báo trong một giờ rồi cho nhắc lại', () => {
    const h = harness()
    h.notifier.pauseForAnHour()
    expect(h.notifier.paused).toBe(true)

    h.notifier.onCheckInsChanged([pending('A')])
    expect(h.shown).toEqual([])

    h.advanceMinutes(59)
    h.notifier.onCheckInsChanged([pending('A')])
    expect(h.shown).toEqual([])

    h.advanceMinutes(2)
    expect(h.notifier.paused).toBe(false)
    h.notifier.onCheckInsChanged([pending('A')])
    expect(h.shown).toHaveLength(1)
  })

  it('tạm dừng KHÔNG đổi setting đã lưu', () => {
    const h = harness()
    h.notifier.pauseForAnHour()
    // Cờ trong bộ nhớ, không phải một lần ghi vào settings: rollback là đóng app.
    expect(h.settings.checkInOsNotificationsEnabled).toBe(true)
    expect(h.settings.proactiveCheckInsEnabled).toBe(true)
  })

  it('resume bỏ tạm dừng ngay', () => {
    const h = harness()
    h.notifier.pauseForAnHour()
    h.notifier.resume()
    expect(h.notifier.paused).toBe(false)
    h.notifier.onCheckInsChanged([pending('A')])
    expect(h.shown).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Chính sách nội dung — bề mặt rò rỉ mới
// ═══════════════════════════════════════════════════════════════════════════

describe('chính sách nội dung', () => {
  it('mặc định chỉ nêu số lượng, không nêu tên cam kết hay bước tiếp theo', () => {
    const h = harness()
    const suggestions = [pending('Gửi báo cáo quý'), pending('Chốt hợp đồng ABBANK')]
    h.notifier.onCheckInsChanged(suggestions)

    const text = JSON.stringify(h.shown)
    expect(h.shown[0]?.body).toBe('2 việc cần chú ý')
    expect(text).not.toContain('Gửi báo cáo quý')
    expect(text).not.toContain('ABBANK')
    expect(text).not.toContain('Bước tiếp theo bí mật')
  })

  it('nêu tên cam kết chỉ khi người dùng đã bật hiển thị nội dung', () => {
    const h = harness({ notificationShowContent: true })
    h.notifier.onCheckInsChanged([pending('Gửi báo cáo quý')])
    expect(h.shown[0]?.body).toBe('Gửi báo cáo quý')
  })

  it('không đưa id nội bộ, mốc thời gian hay bước tiếp theo vào thông báo, kể cả khi bật nội dung', () => {
    const h = harness({ notificationShowContent: true })
    const suggestion = pending('Gửi báo cáo quý')
    h.notifier.onCheckInsChanged([suggestion])

    const text = JSON.stringify(h.shown)
    expect(text).not.toContain(suggestion.id)
    expect(text).not.toContain(suggestion.commitmentId)
    expect(text).not.toContain(suggestion.triggerAt)
    expect(text).not.toContain('Bước tiếp theo bí mật')
  })

  it('log KHÔNG ghi tên cam kết — log ra file nằm ngoài vùng mã hoá', () => {
    const h = harness({ notificationShowContent: true })
    h.notifier.onCheckInsChanged([pending('Gửi báo cáo quý')])
    expect(h.logText()).not.toContain('Gửi báo cáo quý')
    expect(h.logText()).toContain('check-in-notification-sent')
  })
})

describe('buildBody', () => {
  it('chỉ nêu số lượng khi tắt nội dung', () => {
    expect(buildBody([pending('A'), pending('B')], false)).toBe('2 việc cần chú ý')
  })

  it('nêu tối đa ba tên rồi gộp phần còn lại', () => {
    const many = ['A', 'B', 'C', 'D', 'E'].map((title) => pending(title))
    expect(buildBody(many, true)).toBe('A, B, C và 2 việc khác')
  })

  it('không thêm hậu tố khi vừa đủ ba tên', () => {
    expect(buildBody([pending('A'), pending('B'), pending('C')], true)).toBe('A, B, C')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Bấm vào thông báo
// ═══════════════════════════════════════════════════════════════════════════

describe('bấm vào thông báo', () => {
  it('gọi onActivate để main hiện cửa sổ và điều hướng', () => {
    const h = harness()
    h.notifier.onCheckInsChanged([pending('A')])
    expect(h.activations()).toBe(0)
    h.clicks()
    expect(h.activations()).toBe(1)
  })

  it('không đăng ký listener nào khi không gửi thông báo', () => {
    const h = harness({ checkInOsNotificationsEnabled: false })
    h.notifier.onCheckInsChanged([pending('A')])
    h.clicks()
    expect(h.activations()).toBe(0)
  })
})
