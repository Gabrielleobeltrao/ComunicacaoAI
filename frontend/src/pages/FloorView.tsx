import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { archiveFloor, getFloor, getFloorActivity, restoreFloor } from '../lib/floors'
import type { Floor } from '../lib/floors'
import { Button } from '../ui'

// Floor detail. Gated by featureFlags.aiFloors. Shows the floor's mission,
// status and structural activity (agents + sectors); the visual map integration
// arrives with the office-live-status phase.
export function FloorView() {
  const { floorId } = useParams<{ floorId: string }>()
  const [floor, setFloor] = useState<Floor | null>(null)
  const [activity, setActivity] = useState<{ agentCount: number; sectorCount: number } | null>(null)
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
      current="/building"
      title={floor?.name ?? 'Andar'}
      subtitle={floor?.mission || 'Andar do prédio'}
      actions={
        <Link to="/building" style={{ textDecoration: 'none' }}>
          <Button variant="ghost" icon="arrow-left">
            Prédio
          </Button>
        </Link>
      }
    >
      {loading && <p style={{ color: 'var(--text-muted)' }}>Carregando andar…</p>}
      {error && <p style={{ color: 'var(--intent-danger, #d92d20)' }}>Não foi possível carregar o andar.</p>}
      {!loading && !error && floor && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: 'right' }}>{value}</span>
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
