import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Giữ focus bên trong modal, hỗ trợ Escape và trả focus về control đã mở modal.
 * Callback được giữ qua ref để render lại không làm focus nhảy hoặc bị khôi phục sớm.
 */
export function useModalDialog(
  onClose: () => void,
  closeDisabled = false,
): {
  dialogRef: React.RefObject<HTMLDivElement | null>
  initialFocusRef: React.RefObject<HTMLButtonElement | null>
} {
  const dialogRef = useRef<HTMLDivElement>(null)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const closeDisabledRef = useRef(closeDisabled)

  onCloseRef.current = onClose
  closeDisabledRef.current = closeDisabled

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current

    initialFocusRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent): void => {
      const openDialogs = document.querySelectorAll<HTMLElement>('[aria-modal="true"]')
      if (openDialogs.item(openDialogs.length - 1) !== dialog) return

      if (event.key === 'Escape' && !closeDisabledRef.current) {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || dialog === null) return

      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) => element.getAttribute('aria-hidden') !== 'true',
      )
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable.at(-1)
      if (first === undefined || last === undefined) return

      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocus?.isConnected === true) previousFocus.focus()
    }
  }, [])

  return { dialogRef, initialFocusRef }
}
