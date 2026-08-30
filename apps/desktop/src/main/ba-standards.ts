import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { baRulebookSchema, baTemplateSchema, type BaRulebook, type BaTemplate } from '@nexa/ba-kit'
import type { Logger } from '@nexa/observability'

/**
 * Chuẩn của tổ chức: bộ mẫu tài liệu và rulebook validate (D12).
 *
 * Cả hai là **dữ liệu chỉ đọc đi kèm bản cài**, IT ghi đè lúc phân phối đúng đường `policy.json`
 * đang dùng. Không có editor cho người dùng cuối: nếu mỗi máy sửa được chuẩn thì nó thôi là chuẩn.
 *
 * Nguyên tắc bất di bất dịch của module này: **không bao giờ ném lỗi**. File hỏng thì app vẫn
 * khởi động với phần còn đọc được, và log nói rõ cái gì bị loại vì sao. Một file JSON gõ nhầm dấu
 * phẩy không được phép làm người dùng mất luôn ứng dụng.
 */

export interface BaStandards {
  readonly templates: readonly BaTemplate[]
  readonly rulebook: BaRulebook | null
}

export const EMPTY_BA_STANDARDS: BaStandards = { templates: [], rulebook: null }

const templateFileSchema = z.object({ templates: z.array(z.unknown()) })

export interface ResourceReader {
  /** Trả về nội dung JSON đã parse, hoặc `null` khi không có/không đọc được. */
  (fileName: string): unknown
}

/**
 * Đọc một file resource theo đúng thứ tự ưu tiên của `policy.json`.
 *
 * `resourcesPath` chỉ tồn tại trong bản đã đóng gói; khi chạy dev thì đọc từ thư mục nguồn.
 */
export function createResourceReader(appPath: string, logger: Logger): ResourceReader {
  return (fileName: string): unknown => {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    const candidates = [
      resourcesPath === undefined ? null : join(resourcesPath, fileName),
      join(appPath, 'resources', fileName),
    ]
    for (const path of candidates) {
      if (path === null || !existsSync(path)) continue
      try {
        return JSON.parse(readFileSync(path, 'utf8'))
      } catch {
        logger.warn('ba-resource-unreadable', { fileName })
      }
    }
    return null
  }
}

/**
 * Kiểm từng mẫu một, không kiểm cả mảng một lần.
 *
 * Khác biệt quan trọng: kiểm cả mảng thì một mẫu hỏng làm mất trọn bộ. Kiểm từng mẫu thì mẫu hỏng
 * bị loại, các mẫu còn lại vẫn dùng được — và người dùng vẫn làm việc được trong lúc IT sửa file.
 */
export function loadTemplates(raw: unknown, logger: Logger): BaTemplate[] {
  if (raw === null || raw === undefined) return []

  const file = templateFileSchema.safeParse(raw)
  if (!file.success) {
    logger.warn('ba-templates-file-invalid', { issueCount: file.error.issues.length })
    return []
  }

  const templates: BaTemplate[] = []
  const seen = new Set<string>()

  for (const [index, entry] of file.data.templates.entries()) {
    const parsed = baTemplateSchema.safeParse(entry)
    if (!parsed.success) {
      logger.warn('ba-template-invalid-skipped', {
        index,
        // Chỉ id và đường dẫn trường sai; không log nội dung mẫu.
        templateId: readId(entry),
        invalidFields: parsed.error.issues.map((issue) => issue.path.join('.')),
      })
      continue
    }
    if (seen.has(parsed.data.id)) {
      logger.warn('ba-template-duplicate-id-skipped', { templateId: parsed.data.id })
      continue
    }
    seen.add(parsed.data.id)
    templates.push(parsed.data)
  }

  logger.info('ba-templates-loaded', { count: templates.length })
  return templates
}

export function loadRulebook(raw: unknown, logger: Logger): BaRulebook | null {
  if (raw === null || raw === undefined) return null

  const parsed = baRulebookSchema.safeParse(raw)
  if (!parsed.success) {
    logger.warn('ba-rulebook-invalid', {
      invalidFields: parsed.error.issues.map((issue) => issue.path.join('.')),
    })
    return null
  }

  logger.info('ba-rulebook-loaded', {
    rulebookId: parsed.data.id,
    version: parsed.data.version,
    fieldTypeCount: parsed.data.byFieldType.length,
  })
  return parsed.data
}

export function loadBaStandards(read: ResourceReader, logger: Logger): BaStandards {
  return {
    templates: loadTemplates(read('ba-templates.json'), logger),
    rulebook: loadRulebook(read('ba-rulebook.json'), logger),
  }
}

/** Lấy id của một mẫu hỏng để log — không tin cấu trúc, nên đọc phòng thủ. */
function readId(entry: unknown): string {
  if (typeof entry !== 'object' || entry === null) return 'unknown'
  const id = Reflect.get(entry, 'id')
  return typeof id === 'string' ? id.slice(0, 64) : 'unknown'
}
