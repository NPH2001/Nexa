import { memo } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Render Markdown của câu trả lời assistant thành React element.
 *
 * Không dùng `rehype-raw` và không có `dangerouslySetInnerHTML`: HTML thô trong câu trả lời chỉ
 * hiện thành chữ. Link mở qua `target="_blank"` để `setWindowOpenHandler` ở main (allowlist §11.2)
 * quyết định; ảnh bị thay bằng alt text vì CSP đã chặn ảnh từ xa.
 */

const ALLOWED_LINK = /^(https?:|mailto:)/i

const COMPONENTS: Components = {
  a: ({ href, children }) =>
    href !== undefined && ALLOWED_LINK.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }) => <span>{alt ?? ''}</span>,
  table: ({ children }) => (
    <div className="md-table-wrap">
      <table>{children}</table>
    </div>
  ),
}

const REMARK_PLUGINS = [remarkGfm]

export const MarkdownText = memo(function MarkdownText(props: {
  text: string
}): React.JSX.Element {
  return (
    <div className="md">
      <Markdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {props.text}
      </Markdown>
    </div>
  )
})
