import type { AppSettings, CheckInSuggestion } from '@nexa/shared-types'
import type { Logger } from '@nexa/observability'

/**
 * Adapter thông báo hệ điều hành cho proactive check-in (openspec `add-os-checkin-notifications`).
 *
 * `ProactiveCheckInService` đã chừa sẵn `onChanged` làm output port duy nhất và cố ý không biết
 * Notification API tồn tại — lớp này là adapter subscribe cùng port đó. Nhờ vậy "tính khi nào
 * cần nhắc" và "nhắc bằng cách nào" nằm ở hai chỗ khác nhau.
 *
 * File này KHÔNG import `electron`: Notification API, đồng hồ và trạng thái cửa sổ đều vào qua
 * tham số, giống cách `ProactiveCheckInService` nhận `setIntervalFn`. Đó là điều kiện để mọi
 * quyết định gửi/không gửi ở đây kiểm chứng được bằng unit test thường.
 */

const PAUSE_DURATION_MS = 60 * 60 * 1000

/** Số tên cam kết được nêu trước khi thông báo chuyển sang "và N việc khác". */
const MAX_TITLES_IN_BODY = 3

export interface NotificationHandle {
  show(): void
  onClick(listener: () => void): void
}

/**
 * Cổng tới `electron.Notification`, hẹp đúng bằng phần Nexa dùng.
 *
 * `isSupported` nằm ở đây chứ không phải một hằng số lúc khởi động: Cài đặt cần đọc lại nó để
 * vô hiệu hoá công tắc kèm lý do thay vì bật một tính năng không chạy.
 */
export interface NotificationPort {
  isSupported(): boolean
  create(options: { title: string; body: string }): NotificationHandle
}

/** Người dùng có đang NHÌN THẤY màn hình hay không — không phải cửa sổ có tồn tại hay không. */
export interface WindowVisibility {
  readonly exists: boolean
  readonly visible: boolean
  readonly focused: boolean
}

export interface CheckInNotifierOptions {
  readonly notifications: NotificationPort
  readonly readSettings: () => AppSettings
  readonly readWindowVisibility: () => WindowVisibility
  readonly onActivate: () => void
  readonly logger: Logger
  readonly now?: () => Date
}

export class CheckInNotifier {
  private readonly log: Logger
  private readonly now: () => Date
  /**
   * Id đã thông báo, giữ trong RAM có chủ ý: app khởi động lại là một phiên làm việc mới, và
   * nhắc lại một lần lúc đó đúng hơn là im lặng.
   */
  private readonly notified = new Set<string>()
  private pausedUntilMs: number | null = null

  constructor(private readonly opts: CheckInNotifierOptions) {
    this.log = opts.logger.child({ module: 'check-in-notifier' })
    this.now = opts.now ?? (() => new Date())
  }

  get supported(): boolean {
    return this.opts.notifications.isSupported()
  }

  get paused(): boolean {
    return this.pausedUntilMs !== null && this.now().getTime() < this.pausedUntilMs
  }

  /**
   * Tạm dừng một giờ.
   *
   * Chỉ chặn thông báo OS: state suggestion, commitment và setting đã lưu đều không bị đụng tới,
   * nên Hôm nay vẫn là nguồn sự thật trong lúc tạm dừng.
   */
  pauseForAnHour(): void {
    this.pausedUntilMs = this.now().getTime() + PAUSE_DURATION_MS
    this.log.info('check-in-notifications-paused', { minutes: PAUSE_DURATION_MS / 60_000 })
  }

  resume(): void {
    this.pausedUntilMs = null
  }

  /**
   * Gọi mỗi lần `ProactiveCheckInService` báo tập suggestion đổi.
   *
   * Gộp mọi suggestion CHƯA từng được thông báo thành đúng một thông báo. Suggestion đã thông
   * báo rồi thì im lặng, kể cả khi service reconcile nhiều lần với cùng tập.
   */
  onCheckInsChanged(suggestions: readonly CheckInSuggestion[]): void {
    const pending = suggestions.filter((suggestion) => suggestion.state === 'pending')

    // Dọn tập đã-thông-báo TRƯỚC mọi điều kiện gửi: một id rời danh sách pending (người dùng đã
    // xử lý, hoãn, hoặc tắt nhắc) phải rời tập, để một mốc mới sau này vẫn nhắc lại được. Nếu
    // việc dọn nằm sau một lần `return` sớm thì tập sẽ đóng băng đúng lúc người dùng tạm dừng.
    const pendingIds = new Set(pending.map((suggestion) => suggestion.id))
    for (const id of this.notified) {
      if (!pendingIds.has(id)) this.notified.delete(id)
    }

    const reason = this.blockReason(pending.length)
    if (reason !== null) {
      this.log.debug('check-in-notification-skipped', { reason })
      return
    }

    const fresh = pending.filter((suggestion) => !this.notified.has(suggestion.id))
    if (fresh.length === 0) return

    const showContent = this.opts.readSettings().notificationShowContent
    const notification = this.opts.notifications.create({
      title: 'Nexa',
      body: buildBody(fresh, showContent),
    })
    notification.onClick(() => this.opts.onActivate())
    notification.show()

    for (const suggestion of fresh) this.notified.add(suggestion.id)

    // Ghi SỐ LƯỢNG và việc có nêu tên hay không, không ghi tên. Log đi ra file ngoài vùng mã
    // hoá của SQLite, nên nó chịu đúng chính sách nội dung như bản thân thông báo.
    this.log.info('check-in-notification-sent', {
      count: fresh.length,
      withContent: showContent,
    })
  }

  /**
   * Lý do KHÔNG gửi, hoặc `null` khi được gửi.
   *
   * Gom thành một hàm để mọi điều kiện nằm cạnh nhau và log nói được vì sao im lặng — "không
   * thấy thông báo nào" là loại lỗi rất khó điều tra nếu không có dòng này.
   */
  private blockReason(pendingCount: number): string | null {
    if (pendingCount === 0) return 'no-pending-suggestions'

    const settings = this.opts.readSettings()
    // Hai opt-in phải cùng bật. Bật nhắc việc trong app không đồng nghĩa với việc cho phép nội
    // dung rời khỏi cửa sổ Nexa.
    if (!settings.proactiveCheckInsEnabled) return 'check-ins-disabled'
    if (!settings.checkInOsNotificationsEnabled) return 'os-notifications-disabled'

    if (!this.opts.notifications.isSupported()) return 'platform-unsupported'
    if (this.paused) return 'paused'

    // Cửa sổ mở nhưng nằm sau trình duyệt vẫn là không nhìn thấy — điều kiện là "người dùng có
    // đang nhìn không", không phải "cửa sổ có tồn tại không".
    const window = this.opts.readWindowVisibility()
    if (window.exists && window.visible && window.focused) return 'window-focused'

    return null
  }
}

/**
 * Nội dung thông báo.
 *
 * Mặc định chỉ nêu SỐ LƯỢNG. Trung tâm thông báo của OS hiển thị cả trên màn hình khoá, được
 * trợ lý đọc to và trên một số cấu hình Windows còn đồng bộ sang máy khác — tên cam kết chỉ ra
 * khỏi vùng mã hoá khi người dùng đã tự bật `notificationShowContent`.
 *
 * Không nhánh nào đưa id, `nextAction`, `sourceConversationId` hay mốc thời gian vào nội dung.
 */
export function buildBody(suggestions: readonly CheckInSuggestion[], showContent: boolean): string {
  const count = suggestions.length
  if (!showContent) return `${String(count)} việc cần chú ý`

  const titles = suggestions.slice(0, MAX_TITLES_IN_BODY).map((suggestion) => suggestion.title)
  const hidden = count - titles.length
  const listed = titles.join(', ')
  return hidden === 0 ? listed : `${listed} và ${String(hidden)} việc khác`
}
