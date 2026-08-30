import { z } from 'zod'
import { ITEM_TYPES, type BaDocItem, type BaDocModel, type BaItemType } from './model.js'

/**
 * Template tài liệu BA — một **hợp đồng outline kiểm tra được**, không phải một đoạn prompt (D12).
 *
 * Khác biệt đó là điểm chính. Nếu template chỉ là văn bản hướng dẫn gửi cho model thì "tài liệu
 * có theo mẫu không" lại thành câu hỏi cho model. Ở đây template là dữ liệu: mỗi mục nói rõ nó
 * bắt buộc hay không và chứa được kiểu item nào, nên "thiếu mục bắt buộc" là một phép đếm.
 *
 * Template do Nexa ship sẵn và IT ghi đè lúc phân phối. Không có editor cho người dùng cuối —
 * quyền định nghĩa chuẩn của tổ chức thuộc về IT, không thuộc về từng máy.
 */

export const templateSectionSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'key chỉ gồm chữ thường, số và dấu gạch ngang'),
  title: z.string().trim().min(1).max(120),
  /** Mục bắt buộc mà trống là finding của `R-TPL-01`, không phải chuyện im lặng bỏ qua. */
  required: z.boolean().default(false),
  itemTypes: z.array(z.enum(ITEM_TYPES)).min(1),
  /** Câu nhắc hiển thị cho người dùng khi mục còn trống. */
  guidance: z.string().trim().max(300).optional(),
})
export type BaTemplateSection = z.infer<typeof templateSectionSchema>

export const baTemplateSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'id chỉ gồm chữ thường, số và dấu gạch ngang'),
  /**
   * Phiên bản của chuẩn, do IT tăng khi đổi bố cục.
   *
   * Tài liệu lưu lại phiên bản nó được viết theo, nên khi tổ chức đổi chuẩn thì tài liệu cũ vẫn
   * nói được nó theo bản nào — thay vì âm thầm bị đo bằng một thước đo mới.
   */
  version: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[0-9][0-9a-z.-]*$/, 'version bắt đầu bằng số'),
  name: z.string().trim().min(1).max(120),
  documentKind: z.enum(['us', 'srs', 'brd', 'note']),
  description: z.string().trim().max(300).optional(),
  sections: z.array(templateSectionSchema).min(1),
})
export type BaTemplate = z.infer<typeof baTemplateSchema>

export interface TemplateSectionFill {
  readonly key: string
  readonly title: string
  readonly required: boolean
  readonly guidance?: string
  readonly items: readonly BaDocItem[]
}

export interface TemplateEvaluation {
  readonly sections: readonly TemplateSectionFill[]
  /** Key của mục bắt buộc nhưng không có item nào. */
  readonly missingRequired: readonly string[]
  /**
   * Item không thuộc mục nào của template.
   *
   * Phải hiển thị chứ không được bỏ: một tài liệu có 12 rule mà template không có mục cho rule
   * nghĩa là chọn sai template, và người dùng cần biết điều đó thay vì thấy bản xuất thiếu mất
   * 12 rule.
   */
  readonly unplaced: readonly BaDocItem[]
}

/**
 * Đặt item của mô hình vào các mục của template.
 *
 * Một kiểu item được liệt kê ở hai mục thì **mục đầu tiên thắng**. Nhân bản item vào cả hai mục
 * sẽ tạo ra một tài liệu nói cùng một điều hai lần — đúng thứ ask #6 muốn hết.
 *
 * Item còn `needsReview` vẫn được xếp mục để người dùng nhìn thấy, nhưng người gọi phải tự loại
 * chúng khỏi mọi kết luận (D4); `missingRequired` dưới đây chỉ tính item đã soát.
 */
export function evaluateTemplate(model: BaDocModel, template: BaTemplate): TemplateEvaluation {
  const claimed = new Set<BaItemType>()
  const placed = new Set<string>()

  const sections: TemplateSectionFill[] = template.sections.map((section) => {
    const owned = section.itemTypes.filter((itemType) => !claimed.has(itemType))
    for (const itemType of owned) claimed.add(itemType)

    const items = model.items
      .filter((item) => owned.includes(item.itemType))
      .slice()
      .sort((a, b) => a.ordinal - b.ordinal)
    for (const item of items) placed.add(item.id)

    return {
      key: section.key,
      title: section.title,
      required: section.required,
      ...(section.guidance === undefined ? {} : { guidance: section.guidance }),
      items,
    }
  })

  // `every` trên mảng rỗng là true — đúng ý ở đây: mục trống VÀ mục chỉ toàn item chưa soát đều
  // là mục chưa có nội dung đáng tin, và cả hai đều phải bị báo thiếu.
  const missingRequired = sections
    .filter((section) => section.required && section.items.every((item) => item.needsReview))
    .map((section) => section.key)

  return {
    sections,
    missingRequired,
    unplaced: model.items.filter((item) => !placed.has(item.id)),
  }
}
