import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useSession } from '../lib/auth-client'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data: session, isPending, error, refetch } = useSession()

  // A failed session check (backend restarting, brief network blip) isn't
  // the same as "not logged in" — retry instead of bouncing to /login.
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => refetch(), 2000)
    return () => clearTimeout(timer)
  }, [error, refetch])

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Carregando...
      </div>
    )
  }

  if (error && !session) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Problema de conexão. Tentando novamente...
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
