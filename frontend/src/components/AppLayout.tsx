import { useState } from 'react'
import type { ReactNode } from 'react'
import { useOptionalBuildingContext } from '../contexts/BuildingContext'
import { Icon } from '../ui'
import { MobileFloorPicker } from './MobileFloorPicker'
import { MobileFloorTrigger } from './MobileFloorTrigger'
import { MobileNav } from './MobileNav'
import { Sidebar } from './Sidebar'

interface AppLayoutProps {
  current: string
  title: string
  // Optional content shown next to the title (e.g. an entity's quick badges).
  titleExtra?: ReactNode
  subtitle?: ReactNode
  // Optional actions rendered at the right of the topbar.
  actions?: ReactNode
  children: ReactNode
}

export function AppLayout({ current, title, titleExtra, subtitle, actions, children }: AppLayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [floorPickerOpen, setFloorPickerOpen] = useState(false)
  const building = useOptionalBuildingContext()
  // Only one overlay interactive at a time (§7.4): opening the picker closes the drawer.
  const openFloorPicker = () => {
    setDrawerOpen(false)
    setFloorPickerOpen(true)
  }
  return (
    // Full dynamic-viewport height with no page scroll: the rail (desktop) or the
    // bottom nav (mobile) and the topbar stay put while only the main area scrolls.
    <div className="flex overflow-hidden" style={{ height: '100dvh', background: 'var(--surface-app)' }}>
      <Sidebar current={current} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile-only chrome: menu + one-tap floor switcher. The page title itself
            now lives at the top of <main> (see the page header below), on every page. */}
        <header
          className="flex items-center gap-3 lg:hidden"
          style={{
            minHeight: 'var(--topbar-height)',
            paddingTop: 'var(--safe-top)',
            paddingLeft: 'max(var(--gutter-screen), var(--safe-left))',
            paddingRight: 'max(var(--gutter-screen), var(--safe-right))',
            background: 'rgba(255,255,255,.82)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border-subtle)',
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
        >
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={drawerOpen}
            aria-controls="mobile-drawer"
            className="grid shrink-0 place-items-center rounded-md"
            style={{ width: 'var(--hit-min)', height: 'var(--hit-min)', marginLeft: -8, color: 'var(--text-heading)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <Icon name="menu" size={22} />
          </button>
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <MobileFloorTrigger onOpen={openFloorPicker} />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl" style={{ padding: 'var(--gutter-screen)' }}>
            {/* Page header — the module title/subtitle live inside the content now. */}
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-x-2.5">
                  <h1
                    className="truncate"
                    style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--text-heading)' }}
                  >
                    {title}
                  </h1>
                  {titleExtra ? <div className="hidden shrink-0 items-center gap-x-2 sm:flex">{titleExtra}</div> : null}
                </div>
                {subtitle ? <p className="truncate" style={{ margin: '3px 0 0', fontSize: 13.5, color: 'var(--text-muted)' }}>{subtitle}</p> : null}
                {titleExtra ? <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">{titleExtra}</div> : null}
              </div>
              {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
            </div>
            {children}
          </div>
          {/* Clear the home-indicator safe area at the bottom on phones */}
          <div className="lg:hidden" aria-hidden style={{ height: 'var(--safe-bottom)' }} />
        </main>
      </div>

      <MobileNav current={current} open={drawerOpen} onOpenChange={setDrawerOpen} onOpenFloorPicker={openFloorPicker} />
      {building ? <MobileFloorPicker open={floorPickerOpen} onClose={() => setFloorPickerOpen(false)} /> : null}
    </div>
  )
}
