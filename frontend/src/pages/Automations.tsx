import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { Elevator } from '../components/Elevator'
import { useFloors } from '../lib/useFloors'
import { createAutomation, listAutomations } from '../lib/automations'
import type { Automation } from '../lib/automations'
import { Button } from '../ui'

// Automations of the floor in the URL (canonical /floors/:floorId/automations).
// Falls back to the picked floor only on the legacy /automations route.
export function Automations() {
  const { floorId: urlFloorId } = useParams()
  const { floors, activeFloorId, selectFloor } = useFloors()
  const floorId = urlFloorId ?? activeFloorId
  const [items, setItems] = useState<Automation[]>([])
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    if (!floorId) return
    setLoading(true)
    try {
      setItems((await listAutomations(floorId)).items)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorId])

  async function create() {
    if (!floorId || !name.trim()) return
    setCreating(true)
    try {
      await createAutomation({ floorId, name: name.trim() })
      setName('')
      await load()
    } finally {
      setCreating(false)
    }
  }

  return (
    <AppLayout
      current="/automations"
      title="Automações"
      subtitle="Trabalhos que os agentes executam por gatilho, agenda ou webhook"
      actions={
        <Link to="/runs" style={{ textDecoration: 'none' }}>
          <Button variant="ghost" icon="history">
            Execuções
          </Button>
        </Link>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!urlFloorId && floors.length > 0 && <Elevator floors={floors} activeFloorId={activeFloorId} onSelect={selectFloor} />}

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome da nova automação"
            maxLength={160}
            style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-1, #d0d5dd)', font: 'inherit', background: 'var(--paper-0,#fff)', color: 'inherit' }}
          />
          <Button icon="plus" disabled={creating || !name.trim() || !activeFloorId} onClick={create}>
            Criar
          </Button>
        </div>

        {loading && <p style={{ color: 'var(--text-muted)' }}>Carregando…</p>}
        {!loading && items.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhuma automação neste andar ainda.</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((a) => (
            <Link
              key={a.id}
              to={`/automations/${a.id}`}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, border: '1px solid var(--border-1,#e4e7ec)', background: 'var(--paper-0,#fff)', textDecoration: 'none', color: 'inherit' }}
            >
              <span style={{ fontWeight: 600 }}>{a.name}</span>
              <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: 'var(--paper-2,#f2f4f7)', color: 'var(--text-muted)' }}>{a.status}</span>
            </Link>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}
