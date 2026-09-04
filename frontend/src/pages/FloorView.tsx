import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { FloorSettingsDialog } from '../components/FloorSettingsDialog'
import { ExecutionAnalytics } from '../components/ExecutionAnalytics'
import { getFloor, getFloorActivity, getFloorMetrics } from '../lib/floors'
import type { Floor, FloorMetrics } from '../lib/floors'
import { featureFlags } from '../featureFlags'
import { useOptionalBuildingContext } from '../contexts/BuildingContext'
import { OfficeFloor } from '../office/OfficeFloor'
import { KnowledgeMap } from '../knowledge/KnowledgeMap'
import { FloorResources } from '../components/FloorResources'
import { useAgentsAndWidgets } from '../lib/useAgentsAndWidgets'
import { Button, MetricStat } from '../ui'

// Floor detail. Gated by featureFlags.aiFloors. Shows the floor's mission,
// status and structural activity (agents + sectors); the visual map integration
// arrives with the office-live-status phase.
export function FloorView() {
  const { floorId } = useParams<{ floorId: string }>()
  const navigate = useNavigate()
  /**
   * Escritório ou Conhecimento — na URL.
   *
   * Guardar a escolha só no estado faria um link compartilhado abrir sempre no mapa do
   * escritório, inclusive quando a pessoa mandou justamente o de conhecimento. `?view=`
   * é o que torna a visão compartilhável e reabrível.
   */
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'knowledge' ? 'knowledge' : 'office'
  const trocarVisao = (proxima: 'office' | 'knowledge') => {
    const p = new URLSearchParams(params)
    p.set('view', proxima)
    setParams(p, { replace: true })
  }
  const building = useOptionalBuildingContext()
  // Agents + sectors of THIS floor drive the visual map (the office simulation).
  const { agents, sectors } = useAgentsAndWidgets(floorId)
  const [floor, setFloor] = useState<Floor | null>(null)
  const [activity, setActivity] = useState<{ agentCount: number; sectorCount: number } | null>(null)
  const [metrics, setMetrics] = useState<FloorMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  return (
    <AppLayout
      current="/dashboard"
      title={floor?.name ?? 'Andar'}
      subtitle={floor?.mission || 'Andar do prédio'}
      actions={floor ? <Button variant="secondary" icon="settings" onClick={() => setSettingsOpen(true)}>Configurações do andar</Button> : undefined}
    >
      {loading && <p style={{ color: 'var(--text-muted)' }}>Carregando andar…</p>}
      {error && <p style={{ color: 'var(--intent-danger, #d92d20)' }}>Não foi possível carregar o andar.</p>}
      {!loading && !error && floor && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* The most relevant floor numbers sit ABOVE the map, so a glance at the
              floor page reads its operational state before the visual. */}
          <FloorSummary activity={activity} metrics={metrics} />

          {/* Duas leituras do MESMO andar: quem trabalha aqui, e o que se sabe aqui. */}
          <nav className="flex flex-wrap gap-2" role="tablist" aria-label="Visão do andar" data-testid="floor-view-switch">
            {([
              ['office', 'Escritório'],
              ['knowledge', 'Conhecimento'],
            ] as const).map(([chave, rotulo]) => (
              <button
                key={chave}
                type="button"
                role="tab"
                aria-selected={view === chave}
                onClick={() => trocarVisao(chave)}
                data-testid={`floor-view-${chave}`}
                style={{
                  minHeight: 40,
                  padding: '0 16px',
                  borderRadius: 999,
                  border: '1px solid var(--border-subtle)',
                  background: view === chave ? 'var(--intent-brand)' : 'var(--surface-card)',
                  color: view === chave ? '#fff' : 'var(--text-muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {rotulo}
              </button>
            ))}
          </nav>

          {/* Os RECURSOS deste andar. Não é uma segunda lista: é o mesmo catálogo,
              filtrado por contexto — e é por isso que ele nunca diverge do global. */}
          <FloorResources floorId={floor.id} />

          {/* O mapa do escritório continua exatamente o que era; a visão de conhecimento
              troca SÓ a área central, e não a página. */}
          {view === 'office' ? (
            <OfficeFloor floorId={floor.id} agents={agents} sectors={sectors} />
          ) : (
            <KnowledgeMap floorId={floor.id} floorName={floor.name} />
          )}
          {/* The SAME analytics service the building view reads, scoped to this
              floor — never a second formula. */}
          <ExecutionAnalytics
            floorId={floor.id}
            floors={[{ id: floor.id, name: floor.name }]}
            agents={agents.map((a) => ({ _id: a._id, name: a.name }))}
          />
        </div>
      )}

      {floor && (
        <FloorSettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          floor={floor}
          agents={agents}
          onSaved={(updated) => {
            setFloor(updated)
            void building?.reloadFloors()
          }}
          onDeleted={() => {
            setSettingsOpen(false)
            void building?.reloadFloors()
            navigate('/dashboard')
          }}
        />
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
