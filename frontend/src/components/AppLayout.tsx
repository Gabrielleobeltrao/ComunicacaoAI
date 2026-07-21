import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { signOut, useSession } from '../lib/auth-client'
import { ApiKeySettings } from './ApiKeySettings'
import { Sidebar } from './Sidebar'

interface AppLayoutProps {
  current: string
  title: string
  children: ReactNode
}

export function AppLayout({ current, title, children }: AppLayoutProps) {
  const navigate = useNavigate()
  const { data: session } = useSession()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      <Sidebar current={current} />

      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h1 className="text-lg font-semibold">{title}</h1>
          <div className="flex items-center gap-4">
            <ApiKeySettings />
            <span className="text-sm text-slate-400">{session?.user.email}</span>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800"
            >
              Sair
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </div>
    </div>
  )
}
