import { useEffect, useMemo, useState } from 'react'
import { AgentCard } from '../components/AgentCard'
import { AgentForm } from '../components/AgentForm'
import { AppLayout } from '../components/AppLayout'
import type { AgentStat } from '../lib/agentAvatar'
import { API_URL } from '../lib/api'
import type { AgentCardStats } from '../lib/types'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import { Button, Dialog, EmptyState, Field, Input, Select } from '../ui'

const EMPTY_STATS: AgentCardStats = { conversations: 0, attendedConversations: 0, qualifiedLeads: 0 }
const NO_SECTOR = '__none__'

// Undefined stats (still loading) render as "—"; a loaded agent with no
// activity shows zeros.
function buildStats(s: AgentCardStats | undefined): AgentStat[] {
  const pct = s && s.conversations > 0 ? `${Math.round((s.attendedConversations / s.conversations) * 100)}%` : '—'
  return [
    { label: 'Conversas', value: s ? s.conversations.toLocaleString('pt-BR') : '—' },
    { label: 'Leads', value: s ? String(s.qualifiedLeads) : '—' },
    { label: 'Atend.', value: pct },
  ]
}

export function Agents() {
  const { agents, agentsLoading, loadAgents, sectors } = useAgentsAndWidgets()
  const [isCreating, setIsCreating] = useState(false)
  const [agentStats, setAgentStats] = useState<Record<string, AgentCardStats> | null>(null)

  // Search + filters.
  const [search, setSearch] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterSector, setFilterSector] = useState('') // '' = all, sector name, or NO_SECTOR
  const [filterProvider, setFilterProvider] = useState('') // '' = all | 'anthropic' | 'openai'

  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/api/agent-stats`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        if (!cancelled) setAgentStats(data)
      })
      .catch(() => {
        if (!cancelled) setAgentStats({})
      })
    return () => {
      cancelled = true
    }
  }, [])

  // An agent belongs to at most one sector — map agentId -> sector name so each
  // card can show it (or "Sem setor" when orphan).
  const sectorByAgent = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of sectors) for (const m of s.members) map.set(m.agentId, s.name)
    return map
  }, [sectors])

  const activeFilters = (filterSector ? 1 : 0) + (filterProvider ? 1 : 0)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return agents.filter((a) => {
      if (q && !`${a.name} ${a.objective || ''}`.toLowerCase().includes(q)) return false
      if (filterProvider && a.provider !== filterProvider) return false
      if (filterSector) {
        const sec = sectorByAgent.get(a._id) ?? null
        if (filterSector === NO_SECTOR ? sec !== null : sec !== filterSector) return false
      }
      return true
    })
  }, [agents, search, filterProvider, filterSector, sectorByAgent])

  function clearFilters() {
    setFilterSector('')
    setFilterProvider('')
  }
  function clearAll() {
    setSearch('')
    clearFilters()
  }

  return (
    <AppLayout
      current="/agents"
      title="Agentes"
      subtitle="Seu time de agentes de IA"
      actions={
        <Button icon="plus" onClick={() => setIsCreating(true)}>
          Contratar agente
        </Button>
      }
    >
      {agentsLoading ? (
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando agentes...</p>
      ) : agents.length === 0 ? (
        <EmptyState
          icon="users-round"
          title="Nenhum agente ainda"
          body="Contrate seu primeiro agente pra começar a montar seu time."
          action={
            <Button icon="plus" onClick={() => setIsCreating(true)}>
              Contratar agente
            </Button>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Toolbar: search + filter live in the page, not the topbar. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Input
              icon="search"
              placeholder="Buscar agente"
              aria-label="Buscar agente"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, maxWidth: 420 }}
            />
            <Button variant="secondary" icon="sliders-horizontal" onClick={() => setFilterOpen(true)}>
              {activeFilters > 0 ? `Filtros · ${activeFilters}` : 'Filtros'}
            </Button>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon="search-x"
              title="Nenhum agente encontrado"
              body="Ajuste a busca ou os filtros pra ver mais agentes."
              action={
                <Button variant="secondary" icon="x" onClick={clearAll}>
                  Limpar busca e filtros
                </Button>
              }
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {filtered.map((agent) => (
                <AgentCard
                  key={agent._id}
                  agent={agent}
                  sectorName={sectorByAgent.get(agent._id) ?? null}
                  stats={buildStats(agentStats ? (agentStats[agent._id] ?? EMPTY_STATS) : undefined)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={filterOpen} onClose={() => setFilterOpen(false)} title="Filtrar agentes" width={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Setor">
            <Select
              value={filterSector}
              onChange={(e) => setFilterSector(e.target.value)}
              options={[
                { value: '', label: 'Todos os setores' },
                ...sectors.map((s) => ({ value: s.name, label: s.name })),
                { value: NO_SECTOR, label: 'Sem setor' },
              ]}
            />
          </Field>
          <Field label="Provedor">
            <Select
              value={filterProvider}
              onChange={(e) => setFilterProvider(e.target.value)}
              options={[
                { value: '', label: 'Todos' },
                { value: 'anthropic', label: 'Anthropic' },
                { value: 'openai', label: 'OpenAI' },
              ]}
            />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
            <Button variant="ghost" onClick={clearFilters} disabled={activeFilters === 0}>
              Limpar filtros
            </Button>
            <Button onClick={() => setFilterOpen(false)}>Aplicar</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={isCreating} onClose={() => setIsCreating(false)} title="Novo agente" width={680}>
        <AgentForm
          agent={null}
          onSaved={async () => {
            setIsCreating(false)
            await loadAgents()
          }}
        />
      </Dialog>
    </AppLayout>
  )
}
