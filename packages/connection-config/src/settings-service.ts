import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_ORG_POLICY,
  appSettingsSchema,
  orgPolicySchema,
  type AppSettings,
  type OrgPolicy,
} from '@nexa/shared-types'
import type { ConfigRepository } from '@nexa/local-store'
import type { Logger } from '@nexa/observability'

const SETTINGS_KEY = 'app-settings.v1'

/**
 * Cấu hình người dùng, hoà với policy do IT áp (§13.1 feature flag cục bộ).
 *
 * Thứ tự ưu tiên, thấp → cao:
 *   1. mặc định trong code
 *   2. cấu hình người dùng (đã mã hoá trong SQLite)
 *   3. `forcedFeatures` của tổ chức — thắng tất cả
 *
 * Trần retention của tổ chức cũng được áp ở đây, để người dùng không đặt được 3650 ngày khi
 * chính sách nói tối đa 90.
 */
export class SettingsService {
  private cached: AppSettings | null = null

  constructor(
    private readonly repo: ConfigRepository,
    private readonly profileId: string,
    private readonly policy: OrgPolicy,
    private readonly logger: Logger,
  ) {}

  get(): AppSettings {
    if (this.cached !== null) return this.cached

    const stored = this.repo.getSetting<unknown>(this.profileId, SETTINGS_KEY)
    const parsed = appSettingsSchema.safeParse(stored ?? {})
    if (!parsed.success && stored !== null) {
      // Cấu hình cũ không còn khớp schema (nâng cấp app). Quay về mặc định thay vì chết —
      // nhưng phải ghi lại để hỗ trợ biết vì sao thiết lập của người dùng biến mất.
      this.logger.warn('settings-schema-mismatch-reset-to-default', {
        issueCount: parsed.error.issues.length,
      })
    }

    this.cached = this.applyPolicy(parsed.success ? parsed.data : DEFAULT_APP_SETTINGS)
    return this.cached
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const merged = appSettingsSchema.parse({
      ...this.get(),
      ...patch,
      features: { ...this.get().features, ...(patch.features ?? {}) },
    })
    const effective = this.applyPolicy(merged)
    this.repo.putSetting(this.profileId, SETTINGS_KEY, effective)
    this.cached = effective
    return effective
  }

  /** Người dùng không sửa được flag nào — UI dùng để khoá control lại. */
  lockedFeatureNames(): readonly string[] {
    return [...new Set([...this.policy.lockedFeatures, ...Object.keys(this.policy.forcedFeatures)])]
  }

  private applyPolicy(settings: AppSettings): AppSettings {
    const retentionCap = this.policy.maxHistoryRetentionDays
    const historyRetentionDays =
      retentionCap === undefined
        ? settings.historyRetentionDays
        : capRetention(settings.historyRetentionDays, retentionCap)

    return {
      ...settings,
      historyRetentionDays,
      features: { ...settings.features, ...this.policy.forcedFeatures },
    }
  }
}

/**
 * 0 nghĩa là "giữ mãi", nên nó là giá trị LỚN NHẤT khi so với trần, không phải nhỏ nhất.
 * Viết ra thành hàm riêng vì đây đúng là chỗ dễ viết sai `Math.min` một cách âm thầm.
 */
function capRetention(requested: number, cap: number): number {
  if (cap === 0) return requested
  if (requested === 0) return cap
  return Math.min(requested, cap)
}

/** Đọc policy do IT phân phối. File hỏng hoặc thiếu ⇒ dùng mặc định, không chặn khởi động. */
export function loadOrgPolicy(raw: unknown, logger: Logger): OrgPolicy {
  if (raw === null || raw === undefined) return DEFAULT_ORG_POLICY
  const parsed = orgPolicySchema.safeParse(raw)
  if (!parsed.success) {
    logger.warn('org-policy-invalid-using-defaults', { issueCount: parsed.error.issues.length })
    return DEFAULT_ORG_POLICY
  }
  return parsed.data
}
