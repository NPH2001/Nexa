import { buildBriefing, type Briefing, type BriefingCommitmentInput } from '@nexa/daily-briefing'
import type {
  BriefingGroupView,
  BriefingItemView,
  BriefingSourceStateView,
  DailyBriefingView,
} from '@nexa/shared-types'
import type { CommitmentRepository } from '@nexa/local-store'
import type { Logger } from '@nexa/observability'
import type { AtlassianMcpManager } from '@nexa/atlassian-mcp-manager'
import type { AppSettings } from '@nexa/shared-types'
import { fetchBriefingIssues, type BriefingJiraResult } from './briefing-jira.js'
import { summarizeBriefing, type BriefingSummaryDeps } from './briefing-summary.js'

/**
 * Bản tin công việc cá nhân (openspec `add-daily-briefing`).
 *
 * Bề mặt CHỈ ĐỌC: service này không tạo, sửa, hoàn thành hay xoá cam kết, không sinh check-in, và
 * không gọi tool ghi nào. Vì thế nó không chạm Confirmation Guard — không có gì để xác nhận.
 *
 * Cache nằm trong RAM theo `profile + ngày địa phương`, không xuống SQLite: nội dung Jira là dữ
 * liệu tạm, một bản sao trên đĩa là một bản sao phải mã hoá, phải purge và phải giải thích.
 */

/** Chỉ việc đang chạy mới lên bản tin. `paused` là việc người dùng đã chủ động gác lại. */
const BRIEFING_COMMITMENT_STATUSES = new Set(['active', 'blocked'])

/**
 * Hỏng tạm thời thì KHÔNG cache.
 *
 * Cache một lần Jira chết nghĩa là người dùng phải bấm Làm mới bằng tay mới thoát khỏi nó, cho
 * tới hết ngày. Các trạng thái còn lại (`not_configured`, `disabled_by_policy`, `unauthenticated`)
 * thì ngược lại: chúng chỉ đổi khi người dùng đi sửa cấu hình, và lúc đó cache đã bị dọn theo
 * `settings:update` rồi — thử lại mỗi lần mở Today chỉ tốn một lời gọi vô ích.
 */
const TRANSIENT_SOURCE_STATUSES = new Set(['unavailable', 'error'])

interface CachedBriefing {
  readonly localDate: string
  readonly view: DailyBriefingView
}

export interface DailyBriefingDeps {
  readonly profileId: string
  readonly commitments: CommitmentRepository
  readonly settings: () => AppSettings
  readonly mcp: () => AtlassianMcpManager | null
  readonly jiraBaseUrl: () => string | null
  readonly summary: Omit<BriefingSummaryDeps, 'enabled' | 'logger'>
  readonly logger: Logger
  readonly now?: () => Date
  /** Lệch múi giờ tính bằng phút, dương về phía đông. Mặc định đọc từ đồng hồ máy. */
  readonly timeZoneOffsetMinutes?: () => number
}

function issueUrl(baseUrl: string | null, key: string): string | null {
  if (baseUrl === null) return null
  return `${baseUrl.replace(/\/+$/, '')}/browse/${key}`
}

export class DailyBriefingService {
  private cache: CachedBriefing | null = null
  private readonly log: Logger
  private readonly now: () => Date

  constructor(private readonly deps: DailyBriefingDeps) {
    this.log = deps.logger.child({ module: 'daily-briefing' })
    this.now = deps.now ?? (() => new Date())
  }

  /** Bản tin cho hôm nay; dùng lại cache nếu vẫn cùng ngày địa phương. */
  async get(): Promise<DailyBriefingView> {
    const cached = this.cache
    if (cached !== null && cached.localDate === this.localDate()) return cached.view
    return this.build()
  }

  /** Làm mới tường minh: bỏ cache và gọi lại nguồn. */
  async refresh(): Promise<DailyBriefingView> {
    this.cache = null
    return this.build()
  }

  /** Cache mất theo tiến trình; hàm này để đổi cấu hình không phải chờ sang ngày mới. */
  invalidate(): void {
    this.cache = null
  }

  private offsetMinutes(): number {
    if (this.deps.timeZoneOffsetMinutes !== undefined) return this.deps.timeZoneOffsetMinutes()
    // `getTimezoneOffset` trả số phút UTC-so-với-địa-phương (VN = -420), nên phải đảo dấu.
    return -this.now().getTimezoneOffset()
  }

  private localDate(): string {
    const shifted = this.now().getTime() + this.offsetMinutes() * 60_000
    return new Date(shifted).toISOString().slice(0, 10)
  }

  private loadCommitments(): BriefingCommitmentInput[] {
    return this.deps.commitments
      .list(this.deps.profileId, { includeCompleted: false })
      .filter((commitment) => BRIEFING_COMMITMENT_STATUSES.has(commitment.status))
      .map((commitment) => ({
        id: commitment.id,
        title: commitment.title,
        nextAction: commitment.nextAction,
        status: commitment.status,
        dueAt: commitment.dueAt,
        checkInAt: commitment.checkInAt,
        sourceConversationId: commitment.sourceConversationId,
        updatedAt: commitment.updatedAt,
      }))
  }

  private toView(
    briefing: Briefing,
    sources: readonly BriefingSourceStateView[],
    summary: DailyBriefingView['summary'],
  ): DailyBriefingView {
    const baseUrl = this.deps.jiraBaseUrl()
    const groups: BriefingGroupView[] = briefing.groups.map((group) => ({
      group: group.group,
      truncatedCount: group.truncatedCount,
      items: group.items.map(
        (item): BriefingItemView => ({
          id: item.id,
          source: item.source,
          title: item.title,
          detail: item.detail,
          reference: item.reference,
          url: item.reference === null ? null : issueUrl(baseUrl, item.reference),
          sourceConversationId: item.sourceConversationId,
          status: item.status,
          group: item.group,
          reason: item.reason,
          at: item.at,
          updatedAt: item.updatedAt,
          inActiveSprint: item.inActiveSprint,
        }),
      ),
    }))

    return {
      enabled: true,
      generatedAt: briefing.generatedAt,
      localDate: briefing.localDate,
      groups,
      totalItems: briefing.totalItems,
      truncatedTotal: briefing.truncatedTotal,
      sources,
      summary,
    }
  }

  private disabledView(): DailyBriefingView {
    const now = this.now()
    return {
      enabled: false,
      generatedAt: now.toISOString(),
      localDate: this.localDate(),
      groups: [],
      totalItems: 0,
      truncatedTotal: 0,
      sources: [],
      summary: { status: 'disabled', text: null },
    }
  }

  private async build(): Promise<DailyBriefingView> {
    const settings = this.deps.settings()
    if (!settings.dailyBriefingEnabled) return this.disabledView()

    const started = Date.now()
    const now = this.now()

    // Cam kết trước: phần cục bộ không được phụ thuộc vào việc Jira có sống hay không.
    const commitments = this.loadCommitments()

    const jira: BriefingJiraResult = await fetchBriefingIssues({
      mcp: this.deps.mcp(),
      jiraSearchEnabled: settings.features.jiraSearch,
      logger: this.log,
      now: this.now,
    })

    const briefing = buildBriefing({
      now,
      timeZoneOffsetMinutes: this.offsetMinutes(),
      commitments,
      issues: jira.issues,
    })

    const sources: BriefingSourceStateView[] = [
      {
        source: 'commitment',
        status: commitments.length === 0 ? 'empty' : 'ok',
        fetchedAt: now.toISOString(),
        itemCount: commitments.length,
        truncatedCount: 0,
      },
      {
        source: 'jira',
        status: jira.status,
        fetchedAt: jira.fetchedAt,
        itemCount: jira.issues.length,
        truncatedCount: jira.truncatedCount,
      },
    ]

    const summary = await summarizeBriefing(briefing, {
      ...this.deps.summary,
      enabled: () => settings.dailyBriefingSummaryEnabled,
      logger: this.log,
    })

    const view = this.toView(briefing, sources, summary)
    if (!TRANSIENT_SOURCE_STATUSES.has(jira.status)) {
      this.cache = { localDate: view.localDate, view }
    }

    // Chỉ số đếm và enum. Tiêu đề cam kết và tiêu đề issue không bao giờ vào log.
    this.log.info('briefing-built', {
      commitmentCount: commitments.length,
      jiraStatus: jira.status,
      jiraCount: jira.issues.length,
      totalItems: view.totalItems,
      summaryStatus: summary.status,
      durationMs: Date.now() - started,
    })

    return view
  }
}
