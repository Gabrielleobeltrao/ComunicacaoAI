import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { API_URL } from '../lib/api'
import { AppLayout } from './AppLayout'
import { Button, EmptyState } from '../ui'

// Nothing reaches an App page without passing here.
//
// A pin is navigation, not authorisation, and neither is a URL: typing
// `/apps/whatsapp/channels` must not open the operational page when the App is
// inactive, expired or broken. The decision is the SAME one the sidebar uses — it
// comes from the backend, so the two can never disagree.
//
// The three outcomes are deliberately different screens: an inactive App sends the
// owner to /apps to activate it, a broken one offers to reconnect, and anything
// unknown is simply not a page.

type Access =
  | { state: 'checking' }
  | { state: 'ok' }
  | { state: 'denied'; reason: 'unknown' | 'inactive' | 'needs_reauth'; appName: string | null; activationRoute: string | null }

export function AppSurfaceGuard({
  appKey,
  surfaceKey,
  title,
  children,
}: {
  appKey: string
  surfaceKey: string
  title: string
  children: React.ReactNode
}) {
  const [access, setAccess] = useState<Access>({ state: 'checking' })
  const navigate = useNavigate()

  /**
   * Qual App já respondeu que sim.
   *
   * Trocar de aba dentro do MESMO App refaz a pergunta — a resposta é por superfície,
   * e continua sendo. O que não pode é apagar a tela enquanto ela volta: antes daqui
   * cada aba passava por "Carregando…" com o layout inteiro, e era metade do piscar.
   */
  const jaLiberado = useRef<string | null>(null)

  const check = useCallback(async (silencioso = false) => {
    if (!silencioso) setAccess({ state: 'checking' })
    try {
      const res = await fetch(`${API_URL}/api/apps/${appKey}/surfaces/${surfaceKey}/access`, { credentials: 'include' })
      const body = (await res.json()) as { ok?: boolean; reason?: string; appName?: string; activationRoute?: string }
      if (res.ok && body.ok) {
        jaLiberado.current = appKey
        setAccess({ state: 'ok' })
        return
      }
      jaLiberado.current = null
      setAccess({
        state: 'denied',
        reason: body.reason === 'inactive' || body.reason === 'needs_reauth' ? body.reason : 'unknown',
        appName: body.appName ?? null,
        activationRoute: body.activationRoute ?? null,
      })
    } catch {
      // A network failure is not a permission answer: it must not silently open the
      // page, and it must not pretend the App is gone either.
      setAccess({ state: 'denied', reason: 'needs_reauth', appName: null, activationRoute: null })
    }
  }, [appKey, surfaceKey])

  useEffect(() => {
    void check(jaLiberado.current === appKey)
  }, [check, appKey])

  if (access.state === 'checking') {
    return (
      <AppLayout current="/apps" title={title}>
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando…</p>
      </AppLayout>
    )
  }

  if (access.state === 'ok') return <>{children}</>

  // A page that does not exist is not a broken page — it is not a page.
  if (access.reason === 'unknown') return <Navigate to="/apps" replace />

  // Inactive: the owner has to activate the App first, and /apps is where that
  // happens. The message says why they were moved.
  if (access.reason === 'inactive') {
    return <Navigate to={`/apps?inactive=${encodeURIComponent(appKey)}`} replace />
  }

  // Broken or expired: a safe screen with the way out, never the operational page.
  return (
    <AppLayout current="/apps" title={title}>
      <div data-testid="surface-needs-reauth">
        <EmptyState
          icon="plug-zap"
          title={`${access.appName ?? 'Este App'} precisa ser reconectado`}
          body="A conexão existe, mas não está funcionando agora. Reconecte para voltar a usar esta página — nada do que já foi feito é perdido."
          action={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Button size="sm" onClick={() => navigate(access.activationRoute ?? '/apps?tab=connected')} data-testid="surface-reconnect">
                Reconectar
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void check()}>
                Tentar de novo
              </Button>
            </div>
          }
        />
      </div>
    </AppLayout>
  )
}
