import { baDocItemSchema, type BaDocItem, type BaDocModel, type BaItemType } from '../model.js'

/**
 * Áp một câu chữ đã sửa lên **đúng một ô của đúng một item**.
 *
 * Đây là phần "áp dụng" của review, và hình dạng hẹp của nó là chủ đích (D2): review không tự sửa
 * tài liệu. Nó ra finding; người dùng đọc, quyết định, rồi bấm áp dụng cho từng chỗ một. Hàm này
 * vì thế không nhận một finding và cũng không nhận một danh sách — nó nhận một ô và một chuỗi.
 *
 * Vì sao có bảng `FIELDS_BY_ITEM_TYPE` thay vì để Zod tự lọc: Zod mặc định **bỏ im lặng** khoá lạ,
 * nên `{...useCase, message: '...'}` vẫn parse thành công và trả về một use case y hệt cũ. Người
 * dùng bấm áp dụng, thấy báo thành công, và không có gì thay đổi. Bảng này biến chuyện đó thành
 * một lỗi nói ra được.
 */

export const PATCHABLE_FIELDS = [
  'name',
  'label',
  'actor',
  'role',
  'precondition',
  'postcondition',
  'statement',
  'message',
  'meaning',
  'description',
  'noAlternateReason',
  'noValidationReason',
] as const
export type PatchableField = (typeof PATCHABLE_FIELDS)[number]

const FIELDS_BY_ITEM_TYPE: Record<BaItemType, readonly PatchableField[]> = {
  actor: ['name', 'description'],
  field: ['name', 'description', 'noValidationReason'],
  use_case: ['name', 'actor', 'role', 'precondition', 'postcondition', 'noAlternateReason'],
  rule: ['statement'],
  flow_step: ['label'],
  error_code: ['message', 'meaning'],
}

export interface ApplyItemTextInput {
  readonly itemId: string
  readonly field: PatchableField
  readonly value: string
}

export type ApplyItemTextResult =
  | { readonly ok: true; readonly model: BaDocModel; readonly item: BaDocItem }
  | { readonly ok: false; readonly reason: string }

export function applyItemText(model: BaDocModel, input: ApplyItemTextInput): ApplyItemTextResult {
  const target = model.items.find((item) => item.id === input.itemId)
  if (target === undefined) {
    return { ok: false, reason: 'item not found in document model' }
  }

  const allowed = FIELDS_BY_ITEM_TYPE[target.itemType]
  if (!allowed.includes(input.field)) {
    return {
      ok: false,
      reason: `field ${input.field} does not belong to item type ${target.itemType}`,
    }
  }

  // Giới hạn độ dài của `ba-authoring` vẫn áp ở đây: sửa tay không phải cửa sau để đưa vào một
  // mệnh đề 800 ký tự mà bước trích xuất đã từ chối.
  const parsed = baDocItemSchema.safeParse({ ...target, [input.field]: input.value })
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`).join('; '),
    }
  }

  return {
    ok: true,
    // Chỉ item đó đổi; thứ tự item và toàn bộ liên kết giữ nguyên.
    model: {
      items: model.items.map((item) => (item.id === input.itemId ? parsed.data : item)),
      links: model.links,
    },
    item: parsed.data,
  }
}
