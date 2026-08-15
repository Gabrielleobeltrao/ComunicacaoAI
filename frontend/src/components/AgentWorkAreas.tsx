import { useCallback, useEffect, useState } from 'react'
import type { AgentSummary, ActivationMode } from '../lib/types'
import {
  createRoutine,
  getAgentHistory,
  listDeliveryConnections,
  listRoutines,
  routineAction,
  updateRoutine,
  type AgentHistory,
  type DeliveryConnection,
  type Recurrence,
  type Routine,
  type RoutineStatus,
} from '../lib/agentRoutines'
import { createSectorDocument } from '../lib/sectorKnowledge'
import { Button, Card, EmptyState, Field, Input, Select, StatusPill, Tag, Textarea } from '../ui'
import type { AgentStatus } from '../ui'

// The three agent-native work areas that replaced the standalone "Automação"
// surface: Rotinas (scheduled tasks), Acionamentos (how it can be triggered / who
// it collaborates with) and Histórico (routine runs + delegations).

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const ROUTINE_PILL: Record<RoutineStatus, [AgentStatus, string]> = {
  active: ['working', 'Ativa'],
  paused: ['break', 'Pausada'],
  draft: ['idle', 'Rascunho'],
  archived: ['idle', 'Arquivada'],
}

const ACTIVATION_LABEL: Record<ActivationMode, string> = {
  manual: 'Manual',
  scheduled: 'Agendado',
  event: 'Evento',
  channel: 'Canal',
  // LEGACY, read-only: never offered as an option, only rendered for old agents.
  agent_only: 'Legado: só por outro agente',
}

const sectionTitle = (text: string) => (
  <h3 style={{ margin: '0 0 12px', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>{text}</h3>
)

// ---- Rotinas ----------------------------------------------------------------
// ONE form for creating and editing: an edit that could drift from a create is how
// a field ends up saveable only on the way in. Editing PATCHes the same routine —
// the backend rebuilds and republishes the definition and never touches the
// active/paused status, so a paused routine stays paused after a change.
function RoutineForm({ agentId, routine, onDone, onCancel }: { agentId: string; routine?: Routine; onDone: () => void; onCancel: () => void }) {
  const editing = Boolean(routine)
  const [objective, setObjective] = useState(routine?.objective ?? '')
  const [name, setName] = useState(routine?.name ?? '')
  const [kind, setKind] = useState<Recurrence['kind']>(routine?.recurrence?.kind ?? 'daily')
  const [time, setTime] = useState(routine?.recurrence?.time ?? '07:00')
  const [weekdays, setWeekdays] = useState<number[]>(routine?.recurrence?.kind === 'weekly' ? routine.recurrence.weekdays : [1])
  const [day, setDay] = useState(routine?.recurrence?.kind === 'monthly' ? routine.recurrence.day : 1)
  const [timezone, setTimezone] = useState(routine?.timezone || 'America/Sao_Paulo')
  const [input, setInput] = useState(routine?.input ?? '')
  const [outputFormat, setOutputFormat] = useState<'text' | 'markdown' | 'json'>(routine?.outputFormat ?? 'markdown')
  // '' means "no destination"; the sentinel means "whatever it already has" — the
  // two are NOT the same, and telling them apart is what keeps an edit made before
  // the connections arrived from erasing one.
  const KEEP = '__keep__'
  const [connectionId, setConnectionId] = useState(routine?.delivery?.connectionId ?? '')
  const [connections, setConnections] = useState<DeliveryConnection[]>([])
  const [connectionsState, setConnectionsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Destinations are optional: with none configured the field simply says so. Until
  // the list is known the picker cannot represent the current destination, so it
  // shows "keep" instead of pretending the routine has none.
  useEffect(() => {
    let cancelled = false
    listDeliveryConnections()
      .then((list) => {
        if (cancelled) return
        setConnections(list)
        setConnectionsState('ready')
        // The stored destination is gone from the list (revoked, or another
        // account's): keep it rather than silently dropping it.
        setConnectionId((current) => (current && !list.some((c) => c.id === current) ? KEEP : current))
      })
      .catch(() => {
        if (cancelled) return
        setConnectionsState('error')
        setConnectionId((current) => (current ? KEEP : current))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const buildRecurrence = (): Recurrence =>
    kind === 'daily' ? { kind, time } : kind === 'weekly' ? { kind, time, weekdays: [...weekdays].sort((a, b) => a - b) } : { kind, time, day }

  const submit = async () => {
    if (!objective.trim()) {
      setError('Descreva o objetivo da rotina.')
      return
    }
    if (kind === 'weekly' && weekdays.length === 0) {
      setError('Escolha ao menos um dia da semana.')
      return
    }
    setSaving(true)
    setError(null)
    const chosen = connections.find((c) => c.id === connectionId)
    // OMITTING delivery tells the backend to keep the current one. It is sent as
    // null only when the user actually picked "Nenhum" with the list in hand.
    const keepDestination = connectionId === KEEP || connectionsState !== 'ready'
    const payload = {
      name: name.trim() || undefined,
      objective: objective.trim(),
      recurrence: buildRecurrence(),
      timezone,
      input: input.trim() || undefined,
      outputFormat,
      ...(keepDestination ? {} : { delivery: chosen ? { provider: chosen.provider, connectionId: chosen.id } : null }),
    }
    try {
      if (routine) await updateRoutine(agentId, routine.id, payload)
      else await createRoutine(agentId, payload)
      onDone()
    } catch {
      setError(editing ? 'Não foi possível salvar as alterações.' : 'Não foi possível criar a rotina.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card padding="16px" style={{ display: 'grid', gap: 12 }} data-testid="routine-form">
      <Field label="Objetivo" hint="O que o agente deve fazer a cada execução.">
        <Textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Ex.: consolidar as notícias políticas de ontem em um relatório." data-testid="routine-objective" />
      </Field>
      <Field label="Nome (opcional)">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Relatório diário de notícias" data-testid="routine-name" />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Frequência">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Recurrence['kind'])} options={[{ value: 'daily', label: 'Todo dia' }, { value: 'weekly', label: 'Toda semana' }, { value: 'monthly', label: 'Todo mês' }]} />
        </Field>
        <Field label="Horário">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="routine-time" />
        </Field>
      </div>
      {kind === 'weekly' ? (
        <Field label="Dias da semana">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {WEEKDAYS.map((weekdayLabel, i) => {
              const on = weekdays.includes(i)
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setWeekdays((w) => (on ? w.filter((d) => d !== i) : [...w, i]))}
                  style={{ height: 34, padding: '0 12px', borderRadius: 'var(--radius-control)', border: `1px solid ${on ? 'var(--accent-500)' : 'var(--border-subtle)'}`, background: on ? 'var(--accent-50)' : 'var(--surface-card)', color: on ? 'var(--accent-700)' : 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                  {weekdayLabel}
                </button>
              )
            })}
          </div>
        </Field>
      ) : null}
      {kind === 'monthly' ? (
        <Field label="Dia do mês">
          <Input type="number" min={1} max={31} value={day} onChange={(e) => setDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} />
        </Field>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Fuso horário">
          <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} data-testid="routine-timezone" />
        </Field>
        <Field label="Formato de saída">
          <Select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as 'text' | 'markdown' | 'json')} options={[{ value: 'markdown', label: 'Markdown' }, { value: 'text', label: 'Texto' }, { value: 'json', label: 'JSON' }]} />
        </Field>
      </div>
      <Field label="Entrada fixa (opcional)" hint="Texto entregue ao agente em toda execução.">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ex.: foco em política nacional" data-testid="routine-input" />
      </Field>
      <Field
        label="Destino do resultado (opcional)"
        hint={
          connectionsState === 'loading'
            ? 'Carregando os destinos…'
            : connectionsState === 'error'
              ? 'Não foi possível carregar os destinos — o atual será mantido como está.'
              : connections.length
                ? 'Para onde o resultado é enviado ao terminar.'
                : 'Nenhum destino conectado ainda — o resultado fica no histórico.'
        }
      >
        <Select
          value={connectionId}
          onChange={(e) => setConnectionId(e.target.value)}
          disabled={connectionsState === 'loading'}
          data-testid="routine-delivery"
          options={[
            ...(connectionId === KEEP || connectionsState !== 'ready' ? [{ value: KEEP, label: 'Manter o destino atual' }] : []),
            { value: '', label: 'Nenhum — guardar no histórico' },
            ...connections.map((c) => ({ value: c.id, label: `${c.name} (${c.provider === 'email' ? 'e-mail' : 'Telegram'})` })),
          ]}
          aria-label="Destino do resultado"
        />
      </Field>
      {error ? <p style={{ margin: 0, color: 'var(--status-blocked)', fontSize: 13 }} data-testid="routine-error">{error}</p> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => void submit()} disabled={saving || connectionsState === 'loading'} data-testid="save-routine">
          {saving ? 'Salvando…' : connectionsState === 'loading' ? 'Carregando…' : editing ? 'Salvar alterações' : 'Criar rotina'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </Card>
  )
}

function RoutineRow({ agentId, routine, onChanged }: { agentId: string; routine: Routine; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [pill, pillLabel] = ROUTINE_PILL[routine.status]
  const act = async (action: 'activate' | 'pause' | 'archive') => {
    setBusy(true)
    setFailed(false)
    try {
      await routineAction(agentId, routine.id, action)
      onChanged()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  // The editor opens in place, filled with what this routine actually is.
  if (editing)
    return (
      <RoutineForm
        agentId={agentId}
        routine={routine}
        onDone={() => {
          setEditing(false)
          onChanged()
        }}
        onCancel={() => setEditing(false)}
      />
    )

  return (
    <Card padding="14px 16px" style={{ display: 'grid', gap: 8 }} data-testid="routine-row">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--text-heading)' }}>{routine.name}</span>
            <StatusPill status={pill} label={pillLabel} pulse={false} />
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            {routine.scheduleLabel} · {routine.timezone}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 520 }}>{routine.objective}</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" icon="pencil" onClick={() => setEditing(true)} disabled={busy} data-testid="edit-routine">
            Editar
          </Button>
          {routine.status === 'active' ? (
            <Button variant="ghost" size="sm" icon="pause" onClick={() => void act('pause')} disabled={busy}>
              Pausar
            </Button>
          ) : routine.status !== 'archived' ? (
            <Button variant="ghost" size="sm" icon="play" onClick={() => void act('activate')} disabled={busy}>
              Ativar
            </Button>
          ) : null}
          {routine.status !== 'archived' ? (
            <Button variant="ghost" size="sm" icon="archive" onClick={() => void act('archive')} disabled={busy}>
              Arquivar
            </Button>
          ) : null}
        </div>
      </div>
      {failed ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--status-blocked)' }}>Não foi possível concluir. Tente de novo.</p> : null}
    </Card>
  )
}

export function AgentRoutines({ agent }: { agent: AgentSummary }) {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const load = useCallback(() => {
    setLoading(true)
    listRoutines(agent._id)
      .then(setRoutines)
      .catch(() => setRoutines([]))
      .finally(() => setLoading(false))
  }, [agent._id])
  useEffect(load, [load])

  const visible = routines.filter((r) => r.status !== 'archived')
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          {sectionTitle('Rotinas')}
          <p style={{ margin: '-6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>Tarefas agendadas que este agente executa sozinho.</p>
        </div>
        {creating ? null : (
          <Button variant="secondary" icon="plus" onClick={() => setCreating(true)} data-testid="new-routine">
            Nova rotina
          </Button>
        )}
      </div>
      {creating ? (
        <RoutineForm
          agentId={agent._id}
          onDone={() => {
            setCreating(false)
            load()
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Carregando…</p>
      ) : visible.length === 0 ? (
        <EmptyState icon="clock" title="Nenhuma rotina" body="Crie uma rotina para o agente trabalhar em horários definidos." />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {visible.map((r) => (
            <RoutineRow key={r.id} agentId={agent._id} routine={r} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Acionamentos -----------------------------------------------------------
export function AgentActivations({ agent }: { agent: AgentSummary }) {
  const modes = agent.activationModes ?? []

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        {sectionTitle('Como pode ser acionado')}
        {modes.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-subtle)' }}>Nenhum acionamento configurado.</p>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {modes.map((m) => (
              <Tag key={m}>{ACTIVATION_LABEL[m] ?? m}</Tag>
            ))}
          </div>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-subtle)' }}>Com quem ele trabalha fica em “Colaboração”, logo abaixo. Competências ficam em “Ajustes”.</p>
    </div>
  )
}

// ---- Histórico --------------------------------------------------------------
const RUN_PILL: Record<string, [AgentStatus, string]> = {
  succeeded: ['working', 'Concluída'],
  running: ['thinking', 'Executando'],
  queued: ['idle', 'Na fila'],
  failed: ['blocked', 'Falhou'],
  canceled: ['break', 'Cancelada'],
  cancel_requested: ['break', 'Cancelando'],
  denied: ['blocked', 'Negada'],
}

const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

// Explicit, confirmed curation: turns a finished run's output into a sector
// knowledge entry (title + content + source='run' + runId + author/date). NEVER
// automatic — the user picks the sector and confirms.
function SaveToSectorKnowledge({ sectors, title, content, runId }: { sectors: { _id: string; name: string }[]; title: string; content: string; runId: string }) {
  const [open, setOpen] = useState(false)
  const [sectorId, setSectorId] = useState(sectors[0]?._id ?? '')
  const [docTitle, setDocTitle] = useState(title)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (sectors.length === 0 || !content) return null
  if (done) return <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Salvo no conhecimento</span>

  const save = async () => {
    if (!sectorId || !docTitle.trim()) {
      setError('Escolha o setor e informe um título.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createSectorDocument(sectorId, { title: docTitle.trim(), content, source: 'run', sourceRef: runId })
      setDone(true)
    } catch {
      setError('Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  if (!open)
    return (
      <Button variant="ghost" size="sm" icon="book-plus" onClick={() => setOpen(true)}>
        Salvar no conhecimento do setor
      </Button>
    )
  return (
    <Card padding="12px" style={{ display: 'grid', gap: 8, minWidth: 260 }}>
      <Field label="Setor">
        <Select value={sectorId} onChange={(e) => setSectorId(e.target.value)} options={sectors.map((s) => ({ value: s._id, label: s.name }))} />
      </Field>
      <Field label="Título">
        <Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
      </Field>
      {error ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--status-blocked)' }}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? 'Salvando…' : 'Confirmar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </Card>
  )
}

export function AgentHistoryPanel({ agent, sectors = [] }: { agent: AgentSummary; sectors?: { _id: string; name: string }[] }) {
  const [history, setHistory] = useState<AgentHistory | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    getAgentHistory(agent._id)
      .then(setHistory)
      .catch(() => setHistory({ total: 0, items: [], delegations: [] }))
      .finally(() => setLoading(false))
  }, [agent._id])

  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Carregando…</p>
  const runs = history?.items ?? []
  const delegations = history?.delegations ?? []
  if (runs.length === 0 && delegations.length === 0)
    return <EmptyState icon="history" title="Sem histórico" body="Execuções de rotinas e delegações aparecerão aqui." />

  const pill = (status: string): [AgentStatus, string] => RUN_PILL[status] ?? ['idle', status]

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {runs.length > 0 ? (
        <div>
          {sectionTitle('Execuções de rotinas')}
          <div style={{ display: 'grid', gap: 8 }}>
            {runs.map((r) => {
              const [s, label] = pill(r.status)
              return (
                <Card key={r.id} padding="12px 14px" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--text-heading)' }}>{r.routineName}</span>
                    <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{fmtWhen(r.finishedAt ?? r.startedAt ?? r.queuedAt)}</p>
                    {r.error ? <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--status-blocked)' }} data-testid="run-history-error">{r.error.message}</p> : null}
                  </div>
                  <StatusPill status={s} label={label} pulse={false} />
                </Card>
              )
            })}
          </div>
        </div>
      ) : null}
      {delegations.length > 0 ? (
        <div>
          {sectionTitle('Delegações')}
          <div style={{ display: 'grid', gap: 8 }}>
            {delegations.map((d) => {
              const [s, label] = pill(d.status)
              return (
                <Card key={d.id} padding="12px 14px" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Tag>{d.direction === 'outgoing' ? 'Enviada' : 'Recebida'}</Tag>
                      <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{d.targetType === 'sector' ? 'setor' : 'agente'}</span>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 520 }}>{d.objective}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{fmtWhen(d.finishedAt ?? d.createdAt)}</p>
                    {d.error ? <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--status-blocked)' }} data-testid="delegation-error">{d.error.message}</p> : null}
                    {d.status === 'succeeded' && d.outputPreview ? (
                      <div style={{ marginTop: 8 }}>
                        <SaveToSectorKnowledge sectors={sectors} title={d.objective.slice(0, 120)} content={d.outputPreview} runId={d.id} />
                      </div>
                    ) : null}
                  </div>
                  <StatusPill status={s} label={label} pulse={false} />
                </Card>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
