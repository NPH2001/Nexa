import type { BaDocItem } from '../model.js'

/**
 * Rút một item thành hai dòng để hiển thị.
 *
 * Vì sao có phép chiếu này thay vì đẩy thẳng `BaDocItem` qua IPC: renderer là tiến trình không
 * đáng tin (§5.3) và mô hình đầy đủ mang trọn nội dung nghiệp vụ lồng nhau. Danh sách trong tab
 * Tài liệu chỉ cần một dòng tiêu đề và một dòng mô tả, nên chỉ chừng đó đi qua ranh giới.
 *
 * Đây là hàm thuần trong `ba-kit` chứ không phải helper trong renderer, để cách một use case
 * được tóm tắt không phụ thuộc vào chỗ nào đang hiển thị nó.
 */

export interface BaItemSummary {
  readonly id: string
  readonly itemType: BaDocItem['itemType']
  readonly ordinal: number
  readonly needsReview: boolean
  readonly title: string
  readonly detail: string
}

const MAX_DETAIL = 200

function clip(text: string): string {
  const trimmed = text.trim()
  return trimmed.length <= MAX_DETAIL ? trimmed : `${trimmed.slice(0, MAX_DETAIL - 1)}…`
}

export function summarizeItem(item: BaDocItem): BaItemSummary {
  const base = {
    id: item.id,
    itemType: item.itemType,
    ordinal: item.ordinal,
    needsReview: item.needsReview,
  }

  switch (item.itemType) {
    case 'use_case':
      return {
        ...base,
        title: item.name,
        detail: clip(
          `${item.actor} · ${item.mainFlow.length} bước · ${item.exceptionFlows.length} ngoại lệ`,
        ),
      }
    case 'field':
      return {
        ...base,
        title: item.name,
        detail: clip(
          `${item.fieldType}${item.required ? ' · bắt buộc' : ''}${
            item.noValidationReason === undefined ? '' : ` · không validate: ${item.noValidationReason}`
          }`,
        ),
      }
    case 'rule':
      return { ...base, title: clip(item.statement), detail: '' }
    case 'flow_step':
      return { ...base, title: clip(item.label), detail: item.kind }
    case 'error_code':
      return { ...base, title: item.code, detail: clip(item.message) }
    case 'actor':
      return { ...base, title: item.name, detail: clip(item.description ?? '') }
  }
}

export function summarizeModel(items: readonly BaDocItem[]): BaItemSummary[] {
  return items.map(summarizeItem)
}
