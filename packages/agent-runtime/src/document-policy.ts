import { ERROR_CODES, NexaError, type AppSettings } from '@nexa/shared-types'
import type { ProcessedDocument } from '@nexa/document-processor'

/**
 * §11.2: "Nexa phải hiển thị cảnh báo dữ liệu và cho phép cấu hình domain/model được phép
 * nhận tài liệu nội bộ."
 *
 * ⚠️ Mặc định hiện tại là FAIL-OPEN: `documentAllowedModels` rỗng ⇒ mọi model đã cấu hình đều
 * được nhận tài liệu. Điều này NGƯỢC với nguyên tắc "Fail closed" ở §3.
 *
 * Lý do chọn fail-open: nếu rỗng nghĩa là cấm hết thì tính năng đính kèm file sẽ chết ngay khi
 * cài đặt, trước khi ai kịp cấu hình, và người dùng sẽ không hiểu vì sao. ATTT cần chốt —
 * xem docs/OPEN-QUESTIONS.md A5. Đảo lại chỉ là đổi một điều kiện trong hàm dưới đây.
 */
export function assertModelMayReceiveDocuments(modelId: string, settings: AppSettings): void {
  const allowed = settings.documentAllowedModels
  if (allowed.length === 0) return
  if (allowed.includes(modelId)) return

  throw new NexaError(ERROR_CODES.MODEL_NOT_ALLOWED_FOR_DOCUMENTS, {
    safeDetail: `model "${modelId}" is not on the document allowlist`,
  })
}

export interface DocumentWarning {
  readonly fileName: string
  readonly kind: string
  readonly charCount: number
  readonly estimatedTokens: number
  readonly truncated: boolean
  readonly suspectedScan: boolean
}

/**
 * §7.2 bước 4: "hiển thị file đã chọn và lượng nội dung dự kiến gửi".
 *
 * Trả về dữ liệu để UI tự dựng cảnh báo, thay vì trả chuỗi dựng sẵn — UI cần bảng, không cần đoạn văn.
 */
export function summarizeForWarning(documents: readonly ProcessedDocument[]): DocumentWarning[] {
  return documents.map((doc) => ({
    fileName: doc.fileName,
    kind: doc.kind,
    charCount: doc.charCount,
    estimatedTokens: doc.estimatedTokens,
    truncated: doc.truncated,
    suspectedScan: doc.suspectedScan === true,
  }))
}
