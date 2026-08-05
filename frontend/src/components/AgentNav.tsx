import { useState } from 'react'
import type { ReactElement } from 'react'
import { Link, useParams } from 'react-router'
import { AGENT_CONFIG_SECTIONS, AGENT_SECTIONS } from '../lib/agentSections'
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
const TestIcon = svg(
  <path
    d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4v-4Z"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
)
const ConfigIcon = svg([
  <circle key="a" cx="12" cy="12" r="3" />,
  <path
    key="b"
    d="M12 2.5v2M12 19.5v2M4.6 7.2l1.7 1M17.7 15.8l1.7 1M4.6 16.8l1.7-1M17.7 8.2l1.7-1M2.5 12h2M19.5 12h2"
    strokeLinecap="round"
  />,
])
const BasicIcon = svg([
  <rect key="a" x="4.5" y="3" width="15" height="18" rx="2" />,
  <path key="b" d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />,
])
const StyleIcon = svg(
  <path
    d="M12 3l2.1 4.9L19 9l-4 3.4L16 18l-4-2.6L8 18l1-5.6L5 9l4.9-1.1L12 3Z"
    strokeLinejoin="round"
  />,
)
const MemoryIcon = svg([
  <ellipse key="a" cx="12" cy="6" rx="7" ry="3" />,
  <path key="b" d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />,
])
const GuardrailIcon = svg(
  <path d="M12 3l7 3v5c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3Z" strokeLinejoin="round" />,
)
const IdentityIcon = svg([
  <circle key="a" cx="12" cy="9" r="3" />,
  <path key="b" d="M5.5 20a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />,
])
const DataIcon = svg([
  <rect key="a" x="3.5" y="4" width="17" height="16" rx="2" />,
  <path key="b" d="M3.5 9h17M9 9v11M15 9v11" />,
])
const KnowledgeIcon = svg(
  <path
    d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 1 5 18.5v-14ZM5 17.5A1.5 1.5 0 0 1 6.5 16H19"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
)
const ChevronIcon = svg(<path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />)

const SECTION_ICONS: Record<string, (props: IconProps) => ReactElement> = {
  '': OverviewIcon,
  testar: TestIcon,
}
const CONFIG_ICONS: Record<string, (props: IconProps) => ReactElement> = {
  basico: BasicIcon,
  estilo: StyleIcon,
  memoria: MemoryIcon,
  guardrails: GuardrailIcon,
  identificacao: IdentityIcon,
  dados: DataIcon,
  conhecimento: KnowledgeIcon,
}

export function AgentNav() {
  const { agentId, section } = useParams()
  const base = `/agents/${agentId}`
  const active = section ?? ''
  const configActive = AGENT_CONFIG_SECTIONS.some((s) => s.key === active)

  // Collapsible "Configurações" group; persisted, defaults open.
  const [configOpen, setConfigOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('agent-config-open') !== 'false'
    } catch {
      return true
    }
  })
  function toggleConfig() {
    setConfigOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem('agent-config-open', String(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      <Link to="/agents" className={`${ITEM_BASE} ${INACTIVE}`}>
        <BackIcon className="h-5 w-5 shrink-0" />
        <span className={LABEL}>Agentes</span>
      </Link>

      <div className="my-1 h-px bg-slate-800" />

      {AGENT_SECTIONS.map((s) => {
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

      <button
        type="button"
        onClick={toggleConfig}
        aria-expanded={configOpen}
        className={`${ITEM_BASE} mt-2 ${configActive && !configOpen ? ACTIVE : INACTIVE}`}
      >
        <ConfigIcon className="h-5 w-5 shrink-0" />
        <span className={LABEL}>Configurações</span>
        <ChevronIcon
          className={`ml-auto h-4 w-4 shrink-0 opacity-0 transition-[transform,opacity] duration-150 group-hover:opacity-100 ${
            configOpen ? 'rotate-90' : ''
          }`}
        />
      </button>

      {configOpen &&
        AGENT_CONFIG_SECTIONS.map((s) => {
          const Icon = CONFIG_ICONS[s.key]
          return (
            <Link
              key={s.key}
              to={`${base}/${s.key}`}
              className={`${ITEM_BASE} group-hover:pl-7 ${active === s.key ? ACTIVE : INACTIVE}`}
            >
              <Icon className="h-4.5 w-4.5 shrink-0 opacity-80" />
              <span className={`${LABEL} text-[13px]`}>{s.label}</span>
            </Link>
          )
        })}
    </nav>
  )
}
