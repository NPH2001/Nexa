import type { Logger } from '@nexa/observability'

/**
 * Tray icon cho check-in (openspec `add-os-checkin-notifications`).
 *
 * Tray tồn tại cùng tiến trình và KHÔNG đổi ngữ nghĩa thoát app: `window-all-closed` vẫn gọi
 * `app.quit()` trên Windows/Linux. Một tray kiểu "đóng để thu nhỏ" sẽ giữ tiến trình sống vô
 * thời hạn với credential đã giải mã trong RAM — lật ngược một quyết định bảo mật có chủ ý —
 * nên nó nằm ngoài change này.
 *
 * Như `check-in-notifier.ts`, file này không import `electron`: `Tray`/`Menu` vào qua cổng
 * `TrayPort` để vòng đời dựng/huỷ kiểm chứng được bằng unit test.
 */

export interface TrayMenuItem {
  readonly label: string
  readonly click: () => void
}

export interface TrayHandle {
  setToolTip(text: string): void
  setContextMenu(items: readonly TrayMenuItem[]): void
  onClick(listener: () => void): void
  destroy(): void
}

export interface TrayPort {
  /** Ném khi asset không dùng được làm tray icon trên nền tảng hiện tại. */
  create(iconPath: string): TrayHandle
}

export interface TrayControllerOptions {
  readonly tray: TrayPort
  readonly iconPath: string
  readonly logger: Logger
  readonly onOpen: () => void
  readonly onPauseOneHour: () => void
  readonly onQuit: () => void
}

export const TRAY_LABELS = {
  open: 'Mở Nexa',
  pause: 'Tạm dừng nhắc 1 giờ',
  quit: 'Thoát',
} as const

export class TrayController {
  private readonly log: Logger
  private handle: TrayHandle | null = null

  constructor(private readonly opts: TrayControllerOptions) {
    this.log = opts.logger.child({ module: 'tray' })
  }

  /** Tray có đang giữ handle nào không — dùng cho cả test lifecycle và minimize-to-tray. */
  get active(): boolean {
    return this.handle !== null
  }

  /**
   * Dựng tray. Không dựng được thì log rồi bỏ qua.
   *
   * `icon.ico` là asset Windows; một số desktop environment trên Linux từ chối nó. Tray là tiện
   * ích, không phải điều kiện để app chạy — chết lúc khởi động vì một file icon là kết cục tệ
   * hơn hẳn việc thiếu một biểu tượng ở khay hệ thống.
   */
  start(): void {
    if (this.handle !== null) return
    try {
      const handle = this.opts.tray.create(this.opts.iconPath)
      handle.setToolTip('Nexa')
      handle.setContextMenu([
        { label: TRAY_LABELS.open, click: () => this.opts.onOpen() },
        { label: TRAY_LABELS.pause, click: () => this.opts.onPauseOneHour() },
        { label: TRAY_LABELS.quit, click: () => this.opts.onQuit() },
      ])
      handle.onClick(() => this.opts.onOpen())
      this.handle = handle
      this.log.info('tray-ready', {})
    } catch (error) {
      // Ghi lý do dạng thông điệp ngắn, không ghi đường dẫn — đường dẫn userData chứa tên người dùng.
      this.log.warn('tray-unavailable', {
        detail: error instanceof Error ? error.message : 'unknown',
      })
      this.handle = null
    }
  }

  /**
   * Huỷ tray. Gọi trong `before-quit`.
   *
   * Idempotent: shutdown đi qua nhiều handler, và một tray icon còn sót lại sau khi tiến trình
   * chết là đúng thứ khiến người dùng tin Nexa vẫn đang nhắc việc khi nó đã tắt.
   */
  dispose(): void {
    const handle = this.handle
    this.handle = null
    if (handle === null) return
    try {
      handle.destroy()
    } catch (error) {
      this.log.warn('tray-dispose-failed', {
        detail: error instanceof Error ? error.message : 'unknown',
      })
    }
    this.log.info('tray-disposed', {})
  }
}
