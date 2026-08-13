import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { signOut, useSession } from '../lib/auth-client'
import { Brand, Icon } from '../ui'
import { NAV } from './navItems'
import { useOptionalBuildingContext } from '../contexts/BuildingContext'
import { isNavActive, navItemsFor, SCOPE_LABEL } from './navConfig'
import type { NavScope } from './navConfig'

// Touch navigation for phones and small tablets (< lg): a fixed bottom bar for
// the primary destinations plus a slide-in drawer (opened from the topbar) for
// the account, every destination with labels, settings and sign-out. The desktop
// hover rail (Sidebar) is hidden at this size.
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

  // Nav V2 (floor-aware). Bottom bar = up to 4 primary + a "Mais" button; the
  // drawer holds the full grouped nav.
  const bctx = useOptionalBuildingContext()
  const { pathname } = useLocation()
  const floorId = bctx?.activeFloorId ?? null
  const primary = bctx ? navItemsFor(floorId).filter((i) => i.mobilePrimary).slice(0, 4) : null

  return (
    <>
      {/* Bottom navigation — primary destinations, safe-area aware, 44px targets */}
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch lg:hidden"
        style={{
          height: 'calc(var(--bottom-nav-height) + var(--safe-bottom))',
          paddingBottom: 'var(--safe-bottom)',
          background: 'var(--surface-rail)',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {primary ? (
          <>
            {primary.map((item) => {
              const active = isNavActive(item, floorId, pathname)
              return (
                <Link
                  key={item.key}
                  to={item.path(floorId)}
                  aria-current={active ? 'page' : undefined}
                  className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5"
                  style={{ minHeight: 'var(--hit-min)', color: active ? 'var(--intent-brand)' : 'var(--text-muted)', textDecoration: 'none' }}
                >
                  <Icon name={item.icon} size={20} />
                  <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                </Link>
              )
            })}
            <button
              onClick={() => onOpenChange(true)}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5"
              style={{ minHeight: 'var(--hit-min)', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit' }}
            >
              <Icon name="menu" size={20} />
              <span style={{ fontSize: 10.5, fontWeight: 500 }}>Mais</span>
            </button>
          </>
        ) : (
          NAV.map((item) => {
            const active = item.to === current
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5"
                style={{ minHeight: 'var(--hit-min)', color: active ? 'var(--intent-brand)' : 'var(--text-muted)', textDecoration: 'none' }}
              >
                <Icon name={item.icon} size={20} />
                <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
              </Link>
            )
          })
        )}
      </nav>

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
                ? (['general', 'floor', 'communication'] as NavScope[]).map((scope) => {
                    const items = navItemsFor(floorId).filter((i) => i.scope === scope)
                    if (!items.length) return null
                    const label = scope === 'floor' && bctx.activeFloor ? `ANDAR · ${bctx.activeFloor.name.toUpperCase()}` : SCOPE_LABEL[scope]
                    return (
                      <div key={scope} className="flex flex-col gap-1">
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
