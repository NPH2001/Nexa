/**
 * Ba trạng thái mà mọi khối dữ liệu phải có (DESIGN.md "States"): đang tải, trống, lỗi.
 *
 * Gom về một chỗ để các màn nói cùng một giọng và trông như nhau. Trước đây mỗi màn tự viết
 * "Đang tải…" bằng chữ muted, và mỗi nơi báo lỗi một kiểu: nơi có nút thử lại, nơi không có,
 * nơi có mã yêu cầu, nơi không.
 */

/**
 * Khối giữ chỗ trong lúc tải, có hình gần giống nội dung thật để bố cục không nhảy khi dữ liệu về.
 * `label` không hiện ra mà được trình đọc màn hình đọc lên, vì người dùng không nhìn thấy
 * skeleton vẫn phải biết là đang tải.
 */
export function LoadingSkeleton(props: {
  label: string
  /** Số dòng giữ chỗ. */
  rows?: number
  /** `rows`: dòng danh sách thấp. `cards`: thẻ cao như card mục tiêu, cam kết. */
  variant?: 'rows' | 'cards'
}): React.JSX.Element {
  const rows = props.rows ?? 3
  const variant = props.variant ?? 'rows'
  return (
    <div className={`skeleton-group skeleton-${variant}`} role="status" aria-busy="true">
      <span className="sr-only">{props.label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton" aria-hidden="true" />
      ))}
    </div>
  )
}

/**
 * Trạng thái trống: nói vì sao trống và cho một việc để làm tiếp. Không dùng câu kiểu
 * "Bắt đầu gõ…" chung chung (DESIGN.md "Empty").
 */
export function EmptyState(props: {
  title?: string
  children: React.ReactNode
  action?: { label: string; onClick: () => void }
}): React.JSX.Element {
  return (
    <div className="state-empty">
      {props.title !== undefined && <strong className="state-title">{props.title}</strong>}
      <div className="state-text">{props.children}</div>
      {props.action !== undefined && (
        <button type="button" className="btn btn-small" onClick={props.action.onClick}>
          {props.action.label}
        </button>
      )}
    </div>
  )
}

/**
 * Lỗi tải dữ liệu, hiện ngay tại khối bị lỗi thay vì chỉ một toast tự biến mất. Luôn có một
 * cách phục hồi (DESIGN.md "Error": giữ dữ liệu, nói nguyên nhân, cho một hành động).
 * Mã yêu cầu hiện kèm để người dùng chép được khi báo lỗi (§9.3).
 */
export function InlineError(props: {
  title: string
  detail?: string | null
  requestId?: string | null
  onRetry: () => void
  retryLabel?: string
}): React.JSX.Element {
  return (
    <div className="state-error" role="alert">
      <strong className="state-title">{props.title}</strong>
      {props.detail !== undefined && props.detail !== null && props.detail !== '' && (
        <p className="state-text">{props.detail}</p>
      )}
      {props.requestId !== undefined && props.requestId !== null && (
        <p className="state-text small">
          Mã yêu cầu: <code>{props.requestId}</code>
        </p>
      )}
      <button type="button" className="btn btn-small" onClick={props.onRetry}>
        {props.retryLabel ?? 'Thử lại'}
      </button>
    </div>
  )
}
