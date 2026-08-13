import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { archiveFloor, getBuildingOverview, getFloor, getFloorActivity, getFloorMetrics, restoreFloor } from '../lib/floors'
import type { BuildingOverview, Floor, FloorMetrics } from '../lib/floors'
import { featureFlags } from '../featureFlags'
import { OfficeFloor } from '../office/OfficeFloor'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import { Button } from '../ui'

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
  // Building-wide summary (the merged overview) shown compactly at the top.
  const [overview, setOverview] = useState<BuildingOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    getBuildingOverview()
      .then((o) => alive && setOverview(o))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

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
          {/* Building-wide summary (merged overview). Switching floors is done from
              the building selector in the sidebar — not from this page. */}
          {overview && (
            <div>
              <SectionLabel>Prédio</SectionLabel>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
                <Tile label="Andares" value={overview.totals.floors} />
                <Tile label="Agentes" value={overview.totals.agents} />
                <Tile label="Setores" value={overview.totals.sectors} />
                <Tile label="Automações ativas" value={overview.totals.automationsActive} />
                <Tile label="Execuções ativas" value={overview.totals.runsActive} />
                <Tile label="Falhas (24h)" value={overview.totals.failures24h} />
              </div>
            </div>
          )}
          <SectionLabel>Este andar</SectionLabel>
          {/* The visual office map is the centre of the floor view (scoped). */}
          <OfficeFloor floorId={floor.id} agents={agents} sectors={sectors} />
          <div style={panel}>
            <Row label="Status" value={floor.status === 'archived' ? 'Arquivado' : 'Ativo'} />
            <Row label="Fuso horário" value={floor.timezone} />
            <Row label="Idioma" value={floor.defaultLanguage} />
            {floor.description && <Row label="Descrição" value={floor.description} />}
          </div>
          <div style={panel}>
            <Row label="Agentes" value={String(activity?.agentCount ?? '—')} />
            <Row label="Setores" value={String(activity?.sectorCount ?? '—')} />
          </div>
          {metrics && (
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
              <Tile label="Automações ativas" value={metrics.automationsActive} />
              <Tile label="Runs (24h)" value={metrics.runsToday} />
              <Tile label="Em andamento" value={metrics.running} />
              <Tile label="Falhas (24h)" value={metrics.failures24h} />
              <Tile label="Taxa de sucesso" value={metrics.successRate == null ? '—' : `${Math.round(metrics.successRate * 100)}%`} />
              <Tile label="Entregáveis (24h)" value={metrics.recentArtifacts} />
            </div>
          )}
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

function SectionLabel({ children }: { children: string }) {
  return (
    <h2 style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
      {children}
    </h2>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ ...panel, gap: 2 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      <strong style={{ fontSize: 20 }}>{value}</strong>
    </div>
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
