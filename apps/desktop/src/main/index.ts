import { join } from 'node:path'
import { app, BrowserWindow, Menu, Notification, Tray, dialog } from 'electron'
import {
  NEXA_EVENTS,
  NexaError,
  type McpStatusEvent,
  type NavigateView,
} from '@nexa/shared-types'
import { FileSink, Logger, globalRedactor } from '@nexa/observability'
import { ChatController } from './chat-controller.js'
import { CheckInNotifier, type NotificationHandle } from './check-in-notifier.js'
import { registerIpc } from './ipc.js'
import { bootstrapServices, type NexaServices } from './services.js'
import { createMainWindow } from './window.js'
import { TrayController, type TrayHandle } from './tray.js'
import { revealAndNavigate, type RevealWindow } from './window-reveal.js'
import { UpdateService } from './update-service.js'
import { RENDERER_ENTRY_URL, registerRendererProtocol } from './renderer-protocol.js'

/** Khớp `appId` trong electron-builder.yml — xem `setAppUserModelId` trong `start()`. */
const APP_USER_MODEL_ID = 'net.fimaster.nexa'

const isDevelopment = !app.isPackaged
let services: NexaServices | null = null
let chat: ChatController | null = null
let mainWindow: BrowserWindow | null = null
let retentionTimer: NodeJS.Timeout | null = null
let updateTimer: NodeJS.Timeout | null = null
let notifier: CheckInNotifier | null = null
let tray: TrayController | null = null

/**
 * §11.1: "Không chạy ứng dụng với quyền Administrator nếu không cần."
 * Nexa không cần — và một single-instance lock ngăn hai tiến trình tranh nhau cùng file SQLite
 * (§16 "Local DB bị khóa").
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(start)
}

function start(): void {
  // Windows gắn toast vào AppUserModelId của tiến trình, không vào tên file. Không khai báo thì
  // thông báo hiện dưới danh tính "Electron" — hoặc không hiện gì cả. Giá trị phải khớp `appId`
  // trong electron-builder.yml để khớp shortcut Start Menu mà bộ cài tạo ra.
  app.setAppUserModelId(APP_USER_MODEL_ID)

  registerRendererProtocol(join(app.getAppPath(), 'out', 'renderer'))

  try {
    services = bootstrapServices({
      isDevelopment,
      onMcpStatus: emitMcpStatus,
      onCheckInsChanged: emitCheckInsChanged,
    })
  } catch (error) {
    // Fail closed (§3): không mở app khi secure storage hoặc DB không dùng được. Người dùng
    // cần một thông báo rõ ràng chứ không phải một cửa sổ trắng.
    //
    // Ghi log TRƯỚC khi hiện dialog: lúc này `services` chưa tồn tại nên logger chính chưa có,
    // và nếu chỉ hiện dialog rồi thoát thì không còn dấu vết nào để hỗ trợ điều tra vì sao
    // app không mở được (§15.1 "Application log: startup, trạng thái module, error code").
    logStartupFailure(error)
    showFatalError(error)
    app.quit()
    return
  }

  const activeServices = services
  chat = new ChatController(activeServices, () => mainWindow)

  registerIpc({
    services: activeServices,
    chat,
    getWindow: () => mainWindow,
    onMcpStatus: emitMcpStatus,
  })

  notifier = new CheckInNotifier({
    notifications: electronNotifications,
    readSettings: () => activeServices.settings.get(),
    readWindowVisibility: readWindowVisibility,
    onActivate: () => revealToday(activeServices),
    logger: activeServices.logger,
  })

  tray = new TrayController({
    tray: electronTray,
    iconPath: join(app.getAppPath(), 'resources', 'icon.ico'),
    logger: activeServices.logger,
    onOpen: () => revealToday(activeServices),
    onPauseOneHour: () => notifier?.pauseForAnHour(),
    onQuit: () => app.quit(),
  })
  tray.start()

  openWindow(activeServices)
  activeServices.checkIns.start()
  scheduleRetention(activeServices)
  scheduleUpdateCheck(activeServices)
  void startMcp(activeServices)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow(activeServices)
  })
}

function openWindow(activeServices: NexaServices): BrowserWindow {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']

  mainWindow = createMainWindow({
    preloadPath: join(app.getAppPath(), 'out', 'preload', 'index.cjs'),
    rendererUrl: devServerUrl ?? RENDERER_ENTRY_URL,
    logger: activeServices.logger,
    allowedDomains: activeServices.policy.allowedDomains,
    isDevelopment,
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Thu nhỏ xuống tray là tuỳ chọn cho hành vi MINIMIZE, và chỉ vậy: `window-all-closed` bên
  // dưới không đổi một dòng, nên đóng cửa sổ vẫn thoát app. Không dựng được tray thì thu nhỏ
  // giữ nguyên hành vi cũ — ẩn cửa sổ khi không có tray là cách làm nó biến mất hẳn.
  mainWindow.on('minimize', () => {
    if (!activeServices.settings.get().minimizeToTrayEnabled) return
    if (tray?.active !== true) return
    // `hide()` sau khi đã minimize là cách bỏ cửa sổ khỏi taskbar; `minimize` không phải event
    // huỷ được nên không có đường nào chặn nó từ đầu. `revealAndNavigate` restore rồi show, nên
    // hai bước này đảo ngược được đầy đủ.
    mainWindow?.hide()
  })

  activeServices.logger.perf('window-ready', {
    durationMs: Math.round(performance.now()),
  })

  return mainWindow
}

/** Khởi chạy MCP ở nền: chat với LLM không được phải chờ Atlassian sẵn sàng. */
async function startMcp(activeServices: NexaServices): Promise<void> {
  if (activeServices.mcp === null) return
  try {
    await activeServices.mcp.start()
  } catch (error) {
    activeServices.logger.warn('mcp-autostart-failed', {
      errorCode: NexaError.wrap(error).code,
    })
  }
}

/** §8.3 — áp chính sách lưu giữ lúc khởi động rồi mỗi 6 giờ. */
function scheduleRetention(activeServices: NexaServices): void {
  const apply = (): void => {
    const settings = activeServices.settings.get()
    activeServices.retention.apply(activeServices.profileId, {
      historyRetentionDays: settings.features.storeHistory ? settings.historyRetentionDays : 1,
      logRetentionDays: settings.logRetentionDays,
    })
    activeServices.guard.sweepExpired()
  }

  apply()
  retentionTimer = setInterval(apply, 6 * 60 * 60 * 1000)
  retentionTimer.unref()
}

/**
 * §18.2: "Kiểm tra phiên bản khi khởi động và định kỳ tối đa một lần/ngày."
 *
 * Mặc định TẮT (`features.autoUpdate = false`) và chỉ chạy khi tổ chức khai `updateManifestUrl`
 * trong policy — xem docs/OPEN-QUESTIONS.md A8. Không kết nối được máy chủ cập nhật KHÔNG
 * chặn việc sử dụng app.
 */
function scheduleUpdateCheck(activeServices: NexaServices): void {
  const manifestUrl = activeServices.policy.updateManifestUrl
  if (manifestUrl === undefined) return
  if (!activeServices.settings.get().features.autoUpdate) {
    activeServices.logger.info('update-check-disabled', { reason: 'autoUpdate feature is off' })
    return
  }

  const service = new UpdateService(activeServices.logger, app.getVersion())

  const check = (): void => {
    void service
      .check(manifestUrl, activeServices.policy.allowedDomains)
      .then((result) => {
        activeServices.logger.info('update-checked', { status: result.status })
        if (mainWindow === null || mainWindow.isDestroyed()) return
        // §18.2: "Bắt buộc cập nhật chỉ khi có lỗi bảo mật hoặc API không tương thích."
        // Ba trạng thái này phải chặn sử dụng, không chỉ hiện thông báo — nếu chỉ hiện toast
        // thì người dùng sẽ tắt nó và tiếp tục chạy một bản đã bị thu hồi.
        const blocking =
          result.status === 'mandatory' ||
          result.status === 'rollback-required' ||
          result.status === 'unsupported-client'

        if (blocking) {
          const target = result.manifest?.rollbackTo ?? result.manifest
          dialog.showMessageBoxSync(mainWindow, {
            type: 'warning',
            title: 'Nexa cần được cập nhật',
            message: result.message,
            detail: [
              'Hãy liên hệ bộ phận IT để cài phiên bản được chỉ định. Nexa sẽ đóng lại.',
              target === undefined ? '' : `Phiên bản cần cài: ${target.version}`,
            ]
              .filter((line) => line !== '')
              .join('\n'),
            buttons: ['Đóng Nexa'],
          })
          app.quit()
          return
        }

        if (result.status === 'available') {
          mainWindow.webContents.send(NEXA_EVENTS.updateAvailable, {
            version: result.manifest?.version ?? '',
            message: result.message,
            notes: result.manifest?.notes,
          })
        }
      })
      .catch(() => undefined)
  }

  check()
  updateTimer = setInterval(check, 24 * 60 * 60 * 1000)
  updateTimer.unref()
}

function emitMcpStatus(event: McpStatusEvent): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(NEXA_EVENTS.mcpStatus, event)
}

/**
 * Cổng duy nhất của `ProactiveCheckInService` ra ngoài.
 *
 * Hai consumer, cùng một event: Hôm nay cập nhật như trước, và notifier quyết định có gửi thông
 * báo OS hay không. Service vẫn không biết Notification API tồn tại.
 */
function emitCheckInsChanged(changedAt: string): void {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(NEXA_EVENTS.checkInsChanged, { changedAt })
  }

  const activeServices = services
  if (activeServices === null || notifier === null) return
  try {
    // `list()` là cổng đọc công khai duy nhất. Nó reconcile lại một lần nữa, nhưng reconcile là
    // idempotent nên lần thứ hai không tìm thấy thay đổi và không phát lại event — không có đệ quy.
    notifier.onCheckInsChanged(activeServices.checkIns.list().suggestions)
  } catch (error) {
    // Một thông báo không gửi được KHÔNG được làm hỏng việc cập nhật Hôm nay: Hôm nay mới là
    // nguồn sự thật, thông báo chỉ là lời mời quay lại.
    activeServices.logger.warn('check-in-notify-failed', {
      errorCode: NexaError.wrap(error).code,
    })
  }
}

/** Người dùng có đang NHÌN THẤY màn hình hay không — không phải cửa sổ có tồn tại hay không. */
function readWindowVisibility(): { exists: boolean; visible: boolean; focused: boolean } {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    return { exists: false, visible: false, focused: false }
  }
  return {
    exists: true,
    visible: mainWindow.isVisible() && !mainWindow.isMinimized(),
    focused: mainWindow.isFocused(),
  }
}

/** Bấm thông báo và "Mở Nexa" trên tray đi cùng một đường và kết thúc ở cùng một chỗ. */
function revealToday(activeServices: NexaServices): void {
  revealAndNavigate({
    getWindow: () => (mainWindow === null ? null : adaptWindow(mainWindow)),
    openWindow: () => adaptWindow(openWindow(activeServices)),
  })
}

function adaptWindow(window: BrowserWindow): RevealWindow {
  return {
    isDestroyed: () => window.isDestroyed(),
    isMinimized: () => window.isMinimized(),
    isVisible: () => window.isVisible(),
    restore: () => window.restore(),
    show: () => window.show(),
    focus: () => window.focus(),
    isLoading: () => window.webContents.isLoading(),
    onceLoaded: (listener) => window.webContents.once('did-finish-load', listener),
    sendNavigate: (view: NavigateView) =>
      window.webContents.send(NEXA_EVENTS.navigate, { view }),
  }
}

/** Adapter `electron.Notification` — cổng hẹp mà `CheckInNotifier` nhận qua tham số. */
const electronNotifications = {
  isSupported: () => Notification.isSupported(),
  create: (options: { title: string; body: string }): NotificationHandle => {
    const notification = new Notification(options)
    return {
      show: () => notification.show(),
      onClick: (listener) => notification.on('click', listener),
    }
  },
}

/** Adapter `electron.Tray` + `electron.Menu`. */
const electronTray = {
  create: (iconPath: string): TrayHandle => {
    const instance = new Tray(iconPath)
    return {
      setToolTip: (text) => instance.setToolTip(text),
      setContextMenu: (items) =>
        instance.setContextMenu(
          Menu.buildFromTemplate(items.map((item) => ({ label: item.label, click: item.click }))),
        ),
      onClick: (listener) => instance.on('click', listener),
      destroy: () => instance.destroy(),
    }
  },
}

/**
 * Ghi lại lỗi khởi động khi logger chính chưa dựng được.
 *
 * Dùng FileSink trực tiếp vào đúng thư mục log mà `bootstrapServices` sẽ dùng, để người hỗ trợ
 * tìm thấy nó ở chỗ quen thuộc. Nếu cả việc này cũng hỏng thì đành chịu — không được để một
 * lỗi ghi log che mất lỗi gốc.
 */
function logStartupFailure(error: unknown): void {
  const nexa = NexaError.wrap(error)
  try {
    const sink = new FileSink({ dir: join(app.getPath('userData'), 'logs'), baseName: 'nexa' })
    new Logger({ sink, redactor: globalRedactor, minLevel: 'error' }).error('app-startup-failed', {
      errorCode: nexa.code,
      detail: nexa.safeDetail,
      appVersion: app.getVersion(),
      platform: `${process.platform} ${process.arch}`,
      electron: process.versions['electron'] ?? 'unknown',
      node: process.versions.node,
    })
  } catch {
    // Không ghi được log thì dialog vẫn còn — đó là lý do có cả hai.
  }
}

function showFatalError(error: unknown): void {
  const nexa = NexaError.wrap(error)
  dialog.showErrorBox(
    'Nexa không khởi động được',
    [
      nexa.message,
      nexa.hint ?? '',
      '',
      `Mã lỗi: ${nexa.code}`,
      nexa.safeDetail === undefined ? '' : `Chi tiết: ${nexa.safeDetail}`,
    ]
      .filter((line) => line !== '')
      .join('\n'),
  )
}

app.on('window-all-closed', () => {
  // Windows/Linux: đóng cửa sổ là thoát hẳn. Không giữ tiến trình nền ôm credential
  // đã giải mã trong bộ nhớ.
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (retentionTimer !== null) clearInterval(retentionTimer)
  if (updateTimer !== null) clearInterval(updateTimer)
  // Tray phải chết cùng tiến trình: một icon còn sót lại ở khay hệ thống là đúng thứ khiến
  // người dùng tin Nexa vẫn đang nhắc việc khi nó đã tắt.
  tray?.dispose()
  tray = null
  notifier = null
  chat?.shutdown()
})

app.on('will-quit', (event) => {
  if (services === null) return
  const pending = services
  services = null
  event.preventDefault()
  void pending.dispose().finally(() => app.exit(0))
})

// §11.1: chặn mọi cửa sổ mới và mọi lần gắn webview — không có tính năng nào cần chúng.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-attach-webview', (attachEvent) => attachEvent.preventDefault())
})
