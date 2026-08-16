import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_URL } from '../lib/api'
import type { Floor } from '../lib/floors'
import { Button, Dialog } from '../ui'

// The building's own settings, opened from the sidebar gear — not a page.
//
// What lives here is what belongs to the BUILDING: its name and, above all, which
// floors may talk to which. A link only opens the PATH; it grants no access to an
// agent or a sector and overrides no policy. That sentence is on screen, because the
// difference is exactly what someone gets wrong.
//
// Editing is a DRAFT. The previous version saved the mode on the same click that
// asked for the impact, so the communication had already changed by the time the
// owner read what it would break. Now there is `saved` and `draft`, the impact is
// asked about the WHOLE draft, and nothing is written until Salvar — with an extra
// confirmation when the draft would cut existing references.

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

interface Blocked {
  callerName: string
  targetName: string
}

const MODES: { key: CommunicationMode; title: string; help: string }[] = [
  { key: 'isolated', title: 'Andares isolados', help: 'Nenhuma chamada cruza andares.' },
  { key: 'all', title: 'Todos colaboram', help: 'Qualquer andar ativo pode se comunicar, ainda sujeito às permissões de agentes e setores.' },
  { key: 'selected', title: 'Conexões escolhidas', help: 'Somente os caminhos que você criar permitem comunicação entre andares.' },
]

const linkKey = (l: FloorLink) => (l.direction === 'both' ? [l.fromFloorId, l.toFloorId].sort().join('|') : `${l.fromFloorId}>${l.toFloorId}`)
const sameConfig = (a: CommunicationConfig, b: CommunicationConfig) =>
  a.mode === b.mode && JSON.stringify(a.links.map(linkKey).sort()) === JSON.stringify(b.links.map(linkKey).sort())

const json = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.message ?? 'Não foi possível concluir.')
  }
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
  const empty: CommunicationConfig = { mode: 'all', links: [] }
  // What the server confirmed, and what the owner is editing. They only meet on save.
  const [saved, setSaved] = useState<CommunicationConfig>(empty)
  const [draft, setDraft] = useState<CommunicationConfig>(empty)
  const [impact, setImpact] = useState<Blocked[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [newLink, setNewLink] = useState<FloorLink>({ fromFloorId: '', toFloorId: '', direction: 'one_way' })
  // One preview in flight at a time: an older answer must not overwrite a newer one.
  const previewSeq = useRef(0)

  const active = floors.filter((f) => f.status === 'active')
  const nameOf = (id: string) => active.find((f) => f.id === id)?.name ?? 'Andar removido'
  const dirty = useMemo(() => !sameConfig(draft, saved), [draft, saved])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const current = await json<CommunicationConfig>('/api/building/floor-communication')
      setSaved(current)
      setDraft(current)
      setImpact(null)
      setConfirming(false)
    } catch {
      setError('Não foi possível carregar as conexões entre andares.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // The impact is asked about the WHOLE draft — mode AND links — because "isolated"
  // and "selected with these links" block different things.
  useEffect(() => {
    if (!open || loading) return
    if (!dirty) {
      setImpact(null)
      return
    }
    const seq = ++previewSeq.current
    const timer = setTimeout(() => {
      void json<{ blocked: Blocked[] }>('/api/building/floor-communication/impact', { method: 'POST', body: JSON.stringify(draft) })
        .then((r) => {
          // A stale answer is discarded rather than shown next to a newer draft.
          if (seq === previewSeq.current) setImpact(r.blocked)
        })
        .catch(() => {
          if (seq === previewSeq.current) setImpact(null)
        })
    }, 150)
    return () => clearTimeout(timer)
  }, [draft, dirty, open, loading])

  const edit = (next: CommunicationConfig) => {
    setDraft(next)
    // A new edit invalidates a confirmation given for the previous one.
    setConfirming(false)
    setError('')
  }

  const save = async () => {
    if (saving || !dirty) return
    // Cutting live references is a second decision, not a side effect of the first.
    if (impact && impact.length > 0 && !confirming) {
      setConfirming(true)
      return
    }
    setSaving(true)
    setError('')
    try {
      const stored = await json<CommunicationConfig>('/api/building/floor-communication', { method: 'PATCH', body: JSON.stringify(draft) })
      // What the server stored — not the draft — becomes the new confirmed state.
      setSaved(stored)
      setDraft(stored)
      setImpact(null)
      setConfirming(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => {
    setDraft(saved)
    setImpact(null)
    setConfirming(false)
    setError('')
  }

  const addLink = () => {
    if (!newLink.fromFloorId || !newLink.toFloorId || newLink.fromFloorId === newLink.toFloorId) return
    if (draft.links.some((l) => linkKey(l) === linkKey(newLink))) return
    edit({ ...draft, links: [...draft.links, newLink] })
    setNewLink({ fromFloorId: '', toFloorId: '', direction: 'one_way' })
  }

  const close = () => {
    cancel()
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} title={`Configurações de ${buildingName}`} width={620}>
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
                    border: `1px solid ${draft.mode === m.key ? 'var(--intent-brand)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <input
                    type="radio"
                    name="floor-communication"
                    checked={draft.mode === m.key}
                    // Escolher um modo é editar o rascunho. Nada é salvo aqui.
                    onChange={() => edit({ ...draft, mode: m.key })}
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

          {impact && impact.length > 0 ? (
            <div style={{ padding: 10, borderRadius: 10, background: 'var(--surface-sunken)' }} data-testid="communication-impact">
              <p style={{ margin: '0 0 4px', fontSize: 12.5, fontWeight: 700, color: 'var(--text-heading)' }}>
                Se você salvar assim, {impact.length} referência(s) deixariam de funcionar:
              </p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {impact.slice(0, 6).map((b, i) => (
                  <li key={`${b.callerName}:${b.targetName}:${i}`} style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {b.callerName} → {b.targetName}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {draft.mode === 'selected' ? (
            <div style={{ display: 'grid', gap: 8 }} data-testid="floor-links">
              {draft.links.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>Nenhuma conexão ainda: os andares não se falam.</p>
              ) : (
                draft.links.map((link, i) => (
                  <div key={`${link.fromFloorId}:${link.toFloorId}:${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span>
                      {nameOf(link.fromFloorId)} {link.direction === 'both' ? '↔' : '→'} {nameOf(link.toFloorId)}
                    </span>
                    <button
                      type="button"
                      onClick={() => edit({ ...draft, links: draft.links.filter((_, index) => index !== i) })}
                      style={{ background: 'none', border: 0, color: 'var(--intent-brand)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}
                    >
                      remover
                    </button>
                  </div>
                ))
              )}

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={newLink.fromFloorId}
                  onChange={(e) => setNewLink({ ...newLink, fromFloorId: e.target.value })}
                  aria-label="Andar de origem"
                  style={select}
                  data-testid="link-from"
                >
                  <option value="">De…</option>
                  {active.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <select
                  value={newLink.toFloorId}
                  onChange={(e) => setNewLink({ ...newLink, toFloorId: e.target.value })}
                  aria-label="Andar de destino"
                  style={select}
                  data-testid="link-to"
                >
                  <option value="">Para…</option>
                  {active.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <select
                  value={newLink.direction}
                  onChange={(e) => setNewLink({ ...newLink, direction: e.target.value as FloorLink['direction'] })}
                  aria-label="Direção"
                  style={select}
                  data-testid="link-direction"
                >
                  <option value="one_way">Mão única</option>
                  <option value="both">Nos dois sentidos</option>
                </select>
                <Button size="sm" variant="secondary" onClick={addLink} data-testid="add-link">
                  Adicionar
                </Button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--coral-600, #d92d20)' }} data-testid="building-error">
              {error}
            </p>
          ) : null}
        </section>

        {/* --- salvar ---------------------------------------------------------- */}
        {confirming ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-body)' }} data-testid="confirm-impact">
            Confirma? {impact?.length} referência(s) entre andares vão parar de funcionar. Clique em <strong>Salvar alterações</strong> de novo
            para aplicar.
          </p>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
          {dirty ? (
            <span style={{ marginRight: 'auto', fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="building-dirty">
              Alterações não salvas
            </span>
          ) : null}
          <Button variant="secondary" onClick={dirty ? cancel : close} data-testid="cancel-building-settings">
            {dirty ? 'Cancelar' : 'Fechar'}
          </Button>
          <Button onClick={() => void save()} disabled={!dirty || saving} data-testid="save-building-settings">
            {saving ? 'Salvando…' : confirming ? 'Salvar mesmo assim' : 'Salvar alterações'}
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
