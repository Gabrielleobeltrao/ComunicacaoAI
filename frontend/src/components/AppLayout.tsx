import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'

interface AppLayoutProps {
  current: string
  title: string
  // Optional content shown next to the title (e.g. an entity's quick badges).
  titleExtra?: ReactNode
  children: ReactNode
}

export function AppLayout({ current, title, titleExtra, children }: AppLayoutProps) {
  return (
    // Fixed viewport height with no page scroll: the sidebar and header stay
    // put while only the main area scrolls internally. The sidebar itself swaps
    // to the agent's nav on agent pages (see Sidebar).
    <div className="flex h-screen overflow-hidden bg-slate-950 text-white">
      <Sidebar current={current} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-lg font-semibold">{title}</h1>
            {titleExtra}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
