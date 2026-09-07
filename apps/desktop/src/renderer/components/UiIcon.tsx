export type UiIconName =
  | 'home'
  | 'target'
  | 'activity'
  | 'plus'
  | 'search'
  | 'settings'
  | 'book'
  | 'trash'
  | 'pencil'
  | 'copy'
  | 'send'
  | 'attach'
  | 'globe'
  | 'building'
  | 'chevron'
  | 'close'
  | 'stop'
  | 'file'
  | 'check'

const paths: Record<UiIconName, React.ReactNode> = {
  home: (
    <>
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
    </>
  ),
  target: (
    <>
      <path d="M20 11a8 8 0 1 1-7-7M16 12a4 4 0 1 1-4-4m0 4 8-8m-4 0h4v4" />
    </>
  ),
  activity: (
    <>
      <path d="M5 20v-7m7 7V4m7 16V8" strokeWidth="3" />
    </>
  ),
  plus: <path d="M12 4v16M4 12h16" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
  settings: (
    <>
      <path d="m10 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 3 3-1 1-3 3-1 1-3-2-2 1-3-3-2-3 1-2-2Z" />
      <circle cx="12" cy="11" r="3" />
    </>
  ),
  book: (
    <>
      <path d="M12 5v16m0-16C8 2 4 3 2 4v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-3-1-6-2-10 1Z" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
    </>
  ),
  pencil: (
    <>
      <path d="m15 4 5 5M4 15 16 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L9 20l-6 1Z" />
    </>
  ),
  copy: (
    <>
      <rect x="3" y="6" width="14" height="15" rx="2" />
      <path d="M7 6V3h14v14h-4" />
    </>
  ),
  send: (
    <>
      <path d="m3 10 18-7-7 18-3-8-8-3Zm8 3L21 3" />
    </>
  ),
  attach: <path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7L13 2m-6 13 8-8" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18M5 6h14M5 18h14" />
    </>
  ),
  building: (
    <>
      <path d="M3 21V7l9-4v18M12 10h8v11M1 21h22M7 8v2m0 3v2m0 3v3m9-7h1m-1 3h1" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  file: (
    <>
      <path d="M14 3H5v18h14V8Zm0 0v5h5M12 17v-6m-3 3 3-3 3 3" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
}

export function UiIcon({
  name,
  size = 22,
  className,
}: {
  name: UiIconName
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <svg
      className={className ? `ui-icon ${className}` : 'ui-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}
