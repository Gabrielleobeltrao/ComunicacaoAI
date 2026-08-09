import { Link, useParams } from 'react-router'
import { SECTOR_SECTIONS } from '../lib/sectorSections'
import { ACTIVE, INACTIVE, ITEM_BASE, LABEL } from '../lib/sidebarStyles'
import { Icon } from '../ui'

const SECTION_ICONS: Record<string, string> = {
  '': 'layout-dashboard',
  configuracao: 'settings-2',
  testar: 'flask-conical',
}

export function SectorNav() {
  const { sectorId, section } = useParams()
  const base = `/setores/${sectorId}`
  const active = section ?? ''

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      <Link to="/setores" className={`${ITEM_BASE} ${INACTIVE}`}>
        <Icon name="chevron-left" size={18} />
        <span className={LABEL}>Setores</span>
      </Link>

      <div className="my-1 h-px bg-(--border-subtle)" />

      {SECTOR_SECTIONS.map((s) => (
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
