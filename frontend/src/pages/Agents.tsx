import { useEffect, useMemo, useState } from 'react'
import { AgentCard } from '../components/AgentCard'
import { HireWizard } from '../components/HireWizard'
import { AppLayout } from '../components/AppLayout'
import { buildCharacterResolver } from '../lib/agentAvatar'
import type { AgentStat } from '../lib/agentAvatar'
import { getAgentStats } from '../lib/agentStats'
import { formatCount, formatDuration, formatTokens } from '../lib/metricFormat'
import type { AgentOperationalStats } from '../lib/types'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import { useParams } from 'react-router'
import { Button, Dialog, EmptyState, Field, Input, Select } from '../ui'

const NO_SECTOR = '__none__'

// The three card metrics (fixed positions): average execution duration, tokens in
// the period, and the agent's specific KPI. Undefined stats (still loading) render
// as "—"; a null metric means "no telemetry" (also "—"), distinct from a real zero.
function buildStats(s: AgentOperationalStats | undefined): AgentStat[] {
  return [
    { label: 'Tempo méd.', value: formatDuration(s?.avgDurationMs), title: 'Duração média de uma execução (30 dias)' },
    { label: 'Tokens 30d', value: formatTokens(s?.totalTokens), title: 'Tokens de entrada + saída nos últimos 30 dias' },
    // Compact label on the card; the full definition rides in the tooltip.
    { label: s?.specific.shortLabel ?? 'KPI', value: formatCount(s?.specific.value), title: s?.specific.label ?? 'Indicador do agente (30 dias)' },
  ]
}

export function Agents() {
  const { floorId } = useParams()
  const { agents, agentsLoading, loadAgents, sectors } = useAgentsAndWidgets(floorId)
  const [isCreating, setIsCreating] = useState(false)
  const [agentStats, setAgentStats] = useState<Record<string, AgentOperationalStats> | null>(null)

  // Search + filters.
  const [search, setSearch] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterSector, setFilterSector] = useState('') // '' = all, sector name, or NO_SECTOR
  const [filterProvider, setFilterProvider] = useState('') // '' = all | 'anthropic' | 'openai'

  useEffect(() => {
    let cancelled = false
    getAgentStats('30d', floorId)
      .then((data) => {
        if (!cancelled) setAgentStats(data.stats)
      })
      .catch(() => {
        if (!cancelled) setAgentStats({})
      })
    return () => {
      cancelled = true
    }
  }, [floorId])

  // An agent belongs to at most one sector — map agentId -> sector name so each
  // card can show it (or "Sem setor" when orphan).
  const sectorByAgent = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of sectors) for (const m of s.members) map.set(m.agentId, s.name)
    return map
  }, [sectors])

  // Round-robin faces over the full team (built from all agents, not the filtered view).
  const chars = useMemo(() => buildCharacterResolver(agents.map((a) => a._id)), [agents])

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
        <Button icon="plus" aria-label="Contratar agente" onClick={() => setIsCreating(true)}>
          {/* Icon-only on narrow topbars so it never collides with the floor
              context + module title (plan §8.2). */}
          <span className="hidden sm:inline">Contratar agente</span>
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
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <Input
              icon="search"
              placeholder="Buscar agente"
              aria-label="Buscar agente"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 14 }}>
              {filtered.map((agent) => (
                <AgentCard
                  key={agent._id}
                  agent={agent}
                  portrait={chars.portrait(agent._id)}
                  sectorName={sectorByAgent.get(agent._id) ?? null}
                  stats={buildStats(agentStats ? agentStats[agent._id] : undefined)}
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

      <Dialog open={isCreating} onClose={() => setIsCreating(false)} title="Contratar agente" width={680}>
        <HireWizard
          floorId={floorId}
          agents={agents}
          sectors={sectors}
          onCancel={() => setIsCreating(false)}
          onHired={async () => {
            setIsCreating(false)
            await loadAgents()
          }}
        />
      </Dialog>
    </AppLayout>
  )
}
