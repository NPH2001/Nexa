import { evaluateTemplate } from '../../template.js'
import { makeFinding, type ReviewRule } from '../types.js'

/**
 * `R-TPL-01` — không thiếu mục bắt buộc của mẫu đang dùng.
 *
 * `evaluateTemplate` đã tính sẵn `missingRequired`, và nó tính đúng theo D4: một mục chỉ toàn item
 * còn cần soát cũng bị coi là chưa có nội dung.
 *
 * `requires: 'template'` là điểm phải giữ. Tài liệu chưa chọn mẫu thì luật này **chưa được kiểm** —
 * báo cáo nói thế. Trả rỗng rồi tính là "đạt" sẽ tạo ra đúng cảm giác an toàn giả mà ADR 0010 nêu
 * ra như rủi ro chính của việc có bộ luật.
 */
export const R_TPL_01: ReviewRule = {
  id: 'R-TPL-01',
  description: 'Tài liệu có đủ các mục bắt buộc của mẫu đang dùng.',
  defaultSeverity: 'blocker',
  requires: 'template',
  evaluate: ({ doc, template }) => {
    if (template === null) return []
    const evaluation = evaluateTemplate(doc, template)
    const titles = new Map(template.sections.map((section) => [section.key, section] as const))

    return evaluation.missingRequired.map((key) => {
      const section = titles.get(key)
      return makeFinding(R_TPL_01, {
        itemId: null,
        message: `Mục bắt buộc "${section?.title ?? key}" của mẫu "${template.name}" chưa có nội dung nào đã soát.`,
        fix:
          section?.guidance ??
          'Bổ sung nội dung cho mục này, hoặc soát các mục còn cần người xem nếu nội dung đã có nhưng chưa được chốt.',
      })
    })
  },
}
