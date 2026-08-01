import { createHash } from 'node:crypto'
import { ERROR_CODES, NexaError } from '@nexa/shared-types'
import { SECURITY_EVENTS, type Logger } from '@nexa/observability'
import { validateBaseUrl } from '@nexa/security'

/**
 * Kiểm tra cập nhật (§18.2).
 *
 * ⚠️ Phạm vi hiện tại — xem docs/OPEN-QUESTIONS.md A8/C3:
 *   - Có: đọc version manifest qua HTTPS, so sánh phiên bản, xác minh SHA-256 checksum.
 *   - CHƯA có: xác minh chữ ký số. Cần certificate trước (TASKLIST T-02-5). Cho tới lúc đó
 *     `verifySignature` từ chối mọi manifest có `requireSignature: true`, thay vì bỏ qua
 *     âm thầm — §18.2 nói "Bắt buộc xác minh chữ ký và checksum trước khi cài".
 *   - Mặc định TẮT (`features.autoUpdate = false`) để đội IT phân phối tập trung.
 */

export interface VersionManifest {
  readonly channel: 'stable' | 'beta'
  readonly version: string
  readonly url: string
  readonly sha256: string
  readonly releasedAt: string
  readonly mandatory: boolean
  readonly notes?: string
  /** Bản phát hành thật phải bật cờ này. Khi bật mà chưa có cơ chế ký ⇒ từ chối cài. */
  readonly requireSignature?: boolean
  /** Client cũ hơn mức này bị chặn (§16 "Client quá cũ"). */
  readonly minimumSupportedVersion?: string
  /**
   * §18.2 Rollback: bản ổn định gần nhất để quay về khi bản hiện tại có lỗi.
   *
   * Nexa KHÔNG tự gỡ và cài lại — làm vậy cần quyền ghi vào thư mục cài đặt và một tiến trình
   * sống sót qua lúc gỡ. Thay vào đó nó chỉ ra rằng có bản thay thế và cung cấp đường tải,
   * còn việc cài do người dùng hoặc IT thực hiện. Xem docs/operations/release-recall.md.
   */
  readonly rollbackTo?: { readonly version: string; readonly url: string; readonly sha256: string }
}

export interface UpdateCheckResult {
  readonly status:
    | 'up-to-date'
    | 'available'
    | 'mandatory'
    | 'rollback-required'
    | 'unsupported-client'
    | 'unavailable'
  readonly manifest?: VersionManifest
  readonly message: string
}

export class UpdateService {
  constructor(
    private readonly log: Logger,
    private readonly currentVersion: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async check(manifestUrl: string, allowedDomains: readonly string[]): Promise<UpdateCheckResult> {
    let url: string
    try {
      url = validateBaseUrl(manifestUrl, { allowedDomains })
    } catch (error) {
      this.log.security(SECURITY_EVENTS.urlRejected, {
        purpose: 'update-manifest',
        errorCode: NexaError.wrap(error).code,
      })
      return { status: 'unavailable', message: 'Địa chỉ máy chủ cập nhật không hợp lệ.' }
    }

    let manifest: VersionManifest
    try {
      const response = await this.fetchImpl(url, { method: 'GET' })
      if (!response.ok) {
        return {
          status: 'unavailable',
          message: `Máy chủ cập nhật trả về HTTP ${String(response.status)}.`,
        }
      }
      manifest = parseManifest(await response.json())
    } catch {
      // Không kết nối được máy chủ cập nhật KHÔNG phải lỗi chặn sử dụng.
      return { status: 'unavailable', message: 'Chưa kiểm tra được bản cập nhật.' }
    }

    if (
      manifest.minimumSupportedVersion !== undefined &&
      compareVersions(this.currentVersion, manifest.minimumSupportedVersion) < 0
    ) {
      return {
        status: 'unsupported-client',
        manifest,
        message: `Phiên bản ${this.currentVersion} không còn được hỗ trợ. Cần cập nhật lên ${manifest.version}.`,
      }
    }

    // §18.2 Rollback: bản đang chạy bị thu hồi. Kiểm tra TRƯỚC nhánh "up-to-date", vì
    // phiên bản bị thu hồi thường mới HƠN bản được khuyến nghị quay về.
    if (
      manifest.rollbackTo !== undefined &&
      compareVersions(this.currentVersion, manifest.rollbackTo.version) > 0 &&
      compareVersions(this.currentVersion, manifest.version) >= 0
    ) {
      return {
        status: 'rollback-required',
        manifest,
        message: `Phiên bản ${this.currentVersion} đã bị thu hồi. Hãy cài lại bản ${manifest.rollbackTo.version}.`,
      }
    }

    if (compareVersions(this.currentVersion, manifest.version) >= 0) {
      return { status: 'up-to-date', message: 'Bạn đang dùng phiên bản mới nhất.' }
    }

    return {
      status: manifest.mandatory ? 'mandatory' : 'available',
      manifest,
      message: `Có bản ${manifest.version}${manifest.mandatory ? ' (bắt buộc cập nhật)' : ''}.`,
    }
  }

  /**
   * Xác minh gói cài trước khi chạy nó (§18.2).
   *
   * Fail closed: thiếu chữ ký khi manifest yêu cầu, hoặc checksum lệch ⇒ từ chối. Không có
   * nhánh nào "cảnh báo rồi vẫn cài".
   */
  verifyPackage(bytes: Buffer, manifest: VersionManifest): void {
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual.toLowerCase() !== manifest.sha256.toLowerCase()) {
      this.log.security(SECURITY_EVENTS.updateSignatureFailed, { reason: 'checksum-mismatch' }, 'error')
      throw new NexaError(ERROR_CODES.INTERNAL_ERROR, {
        safeDetail: 'installer checksum does not match the manifest',
      })
    }

    if (manifest.requireSignature === true) {
      // Chưa có certificate nên chưa xác minh chữ ký được. Từ chối thay vì giả vờ đã kiểm tra.
      this.log.security(
        SECURITY_EVENTS.updateSignatureFailed,
        { reason: 'signature-verification-not-implemented' },
        'error',
      )
      throw new NexaError(ERROR_CODES.INTERNAL_ERROR, {
        safeDetail:
          'manifest requires signature verification, which is not available in this build',
      })
    }
  }
}

function parseManifest(raw: unknown): VersionManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, { safeDetail: 'manifest is not an object' })
  }
  const m = raw as Record<string, unknown>
  const version = String(m['version'] ?? '')
  const url = String(m['url'] ?? '')
  const sha256 = String(m['sha256'] ?? '')

  if (!/^\d+\.\d+\.\d+/.test(version) || url === '' || !/^[0-9a-f]{64}$/i.test(sha256)) {
    throw new NexaError(ERROR_CODES.VALIDATION_FAILED, { safeDetail: 'manifest fields invalid' })
  }

  return {
    channel: m['channel'] === 'beta' ? 'beta' : 'stable',
    version,
    url,
    sha256,
    releasedAt: String(m['releasedAt'] ?? ''),
    mandatory: m['mandatory'] === true,
    ...(typeof m['notes'] === 'string' ? { notes: m['notes'] } : {}),
    ...(m['requireSignature'] === true ? { requireSignature: true } : {}),
    ...(typeof m['minimumSupportedVersion'] === 'string'
      ? { minimumSupportedVersion: m['minimumSupportedVersion'] }
      : {}),
    ...parseRollback(m['rollbackTo']),
  }
}

function parseRollback(raw: unknown): Pick<VersionManifest, 'rollbackTo'> {
  if (typeof raw !== 'object' || raw === null) return {}
  const r = raw as Record<string, unknown>
  const version = String(r['version'] ?? '')
  const url = String(r['url'] ?? '')
  const sha256 = String(r['sha256'] ?? '')
  // Manifest rollback sai định dạng thì BỎ QUA thay vì làm hỏng cả lần kiểm tra cập nhật —
  // người dùng vẫn cần biết có bản mới hay không.
  if (!/^\d+\.\d+\.\d+/.test(version) || url === '' || !/^[0-9a-f]{64}$/i.test(sha256)) return {}
  return { rollbackTo: { version, url, sha256 } }
}

/** So sánh semver đơn giản. Trả <0 nếu a cũ hơn b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((p) => Number.parseInt(p, 10) || 0)
  const pb = b.split('.').map((p) => Number.parseInt(p, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
