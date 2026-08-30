import type { BaDocModel, BaFlowStep } from '../model.js'
import { itemsOfType } from '../model.js'

/**
 * Chiếu đồ thị flow ra mã Mermaid (D8).
 *
 * Không dựng trình vẽ: `flow_step` cộng các cạnh `next` ĐÃ là một đồ thị, và Mermaid là một hàm
 * thuần trên đồ thị đó. Đổi lại ba thứ — sơ đồ luôn khớp tài liệu vì cùng một nguồn, diff được
 * trong Git, và không thêm dependency UI nào.
 */

/**
 * Mermaid dùng `"` để bọc nhãn nên nhãn không được chứa `"`.
 *
 * Thay bằng dấu nháy đơn chứ không xoá: mã lỗi và tên trường trong tài liệu nghiệp vụ hay có dấu
 * nháy kép, và xoá đi làm nhãn sai nghĩa. Ký tự xuống dòng thành `<br/>` vì Mermaid hiểu thẻ đó.
 */
function label(text: string): string {
  return text.replace(/"/g, "'").replace(/\r?\n/g, '<br/>').trim()
}

/** Id Mermaid phải là token đơn giản; id item có thể chứa ký tự Mermaid coi là cú pháp. */
function nodeId(id: string): string {
  return `n_${id.replace(/[^A-Za-z0-9_]/g, '_')}`
}

function shape(step: BaFlowStep): string {
  const text = `"${label(step.label)}"`
  switch (step.kind) {
    case 'start':
    case 'end':
      return `([${text}])`
    case 'decision':
      return `{${text}}`
    case 'step':
      return `[${text}]`
  }
}

export interface MermaidResult {
  readonly code: string
  /** Bước không có cạnh vào lẫn cạnh ra — sơ đồ vẽ được nhưng người dùng cần biết chúng rời rạc. */
  readonly isolatedSteps: readonly string[]
  readonly stepCount: number
  readonly edgeCount: number
}

export function renderMermaid(model: BaDocModel): MermaidResult {
  const steps = itemsOfType(model, 'flow_step')
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
  const alive = new Set(steps.map((step) => step.id))

  const edges = model.links.filter(
    (link) => link.kind === 'next' && alive.has(link.from) && alive.has(link.to),
  )

  const connected = new Set<string>()
  for (const edge of edges) {
    connected.add(edge.from)
    connected.add(edge.to)
  }

  const lines = ['flowchart TD']
  for (const step of steps) {
    lines.push(`  ${nodeId(step.id)}${shape(step)}`)
  }
  for (const edge of edges) {
    const arrow = edge.label === undefined ? '-->' : `-->|"${label(edge.label)}"|`
    lines.push(`  ${nodeId(edge.from)} ${arrow} ${nodeId(edge.to)}`)
  }

  return {
    code: `${lines.join('\n')}\n`,
    isolatedSteps: steps.filter((step) => !connected.has(step.id)).map((step) => step.id),
    stepCount: steps.length,
    edgeCount: edges.length,
  }
}
