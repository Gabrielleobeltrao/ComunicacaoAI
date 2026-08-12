import { useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../ui'
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
  return (
    // Full dynamic-viewport height with no page scroll: the rail (desktop) or the
    // bottom nav (mobile) and the topbar stay put while only the main area scrolls.
    <div className="flex overflow-hidden" style={{ height: '100dvh', background: 'var(--surface-app)' }}>
      <Sidebar current={current} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex items-center gap-3"
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
            className="grid shrink-0 place-items-center rounded-md lg:hidden"
            style={{ width: 'var(--hit-min)', height: 'var(--hit-min)', marginLeft: -8, color: 'var(--text-heading)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <Icon name="menu" size={22} />
          </button>

          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <div className="flex min-w-0 items-center gap-x-2.5">
              <h1
                className="truncate"
                style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, letterSpacing: '-.015em', color: 'var(--text-heading)' }}
              >
                {title}
              </h1>
              {titleExtra ? <div className="hidden shrink-0 items-center gap-x-2 sm:flex">{titleExtra}</div> : null}
            </div>
            {subtitle ? <span className="truncate" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{subtitle}</span> : null}
          </div>

          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl" style={{ padding: 'var(--gutter-screen)' }}>{children}</div>
          {/* Reserve room so content isn't hidden behind the fixed mobile bottom nav */}
          <div className="lg:hidden" aria-hidden style={{ height: 'calc(var(--bottom-nav-height) + var(--safe-bottom))' }} />
        </main>
      </div>

      <MobileNav current={current} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  )
}
