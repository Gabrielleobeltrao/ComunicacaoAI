import { useEffect, useMemo, useState } from 'react'
import { API_URL } from '../lib/api'
import type { AgentSummary, DelegationPolicy } from '../lib/types'
import { Button, Card } from '../ui'
import { reachFromPool } from '../lib/agentReadiness'

// "Colaboração": who this agent can call, and who can call it — in the words the
// user thinks in. The technical fields (delegationPolicy, callerPolicy and the id
// lists) are persisted, never shown.
//
// The candidate list comes from the backend, scoped to the agent's BUILDING (any
// floor), so a colleague one floor up is selectable here even though the roster page
// lists a single floor. The backend re-validates everything it receives.

export interface CollaboratorOption {
  _id: string
  name: string
  preset?: string
  floorName?: string | null
  acceptsCall?: boolean
}
export interface CollaboratorSectorOption {
  _id: string
  name: string
  floorName?: string | null
}
export interface CollaboratorPool {
  buildingId: string
  agents: CollaboratorOption[]
  sectors: CollaboratorSectorOption[]
}

export const getCollaboratorPool = (agentId: string): Promise<CollaboratorPool> =>
  fetch(`${API_URL}/api/agents/${agentId}/collaborators`, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.json() as Promise<CollaboratorPool>
  })

const OUTGOING: { value: DelegationPolicy; label: string; help: string }[] = [
  { value: 'none', label: 'Ninguém', help: 'Ele trabalha sozinho.' },
  { value: 'all', label: 'Qualquer colega do prédio', help: 'Ele escolhe quem chamar conforme a tarefa.' },
  { value: 'selected', label: 'Só quem eu escolher', help: 'Ele só pode chamar os marcados abaixo.' },
]
const INCOMING: { value: DelegationPolicy; label: string; help: string }[] = [
  { value: 'none', label: 'Ninguém', help: 'Nenhum outro agente pode acioná-lo.' },
  { value: 'all', label: 'Qualquer colega do prédio', help: 'Qualquer agente do prédio pode pedir ajuda a ele.' },
  { value: 'selected', label: 'Só quem eu escolher', help: 'Só os marcados abaixo podem acioná-lo.' },
]

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

function Choice({ on, label, help, onClick }: { on: boolean; label: string; help: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        textAlign: 'left',
        padding: '10px 12px',
        borderRadius: 'var(--radius-control)',
        border: `1px solid ${on ? 'var(--intent-brand)' : 'var(--border-subtle)'}`,
        background: on ? 'var(--intent-brand-soft)' : 'var(--surface-card)',
        color: on ? 'var(--text-heading)' : 'var(--text-heading)',
        cursor: 'pointer',
        fontFamily: 'var(--font-ui)',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 12, color: on ? 'var(--text-heading)' : 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{help}</div>
    </button>
  )
}

function PickList({
  items,
  selected,
  onToggle,
  emptyText,
  testId,
}: {
  items: { _id: string; name: string; floorName?: string | null; acceptsCall?: boolean }[]
  selected: string[]
  onToggle: (id: string) => void
  emptyText: string
  testId: string
}) {
  if (items.length === 0) return <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{emptyText}</p>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))', gap: 8 }} data-testid={testId}>
      {items.map((it) => (
        <label
          key={it._id}
          style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border-subtle)', cursor: 'pointer', minWidth: 0 }}
        >
          <input type="checkbox" checked={selected.includes(it._id)} onChange={() => onToggle(it._id)} style={{ marginTop: 3 }} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--text-heading)' }}>{it.name}</span>
            {it.floorName ? <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>{it.floorName}</span> : null}
            {it.acceptsCall === false ? (
              // Selecting is still allowed — the colleague's own setting is what
              // blocks it, and saying so is more useful than hiding the option.
              <span style={{ display: 'block', fontSize: 12, color: 'var(--mango-700, #b54708)' }}>não aceita chamadas hoje</span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  )
}

export function CollaborationEditor({ agent, onSaved }: { agent: AgentSummary; onSaved: () => void | Promise<void> }) {
  const [pool, setPool] = useState<CollaboratorPool | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [canCall, setCanCall] = useState<DelegationPolicy>(agent.delegationPolicy ?? 'none')
  const [calledBy, setCalledBy] = useState<DelegationPolicy>(agent.callerPolicy ?? 'all')
  const [agentIds, setAgentIds] = useState<string[]>(agent.callableAgentIds ?? [])
  const [sectorIds, setSectorIds] = useState<string[]>(agent.callableSectorIds ?? [])
  const [callerIds, setCallerIds] = useState<string[]>(agent.allowedCallerAgentIds ?? [])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Arriving from a checklist/readiness action ("…#colaboracao") lands on the editor
  // itself, not at the top of the tab.
  useEffect(() => {
    if (window.location.hash === '#colaboracao') document.getElementById('colaboracao')?.scrollIntoView({ block: 'start' })
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoadError(false)
    getCollaboratorPool(agent._id)
      .then((p) => {
        if (!cancelled) setPool(p)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [agent._id])

  // How many colleagues this configuration really reaches — the same rule the backend
  // applies, so the editor never promises a reach readiness will refuse. A colleague
  // that refuses calls is listed but not counted.
  const reach = useMemo(
    () => reachFromPool(canCall, pool ?? { agents: [], sectors: [] }, agentIds, sectorIds),
    [canCall, pool, agentIds, sectorIds],
  )

  const save = async () => {
    setSaving(true)
    setResult(null)
    try {
      const res = await fetch(`${API_URL}/api/agents/${agent._id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delegationPolicy: canCall,
          callerPolicy: calledBy,
          callableAgentIds: canCall === 'selected' ? agentIds : [],
          callableSectorIds: canCall === 'selected' ? sectorIds : [],
          allowedCallerAgentIds: calledBy === 'selected' ? callerIds : [],
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setResult({ ok: false, message: (body as { error?: string }).error ?? 'Não foi possível salvar.' })
        return
      }
      // The backend may have dropped references it refused — adopt what it stored.
      const saved = (await res.json()) as AgentSummary
      setAgentIds(saved.callableAgentIds ?? [])
      setSectorIds(saved.callableSectorIds ?? [])
      setCallerIds(saved.allowedCallerAgentIds ?? [])
      setResult({ ok: true, message: 'Colaboração salva.' })
      await onSaved()
    } catch {
      setResult({ ok: false, message: 'Não foi possível salvar.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div id="colaboracao" data-testid="collaboration-editor" style={{ display: 'grid', gap: 14 }}>
      <div>
        <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Colaboração</h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Com quem ele trabalha. Vale para todo o prédio, em qualquer andar.</p>
      </div>

      {loadError ? <p style={{ margin: 0, fontSize: 13, color: 'var(--coral-600, #d92d20)' }}>Não foi possível carregar os colegas.</p> : null}

      <Card padding="14px 16px" style={{ display: 'grid', gap: 10 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-heading)' }}>Quem este agente pode acionar</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 8 }} data-testid="can-call-options">
          {OUTGOING.map((o) => (
            <Choice key={o.value} on={canCall === o.value} label={o.label} help={o.help} onClick={() => setCanCall(o.value)} />
          ))}
        </div>
        {canCall === 'selected' ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6 }}>Colegas</span>
              <PickList items={pool?.agents ?? []} selected={agentIds} onToggle={(id) => setAgentIds((l) => toggle(l, id))} emptyText="Nenhum outro agente neste prédio ainda." testId="pick-agents" />
            </div>
            <div>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6 }}>Equipes</span>
              <PickList items={pool?.sectors ?? []} selected={sectorIds} onToggle={(id) => setSectorIds((l) => toggle(l, id))} emptyText="Nenhuma equipe que execute trabalho neste prédio." testId="pick-sectors" />
            </div>
          </div>
        ) : null}
        <span style={{ fontSize: 12.5, color: reach === 0 ? 'var(--mango-700, #b54708)' : 'var(--text-muted)' }} data-testid="collaboration-reach">
          {reach === 0 ? 'Hoje ele não alcança ninguém.' : `Hoje ele alcança ${reach} ${reach === 1 ? 'colega/equipe' : 'colegas/equipes'}.`}
        </span>
      </Card>

      <Card padding="14px 16px" style={{ display: 'grid', gap: 10 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-heading)' }}>Quem pode acionar este agente</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 8 }} data-testid="called-by-options">
          {INCOMING.map((o) => (
            <Choice key={o.value} on={calledBy === o.value} label={o.label} help={o.help} onClick={() => setCalledBy(o.value)} />
          ))}
        </div>
        {calledBy === 'selected' ? (
          <PickList items={pool?.agents ?? []} selected={callerIds} onToggle={(id) => setCallerIds((l) => toggle(l, id))} emptyText="Nenhum outro agente neste prédio ainda." testId="pick-callers" />
        ) : null}
      </Card>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button onClick={() => void save()} disabled={saving} data-testid="collaboration-save">
          {saving ? 'Salvando…' : 'Salvar colaboração'}
        </Button>
        {result ? (
          <span style={{ fontSize: 13, color: result.ok ? 'var(--emerald-700, #067647)' : 'var(--coral-600, #d92d20)' }} data-testid="collaboration-result">
            {result.message}
          </span>
        ) : null}
      </div>
    </div>
  )
}
