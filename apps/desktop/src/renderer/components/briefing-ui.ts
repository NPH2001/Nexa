import type {
  BriefingGroupName,
  BriefingItemView,
  BriefingReasonView,
  BriefingSourceStateView,
  BriefingSourceStatusName,
} from '@nexa/shared-types/renderer'

/**
 * Copy cho bản tin (openspec `add-daily-briefing`).
 *
 * Main gửi enum và timestamp; câu chữ tiếng Việt dựng ở đây. Một trạng thái chỉ được viết ở đúng
 * một chỗ, nên không có hai tầng cùng đặt tên cho một tình huống.
 */

export const BRIEFING_GROUP_LABELS: Readonly<Record<BriefingGroupName, string>> = {
  overdue: 'Quá hạn',
  due_today: 'Đến hạn hôm nay',
  due_this_week: 'Trong 7 ngày tới',
  in_progress: 'Đang làm',
}

export const BRIEFING_GROUP_TONES: Readonly<Record<BriefingGroupName, string>> = {
  overdue: 'overdue',
  due_today: 'soon',
  due_this_week: 'soon',
  in_progress: 'normal',
}

/** Lý do một mục có mặt, nói bằng ngày và trạng thái — không bằng điểm ưu tiên. */
export function describeBriefingReason(reason: BriefingReasonView): string {
  const days = reason.days
  if (days === null) return 'Chưa đặt hạn'

  if (reason.kind === 'check_in_due') {
    return days < 0
      ? `Đã tới lúc check-in từ ${String(-days)} ngày trước`
      : 'Đến lúc check-in hôm nay'
  }
  if (days < 0) return `Quá hạn ${String(-days)} ngày`
  if (days === 0) return 'Đến hạn hôm nay'
  if (days === 1) return 'Đến hạn ngày mai'
  return `Còn ${String(days)} ngày`
}

export interface BriefingSourceNotice {
  readonly tone: 'info' | 'warning'
  readonly message: string
  /** Có mời người dùng thử lại hay không — chỉ với hỏng hóc tạm thời. */
  readonly canRetry: boolean
}

/**
 * Nguồn nào không có dữ liệu, và vì sao.
 *
 * `null` nghĩa là nguồn chạy bình thường. Mọi nhánh còn lại đều phải NÓI RA lý do: im lặng ở đây
 * chính là cách một nguồn hỏng bị đọc nhầm thành "hôm nay không có việc".
 */
export function describeBriefingSource(
  source: BriefingSourceStateView,
): BriefingSourceNotice | null {
  if (source.status === 'ok') return null

  const what = source.source === 'jira' ? 'Jira' : 'cam kết'

  const notices: Readonly<Record<BriefingSourceStatusName, BriefingSourceNotice | null>> = {
    ok: null,
    empty: null,
    disabled_by_policy: {
      tone: 'info',
      message: `Việc từ ${what} đang tắt theo chính sách của tổ chức.`,
      canRetry: false,
    },
    not_configured: {
      tone: 'info',
      message: `Chưa kết nối ${what}, nên bản tin chưa có việc từ đó.`,
      canRetry: false,
    },
    unauthenticated: {
      tone: 'warning',
      message: `${what} từ chối đăng nhập hiện tại. Kiểm tra lại kết nối trong Cài đặt.`,
      canRetry: false,
    },
    unavailable: {
      tone: 'warning',
      message: `Không lấy được việc từ ${what} lúc này.`,
      canRetry: true,
    },
    error: {
      tone: 'warning',
      message: `${what} trả về dữ liệu không đọc được, nên bản tin đang thiếu phần đó.`,
      canRetry: true,
    },
  }

  return notices[source.status]
}

/** `true` khi một nguồn im lặng vì hỏng chứ không phải vì hết việc. */
export function isBriefingSourceBroken(source: BriefingSourceStateView): boolean {
  return source.status !== 'ok' && source.status !== 'empty'
}

export function formatBriefingTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

export function briefingItemKicker(item: BriefingItemView): string {
  return item.source === 'jira' ? (item.reference ?? 'Jira') : 'Cam kết'
}
