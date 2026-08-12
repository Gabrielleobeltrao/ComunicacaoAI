import { useState } from 'react'
import { Link } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { Elevator } from '../components/Elevator'
import { useFloors } from '../lib/useFloors'
import { createFloor } from '../lib/floors'
import { Button } from '../ui'

// Térreo — the building overview. Gated by featureFlags.aiBuilding. Lists the
// floors as cards and offers the elevator + "Criar andar". Additive: /dashboard
// and every existing route are untouched.
export function Building() {
  const { building, floors, activeFloorId, loading, error, reload, selectFloor } = useFloors()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [mission, setMission] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('Dê um nome ao andar.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      await createFloor({ name: trimmed, mission: mission.trim() || undefined })
      setName('')
      setMission('')
      setCreating(false)
      await reload()
    } catch {
      setFormError('Não foi possível criar o andar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppLayout
      current="/building"
      title={building?.name ?? 'Prédio'}
      subtitle="Visão geral do seu prédio operacional de IAs"
      actions={
        <Button icon="plus" onClick={() => setCreating((v) => !v)}>
          Criar andar
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {floors.length > 0 && (
          <Elevator floors={floors} activeFloorId={activeFloorId} onSelect={selectFloor} />
        )}

        {creating && (
          <form onSubmit={submit} style={cardStyle}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Nome do andar</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} style={inputStyle} autoFocus />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Missão (opcional)</span>
              <input value={mission} onChange={(e) => setMission(e.target.value)} maxLength={2000} style={inputStyle} />
            </label>
            {formError && <span style={{ color: 'var(--intent-danger, #d92d20)', fontSize: 13 }}>{formError}</span>}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="submit" disabled={saving}>
                {saving ? 'Criando…' : 'Criar'}
              </Button>
              <Button variant="ghost" type="button" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}

        {loading && <p style={{ color: 'var(--text-muted)' }}>Carregando andares…</p>}
        {error && <p style={{ color: 'var(--intent-danger, #d92d20)' }}>Não foi possível carregar o prédio.</p>}
        {!loading && !error && floors.length === 0 && (
          <p style={{ color: 'var(--text-muted)' }}>Nenhum andar ainda. Crie o primeiro para começar.</p>
        )}

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {floors.map((f) => (
            <Link key={f.id} to={`/floors/${f.id}`} style={{ ...cardStyle, textDecoration: 'none', color: 'inherit' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {f.color && <span style={{ width: 10, height: 10, borderRadius: '50%', background: f.color }} />}
                <strong style={{ fontSize: 15 }}>{f.name}</strong>
                {f.status === 'archived' && <span style={badgeStyle}>arquivado</span>}
              </div>
              {f.mission && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{f.mission}</span>}
            </Link>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 14,
  borderRadius: 'var(--radius-panel, 12px)',
  border: '1px solid var(--border-1, #e4e7ec)',
  background: 'var(--paper-0, #fff)',
}
const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600 }
const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 'var(--radius-field, 8px)',
  border: '1px solid var(--border-1, #d0d5dd)',
  background: 'var(--paper-0, #fff)',
  color: 'inherit',
  font: 'inherit',
}
const badgeStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '1px 6px',
  borderRadius: 999,
  background: 'var(--paper-2, #f2f4f7)',
  color: 'var(--text-muted)',
}
