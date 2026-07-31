import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'

interface AppLayoutProps {
  current: string
  title: string
  children: ReactNode
}

export function AppLayout({ current, title, children }: AppLayoutProps) {
  return (
    // Fixed viewport height with no page scroll: the sidebar and header stay
    // put while only the main area scrolls internally.
    <div className="flex h-screen overflow-hidden bg-slate-950 text-white">
      <Sidebar current={current} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h1 className="text-lg font-semibold">{title}</h1>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
