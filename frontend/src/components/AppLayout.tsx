import type { ReactNode } from 'react'
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
  return (
    // Fixed viewport height with no page scroll: the rail and topbar stay put
    // while only the main area scrolls. The rail swaps to the agent/team nav on
    // those pages (see Sidebar).
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--surface-app)' }}>
      <Sidebar current={current} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex items-center gap-4"
          style={{
            height: 'var(--topbar-height)',
            padding: '0 var(--gutter-screen)',
            background: 'rgba(255,255,255,.82)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border-subtle)',
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
        >
          <div className="flex min-w-0 flex-col justify-center">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 18,
                  fontWeight: 800,
                  letterSpacing: '-.015em',
                  color: 'var(--text-heading)',
                }}
              >
                {title}
              </h1>
              {titleExtra}
            </div>
            {subtitle ? <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{subtitle}</span> : null}
          </div>
          <div className="flex-1" />
          {actions ? <div className="flex items-center gap-2.5">{actions}</div> : null}
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl" style={{ padding: 'var(--gutter-screen)' }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
