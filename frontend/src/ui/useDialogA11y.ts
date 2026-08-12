import { useEffect } from 'react'
import type { RefObject } from 'react'

// Shared modal accessibility: while open, lock background scroll, close on Escape,
// keep Tab focus inside the panel, and restore focus to the opener on close. Used
// by both dialog implementations so the behaviour lives in one place.
export function useDialogA11y(open: boolean, onClose: (() => void) | undefined, panelRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const opener = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    // Move focus into the dialog (the panel itself is focusable via tabIndex=-1).
    if (panel && !panel.contains(document.activeElement)) panel.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const f = panel.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')
      if (f.length === 0) {
        e.preventDefault()
        return
      }
      const first = f[0]
      const last = f[f.length - 1]
      const active = document.activeElement
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
  }, [open, onClose, panelRef])
}
