import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { AGENT_CONFIG_SECTIONS, AGENT_SECTIONS } from '../lib/agentSections'
import { ACTIVE, COLLAPSE_FADE, INACTIVE, ITEM_BASE, LABEL } from '../lib/sidebarStyles'
import { Icon } from '../ui'

const SECTION_ICONS: Record<string, string> = {
  '': 'layout-dashboard',
  testar: 'flask-conical',
}
const CONFIG_ICONS: Record<string, string> = {
  essencial: 'sliders-horizontal',
  ferramentas: 'wrench',
  conhecimento: 'book-open',
  avancado: 'settings-2',
}

export function AgentNav() {
  const { agentId, section } = useParams()
  const [searchParams] = useSearchParams()
  const base = `/agents/${agentId}`
  const active = section ?? ''
  const configActive = AGENT_CONFIG_SECTIONS.some((s) => s.key === active)

  // Opened from a team? Then "back" returns to that team. The origin is carried
  // in ?from=... and preserved across the agent's own section links.
  const from = searchParams.get('from')
  const qs = from ? `?from=${encodeURIComponent(from)}` : ''
  const backTo = from ?? '/agents'
  const backLabel = from ? (from.startsWith('/teams') ? 'Equipe' : 'Voltar') : 'Agentes'

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
      <Link to={backTo} className={`${ITEM_BASE} ${INACTIVE}`}>
        <Icon name="chevron-left" size={18} />
        <span className={LABEL}>{backLabel}</span>
      </Link>

      <div className="my-1 h-px bg-(--border-subtle)" />

      {AGENT_SECTIONS.map((s) => (
        <Link
          key={s.key}
          to={`${s.key ? `${base}/${s.key}` : base}${qs}`}
          className={`${ITEM_BASE} ${active === s.key ? ACTIVE : INACTIVE}`}
        >
          <Icon name={SECTION_ICONS[s.key] ?? 'layout-dashboard'} size={18} />
          <span className={LABEL}>{s.label}</span>
        </Link>
      ))}

      <button
        type="button"
        onClick={toggleConfig}
        aria-expanded={configOpen}
        className={`${ITEM_BASE} mt-2 ${configActive && !configOpen ? ACTIVE : INACTIVE}`}
      >
        <Icon name="settings" size={18} />
        <span className={LABEL}>Configurações</span>
        <Icon
          name="chevron-right"
          size={16}
          className={`ml-auto transition-transform ${COLLAPSE_FADE}`}
          style={{ transform: configOpen ? 'rotate(90deg)' : undefined }}
        />
      </button>

      {configOpen &&
        AGENT_CONFIG_SECTIONS.map((s) => (
          <Link
            key={s.key}
            to={`${base}/${s.key}${qs}`}
            className={`${ITEM_BASE} group-hover:pl-7 ${active === s.key ? ACTIVE : INACTIVE}`}
          >
            <Icon name={CONFIG_ICONS[s.key] ?? 'settings-2'} size={17} style={{ opacity: 0.8 }} />
            <span className={`${LABEL} text-[13px]`}>{s.label}</span>
          </Link>
        ))}
    </nav>
  )
}
