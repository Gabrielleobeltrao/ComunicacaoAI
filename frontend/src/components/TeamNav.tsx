import { Link, useParams } from 'react-router'
import { TEAM_SECTIONS } from '../lib/teamSections'
import { ACTIVE, INACTIVE, ITEM_BASE, LABEL } from '../lib/sidebarStyles'
import { Icon } from '../ui'

const SECTION_ICONS: Record<string, string> = {
  '': 'layout-dashboard',
  configuracao: 'settings-2',
  testar: 'flask-conical',
}

export function TeamNav() {
  const { teamId, section } = useParams()
  const base = `/teams/${teamId}`
  const active = section ?? ''

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      <Link to="/teams" className={`${ITEM_BASE} ${INACTIVE}`}>
        <Icon name="chevron-left" size={18} />
        <span className={LABEL}>Equipes</span>
      </Link>

      <div className="my-1 h-px bg-(--border-subtle)" />

      {TEAM_SECTIONS.map((s) => (
        <Link
          key={s.key}
          to={s.key ? `${base}/${s.key}` : base}
          className={`${ITEM_BASE} ${active === s.key ? ACTIVE : INACTIVE}`}
        >
          <Icon name={SECTION_ICONS[s.key] ?? 'layout-dashboard'} size={18} />
          <span className={LABEL}>{s.label}</span>
        </Link>
      ))}
    </nav>
  )
}
