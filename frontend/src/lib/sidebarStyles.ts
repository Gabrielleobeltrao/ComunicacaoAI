// Shared rail item classes (Tavorium light rail), used by the app nav and the
// agent/sector section navs so they look and behave identically.
// Collapsed, the item centers its icon (no gap, zero-width label); on hover the
// gap and left alignment return so the label has room.
export const ITEM_BASE =
  'flex w-full items-center justify-center gap-0 rounded-(--radius-control) px-3 h-10 text-left text-sm no-underline transition hover:no-underline group-hover:justify-start group-hover:gap-2.5'
export const INACTIVE = 'font-semibold text-(--text-body) hover:bg-(--surface-sunken)'
export const ACTIVE = 'font-bold bg-(--intent-brand-soft) text-(--cobalt-700)'
// The rail is icons-only until hovered; anything past the icon (labels, the
// wordmark, chevrons) collapses to zero width and fades out, then expands back
// in on hover. `group-hover` keys off the `group` wrapper in Sidebar.
export const COLLAPSE_FADE =
  'max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-200 group-hover:max-w-[200px] group-hover:opacity-100'
export const LABEL = `min-w-0 flex-1 truncate ${COLLAPSE_FADE}`
