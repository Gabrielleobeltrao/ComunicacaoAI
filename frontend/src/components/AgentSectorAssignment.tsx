import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { API_URL } from '../lib/api'
import { SectorApiError, assignAgentToSector } from '../lib/sectors'
import { floorSector } from '../lib/floorRoutes'
import type { SectorSummary } from '../lib/types'
import { Card, Icon, Select } from '../ui'

// Change an agent's sector from the agent page (plan §8). The selector offers only
// sectors of the AGENT'S floor plus "Sem setor"; choosing one moves the agent
// (transferring it out of any previous sector), choosing "Sem setor" removes it.
// The current sector is derived from the floor's sectors (an agent is in ≤ 1).
export function AgentSectorAssignment({ agentId, floorId, floorName, onChanged }: { agentId: string; floorId: string | null; floorName: string; onChanged?: () => void | Promise<void> }) {
  const [sectors, setSectors] = useState<SectorSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!floorId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const r = await fetch(`${API_URL}/api/sectors?floorId=${floorId}`, { credentials: 'include' })
      setSectors(r.ok ? await r.json() : [])
    } catch {
      setSectors([])
    } finally {
      setLoading(false)
    }
  }, [floorId])
  useEffect(() => {
    void load()
  }, [load])

  const current = sectors.find((s) => s.members.some((m) => m.agentId === agentId)) ?? null
  const needsConfig = current?.mode === 'pipeline'

  async function change(nextSectorId: string | null) {
    setBusy(true)
    setError('')
    try {
      const r = await assignAgentToSector(agentId, nextSectorId)
      setStatus(
        r.currentSector
          ? r.previousSector
            ? `Movido de ${r.previousSector.name} para ${r.currentSector.name}.`
            : `Adicionado a ${r.currentSector.name}.`
          : r.previousSector
            ? `Removido de ${r.previousSector.name}.`
            : 'Sem setor.',
      )
      await load()
      await onChanged?.()
    } catch (e) {
      setError(e instanceof SectorApiError ? e.message : 'Não foi possível trocar o setor.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Setor</span>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>Andar: {floorName}</p>

      <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Setor do agente
        <Select
          value={current?._id ?? ''}
          disabled={busy || loading || !floorId}
          aria-label="Setor do agente"
          onChange={(e) => void change(e.target.value || null)}
          options={[{ value: '', label: 'Sem setor' }, ...sectors.map((s) => ({ value: s._id, label: s.name }))]}
        />
      </label>

      {current ? (
        <Link to={floorId ? floorSector(floorId, current._id) : `/setores/${current._id}`} style={{ fontSize: 13, color: 'var(--intent-brand,#2e5bff)', textDecoration: 'none' }}>
          Abrir setor →
        </Link>
      ) : null}

      {needsConfig ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mango-700,#b54708)', display: 'flex', gap: 6 }}>
          <Icon name="info" size={14} />
          Setor em fluxo — configure a etapa deste agente na página do setor.
        </p>
      ) : null}

      <p aria-live="polite" style={{ minHeight: 16, margin: 0, fontSize: 12.5, color: error ? 'var(--coral-600,#d92d20)' : 'var(--text-muted)' }}>
        {error || status}
      </p>
    </Card>
  )
}
