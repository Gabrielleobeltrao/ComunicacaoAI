import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { archiveFloor, getFloor, getFloorActivity, getFloorMetrics, restoreFloor } from '../lib/floors'
import type { Floor, FloorMetrics } from '../lib/floors'
import { featureFlags } from '../featureFlags'
import { OfficeFloor } from '../office/OfficeFloor'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import { Button, MetricStat } from '../ui'

// Floor detail. Gated by featureFlags.aiFloors. Shows the floor's mission,
// status and structural activity (agents + sectors); the visual map integration
// arrives with the office-live-status phase.
export function FloorView() {
  const { floorId } = useParams<{ floorId: string }>()
  // Agents + sectors of THIS floor drive the visual map (the office simulation).
  const { agents, sectors } = useAgentsAndWidgets(floorId)
  const [floor, setFloor] = useState<Floor | null>(null)
  const [activity, setActivity] = useState<{ agentCount: number; sectorCount: number } | null>(null)
  const [metrics, setMetrics] = useState<FloorMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!floorId) return
    setLoading(true)
    setError(false)
    try {
      const [f, a] = await Promise.all([getFloor(floorId), getFloorActivity(floorId)])
      setFloor(f)
      setActivity(a)
      if (featureFlags.aiAutomations) setMetrics(await getFloorMetrics(floorId).catch(() => null))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [floorId])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleArchive() {
    if (!floor) return
    setBusy(true)
    try {
      const updated = floor.status === 'archived' ? await restoreFloor(floor.id) : await archiveFloor(floor.id)
      setFloor(updated)
    } catch {
      /* surfaced by the disabled state resetting */
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppLayout
      current="/dashboard"
      title={floor?.name ?? 'Andar'}
      subtitle={floor?.mission || 'Andar do prédio'}
    >
      {loading && <p style={{ color: 'var(--text-muted)' }}>Carregando andar…</p>}
      {error && <p style={{ color: 'var(--intent-danger, #d92d20)' }}>Não foi possível carregar o andar.</p>}
      {!loading && !error && floor && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* The most relevant floor numbers sit ABOVE the map, so a glance at the
              floor page reads its operational state before the visual. */}
          <FloorSummary activity={activity} metrics={metrics} />
          {/* The visual office map is the centre of the floor view (scoped). */}
          <OfficeFloor floorId={floor.id} agents={agents} sectors={sectors} />
          <div>
            <Button variant={floor.status === 'archived' ? 'primary' : 'danger'} disabled={busy} onClick={toggleArchive}>
              {floor.status === 'archived' ? 'Restaurar andar' : 'Arquivar andar'}
            </Button>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

// The relevant-numbers header above the map: structural stats always, plus
// automation health when that module is on.
function FloorSummary({
  activity,
  metrics,
}: {
  activity: { agentCount: number; sectorCount: number } | null
  metrics: FloorMetrics | null
}) {
  const successPct = metrics?.successRate == null ? null : Math.round(metrics.successRate * 100)
  return (
    <section
      aria-label="Resumo do andar"
      style={{ ...panel, display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(116px, 1fr))', padding: 18 }}
    >
      <MetricStat icon="users-round" label="Agentes" value={activity?.agentCount ?? '—'} />
      <MetricStat icon="network" label="Setores" value={activity?.sectorCount ?? '—'} />
      {metrics && (
        <>
          <MetricStat icon="loader" label="Rodando" value={metrics.running} />
          <MetricStat icon="workflow" label="Runs 24h" value={metrics.runsToday} />
          <MetricStat icon="circle-check" label="Sucesso" value={successPct ?? '—'} unit={successPct == null ? undefined : '%'} />
          <MetricStat
            icon="triangle-alert"
            label="Falhas 24h"
            value={metrics.failures24h}
            delta={metrics.failures24h > 0 ? 'atenção' : undefined}
            deltaTone="danger"
          />
        </>
      )}
    </section>
  )
}

const panel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: 14,
  borderRadius: 'var(--radius-panel, 12px)',
  border: '1px solid var(--border-1, #e4e7ec)',
  background: 'var(--paper-0, #fff)',
}
