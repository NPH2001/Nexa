import {
  ERROR_CODES,
  NexaError,
  isExternalProvider,
  type AppSettings,
  type LlmProvider,
} from '@nexa/shared-types'
import type { ProcessedDocument } from '@nexa/document-processor'

/**
 * §11.2: "Nexa phải hiển thị cảnh báo dữ liệu và cho phép cấu hình domain/model được phép
 * nhận tài liệu nội bộ."
 *
 * Chính sách chia làm HAI mức theo provider, và đây là chỗ quan trọng nhất của việc thêm
 * kết nối OpenAI trực tiếp:
 *
 *   Provider NỘI BỘ (litellm) — FAIL-OPEN.
 *     `documentAllowedModels` rỗng ⇒ cho phép. Nếu rỗng nghĩa là cấm hết thì tính năng đính
 *     kèm file chết ngay khi cài, trước khi ai kịp cấu hình. Dữ liệu vẫn ở trong hạ tầng của
 *     tổ chức, có usage log và quota. Xem OPEN-QUESTIONS A5.
 *
 *   Provider NGOÀI (openai) — FAIL-CLOSED.
 *     Rỗng ⇒ TỪ CHỐI. Gửi tài liệu nội bộ tới một cloud công cộng là hành động không thể
 *     hoàn tác, và không được xảy ra vì người dùng bấm nhầm hay vì admin quên cấu hình.
 *     Muốn cho phép thì phải khai model đó vào `documentAllowedModels` một cách tường minh.
 *     Xem OPEN-QUESTIONS F1.
 *
 * Chat không kèm tài liệu KHÔNG bị hàm này chặn — người dùng vẫn tự gõ được gì họ muốn. Đây
 * là biện pháp chống rò rỉ hàng loạt do đính kèm file, không phải kiểm duyệt nội dung.
 */
export function assertModelMayReceiveDocuments(
  provider: LlmProvider,
  modelId: string,
  settings: AppSettings,
): void {
  if (isExternalProvider(provider)) {
    // Danh sách RIÊNG, và fail-closed: rỗng nghĩa là không cho phép.
    if (!settings.externalDocumentAllowedModels.includes(externalAllowKey(provider, modelId))) {
      throw new NexaError(ERROR_CODES.EXTERNAL_MODEL_NOT_ALLOWED_FOR_DOCUMENTS, {
        safeDetail: `external provider "${provider}" model "${modelId}" is not explicitly allowlisted for documents`,
      })
    }
    return
  }

  const allowed = settings.documentAllowedModels
  if (allowed.length === 0) return
  if (allowed.includes(modelId)) return

  throw new NexaError(ERROR_CODES.MODEL_NOT_ALLOWED_FOR_DOCUMENTS, {
    safeDetail: `model "${modelId}" is not on the document allowlist`,
  })
}

/**
 * Khoá trong `externalDocumentAllowedModels`.
 *
 * Có tiền tố provider vì cùng một model id tồn tại được ở nhiều provider; cho phép ở chỗ này
 * không có nghĩa là cho phép ở chỗ khác.
 */
export function externalAllowKey(provider: LlmProvider, modelId: string): string {
  return `${provider}:${modelId}`
}

/** UI dùng để tô cảnh báo và khoá nút Gửi trước khi người dùng bấm. */
export function mayReceiveDocuments(
  provider: LlmProvider,
  modelId: string,
  settings: AppSettings,
): boolean {
  try {
    assertModelMayReceiveDocuments(provider, modelId, settings)
    return true
  } catch {
    return false
  }
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
