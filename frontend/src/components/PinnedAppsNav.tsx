import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ACTIVE, COLLAPSE_FADE, INACTIVE, ITEM_BASE, LABEL } from '../lib/sidebarStyles'
import { Icon } from '../ui'
import { defaultPathFor } from '../lib/appNavigation'
import type { NavigationApp } from '../lib/appNavigation'
import { AppLogo } from './AppLogo'

// The "Apps fixados" group. One entry per pinned App; clicking the name opens its
// default page, the chevron expands every page the App offers. There is no pinning
// of individual sub-pages — an App is pinned whole or not at all.

export function PinnedAppsNav({ apps }: { apps: NavigationApp[] }) {
  const { pathname } = useLocation()
  if (apps.length === 0) return null

  return (
    <div className="flex flex-col gap-1" data-testid="pinned-apps">
      <span
        className="hidden truncate group-hover:block"
        style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-muted)', paddingLeft: 10, paddingTop: 4 }}
      >
        APPS FIXADOS
      </span>
      {apps.map((app) => (
        <PinnedApp key={app.appKey} app={app} pathname={pathname} />
      ))}
    </div>
  )
}

function PinnedApp({ app, pathname }: { app: NavigationApp; pathname: string }) {
  // Opens automatically when one of its pages is the current route; the rest is a
  // local preference, not something worth persisting.
  const containsActive = app.surfaces.some((s) => pathname === s.path)
  const [open, setOpen] = useState(containsActive)
  const expanded = open || containsActive
  const single = app.surfaces.length === 1

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center">
        <Link
          to={defaultPathFor(app)}
          className={`${ITEM_BASE} ${containsActive ? ACTIVE : INACTIVE} flex-1`}
          data-testid={`pinned-app-${app.appKey}`}
        >
          {/* O MESMO símbolo do catálogo. Antes ia `app.icon` direto para o Icon,
              que carrega glifos do Lucide — e o Lucide não tem logo de marca, então
              WhatsApp, Slack e companhia apareciam em branco aqui. */}
          <AppLogo appKey={app.appKey} icon={app.icon} size={18} plain />
          <span className={LABEL}>{app.name}</span>
          {app.status === 'needs_reauth' ? (
            <span className={COLLAPSE_FADE} style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--intent-warning, #b54708)' }}>
              reconectar
            </span>
          ) : null}
        </Link>
        {single ? null : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Recolher' : 'Expandir'} páginas de ${app.name}`}
            className={`${COLLAPSE_FADE} shrink-0 rounded-md p-1`}
            style={{ background: 'none', border: 0, color: 'var(--text-muted)', cursor: 'pointer' }}
            data-testid={`toggle-${app.appKey}`}
          >
            <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
          </button>
        )}
      </div>

      {expanded && !single ? (
        <div className="hidden flex-col gap-0.5 group-hover:flex" style={{ paddingLeft: 18 }}>
          {app.surfaces.map((surface) => (
            <Link
              key={surface.key}
              to={surface.path}
              className={`${ITEM_BASE} ${pathname === surface.path ? ACTIVE : INACTIVE}`}
              style={{ fontSize: 13 }}
              data-testid={`surface-${app.appKey}-${surface.key}`}
            >
              <span className={LABEL}>{surface.label}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
