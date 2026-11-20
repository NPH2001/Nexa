import { useMemo } from 'react'
import { parseFileBlocks, type Message } from '@nexa/shared-types/renderer'
import {
  canDownloadFileBlock,
  describeOmittedBlocks,
  describeOversizeBlock,
  fileBlockIcon,
} from './file-block-ui.js'
import type { Toast } from './Toasts.js'
import { MarkdownText } from './MarkdownText.js'
import { FileBlockCard } from './FileBlockCard.js'

/**
 * Thân message.
 *
 * Message của NGƯỜI DÙNG giữ nguyên đường render cũ: text thuần. Người dùng dán code vào chat là
 * chuyện thường, và biến đoạn dán đó thành thẻ file kèm nút tải xuống là đem lại thứ họ không hỏi
 * — họ đã có nội dung đó rồi.
 *
 * Phần văn xuôi của assistant render qua `MarkdownText` (react-markdown, không `rehype-raw`), nên
 * vẫn không có `dangerouslySetInnerHTML` và HTML thô không thành element.
 */
export function MessageBody(props: {
  message: Message
  onToast: (toast: Omit<Toast, 'id'>) => void
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element {
  const { message } = props

  const segments = useMemo(
    () => (message.role === 'assistant' ? parseFileBlocks(message.content) : null),
    [message.role, message.content],
  )

  if (segments === null) return <>{message.content}</>

  return (
    <>
      {segments.map((segment, index) => {
        switch (segment.kind) {
          case 'text':
            return <MarkdownText key={index} text={segment.text} />
          case 'file':
            return (
              <FileBlockCard
                key={index}
                block={segment}
                downloadable={canDownloadFileBlock(message.status)}
                onToast={props.onToast}
                onError={props.onError}
              />
            )
          case 'partial':
            return (
              <div key={index} className="file-block file-block-partial" aria-live="polite">
                <span className="file-block-icon" aria-hidden="true">
                  {fileBlockIcon(segment.format)}
                </span>
                <span className="file-block-name">{segment.fileName}</span>
                <span className="muted small">· đang tạo…</span>
              </div>
            )
          case 'oversize':
            return (
              <div key={index} className="file-block file-block-disabled">
                <span className="file-block-icon" aria-hidden="true">
                  {fileBlockIcon(segment.format)}
                </span>
                <span className="file-block-name">{segment.fileName}</span>
                <span className="muted small">{describeOversizeBlock(segment.byteLength)}</span>
              </div>
            )
          case 'omitted':
            return (
              <p key={index} className="muted small">
                {describeOmittedBlocks(segment.count)}
              </p>
            )
        }
      })}
    </>
  )
}
