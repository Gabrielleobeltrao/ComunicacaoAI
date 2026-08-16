import { Link, useLocation, useNavigate } from 'react-router'
import { signOut, useSession } from '../lib/auth-client'
import { ACTIVE, COLLAPSE_FADE, INACTIVE, ITEM_BASE, LABEL } from '../lib/sidebarStyles'
import { Brand, Icon, IconButton } from '../ui'
import { NAV } from './navItems'
import { useOptionalBuildingContext } from '../contexts/BuildingContext'
import { isNavActive, navGroupsFor } from './navConfig'
import { BuildingSwitcher } from './BuildingSwitcher'
import { PinnedAppsNav } from './PinnedAppsNav'
import { useAppNavigation } from '../lib/appNavigation'

export function Sidebar({ current }: { current: string }) {
  const navigate = useNavigate()
  const { data: session } = useSession()
  // Nav V2 (grouped, floor-aware) when the building context is present.
  const bctx = useOptionalBuildingContext()
  const { pathname } = useLocation()
  const { pinned } = useAppNavigation()

  const user = session?.user
  const displayName = user?.name?.trim() || user?.email?.split('@')[0] || 'Você'
  const secondary = user?.email || 'Conta'
  const initial = displayName.charAt(0).toUpperCase()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    // A slim rail (icons only) that expands to the full width on hover. The
    // outer wrapper keeps reserving the collapsed width so the page never
    // reflows; the <aside> overlays the content when expanded. Desktop only —
    // touch devices get MobileNav (bottom bar + drawer) instead of this hover rail.
    <div className="group relative hidden shrink-0 lg:block" style={{ width: 'var(--rail-width-collapsed)' }}>
      <aside
        className="absolute inset-y-0 left-0 z-30 flex w-(--rail-width-collapsed) flex-col gap-4 overflow-hidden border-r px-3 py-4 transition-[width,box-shadow] duration-200 ease-out group-hover:w-(--rail-width) group-hover:overflow-y-auto group-hover:shadow-[0_16px_40px_rgba(22,24,31,.16)]"
        style={{ background: 'var(--surface-rail)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center justify-center gap-0 overflow-hidden pt-1 group-hover:justify-start group-hover:gap-2.5 group-hover:px-1.5">
          <Brand size={18} word={false} />
          <span className={COLLAPSE_FADE} style={{ display: 'inline-flex' }}>
            <Brand size={18} mark={false} />
          </span>
        </div>

        {bctx ? (
          <nav className="flex flex-col gap-2">
            <BuildingSwitcher />
            {navGroupsFor(bctx.activeFloorId, bctx.activeFloor?.name).map(({ group, label, items }) => (
              <div key={group} className="flex flex-col gap-1">
                {/* Hidden entirely (not just zero-width) in the slim rail so it
                    leaves no phantom row between icon groups; revealed on hover. */}
                <span className="hidden truncate group-hover:block" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-muted)', paddingLeft: 10, paddingTop: 4 }}>
                  {label}
                </span>
                {items.map((item) => {
                  const disabled = item.scope === 'floor' && !bctx.activeFloorId
                  return (
                    <Link
                      key={item.key}
                      to={disabled ? '/dashboard' : item.path(bctx.activeFloorId)}
                      className={`${ITEM_BASE} ${isNavActive(item, bctx.activeFloorId, pathname) ? ACTIVE : INACTIVE}`}
                      style={disabled ? { opacity: 0.5 } : undefined}
                    >
                      <Icon name={item.icon} size={18} />
                      <span className={LABEL}>{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            ))}
            {/* Apps the user pinned. Built from active installations + manifest
                pages + this user's preference — never from static config. */}
            <PinnedAppsNav apps={pinned} />
          </nav>
        ) : (
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => (
              <Link key={item.to} to={item.to} className={`${ITEM_BASE} ${item.to === current ? ACTIVE : INACTIVE}`}>
                <Icon name={item.icon} size={18} />
                <span className={LABEL}>{item.label}</span>
              </Link>
            ))}
          </nav>
        )}

        {/* User card — mirrors the design's Rail footer. Collapsed to the avatar
            until the rail expands. */}
        <div
          className="mt-auto flex items-center justify-center gap-0 overflow-hidden rounded-md p-1.5 group-hover:justify-start group-hover:gap-2.5"
          style={{ background: 'var(--surface-sunken)' }}
        >
          <span
            className="grid shrink-0 place-items-center rounded-full"
            style={{
              width: 32,
              height: 32,
              background: 'var(--intent-brand-soft)',
              color: 'var(--cobalt-700)',
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            {initial}
          </span>
          <div className={`flex min-w-0 flex-1 flex-col ${COLLAPSE_FADE}`}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {secondary}
            </span>
          </div>
          <div className={`flex items-center gap-0.5 ${COLLAPSE_FADE}`}>
            <IconButton icon="settings" label="Configurações" size="sm" onClick={() => navigate('/settings')} />
            <IconButton icon="log-out" label="Sair" size="sm" onClick={handleSignOut} />
          </div>
        </div>
      </aside>
    </div>
  )
}
