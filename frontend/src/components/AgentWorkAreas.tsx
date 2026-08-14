import { useCallback, useEffect, useState } from 'react'
import type { AgentSummary, ActivationMode } from '../lib/types'
import {
  createRoutine,
  getAgentHistory,
  listRoutines,
  routineAction,
  type AgentHistory,
  type Recurrence,
  type Routine,
  type RoutineStatus,
} from '../lib/agentRoutines'
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
  agent_only: 'Só por outro agente',
}

const sectionTitle = (text: string) => (
  <h3 style={{ margin: '0 0 12px', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>{text}</h3>
)

// ---- Rotinas ----------------------------------------------------------------
function NewRoutineForm({ agentId, onCreated }: { agentId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [objective, setObjective] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Recurrence['kind']>('daily')
  const [time, setTime] = useState('07:00')
  const [weekdays, setWeekdays] = useState<number[]>([1])
  const [day, setDay] = useState(1)
  const [timezone, setTimezone] = useState('America/Sao_Paulo')
  const [input, setInput] = useState('')
  const [outputFormat, setOutputFormat] = useState<'text' | 'markdown' | 'json'>('markdown')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setObjective('')
    setName('')
    setInput('')
    setKind('daily')
    setTime('07:00')
    setWeekdays([1])
    setDay(1)
    setOpen(false)
    setError(null)
  }

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
    try {
      await createRoutine(agentId, { name: name.trim() || undefined, objective: objective.trim(), recurrence: buildRecurrence(), timezone, input: input.trim() || undefined, outputFormat })
      reset()
      onCreated()
    } catch {
      setError('Não foi possível criar a rotina.')
    } finally {
      setSaving(false)
    }
  }

  if (!open)
    return (
      <Button variant="secondary" icon="plus" onClick={() => setOpen(true)}>
        Nova rotina
      </Button>
    )

  return (
    <Card padding="16px" style={{ display: 'grid', gap: 12 }}>
      <Field label="Objetivo" hint="O que o agente deve fazer a cada execução.">
        <Textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Ex.: consolidar as notícias políticas de ontem em um relatório." />
      </Field>
      <Field label="Nome (opcional)">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Relatório diário de notícias" />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Frequência">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Recurrence['kind'])} options={[{ value: 'daily', label: 'Todo dia' }, { value: 'weekly', label: 'Toda semana' }, { value: 'monthly', label: 'Todo mês' }]} />
        </Field>
        <Field label="Horário">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      {kind === 'weekly' ? (
        <Field label="Dias da semana">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {WEEKDAYS.map((label, i) => {
              const on = weekdays.includes(i)
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setWeekdays((w) => (on ? w.filter((d) => d !== i) : [...w, i]))}
                  style={{ height: 34, padding: '0 12px', borderRadius: 'var(--radius-control)', border: `1px solid ${on ? 'var(--accent-500)' : 'var(--border-subtle)'}`, background: on ? 'var(--accent-50)' : 'var(--surface-card)', color: on ? 'var(--accent-700)' : 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                  {label}
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
          <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </Field>
        <Field label="Formato de saída">
          <Select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as 'text' | 'markdown' | 'json')} options={[{ value: 'markdown', label: 'Markdown' }, { value: 'text', label: 'Texto' }, { value: 'json', label: 'JSON' }]} />
        </Field>
      </div>
      <Field label="Entrada fixa (opcional)" hint="Texto entregue ao agente em toda execução.">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ex.: foco em política nacional" />
      </Field>
      {error ? <p style={{ margin: 0, color: 'var(--status-blocked)', fontSize: 13 }}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={submit} disabled={saving}>
          Criar rotina
        </Button>
        <Button variant="ghost" onClick={reset} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </Card>
  )
}

function RoutineRow({ agentId, routine, onChanged }: { agentId: string; routine: Routine; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [pill, pillLabel] = ROUTINE_PILL[routine.status]
  const act = async (action: 'activate' | 'pause' | 'archive') => {
    setBusy(true)
    try {
      await routineAction(agentId, routine.id, action)
      onChanged()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card padding="14px 16px" style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
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
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {routine.status === 'active' ? (
          <Button variant="secondary" size="sm" icon="pause" onClick={() => act('pause')} disabled={busy}>
            Pausar
          </Button>
        ) : routine.status !== 'archived' ? (
          <Button variant="secondary" size="sm" icon="play" onClick={() => act('activate')} disabled={busy}>
            Ativar
          </Button>
        ) : null}
        {routine.status !== 'archived' ? (
          <Button variant="ghost" size="sm" icon="archive" onClick={() => act('archive')} disabled={busy}>
            Arquivar
          </Button>
        ) : null}
      </div>
    </Card>
  )
}

export function AgentRoutines({ agent }: { agent: AgentSummary }) {
  const [routines, setRoutines] = useState<Routine[]>([])
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
        <NewRoutineForm agentId={agent._id} onCreated={load} />
      </div>
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
export function AgentActivations({ agent, agents }: { agent: AgentSummary; agents: AgentSummary[] }) {
  const nameOf = (id: string) => agents.find((a) => a._id === id)?.name ?? 'Agente removido'
  const modes = agent.activationModes ?? []
  const callable = agent.callableAgentIds ?? []
  const callers = agent.allowedCallerAgentIds ?? []
  const sectors = agent.callableSectorIds ?? []

  const list = (ids: string[], empty: string) =>
    ids.length === 0 ? (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-subtle)' }}>{empty}</p>
    ) : (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {ids.map((id) => (
          <Tag key={id}>{nameOf(id)}</Tag>
        ))}
      </div>
    )

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
      <div>
        {sectionTitle('Pode acionar')}
        {list(callable, 'Não delega para nenhum agente.')}
        {sectors.length > 0 ? <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>Setores: {sectors.length}</p> : null}
      </div>
      <div>
        {sectionTitle('Pode ser acionado por')}
        {callers.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: 'var(--text-subtle)' }}>Qualquer agente do mesmo prédio.</p> : list(callers, '')}
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-subtle)' }}>Ajuste competências, acionamentos e colaboradores em “Ajustes”.</p>
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

export function AgentHistoryPanel({ agent }: { agent: AgentSummary }) {
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
                    {r.error ? <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--status-blocked)' }}>{r.error}</p> : null}
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
                    {d.error ? <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--status-blocked)' }}>{d.error}</p> : null}
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
