import { useCallback, useEffect, useState } from 'react'
import { API_URL } from '../lib/api'
import type { Floor } from '../lib/floors'
import { Button, Dialog } from '../ui'

// The building's own settings, opened from the sidebar gear — not a page.
//
// What lives here is what belongs to the BUILDING: its name and, above all, which
// floors may talk to which. A link only opens the PATH; it grants no access to an
// agent or a sector and overrides no policy. That sentence is on screen, because the
// difference is exactly what someone gets wrong.

export type CommunicationMode = 'isolated' | 'all' | 'selected'

interface FloorLink {
  fromFloorId: string
  toFloorId: string
  direction: 'one_way' | 'both'
}

interface CommunicationConfig {
  mode: CommunicationMode
  links: FloorLink[]
}

const MODES: { key: CommunicationMode; title: string; help: string }[] = [
  { key: 'isolated', title: 'Andares isolados', help: 'Nenhuma chamada cruza andares.' },
  { key: 'all', title: 'Todos colaboram', help: 'Qualquer andar ativo pode se comunicar, ainda sujeito às permissões de agentes e setores.' },
  { key: 'selected', title: 'Conexões escolhidas', help: 'Somente os caminhos que você criar permitem comunicação entre andares.' },
]

const get = async <T,>(path: string): Promise<T> => {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error('falhou')
  return (await res.json()) as T
}

export function BuildingSettingsDialog({
  open,
  onClose,
  buildingName,
  floors,
}: {
  open: boolean
  onClose: () => void
  buildingName: string
  floors: Floor[]
}) {
  const [config, setConfig] = useState<CommunicationConfig>({ mode: 'all', links: [] })
  const [impact, setImpact] = useState<{ blocked: { callerName: string; targetName: string }[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<FloorLink>({ fromFloorId: '', toFloorId: '', direction: 'one_way' })

  const active = floors.filter((f) => f.status === 'active')
  const nameOf = (id: string) => active.find((f) => f.id === id)?.name ?? 'Andar removido'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setConfig(await get<CommunicationConfig>('/api/building/floor-communication'))
    } catch {
      setError('Não foi possível carregar as conexões entre andares.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // What a mode would block is asked BEFORE saving it.
  const previewImpact = useCallback(async (mode: CommunicationMode) => {
    try {
      setImpact(await get(`/api/building/floor-communication/impact?mode=${mode}`))
    } catch {
      setImpact(null)
    }
  }, [])

  const save = async (next: CommunicationConfig) => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/building/floor-communication`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? 'Não foi possível salvar.')
      }
      setConfig((await res.json()) as CommunicationConfig)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const addLink = () => {
    if (!draft.fromFloorId || !draft.toFloorId || draft.fromFloorId === draft.toFloorId) return
    void save({ ...config, links: [...config.links, draft] })
    setDraft({ fromFloorId: '', toFloorId: '', direction: 'one_way' })
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Configurações de ${buildingName}`} width={620}>
      <div style={{ display: 'grid', gap: 16 }} data-testid="building-settings">
        <section style={{ display: 'grid', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-heading)' }}>Comunicação entre andares</h3>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            A conexão só abre o caminho. Ela não dá acesso a um agente ou setor, não adiciona ferramentas e não ignora as permissões deles.
          </p>

          {loading ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Carregando…</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {MODES.map((m) => (
                <label
                  key={m.key}
                  data-testid={`communication-${m.key}`}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: 10,
                    borderRadius: 10,
                    cursor: 'pointer',
                    border: `1px solid ${config.mode === m.key ? 'var(--intent-brand)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <input
                    type="radio"
                    name="floor-communication"
                    checked={config.mode === m.key}
                    onChange={() => {
                      void previewImpact(m.key)
                      void save({ ...config, mode: m.key })
                    }}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text-heading)' }}>{m.title}</span>
                    <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)' }}>{m.help}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {impact && impact.blocked.length > 0 ? (
            <div style={{ padding: 10, borderRadius: 10, background: 'var(--surface-sunken)' }} data-testid="communication-impact">
              <p style={{ margin: '0 0 4px', fontSize: 12.5, fontWeight: 700, color: 'var(--text-heading)' }}>
                {impact.blocked.length} referência(s) deixariam de funcionar:
              </p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {impact.blocked.slice(0, 6).map((b, i) => (
                  <li key={`${b.callerName}:${b.targetName}:${i}`} style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {b.callerName} → {b.targetName}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {config.mode === 'selected' ? (
            <div style={{ display: 'grid', gap: 8 }} data-testid="floor-links">
              {config.links.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>Nenhuma conexão ainda: os andares não se falam.</p>
              ) : (
                config.links.map((link, i) => (
                  <div key={`${link.fromFloorId}:${link.toFloorId}:${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span>
                      {nameOf(link.fromFloorId)} {link.direction === 'both' ? '↔' : '→'} {nameOf(link.toFloorId)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void save({ ...config, links: config.links.filter((_, index) => index !== i) })}
                      style={{ background: 'none', border: 0, color: 'var(--intent-brand)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}
                    >
                      remover
                    </button>
                  </div>
                ))
              )}

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={draft.fromFloorId} onChange={(e) => setDraft({ ...draft, fromFloorId: e.target.value })} aria-label="Andar de origem" style={select} data-testid="link-from">
                  <option value="">De…</option>
                  {active.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <select value={draft.toFloorId} onChange={(e) => setDraft({ ...draft, toFloorId: e.target.value })} aria-label="Andar de destino" style={select} data-testid="link-to">
                  <option value="">Para…</option>
                  {active.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <select
                  value={draft.direction}
                  onChange={(e) => setDraft({ ...draft, direction: e.target.value as FloorLink['direction'] })}
                  aria-label="Direção"
                  style={select}
                  data-testid="link-direction"
                >
                  <option value="one_way">Mão única</option>
                  <option value="both">Nos dois sentidos</option>
                </select>
                <Button size="sm" variant="secondary" onClick={addLink} disabled={saving} data-testid="add-link">
                  Adicionar
                </Button>
              </div>
            </div>
          ) : null}

          {error ? <p style={{ margin: 0, fontSize: 13, color: 'var(--coral-600, #d92d20)' }} data-testid="building-error">{error}</p> : null}
        </section>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

const select: React.CSSProperties = {
  height: 34,
  padding: '0 8px',
  borderRadius: 'var(--radius-control)',
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-card)',
  fontSize: 13,
}
