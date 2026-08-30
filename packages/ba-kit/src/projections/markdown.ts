import type { BaDocItem, BaDocModel } from '../model.js'
import { evaluateTemplate, type BaTemplate } from '../template.js'

/**
 * Chiếu mô hình ra Markdown theo template (D1).
 *
 * Đây là chỗ "viết tài liệu theo mẫu" thật sự xảy ra, và nó là một hàm thuần: không gọi model,
 * không thêm câu nào không có trong mô hình. Model chỉ tham gia ở bước trích xuất phía trước.
 *
 * Hệ quả đáng giá: đổi template rồi xuất lại thì bố cục đổi mà nội dung không đổi một chữ.
 */

export interface MarkdownRenderOptions {
  /** Tiêu đề tài liệu, thường là tên người dùng đặt. */
  readonly title: string
  /**
   * Có in mục trống kèm câu nhắc hay không.
   *
   * Mặc định BẬT: một bản nháp giấu mất mục còn thiếu trông giống một tài liệu đã xong, và đó
   * chính là kiểu "đầy đủ giả" mà cả change này được viết ra để tránh.
   */
  readonly showEmptySections?: boolean
}

function bullet(text: string): string {
  return `- ${text.trim().replace(/\s+/g, ' ')}`
}

function renderItem(item: BaDocItem): string[] {
  switch (item.itemType) {
    case 'actor':
      return [bullet(`**${item.name}**${item.description === undefined ? '' : ` — ${item.description}`}`)]

    case 'field': {
      const bits = [item.fieldType, item.required ? 'bắt buộc' : 'tuỳ chọn']
      if (item.noValidationReason !== undefined) {
        bits.push(`không validate: ${item.noValidationReason}`)
      }
      return [
        bullet(`**${item.name}** — ${bits.join(' · ')}`),
        ...(item.description === undefined ? [] : [`  ${item.description}`]),
      ]
    }

    case 'rule':
      return [bullet(`\`${item.id}\` ${item.statement}`)]

    case 'error_code':
      return [
        bullet(
          `\`${item.code}\` — ${item.message}${item.httpStatus === undefined ? '' : ` (HTTP ${String(item.httpStatus)})`}`,
        ),
      ]

    case 'flow_step':
      return [bullet(`[${item.kind}] ${item.label}${item.actor === undefined ? '' : ` — ${item.actor}`}`)]

    case 'use_case': {
      const lines = [
        `#### ${item.name}`,
        '',
        `- **Tác nhân:** ${item.actor}`,
        `- **Quyền:** ${item.role}`,
        `- **Tác động dữ liệu:** ${item.dataEffects.join(', ')}`,
        `- **Điều kiện trước:** ${item.precondition}`,
        `- **Điều kiện sau:** ${item.postcondition}`,
        '',
        '**Luồng chính**',
        '',
        ...item.mainFlow.map((step, index) => `${String(index + 1)}. ${step}`),
      ]

      if (item.alternateFlows.length > 0) {
        lines.push('', '**Luồng thay thế**', '')
        for (const branch of item.alternateFlows) {
          lines.push(`- *${branch.name}*`)
          lines.push(...branch.steps.map((step) => `  - ${step}`))
        }
      } else if (item.noAlternateReason !== undefined) {
        lines.push('', `**Luồng thay thế:** không có — ${item.noAlternateReason}`)
      }

      if (item.exceptionFlows.length > 0) {
        lines.push('', '**Luồng ngoại lệ**', '')
        for (const branch of item.exceptionFlows) {
          const code = branch.errorCode === undefined ? '' : ` (\`${branch.errorCode}\`)`
          lines.push(`- *${branch.name}*${code}`)
          lines.push(...branch.steps.map((step) => `  - ${step}`))
        }
      }

      return lines
    }
  }
}

export function renderMarkdown(
  model: BaDocModel,
  template: BaTemplate,
  options: MarkdownRenderOptions,
): string {
  const showEmpty = options.showEmptySections ?? true
  const evaluation = evaluateTemplate(model, template)

  const lines: string[] = [
    `# ${options.title}`,
    '',
    `> Theo mẫu **${template.name}** phiên bản ${template.version}.`,
    '',
  ]

  for (const section of evaluation.sections) {
    if (section.items.length === 0 && !showEmpty) continue

    lines.push(`## ${section.title}`, '')

    if (section.items.length === 0) {
      const suffix = section.guidance === undefined ? '' : ` ${section.guidance}`
      lines.push(
        section.required
          ? `> ⚠ Mục bắt buộc còn trống.${suffix}`
          : `> Mục này chưa có nội dung.${suffix}`,
        '',
      )
      continue
    }

    for (const item of section.items) {
      // Item chưa soát vẫn được in ra, nhưng phải đeo nhãn: người đọc bản Markdown không nhìn
      // thấy cờ `needsReview` trong UI, nên nếu không nói ở đây thì nó biến mất.
      if (item.needsReview) lines.push('> ⚠ Mục dưới đây Nexa chưa chắc — cần người soát.', '')
      lines.push(...renderItem(item), '')
    }
  }

  if (evaluation.unplaced.length > 0) {
    lines.push(
      '## Nội dung ngoài mẫu',
      '',
      `> ${String(evaluation.unplaced.length)} mục không thuộc mục nào của mẫu này. Có thể tài liệu đang dùng sai mẫu.`,
      '',
    )
    for (const item of evaluation.unplaced) lines.push(...renderItem(item), '')
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}
