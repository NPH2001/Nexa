import { useId } from 'react'

export function NexaMark({
  size = 48,
  className,
  avatar = false,
}: {
  size?: number
  className?: string
  avatar?: boolean
}): React.JSX.Element {
  const gradientId = useId()
  return (
    <svg
      className={className ? `nexa-mark ${className}` : 'nexa-mark'}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0" stopColor="#28b8ff" />
          <stop offset="0.5" stopColor="#4878ff" />
          <stop offset="1" stopColor="#8c42ff" />
        </linearGradient>
      </defs>
      {avatar && <circle cx="24" cy="24" r="24" fill={`url(#${gradientId})`} />}
      <path
        transform={avatar ? 'translate(9 9) scale(.625)' : undefined}
        d="M3 46V15C3 4 14-1 21 9l12 17V13C33 5 39 1 46 0v32c0 11-11 16-18 6L16 21v12c0 8-6 12-13 13Z"
        fill={avatar ? '#fff' : `url(#${gradientId})`}
      />
    </svg>
  )
}
