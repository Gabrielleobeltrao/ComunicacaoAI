import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'

interface AppLayoutProps {
  current: string
  title: string
  children: ReactNode
}

export function AppLayout({ current, title, children }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      <Sidebar current={current} />

      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h1 className="text-lg font-semibold">{title}</h1>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </div>
    </div>
  )
}
