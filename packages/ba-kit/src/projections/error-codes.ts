import type { BaDocModel } from '../model.js'
import { itemsOfType, reviewedItems } from '../model.js'

/**
 * Trang mã lỗi — phép chiếu, không phải câu hỏi cho model (ask #8).
 *
 * Đây là tính năng rẻ nhất của change này và cũng là bằng chứng rõ nhất cho D1: khi mã lỗi là item
 * có cấu trúc, "tổng hợp đầy đủ" là một phép gom mảng. Không có chỗ nào để bỏ sót, và ba nhóm bất
 * thường dưới đây là thứ một bản tổng hợp bằng văn xuôi không thể nói ra.
 */

export interface ErrorCodeEntry {
  readonly code: string
  readonly message: string
  readonly meaning?: string
  readonly httpStatus?: number
  readonly itemId: string
  /** Id của use case hoặc flow step nhắc tới mã này. */
  readonly referencedBy: readonly string[]
}

export interface UndeclaredErrorCode {
  readonly code: string
  readonly referencedBy: readonly string[]
}

export interface InconsistentErrorCode {
  readonly code: string
  readonly variants: readonly { readonly message: string; readonly itemId: string }[]
}

export interface ErrorCodePage {
  /** Mã đã khai báo, sắp theo mã. */
  readonly declared: readonly ErrorCodeEntry[]
  /** Được nhắc trong luồng nhưng chưa có khai báo — `R-ERR-01` chiều thứ nhất. */
  readonly undeclared: readonly UndeclaredErrorCode[]
  /** Đã khai báo nhưng không luồng nào dùng — `R-ERR-01` chiều thứ hai. */
  readonly unreferenced: readonly ErrorCodeEntry[]
  /** Cùng một mã mang hai thông điệp khác nhau — `R-ERR-02`. */
  readonly inconsistent: readonly InconsistentErrorCode[]
  readonly counts: {
    readonly declared: number
    readonly undeclared: number
    readonly unreferenced: number
    readonly inconsistent: number
    /** Số item bị bỏ vì còn `needsReview` — phải hiển thị, không được giấu (D4). */
    readonly excludedNeedsReview: number
  }
}

/** So sánh mã lỗi ổn định: `E2` đứng trước `E10`, không phải sau. */
function compareCodes(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
}

/** Mã lỗi so sánh không phân biệt hoa thường và khoảng trắng thừa. */
function codeKey(code: string): string {
  return code.trim().toUpperCase()
}

/**
 * Nơi một mã lỗi được nhắc tới.
 *
 * Ba nguồn, cố ý không chỉ dựa vào link `raises`: lúc trích xuất, mã lỗi thường xuất hiện ngay
 * trong câu mô tả luồng ngoại lệ trước khi có ai nối link. Nếu chỉ đọc link thì trang mã lỗi sẽ
 * báo "không có gì bất thường" trên một tài liệu chưa hề được nối — đúng kiểu im lặng sai mà cả
 * change này được viết ra để tránh.
 */
function collectReferences(model: BaDocModel): Map<string, Set<string>> {
  const references = new Map<string, Set<string>>()
  const add = (code: string, itemId: string): void => {
    const key = codeKey(code)
    const existing = references.get(key)
    if (existing === undefined) references.set(key, new Set([itemId]))
    else existing.add(itemId)
  }

  const reviewed = new Set(reviewedItems(model).map((item) => item.id))
  const codeById = new Map(
    itemsOfType(model, 'error_code').map((item) => [item.id, item.code] as const),
  )

  for (const useCase of itemsOfType(model, 'use_case')) {
    if (!reviewed.has(useCase.id)) continue
    for (const branch of [...useCase.exceptionFlows, ...useCase.alternateFlows]) {
      if (branch.errorCode !== undefined) add(branch.errorCode, useCase.id)
    }
  }

  for (const step of itemsOfType(model, 'flow_step')) {
    if (!reviewed.has(step.id)) continue
    if (step.errorCode !== undefined) add(step.errorCode, step.id)
  }

  for (const link of model.links) {
    if (link.kind !== 'raises') continue
    if (!reviewed.has(link.from)) continue
    const code = codeById.get(link.to)
    if (code !== undefined) add(code, link.from)
  }

  return references
}

export function buildErrorCodePage(model: BaDocModel): ErrorCodePage {
  const allErrorItems = itemsOfType(model, 'error_code')
  const declaredItems = allErrorItems.filter((item) => !item.needsReview)
  const excludedNeedsReview = allErrorItems.length - declaredItems.length

  const references = collectReferences(model)

  const byCode = new Map<string, typeof declaredItems>()
  for (const item of declaredItems) {
    const key = codeKey(item.code)
    const bucket = byCode.get(key)
    if (bucket === undefined) byCode.set(key, [item])
    else bucket.push(item)
  }

  const declared: ErrorCodeEntry[] = []
  const inconsistent: InconsistentErrorCode[] = []

  for (const [key, items] of byCode) {
    const referencedBy = [...(references.get(key) ?? [])].sort()
    for (const item of items) {
      declared.push({
        code: item.code,
        message: item.message,
        ...(item.meaning === undefined ? {} : { meaning: item.meaning }),
        ...(item.httpStatus === undefined ? {} : { httpStatus: item.httpStatus }),
        itemId: item.id,
        referencedBy,
      })
    }

    const distinctMessages = new Set(items.map((item) => item.message.trim()))
    if (distinctMessages.size > 1) {
      inconsistent.push({
        code: items[0]?.code ?? key,
        // Sắp theo id chứ không theo thông điệp: thứ tự hiển thị của các biến thể không mang
        // nghĩa, còn `localeCompare` trên tiếng Việt phụ thuộc ICU của máy chạy.
        variants: items
          .map((item) => ({ message: item.message, itemId: item.id }))
          .sort((a, b) => a.itemId.localeCompare(b.itemId)),
      })
    }
  }

  declared.sort((a, b) => compareCodes(a.code, b.code) || a.itemId.localeCompare(b.itemId))
  inconsistent.sort((a, b) => compareCodes(a.code, b.code))

  const undeclared: UndeclaredErrorCode[] = [...references.entries()]
    .filter(([key]) => !byCode.has(key))
    .map(([key, itemIds]) => ({ code: key, referencedBy: [...itemIds].sort() }))
    .sort((a, b) => compareCodes(a.code, b.code))

  const unreferenced = declared.filter((entry) => entry.referencedBy.length === 0)

  return {
    declared,
    undeclared,
    unreferenced,
    inconsistent,
    counts: {
      declared: declared.length,
      undeclared: undeclared.length,
      unreferenced: unreferenced.length,
      inconsistent: inconsistent.length,
      excludedNeedsReview,
    },
  }
}
