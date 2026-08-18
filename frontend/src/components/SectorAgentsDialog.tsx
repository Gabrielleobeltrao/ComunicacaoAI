import { useEffect, useMemo, useState } from 'react'
import { API_URL } from '../lib/api'
import { SectorApiError, assignAgentToSector } from '../lib/sectors'
import type { AgentSummary, SectorSummary } from '../lib/types'
import { Button, Dialog, Icon } from '../ui'

// Manage a sector's agents without leaving the overview (plan §7). Add (from the
// SAME floor) transfers the agent out of any other sector; remove is allowed even
// down to zero members. Not optimistic (an add can transfer from elsewhere): each
// row shows a loading state and the list refreshes from the server after success.
const MAX = 10

export function SectorAgentsDialog({
  open,
  onClose,
  sector,
  floorAgents,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  sector: SectorSummary
  floorAgents: AgentSummary[]
  onChanged: () => void | Promise<void>
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  // agentId -> the OTHER sector it currently belongs to (for the transfer hint).
  const [otherSectorByAgent, setOtherSectorByAgent] = useState<Map<string, string>>(new Map())

  const nameById = useMemo(() => new Map(floorAgents.map((a) => [a._id, a.name])), [floorAgents])
  const memberIds = useMemo(() => new Set(sector.members.map((m) => m.agentId)), [sector.members])
  const candidates = useMemo(() => floorAgents.filter((a) => !memberIds.has(a._id)), [floorAgents, memberIds])

  useEffect(() => {
    if (!open || !sector.floorId) return
    let cancelled = false
    fetch(`${API_URL}/api/sectors?floorId=${sector.floorId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: SectorSummary[]) => {
        if (cancelled) return
        const map = new Map<string, string>()
        for (const s of list) if (s._id !== sector._id) for (const m of s.members) map.set(m.agentId, s.name)
        setOtherSectorByAgent(map)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, sector.floorId, sector._id])

  async function run(action: () => Promise<void>, id: string) {
    setBusyId(id)
    setError('')
    try {
      await action()
      await onChanged()
    } catch (e) {
      setError(e instanceof SectorApiError ? e.message : 'Não foi possível concluir a ação.')
    } finally {
      setBusyId(null)
    }
  }

  const add = (agent: AgentSummary) => {
    const from = otherSectorByAgent.get(agent._id)
    if (from && !window.confirm(`${agent.name} sairá do setor "${from}" e entrará em "${sector.name}". Continuar?`)) return
    void run(async () => {
      const r = await assignAgentToSector(agent._id, sector._id)
      setStatus(r.previousSector ? `${agent.name} movido de ${r.previousSector.name} para ${sector.name}.` : `${agent.name} adicionado ao setor.`)
    }, agent._id)
  }

  const remove = (agentId: string) => {
    const name = nameById.get(agentId) ?? 'Agente'
    void run(async () => {
      await assignAgentToSector(agentId, null)
      setStatus(`${name} removido do setor.`)
    }, agentId)
  }

  const atLimit = sector.members.length >= MAX

  return (
    <Dialog open={open} onClose={onClose} title="Gerenciar agentes" subtitle={sector.name} width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '70dvh', overflowY: 'auto' }}>
        <p aria-live="polite" style={{ minHeight: 18, margin: 0, fontSize: 13, color: error ? 'var(--coral-600,#d92d20)' : 'var(--text-muted)' }}>
          {error || status}
        </p>

        <section>
          <h4 style={sectionTitle}>No setor ({sector.members.length})</h4>
          {sector.members.length === 0 ? (
            <p style={muted}>Nenhum agente ainda. Adicione agentes deste andar para colocar a sala em operação.</p>
          ) : (
            <ul style={listStyle}>
              {sector.members.map((m) => (
                <li key={m.agentId} style={row}>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="truncate" style={{ fontWeight: 600, color: 'var(--text-heading)' }}>{nameById.get(m.agentId) ?? 'Agente removido'}</span>
                    {m.isDefault && !sector.coordinatorAgentId ? <span style={pill}>Coordena (padrão)</span> : null}
                  </span>
                  <Button variant="ghost" size="sm" disabled={busyId === m.agentId} aria-label={`Remover ${nameById.get(m.agentId) ?? 'agente'} do setor`} onClick={() => remove(m.agentId)}>
                    {busyId === m.agentId ? 'Removendo…' : 'Remover'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 style={sectionTitle}>Adicionar deste andar</h4>
          {atLimit ? (
            <p style={muted}>O setor atingiu o máximo de {MAX} agentes.</p>
          ) : candidates.length === 0 ? (
            <p style={muted}>Todos os agentes deste andar já estão no setor.</p>
          ) : (
            <ul style={listStyle}>
              {candidates.map((a) => {
                const from = otherSectorByAgent.get(a._id)
                return (
                  <li key={a._id} style={row}>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span className="truncate" style={{ fontWeight: 600, color: 'var(--text-heading)' }}>{a.name}</span>
                      {from ? <span style={{ fontSize: 12, color: 'var(--mango-700,#b54708)' }}>Sairá de {from}</span> : a.objective ? <span className="truncate" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.objective}</span> : null}
                    </span>
                    <Button variant="secondary" size="sm" icon="plus" disabled={busyId === a._id} onClick={() => add(a)}>
                      {busyId === a._id ? 'Adicionando…' : 'Adicionar'}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {sector.mode === 'pipeline' && (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', display: 'flex', gap: 6 }}>
            <Icon name="info" size={14} />
            No modo fluxo, agentes novos entram como última etapa — abra a Configuração para definir a ordem e quando avançar.
          </p>
        )}
      </div>
    </Dialog>
  )
}

const sectionTitle: React.CSSProperties = { margin: '0 0 8px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }
const listStyle: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '6px 10px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }
const pill: React.CSSProperties = { fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, border: '1px solid var(--border-strong,#d0d5dd)', color: 'var(--text-muted)' }
const muted: React.CSSProperties = { margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }
