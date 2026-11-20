import { useState } from 'react'
import type { FileBlockSegment } from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { fileBlockIcon, fileBlockLabel, formatFileSize, formatLineCount } from './file-block-ui.js'
import type { Toast } from './Toasts.js'

/**
 * Thẻ file: tên, định dạng, dung lượng, số dòng, và một nút để lưu xuống ổ đĩa.
 *
 * Nội dung thu gọn theo mặc định. Với một khối `.drawio` thì XML mở sẵn chỉ là rác thị giác, còn
 * với `.txt` thì người dùng mở một lần là thấy — mặc định thu gọn phục vụ cả hai mà không cần một
 * luật đoán theo định dạng.
 */
export function FileBlockCard(props: {
  block: FileBlockSegment
  downloadable: boolean
  onToast: (toast: Omit<Toast, 'id'>) => void
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element {
  const { block } = props
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)

  const download = async (): Promise<void> => {
    setSaving(true)
    try {
      const result = await api.files.save({
        fileName: block.fileName,
        format: block.format,
        content: block.content,
      })
      // Huỷ hộp thoại KHÔNG phải lỗi và không đáng một thông báo: người dùng vừa tự huỷ.
      if (result.saved) {
        props.onToast({ kind: 'success', title: `Đã lưu ${result.fileName}` })
      }
    } catch (error) {
      props.onError(error, 'Không lưu được file.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="file-block">
      <div className="file-block-head">
        <span className="file-block-icon" aria-hidden="true">
          {fileBlockIcon(block.format)}
        </span>
        <span className="file-block-name">{block.fileName}</span>
        <span className="muted small">
          {fileBlockLabel(block.format)} · {formatFileSize(block.byteLength)} ·{' '}
          {formatLineCount(block.lineCount)}
        </span>
        <span className="file-block-actions">
          {/* Khối rỗng không có nút Tải xuống: hợp đồng IPC từ chối nội dung rỗng, nên một nút ở
              đây sẽ luôn báo lỗi. Thẻ vẫn hiện để người dùng thấy model đã tạo một file trống. */}
          {props.downloadable && block.byteLength > 0 && (
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={saving}
              aria-label={`Tải xuống ${block.fileName}`}
              onClick={() => {
                void download()
              }}
            >
              {saving ? 'Đang lưu…' : 'Tải xuống'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-small"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Thu gọn' : 'Xem'} nội dung ${block.fileName}`}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Thu gọn' : 'Xem nội dung'}
          </button>
        </span>
      </div>
      {expanded && <pre className="file-block-content">{block.content}</pre>}
    </div>
  )
}
