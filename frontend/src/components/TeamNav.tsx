import type { ReactElement } from 'react'
import { Link, useParams } from 'react-router'
import { TEAM_SECTIONS } from '../lib/teamSections'
import { ACTIVE, INACTIVE, ITEM_BASE, LABEL } from '../lib/sidebarStyles'

type IconProps = { className?: string }
const svg = (children: ReactElement | ReactElement[]) =>
  function Icon({ className }: IconProps) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
        {children}
      </svg>
    )
  }

const BackIcon = svg(<path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />)
const OverviewIcon = svg([
  <rect key="a" x="3" y="3" width="7" height="9" rx="1.5" />,
  <rect key="b" x="14" y="3" width="7" height="5" rx="1.5" />,
  <rect key="c" x="14" y="12" width="7" height="9" rx="1.5" />,
  <rect key="d" x="3" y="16" width="7" height="5" rx="1.5" />,
])
const ConfigIcon = svg([
  <circle key="a" cx="12" cy="12" r="3" />,
  <path
    key="b"
    d="M12 2.5v2M12 19.5v2M4.6 7.2l1.7 1M17.7 15.8l1.7 1M4.6 16.8l1.7-1M17.7 8.2l1.7-1M2.5 12h2M19.5 12h2"
    strokeLinecap="round"
  />,
])
const TestIcon = svg(
  <path
    d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4v-4Z"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
)

const SECTION_ICONS: Record<string, (props: IconProps) => ReactElement> = {
  '': OverviewIcon,
  configuracao: ConfigIcon,
  testar: TestIcon,
}

export function TeamNav() {
  const { teamId, section } = useParams()
  const base = `/teams/${teamId}`
  const active = section ?? ''

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      <Link to="/teams" className={`${ITEM_BASE} ${INACTIVE}`}>
        <BackIcon className="h-5 w-5 shrink-0" />
        <span className={LABEL}>Equipes</span>
      </Link>

      <div className="my-1 h-px bg-slate-800" />

      {TEAM_SECTIONS.map((s) => {
        const Icon = SECTION_ICONS[s.key]
        return (
          <Link
            key={s.key}
            to={s.key ? `${base}/${s.key}` : base}
            className={`${ITEM_BASE} ${active === s.key ? ACTIVE : INACTIVE}`}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className={LABEL}>{s.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
