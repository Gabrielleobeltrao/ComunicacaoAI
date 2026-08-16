import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { floorAgent, floorSector } from '../lib/floorRoutes'
import { getFloorWorkOverview, patchFloor } from '../lib/floors'
import type { Floor, FloorWorkOverview } from '../lib/floors'
import type { AgentSummary } from '../lib/types'
import { Button, Card } from '../ui'

// "Como este andar trabalha".
//
// Two modes and nothing else, because a floor is an ORGANISATIONAL area: it never
// reasons and never executes. Coordinating only points at an agent that already
// exists — the tools, connections, triggers and permissions stay on that agent, and
// its own delegation policy decides what it reaches. Choosing here never grants
// anything.

const MODES = [
  {
    key: 'organization' as const,
    title: 'Livre / somente organizar',
    body: 'Agentes e setores continuam funcionando pelos próprios canais, rotinas, gatilhos e chamadas. O andar só organiza.',
  },
  {
    key: 'coordinated' as const,
    title: 'Coordenado por um agente',
    body: 'Um agente do andar é a porta de entrada e decide quais agentes ou setores autorizados consultar.',
  },
]

export function FloorWorkSection({ floor, agents, onSaved }: { floor: Floor; agents: AgentSummary[]; onSaved?: () => void }) {
  const [mode, setMode] = useState(floor.workMode)
  const [coordinatorId, setCoordinatorId] = useState(floor.coordinatorAgentId ?? '')
  const [instruction, setInstruction] = useState(floor.instruction)
  const [overview, setOverview] = useState<FloorWorkOverview | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const floorAgents = agents.filter((a) => a.floorId === floor.id)

  const load = useCallback(async () => {
    try {
      setOverview(await getFloorWorkOverview(floor.id))
    } catch {
      setOverview(null)
    }
  }, [floor.id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setMode(floor.workMode)
    setCoordinatorId(floor.coordinatorAgentId ?? '')
    setInstruction(floor.instruction)
  }, [floor.workMode, floor.coordinatorAgentId, floor.instruction])

  const dirty = mode !== floor.workMode || coordinatorId !== (floor.coordinatorAgentId ?? '') || instruction !== floor.instruction

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await patchFloor(floor.id, { workMode: mode, coordinatorAgentId: coordinatorId || null, instruction })
      await load()
      onSaved?.()
    } catch (e) {
      setError((e as Error).message || 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card padding="18px" style={{ display: 'grid', gap: 14 }} data-testid="floor-work-section">
      <div>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>
          Como este andar trabalha
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          O andar organiza. Quem raciocina e executa é sempre um agente.
        </p>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {MODES.map((m) => (
          <label
            key={m.key}
            data-testid={`work-mode-${m.key}`}
            style={{
              display: 'flex',
              gap: 10,
              padding: 12,
              borderRadius: 10,
              cursor: 'pointer',
              border: `1px solid ${mode === m.key ? 'var(--intent-brand)' : 'var(--border-subtle)'}`,
              background: mode === m.key ? 'var(--surface-sunken)' : 'transparent',
            }}
          >
            <input type="radio" name="floor-work-mode" checked={mode === m.key} onChange={() => setMode(m.key)} style={{ marginTop: 3 }} />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text-heading)' }}>{m.title}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)' }}>{m.body}</span>
            </span>
          </label>
        ))}
      </div>

      {mode === 'coordinated' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Agente que coordena</span>
            <select
              value={coordinatorId}
              onChange={(e) => setCoordinatorId(e.target.value)}
              data-testid="coordinator-select"
              style={{ height: 38, padding: '0 10px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border-strong)', background: 'var(--surface-card)', fontSize: 13.5 }}
            >
              <option value="">Escolha um agente deste andar</option>
              {floorAgents.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name}
                </option>
              ))}
            </select>
            {floorAgents.length === 0 ? (
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Este andar ainda não tem agentes.</span>
            ) : null}
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Instrução do andar (opcional)</span>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              data-testid="floor-instruction"
              placeholder="Ex.: priorize pedidos atrasados antes de qualquer outra coisa."
              style={{ padding: 10, borderRadius: 'var(--radius-control)', border: '1px solid var(--border-strong)', background: 'var(--surface-card)', fontSize: 13.5, resize: 'vertical' }}
            />
          </label>
        </div>
      ) : null}

      {error ? <p style={{ margin: 0, fontSize: 13, color: 'var(--coral-600, #d92d20)' }} data-testid="work-error">{error}</p> : null}

      <div>
        <Button size="sm" disabled={!dirty || saving} onClick={() => void save()} data-testid="save-work-mode">
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>

      {/* --- what this actually produces ------------------------------------- */}
      {overview && overview.workMode === 'coordinated' ? (
        <div style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }} data-testid="work-preview">
          {overview.issues.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }} data-testid="work-issues">
              {overview.issues.map((issue) => (
                <li key={issue.code} style={{ fontSize: 13, color: issue.severity === 'blocking' ? 'var(--coral-600, #d92d20)' : 'var(--text-muted)' }}>
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }} data-testid="work-ready">
              Pronto: {overview.coordinator?.name} recebe os pedidos deste andar.
            </p>
          )}

          {/* Vertical preview: entrada ↓ coordenador ↓ quem ele alcança. */}
          {overview.coordinator ? (
            <div style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
              <Block label="Pedido que chega ao andar" />
              <Arrow />
              <Block label={`${overview.coordinator.name} · coordena`} strong testid="coordinator-block" />
              {overview.targets.length > 0 ? (
                <>
                  <Arrow />
                  <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexWrap: 'wrap', gap: 6 }} data-testid="work-targets">
                    {overview.targets.map((t) => (
                      <span
                        key={`${t.kind}:${t.id}`}
                        title={t.blockedReason ?? t.competency}
                        style={{
                          flex: '1 1 160px',
                          padding: '6px 10px',
                          borderRadius: 8,
                          fontSize: 12.5,
                          border: '1px solid var(--border-subtle)',
                          opacity: t.ready ? 1 : 0.55,
                        }}
                      >
                        <Link
                          to={t.kind === 'agent' ? floorAgent(floor.id, t.id) : floorSector(floor.id, t.id)}
                          style={{ color: 'var(--text-heading)', textDecoration: 'none' }}
                        >
                          {t.name}
                        </Link>
                        <span style={{ display: 'block', color: 'var(--text-faint)' }}>
                          {t.kind === 'sector' ? 'setor' : 'agente'}
                          {t.ready ? '' : ' · indisponível'}
                        </span>
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

const Arrow = () => (
  <span aria-hidden style={{ color: 'var(--text-faint)', fontSize: 15, lineHeight: 1 }}>
    ↓
  </span>
)

const Block = ({ label, strong, testid }: { label: string; strong?: boolean; testid?: string }) => (
  <span
    data-testid={testid}
    style={{
      width: '100%',
      maxWidth: 420,
      padding: '8px 12px',
      borderRadius: 10,
      fontSize: 13,
      textAlign: 'left',
      border: `1px solid ${strong ? 'var(--intent-brand)' : 'var(--border-subtle)'}`,
      background: 'var(--surface-card)',
    }}
  >
    {label}
  </span>
)
