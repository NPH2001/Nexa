import {
  BRIEFING_GROUPS,
  DEFAULT_MAX_ITEMS_PER_GROUP,
  type Briefing,
  type BriefingCommitmentInput,
  type BriefingGroup,
  type BriefingGroupResult,
  type BriefingInput,
  type BriefingIssueInput,
  type BriefingItem,
  type BriefingReasonKind,
} from './model.js'

const MS_PER_DAY = 86_400_000
const MS_PER_MINUTE = 60_000

/** Mốc nào đã đẩy một cam kết lên bản tin: hạn hoàn thành hay lịch quay lại. */
type TimestampDriver = 'due' | 'check_in'

function parseTimestamp(value: string | null): number | null {
  if (value === null) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Số thứ tự ngày địa phương của một mốc UTC.
 *
 * Cộng offset rồi mới chia cho một ngày: đó là chỗ duy nhất ranh giới ngày được quyết định, nên
 * "quá hạn hôm qua" luôn khớp với đồng hồ người dùng chứ không phải với UTC.
 */
function localDayIndex(ms: number, offsetMinutes: number): number {
  return Math.floor((ms + offsetMinutes * MS_PER_MINUTE) / MS_PER_DAY)
}

function localDateKey(ms: number, offsetMinutes: number): string {
  return new Date(ms + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 10)
}

function groupForDayDelta(dayDelta: number | null): BriefingGroup {
  if (dayDelta === null) return 'in_progress'
  if (dayDelta < 0) return 'overdue'
  if (dayDelta === 0) return 'due_today'
  if (dayDelta <= 7) return 'due_this_week'
  return 'in_progress'
}

function reasonKindFor(group: BriefingGroup, driver: TimestampDriver | null): BriefingReasonKind {
  // Lịch quay lại và hạn hoàn thành là hai chuyện khác nhau với người dùng; chỉ nói "check-in"
  // khi nó thực sự đang tới hạn, còn khi mốc còn xa thì nhóm mới là thông tin đáng nói.
  if (driver === 'check_in' && (group === 'overdue' || group === 'due_today')) return 'check_in_due'
  return group
}

function toItem(opts: {
  readonly id: string
  readonly source: BriefingItem['source']
  readonly title: string
  readonly detail: string | null
  readonly reference: string | null
  readonly sourceConversationId: string | null
  readonly status: string
  readonly at: string | null
  readonly atMs: number | null
  readonly driver: TimestampDriver | null
  readonly updatedAt: string
  readonly inActiveSprint: boolean
  readonly todayIndex: number
  readonly offsetMinutes: number
}): BriefingItem {
  const dayDelta =
    opts.atMs === null ? null : localDayIndex(opts.atMs, opts.offsetMinutes) - opts.todayIndex
  const group = groupForDayDelta(dayDelta)
  return {
    id: opts.id,
    source: opts.source,
    title: opts.title,
    detail: opts.detail,
    reference: opts.reference,
    sourceConversationId: opts.sourceConversationId,
    status: opts.status,
    group,
    reason: { kind: reasonKindFor(group, opts.driver), at: opts.at, days: dayDelta },
    at: opts.at,
    updatedAt: opts.updatedAt,
    inActiveSprint: opts.inActiveSprint,
  }
}

function commitmentToItem(
  commitment: BriefingCommitmentInput,
  todayIndex: number,
  offsetMinutes: number,
): BriefingItem {
  const dueMs = parseTimestamp(commitment.dueAt)
  const checkInMs = parseTimestamp(commitment.checkInAt)

  // Mốc nào tới trước thì mốc đó quyết định mức khẩn — một cam kết quá hạn nhưng còn lịch check-in
  // tuần sau vẫn phải nằm ở nhóm quá hạn.
  let driver: TimestampDriver | null = null
  let atMs: number | null = null
  let at: string | null = null
  if (dueMs !== null && (checkInMs === null || dueMs <= checkInMs)) {
    driver = 'due'
    atMs = dueMs
    at = commitment.dueAt
  } else if (checkInMs !== null) {
    driver = 'check_in'
    atMs = checkInMs
    at = commitment.checkInAt
  }

  return toItem({
    id: `commitment:${commitment.id}`,
    source: 'commitment',
    title: commitment.title,
    detail: commitment.nextAction,
    reference: null,
    sourceConversationId: commitment.sourceConversationId,
    status: commitment.status,
    at,
    atMs,
    driver,
    updatedAt: commitment.updatedAt,
    inActiveSprint: false,
    todayIndex,
    offsetMinutes,
  })
}

function issueToItem(
  issue: BriefingIssueInput,
  todayIndex: number,
  offsetMinutes: number,
): BriefingItem {
  return toItem({
    id: `jira:${issue.key}`,
    source: 'jira',
    title: issue.summary,
    detail: issue.statusName,
    reference: issue.key,
    sourceConversationId: null,
    status: issue.statusName,
    at: issue.dueAt,
    atMs: parseTimestamp(issue.dueAt),
    driver: issue.dueAt === null ? null : 'due',
    updatedAt: issue.updatedAt,
    inActiveSprint: issue.inActiveSprint,
    todayIndex,
    offsetMinutes,
  })
}

function compareDated(a: BriefingItem, b: BriefingItem): number {
  const aAt = parseTimestamp(a.at) ?? 0
  const bAt = parseTimestamp(b.at) ?? 0
  if (aAt !== bAt) return aAt - bAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Trong nhóm "đang làm": việc của sprint đang chạy lên trước, rồi tới việc có hạn (gần trước),
 * rồi tới việc vừa động vào gần đây. Tie-break cuối cùng luôn là id, để hai lần dựng không bao
 * giờ đảo thứ tự của hai mục ngang điểm.
 */
function compareInProgress(a: BriefingItem, b: BriefingItem): number {
  if (a.inActiveSprint !== b.inActiveSprint) return a.inActiveSprint ? -1 : 1

  const aAt = parseTimestamp(a.at)
  const bAt = parseTimestamp(b.at)
  if (aAt !== null && bAt !== null && aAt !== bAt) return aAt - bAt
  if (aAt !== null && bAt === null) return -1
  if (aAt === null && bAt !== null) return 1

  const aUpdated = parseTimestamp(a.updatedAt) ?? 0
  const bUpdated = parseTimestamp(b.updatedAt) ?? 0
  if (aUpdated !== bUpdated) return bUpdated - aUpdated

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Dựng bản tin từ cam kết cục bộ và issue Jira đã chuẩn hoá.
 *
 * Hàm thuần: không đọc đồng hồ hệ thống, không gọi mạng, không ném lỗi cho dữ liệu thiếu mốc thời
 * gian — một mục không có hạn là một mục đang làm, không phải một lỗi.
 */
export function buildBriefing(input: BriefingInput): Briefing {
  const nowMs = input.now.getTime()
  const offsetMinutes = input.timeZoneOffsetMinutes
  const todayIndex = localDayIndex(nowMs, offsetMinutes)
  const cap = Math.max(1, input.maxItemsPerGroup ?? DEFAULT_MAX_ITEMS_PER_GROUP)

  const items = [
    ...input.commitments.map((c) => commitmentToItem(c, todayIndex, offsetMinutes)),
    ...input.issues.map((i) => issueToItem(i, todayIndex, offsetMinutes)),
  ]

  let totalItems = 0
  let truncatedTotal = 0
  const groups: BriefingGroupResult[] = BRIEFING_GROUPS.map((group) => {
    const inGroup = items
      .filter((item) => item.group === group)
      .sort(group === 'in_progress' ? compareInProgress : compareDated)
    const kept = inGroup.slice(0, cap)
    const truncatedCount = inGroup.length - kept.length
    totalItems += kept.length
    truncatedTotal += truncatedCount
    return { group, items: kept, truncatedCount }
  })

  return {
    generatedAt: new Date(nowMs).toISOString(),
    localDate: localDateKey(nowMs, offsetMinutes),
    groups,
    totalItems,
    truncatedTotal,
  }
}
