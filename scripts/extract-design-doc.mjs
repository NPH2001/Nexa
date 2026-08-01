#!/usr/bin/env node
/**
 * Trích xuất tài liệu thiết kế .docx thành Markdown (T-01-6).
 *
 * Vì sao cần: file .docx không grep được, không diff được. Comment trong mã nguồn tham chiếu
 * số mục (§10.2, §17.2…), nên phải có một bản text để đối chiếu ngay trong repo.
 *
 * File .docx vẫn là **bản gốc có thẩm quyền**. Bản Markdown chỉ là dẫn xuất; khi tài liệu ra
 * phiên bản mới thì chạy lại script này rồi xem diff để biết điều gì đã đổi.
 *
 *   node scripts/extract-design-doc.mjs <đường-dẫn.docx> [đầu-ra.md]
 *
 * Tự viết thay vì dùng thư viện: chỉ cần đọc zip + XML, và không đáng thêm một dependency
 * chỉ để chạy tay vài lần một năm.
 */

import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { argv, exit, stderr, stdout } from 'node:process'

const source = argv[2] ?? 'Nexa_Tai_lieu_thiet_ke_va_trien_khai_MVP_v1.1.docx'
const target = argv[3] ?? 'docs/design-doc-v1.1.md'

let documentXml
try {
  // `unzip -p` có sẵn trên Linux/macOS; trên Windows dùng Git Bash hoặc WSL.
  documentXml = execFileSync('unzip', ['-p', source, 'word/document.xml'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
} catch (error) {
  stderr.write(`Không đọc được ${source}: ${error.message}\n`)
  stderr.write('Cần lệnh `unzip` trong PATH.\n')
  exit(1)
}

const HEADER = `# Nexa — Tài liệu thiết kế kỹ thuật và kế hoạch triển khai MVP

> **Bản trích xuất tự động** từ \`${source}\`.
> Sinh bằng \`scripts/extract-design-doc.mjs\`. **File .docx là bản gốc có thẩm quyền** — khi hai
> bản lệch nhau thì .docx đúng.
> Mục đích của bản này: để \`grep\` được từ trong repo và để diff khi tài liệu ra phiên bản mới.
`

/** Gỡ thẻ XML của một đoạn, giữ lại text trong <w:t>. */
function textOf(fragment) {
  const parts = [...fragment.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1])
  return decode(parts.join('')).trim()
}

function decode(s) {
  return s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(documentXml)?.[1] ?? documentXml
const blocks = [...body.matchAll(/<w:(p|tbl)\b[^>]*>[\s\S]*?<\/w:\1>/g)].map((m) => m[0])

const lines = [HEADER]

for (const block of blocks) {
  if (block.startsWith('<w:tbl')) {
    lines.push(...renderTable(block))
    continue
  }

  const text = textOf(block)
  if (text === '') continue

  const style = /<w:pStyle w:val="([^"]+)"/.exec(block)?.[1] ?? ''
  if (style === 'Heading1') lines.push(`\n## ${text}\n`)
  else if (style === 'Heading2') lines.push(`\n### ${text}\n`)
  else if (style === 'ListBullet') lines.push(`- ${text}`)
  else lines.push(`${text}\n`)
}

function renderTable(tableXml) {
  const rows = [...tableXml.matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)]
    .map((m) => [...m[0].matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)]
      .map((c) => textOf(c[0]).replaceAll('|', '\\|')))
    .filter((cells) => cells.length > 0)

  if (rows.length === 0) return []

  const width = Math.max(...rows.map((r) => r.length))
  // Bảng một cột trong tài liệu này là hộp ghi chú, không phải bảng dữ liệu.
  if (width < 2) {
    return rows.filter((r) => r[0]).map((r) => `\n> ${r[0]}\n`)
  }

  const padded = rows.map((r) => [...r, ...Array(width - r.length).fill('')])
  return [
    '',
    `| ${padded[0].join(' | ')} |`,
    `|${'---|'.repeat(width)}`,
    ...padded.slice(1).map((r) => `| ${r.join(' | ')} |`),
    '',
  ]
}

writeFileSync(target, lines.join('\n'), 'utf8')
stdout.write(`Đã ghi ${target} (${lines.join('\n').length} ký tự)\n`)
