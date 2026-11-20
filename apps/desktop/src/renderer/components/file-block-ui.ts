import {
  FILE_BLOCK_FORMAT_META,
  MAX_FILE_BLOCK_BYTES,
  type FileBlockFormat,
  type Message,
} from '@nexa/shared-types/renderer'

/**
 * Helper hiển thị cho thẻ file (openspec `add-generated-file-download`).
 *
 * Tách khỏi `ChatView.tsx` vì đây là chỗ duy nhất quyết định "khi nào được bấm Tải xuống" — một
 * luật có điều kiện, đáng được test riêng mà không cần dựng React.
 */

/** Biểu tượng theo định dạng. Chỉ để quét nhanh bằng mắt, không mang thông tin nào khác. */
const FORMAT_ICONS: Readonly<Record<FileBlockFormat, string>> = {
  drawio: '📐',
  txt: '📄',
  md: '📝',
  csv: '📊',
  json: '🧾',
  xml: '🧾',
  yaml: '⚙',
  yml: '⚙',
  sql: '🗃',
  puml: '📐',
  mmd: '📐',
  svg: '🖼',
  http: '🌐',
}

export function fileBlockIcon(format: FileBlockFormat): string {
  return FORMAT_ICONS[format]
}

export function fileBlockLabel(format: FileBlockFormat): string {
  return FILE_BLOCK_FORMAT_META[format].label
}

/** Dùng chung cho cả chip đính kèm và thẻ file — hai chỗ này không được nói khác nhau về cùng một số. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Nhãn số dòng. Nội dung rỗng nói "trống" thay vì "0 dòng": một file 0 dòng đọc như lỗi trích
 * xuất, còn "trống" thì đúng là điều đang xảy ra.
 */
export function formatLineCount(lineCount: number): string {
  return lineCount === 0 ? 'trống' : `${lineCount.toLocaleString('vi-VN')} dòng`
}

/**
 * Nút Tải xuống chỉ hiện khi khối đã đóng VÀ message đã hết streaming.
 *
 * Điều kiện thứ hai không dư: fence có thể đóng ở giữa lượt trả lời, và ghi một file mà byte cuối
 * chưa tới thì tệ hơn là chưa cho ghi.
 */
export function canDownloadFileBlock(messageStatus: Message['status']): boolean {
  return messageStatus !== 'streaming' && messageStatus !== 'pending'
}

/** Lý do một khối bị vô hiệu, nói bằng con số người dùng đối chiếu được. */
export function describeOversizeBlock(byteLength: number): string {
  return `Khối này ${formatFileSize(byteLength)}, vượt trần ${formatFileSize(
    MAX_FILE_BLOCK_BYTES,
  )} nên chưa tải xuống được.`
}

export function describeOmittedBlocks(count: number): string {
  return `Còn ${count.toLocaleString('vi-VN')} khối file nữa trong câu trả lời này chưa được hiển thị.`
}
