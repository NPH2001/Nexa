import { describe, expect, it, vi } from 'vitest'
import { Logger, MemorySink } from '@nexa/observability'
import { TRAY_LABELS, TrayController, type TrayHandle, type TrayPort } from './tray.js'
import { revealAndNavigate, type RevealWindow } from './window-reveal.js'

/**
 * Tray + deep-link (openspec `add-os-checkin-notifications`).
 *
 * `tray.ts` và `window-reveal.ts` đều không import `electron`, nên `Tray`/`Menu` và
 * `BrowserWindow` vào qua cổng và cả hai vòng đời kiểm chứng được bằng test thường.
 */

function logger(): { log: Logger; text: () => string } {
  const sink = new MemorySink()
  return { log: new Logger({ sink, minLevel: 'debug' }), text: () => sink.asText() }
}

interface FakeTray {
  port: TrayPort
  handles: { destroyed: boolean; tooltip: string | null; items: { label: string }[] }[]
  clickAll: () => void
  fireMenu: (label: string) => void
}

function fakeTray(opts: { failOnCreate?: boolean; failOnDestroy?: boolean } = {}): FakeTray {
  const handles: FakeTray['handles'] = []
  const clickListeners: (() => void)[] = []
  const menus: { label: string; click: () => void }[][] = []

  const port: TrayPort = {
    create: (): TrayHandle => {
      if (opts.failOnCreate === true) throw new Error('icon không dùng được trên nền tảng này')
      const record = {
        destroyed: false,
        tooltip: null as string | null,
        items: [] as { label: string }[],
      }
      handles.push(record)
      return {
        setToolTip: (text) => {
          record.tooltip = text
        },
        setContextMenu: (items) => {
          record.items = items.map((item) => ({ label: item.label }))
          menus.push([...items])
        },
        onClick: (listener) => clickListeners.push(listener),
        destroy: () => {
          if (opts.failOnDestroy === true) throw new Error('destroy hỏng')
          record.destroyed = true
        },
      }
    },
  }

  return {
    port,
    handles,
    clickAll: () => {
      for (const listener of clickListeners) listener()
    },
    fireMenu: (label) => {
      for (const menu of menus) {
        for (const item of menu) if (item.label === label) item.click()
      }
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Menu tray
// ═══════════════════════════════════════════════════════════════════════════

describe('TrayController', () => {
  it('dựng tray với đúng ba mục: Mở Nexa / Tạm dừng nhắc 1 giờ / Thoát', () => {
    const tray = fakeTray()
    const controller = new TrayController({
      tray: tray.port,
      iconPath: '/resources/icon.ico',
      logger: logger().log,
      onOpen: vi.fn(),
      onPauseOneHour: vi.fn(),
      onQuit: vi.fn(),
    })

    controller.start()
    expect(controller.active).toBe(true)
    expect(tray.handles[0]?.items.map((item) => item.label)).toEqual([
      TRAY_LABELS.open,
      TRAY_LABELS.pause,
      TRAY_LABELS.quit,
    ])
    expect(tray.handles[0]?.tooltip).toBe('Nexa')
  })

  it('mỗi mục menu gọi đúng một callback', () => {
    const tray = fakeTray()
    const onOpen = vi.fn()
    const onPauseOneHour = vi.fn()
    const onQuit = vi.fn()
    const controller = new TrayController({
      tray: tray.port,
      iconPath: '/resources/icon.ico',
      logger: logger().log,
      onOpen,
      onPauseOneHour,
      onQuit,
    })
    controller.start()

    tray.fireMenu(TRAY_LABELS.pause)
    expect(onPauseOneHour).toHaveBeenCalledTimes(1)
    expect(onQuit).not.toHaveBeenCalled()

    tray.fireMenu(TRAY_LABELS.quit)
    expect(onQuit).toHaveBeenCalledTimes(1)

    // Bấm thẳng vào icon cũng là "Mở Nexa" — hành vi mà người dùng Windows mong đợi.
    tray.clickAll()
    tray.fireMenu(TRAY_LABELS.open)
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('gọi start hai lần không dựng thêm tray thứ hai', () => {
    const tray = fakeTray()
    const controller = new TrayController({
      tray: tray.port,
      iconPath: '/resources/icon.ico',
      logger: logger().log,
      onOpen: vi.fn(),
      onPauseOneHour: vi.fn(),
      onQuit: vi.fn(),
    })
    controller.start()
    controller.start()
    expect(tray.handles).toHaveLength(1)
  })

  it('asset không dùng được thì LOG và bỏ qua tray, không làm chết khởi động', () => {
    const tray = fakeTray({ failOnCreate: true })
    const log = logger()
    const controller = new TrayController({
      tray: tray.port,
      iconPath: '/resources/icon.ico',
      logger: log.log,
      onOpen: vi.fn(),
      onPauseOneHour: vi.fn(),
      onQuit: vi.fn(),
    })

    expect(() => controller.start()).not.toThrow()
    expect(controller.active).toBe(false)
    expect(log.text()).toContain('tray-unavailable')
  })

  it('không ghi đường dẫn icon vào log — userData chứa tên người dùng', () => {
    const tray = fakeTray({ failOnCreate: true })
    const log = logger()
    new TrayController({
      tray: tray.port,
      iconPath: '/home/nguoi-dung-that/resources/icon.ico',
      logger: log.log,
      onOpen: vi.fn(),
      onPauseOneHour: vi.fn(),
      onQuit: vi.fn(),
    }).start()
    expect(log.text()).not.toContain('nguoi-dung-that')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Vòng đời — không còn handle nào sau shutdown
// ═══════════════════════════════════════════════════════════════════════════

describe('vòng đời tray', () => {
  it('dispose huỷ handle và không còn giữ gì sau shutdown', () => {
    const tray = fakeTray()
    const controller = new TrayController({
      tray: tray.port,
      iconPath: '/resources/icon.ico',
      logger: logger().log,
      onOpen: vi.fn(),
      onPauseOneHour: vi.fn(),
      onQuit: vi.fn(),
    })
    controller.start()
    controller.dispose()

    // Một tray icon còn sót sau khi tiến trình chết là đúng thứ khiến người dùng tin Nexa
    // vẫn đang nhắc việc khi nó đã tắt.
    expect(controller.active).toBe(false)
    expect(tray.handles[0]?.destroyed).toBe(true)
  })

  it('dispose là idempotent — shutdown đi qua nhiều handler', () => {
    const tray = fakeTray()
    const controller = new TrayController({
      tray: tray.port,
      iconPath: '/resources/icon.ico',
      logger: logger().log,
      onOpen: vi.fn(),
      onPauseOneHour: vi.fn(),
      onQuit: vi.fn(),
    })
    controller.start()
    controller.dispose()
    expect(() => controller.dispose()).not.toThrow()
    expect(controller.active).toBe(false)
  })

  it('dispose khi chưa từng dựng được tray cũng không ném', () => {
    const tray = fakeTray({ failOnCreate: true })
    const controller = new TrayController({
      tray: tray.port,
      iconPath: '/resources/icon.ico',
      logger: logger().log,
      onOpen: vi.fn(),
      onPauseOneHour: vi.fn(),
      onQuit: vi.fn(),
    })
    controller.start()
    expect(() => controller.dispose()).not.toThrow()
  })

  it('destroy hỏng vẫn nhả handle — không chặn đường thoát', () => {
    const tray = fakeTray({ failOnDestroy: true })
    const log = logger()
    const controller = new TrayController({
      tray: tray.port,
      iconPath: '/resources/icon.ico',
      logger: log.log,
      onOpen: vi.fn(),
      onPauseOneHour: vi.fn(),
      onQuit: vi.fn(),
    })
    controller.start()
    expect(() => controller.dispose()).not.toThrow()
    expect(controller.active).toBe(false)
    expect(log.text()).toContain('tray-dispose-failed')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Deep-link — cả hai đường đều kết thúc ở Hôm nay
// ═══════════════════════════════════════════════════════════════════════════

interface FakeWindow extends RevealWindow {
  readonly calls: string[]
  readonly navigated: string[]
  finishLoading: () => void
  destroy: () => void
}

function fakeWindow(
  state: { minimized?: boolean; visible?: boolean; loading?: boolean; destroyed?: boolean } = {},
): FakeWindow {
  const calls: string[] = []
  const navigated: string[] = []
  const loadListeners: (() => void)[] = []
  let minimized = state.minimized ?? false
  let visible = state.visible ?? true
  let loading = state.loading ?? false
  let destroyed = state.destroyed ?? false

  return {
    calls,
    navigated,
    finishLoading: () => {
      loading = false
      for (const listener of loadListeners) listener()
    },
    destroy: () => {
      destroyed = true
    },
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    isVisible: () => visible,
    restore: () => {
      minimized = false
      calls.push('restore')
    },
    show: () => {
      visible = true
      calls.push('show')
    },
    focus: () => calls.push('focus'),
    isLoading: () => loading,
    onceLoaded: (listener) => loadListeners.push(listener),
    sendNavigate: (view) => navigated.push(view),
  }
}

describe('revealAndNavigate', () => {
  it('cửa sổ thu nhỏ: restore, show, focus rồi tới Hôm nay', () => {
    const window = fakeWindow({ minimized: true, visible: false })
    const openWindow = vi.fn()

    revealAndNavigate({ getWindow: () => window, openWindow })

    // Restore phải đi trước focus: focus trên cửa sổ đang minimize không đưa nó lên trên ở
    // mọi window manager.
    expect(window.calls).toEqual(['restore', 'show', 'focus'])
    expect(window.navigated).toEqual(['today'])
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('cửa sổ đang hiện nhưng bị che: chỉ cần focus rồi tới Hôm nay', () => {
    const window = fakeWindow()
    revealAndNavigate({ getWindow: () => window, openWindow: vi.fn() })
    expect(window.calls).toEqual(['focus'])
    expect(window.navigated).toEqual(['today'])
  })

  it('không còn cửa sổ nào: mở cửa sổ mới và vẫn kết thúc ở Hôm nay', () => {
    const fresh = fakeWindow({ loading: true })
    const openWindow = vi.fn(() => fresh)

    revealAndNavigate({ getWindow: () => null, openWindow })

    expect(openWindow).toHaveBeenCalledTimes(1)
    // Cửa sổ mới còn đang nạp renderer: gửi ngay thì event rơi vào hư không.
    expect(fresh.navigated).toEqual([])
    fresh.finishLoading()
    expect(fresh.navigated).toEqual(['today'])
  })

  it('cửa sổ đã destroy được coi như không còn cửa sổ nào', () => {
    const stale = fakeWindow({ destroyed: true })
    const fresh = fakeWindow()
    const openWindow = vi.fn(() => fresh)

    revealAndNavigate({ getWindow: () => stale, openWindow })

    expect(openWindow).toHaveBeenCalledTimes(1)
    expect(fresh.navigated).toEqual(['today'])
    expect(stale.navigated).toEqual([])
  })

  it('cửa sổ bị đóng trong lúc đang nạp thì không gửi event vào hư không', () => {
    const window = fakeWindow({ loading: true })
    revealAndNavigate({ getWindow: () => window, openWindow: () => null })

    window.destroy()
    window.finishLoading()
    expect(window.navigated).toEqual([])
  })

  it('không mở được cửa sổ mới thì im lặng chứ không ném', () => {
    expect(() => revealAndNavigate({ getWindow: () => null, openWindow: () => null })).not.toThrow()
  })
})
