import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useSession } from '../lib/auth-client'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession()

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Carregando...
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
