import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { signOut, useSession } from '../lib/auth-client'
import { Brand, Icon } from '../ui'
import { NAV } from './navItems'
import { useOptionalBuildingContext } from '../contexts/BuildingContext'
import { isNavActive, navGroupsFor } from './navConfig'
import { defaultPathFor, useAppNavigation } from '../lib/appNavigation'
import type { NavigationApp } from '../lib/appNavigation'
import { AppLogo } from './AppLogo'

// Touch navigation for phones and small tablets (< lg): a single slide-in drawer
// (opened from the topbar hamburger) with the account, every destination with
// labels, the floor switcher, settings and sign-out. No bottom bar — it duplicated
// the drawer. The desktop hover rail (Sidebar) is hidden at this size.
export function MobileNav({ current, open, onOpenChange, onOpenFloorPicker }: { current: string; open: boolean; onOpenChange: (v: boolean) => void; onOpenFloorPicker: () => void }) {
  const navigate = useNavigate()
  const { data: session } = useSession()
  const user = session?.user
  const displayName = user?.name?.trim() || user?.email?.split('@')[0] || 'Você'
  const secondary = user?.email || 'Conta'
  const initial = displayName.charAt(0).toUpperCase()

  // While the drawer is open: lock background scroll and close on Escape.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  const close = () => onOpenChange(false)
  async function handleSignOut() {
    close()
    await signOut()
    navigate('/login')
  }

  // Nav V2 (floor-aware). The hamburger drawer is the single mobile navigation —
  // it holds the full grouped menu, the floor switcher, account and sign-out. There
  // is no bottom bar (it duplicated the drawer).
  const bctx = useOptionalBuildingContext()
  const { pathname } = useLocation()
  const floorId = bctx?.activeFloorId ?? null
  const { pinned } = useAppNavigation()

  return (
    <>
      {/* Drawer — account + full menu + settings/sign-out */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div onClick={close} style={{ position: 'absolute', inset: 0, background: 'rgba(15,20,32,.5)' }} />
          <aside
            id="mobile-drawer"
            className="absolute inset-y-0 left-0 flex w-[min(84vw,320px)] flex-col gap-4 overflow-y-auto p-4"
            style={{
              background: 'var(--surface-rail)',
              borderRight: '1px solid var(--border-subtle)',
              paddingTop: 'calc(16px + var(--safe-top))',
              paddingBottom: 'calc(16px + var(--safe-bottom))',
              paddingLeft: 'calc(16px + var(--safe-left))',
              boxShadow: '0 16px 40px rgba(22,24,31,.24)',
            }}
          >
            <div className="flex items-center justify-between">
              <Brand size={20} />
              <button onClick={close} aria-label="Fechar menu" className="grid place-items-center rounded-md" style={{ width: 'var(--hit-min)', height: 'var(--hit-min)', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <Icon name="x" size={20} />
              </button>
            </div>

            {bctx && (
              <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'var(--surface-sunken)' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bctx.building?.name ?? 'Prédio'}</span>
                <div className="flex items-center gap-2">
                  <span style={{ width: 12, height: 12, borderRadius: 4, background: bctx.activeFloor?.color ?? 'var(--accent, #6b5cff)', flexShrink: 0 }} />
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Andar atual: {bctx.activeFloor?.name ?? 'Nenhum'}
                  </span>
                </div>
                <button
                  onClick={onOpenFloorPicker}
                  className="flex items-center justify-center gap-2 rounded-lg"
                  style={{ minHeight: 40, padding: '0 12px', border: '1px solid var(--border-strong,#d0d5dd)', background: 'var(--surface-card,#fff)', color: 'var(--text-body)', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}
                >
                  <Icon name="chevrons-up-down" size={16} />
                  Trocar de andar
                </button>
              </div>
            )}
            <nav className="flex flex-col gap-1">
              {bctx
                ? navGroupsFor(floorId, bctx.activeFloor?.name).map(({ group, label, items }) => {
                    return (
                      <div key={group} className="flex flex-col gap-1">
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-muted)', padding: '8px 8px 2px' }}>{label}</span>
                        {items.map((item) => {
                          const active = isNavActive(item, floorId, pathname)
                          return (
                            <Link
                              key={item.key}
                              to={item.path(floorId)}
                              onClick={close}
                              aria-current={active ? 'page' : undefined}
                              className="flex items-center gap-3 rounded-md px-3"
                              style={{ minHeight: 'var(--hit-min)', color: active ? 'var(--intent-brand)' : 'var(--text-body)', background: active ? 'var(--intent-brand-soft)' : 'transparent', fontWeight: active ? 700 : 500, textDecoration: 'none' }}
                            >
                              <Icon name={item.icon} size={18} />
                              <span>{item.label}</span>
                            </Link>
                          )
                        })}
                      </div>
                    )
                  })
                : NAV.map((item) => {
                    const active = item.to === current
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={close}
                        aria-current={active ? 'page' : undefined}
                        className="flex items-center gap-3 rounded-md px-3"
                        style={{ minHeight: 'var(--hit-min)', color: active ? 'var(--intent-brand)' : 'var(--text-body)', background: active ? 'var(--intent-brand-soft)' : 'transparent', fontWeight: active ? 700 : 500, textDecoration: 'none' }}
                      >
                        <Icon name={item.icon} size={18} />
                        <span>{item.label}</span>
                      </Link>
                    )
                  })}
              {/* The same pins as the desktop rail. They are appended, so they can
                  never push an essential destination out of the drawer. */}
              {pinned.length > 0 && (
                <div className="flex flex-col gap-1" data-testid="mobile-pinned-apps">
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-muted)', padding: '8px 8px 2px' }}>
                    APPS FIXADOS
                  </span>
                  {/* One expandable PARENT per App — the same structure as the desktop
                      rail. Flattening every page into its own top-level link buried the
                      essential destinations under a wall of App sub-pages. */}
                  {pinned.map((app) => (
                    <MobilePinnedApp key={app.appKey} app={app} pathname={pathname} onNavigate={close} />
                  ))}
                </div>
              )}
            </nav>

            <div className="mt-auto flex flex-col gap-1 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center gap-2.5 px-1 pb-1">
                <span className="grid shrink-0 place-items-center rounded-full" style={{ width: 34, height: 34, background: 'var(--intent-brand-soft)', color: 'var(--cobalt-700)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14 }}>
                  {initial}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{secondary}</span>
                </div>
              </div>
              <Link to="/settings" onClick={close} className="flex items-center gap-3 rounded-md px-3" style={{ minHeight: 'var(--hit-min)', color: 'var(--text-body)', textDecoration: 'none' }}>
                <Icon name="settings" size={18} />
                <span>Configurações</span>
              </Link>
              <button onClick={handleSignOut} className="flex items-center gap-3 rounded-md px-3 text-left" style={{ minHeight: 'var(--hit-min)', color: 'var(--intent-danger)', background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit' }}>
                <Icon name="log-out" size={18} />
                <span>Sair</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}

// A pinned App in the drawer: the name opens its default page, the chevron reveals
// the rest. It opens by itself when one of its pages is the current route.
function MobilePinnedApp({
  app,
  pathname,
  onNavigate,
}: {
  app: NavigationApp
  pathname: string
  onNavigate: () => void
}) {
  const containsActive = app.surfaces.some((s) => pathname === s.path)
  const [open, setOpen] = useState(containsActive)
  const expanded = open || containsActive
  const single = app.surfaces.length === 1

  const row = (active: boolean): CSSProperties => ({
    minHeight: 'var(--hit-min)',
    color: active ? 'var(--intent-brand)' : 'var(--text-body)',
    background: active ? 'var(--intent-brand-soft)' : 'transparent',
    fontWeight: active ? 700 : 500,
    textDecoration: 'none',
  })

  return (
    <div className="flex flex-col gap-0.5" data-testid={`mobile-app-${app.appKey}`}>
      <div className="flex items-center gap-1">
        <Link
          to={defaultPathFor(app)}
          onClick={onNavigate}
          aria-current={containsActive ? 'page' : undefined}
          className="flex flex-1 items-center gap-3 rounded-md px-3"
          style={row(containsActive)}
        >
          {/* O MESMO símbolo do catálogo. Antes ia `app.icon` direto para o Icon,
              que carrega glifos do Lucide — e o Lucide não tem logo de marca, então
              WhatsApp, Slack e companhia apareciam em branco aqui. */}
          <AppLogo appKey={app.appKey} icon={app.icon} size={18} plain />
          <span>{app.name}</span>
          {app.status === 'needs_reauth' ? (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--intent-warning, #b54708)' }}>reconectar</span>
          ) : null}
        </Link>
        {single ? null : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Recolher' : 'Expandir'} páginas de ${app.name}`}
            data-testid={`mobile-toggle-${app.appKey}`}
            // A real touch target, not a 14px chevron.
            style={{ minWidth: 'var(--hit-min)', minHeight: 'var(--hit-min)', display: 'grid', placeItems: 'center', background: 'none', border: 0, color: 'var(--text-muted)' }}
          >
            <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={18} />
          </button>
        )}
      </div>

      {expanded && !single ? (
        <div className="flex flex-col gap-0.5" style={{ paddingLeft: 22 }}>
          {app.surfaces.map((surface) => {
            const active = pathname === surface.path
            return (
              <Link
                key={surface.path}
                to={surface.path}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className="flex items-center gap-3 rounded-md px-3"
                style={{ ...row(active), fontSize: 13.5 }}
                data-testid={`mobile-surface-${app.appKey}-${surface.key}`}
              >
                <span>{surface.label}</span>
              </Link>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
