import { useCallback, useEffect, useState } from 'react'
import type { AgentSummary, ActivationMode } from '../lib/types'
import {
  createRoutine,
  getAgentHistory,
  listDeliveryConnections,
  listRoutines,
  checkRoutineNow,
  routineAction,
  updateRoutine,
  type AgentHistory,
  type DeliveryConnection,
  type Recurrence,
  type Routine,
  type RoutineStatus,
  type InitialWindow,
  type RoutineSource,
  type SourcePreview,
  testSource,
} from '../lib/agentRoutines'
import { createSectorDocument } from '../lib/sectorKnowledge'
import { emptyAppActionPlan, emptyMemoryPlan, ExecutionModeFields, type ExecutionModeValue } from './ExecutionModeFields'
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
  // `time` só existe nas recorrências com hora do dia. "A cada 15 minutos" não tem
  // horário, e ler `.time` de lá seria ler um campo que não existe.
  const comHorario = routine?.recurrence && 'time' in routine.recurrence ? routine.recurrence.time : undefined
  const [time, setTime] = useState(comHorario ?? '07:00')
  const [every, setEvery] = useState<5 | 15 | 30>(routine?.recurrence?.kind === 'minutes' ? routine.recurrence.every : 15)

  // --- fonte de entrada ---------------------------------------------------------
  const fonteAtual = routine?.source ?? { kind: 'fixed' as const }
  const [sourceKind, setSourceKind] = useState<'fixed' | 'rss' | 'http'>(fonteAtual.kind)
  const [sourceUrl, setSourceUrl] = useState(fonteAtual.kind === 'fixed' ? '' : fonteAtual.url)
  const [initialWindow, setInitialWindow] = useState<InitialWindow>(fonteAtual.kind === 'rss' ? fonteAtual.initialWindow : '24h')
  const [focus, setFocus] = useState(fonteAtual.kind === 'fixed' ? '' : (fonteAtual.focus ?? ''))
  const [preview, setPreview] = useState<SourcePreview | null>(null)
  const [testando, setTestando] = useState(false)
  // Como a rotina processa o que a fonte trouxer, e onde guardar. Reabre exatamente
  // como foi salvo; uma rotina anterior a isto não tem os campos e cai no padrão.
  const [modo, setModo] = useState<ExecutionModeValue>({
    executionMode: routine?.executionMode ?? 'ai',
    memory: routine?.memory ?? emptyMemoryPlan(),
    aiCondition: routine?.aiCondition ?? null,
    action: routine?.action ?? emptyAppActionPlan(),
  })
  const comIA = modo.executionMode === 'ai' || ((modo.executionMode === 'hybrid' || modo.executionMode === 'automatic') && !!modo.aiCondition)
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

  const buildRecurrence = (): Recurrence => {
    if (kind === 'minutes') return { kind, every }
    if (kind === 'hourly') return { kind }
    if (kind === 'weekly') return { kind, time, weekdays: [...weekdays].sort((a, b) => a - b) }
    if (kind === 'monthly') return { kind, time, day }
    return { kind: 'daily', time }
  }

  const monitorando = sourceKind !== 'fixed'

  const buildSource = (): RoutineSource => {
    if (sourceKind === 'fixed') return { kind: 'fixed' }
    const url = sourceUrl.trim()
    const f = focus.trim()
    if (sourceKind === 'rss') return { kind: 'rss', url, initialWindow, ...(f ? { focus: f } : {}) }
    return { kind: 'http', url, ...(f ? { focus: f } : {}) }
  }

  // Consulta a fonte e mostra o que ela devolve. Não executa a rotina, não chama a
  // LLM e não gasta token — é uma conferência antes de salvar.
  const testarFonte = async () => {
    if (sourceKind === 'fixed') return
    setTestando(true)
    setPreview(null)
    try {
      setPreview(await testSource(agentId, { kind: sourceKind, url: sourceUrl.trim(), initialWindow }))
    } catch {
      setPreview({ ok: false, kind: sourceKind, message: 'Não foi possível consultar a fonte agora.' })
    } finally {
      setTestando(false)
    }
  }

  const submit = async () => {
    if (comIA && !objective.trim()) {
      setError('Descreva o objetivo da rotina.')
      return
    }
    if (kind === 'weekly' && weekdays.length === 0) {
      setError('Escolha ao menos um dia da semana.')
      return
    }
    if (monitorando && !sourceUrl.trim()) {
      setError('Informe o endereço da fonte a monitorar.')
      return
    }
    if (monitorando && !/^https?:\/\//i.test(sourceUrl.trim())) {
      setError('O endereço precisa começar com http:// ou https://.')
      return
    }
    if (modo.memory.enabled && modo.memory.scope !== 'agent' && !modo.memory.sectorId && !modo.memory.floorId && !modo.memory.buildingId) {
      setError('Escolha onde a informação será guardada.')
      return
    }
    // Sem IA, sem memória e sem fonte a rotina não faria nada. O servidor recusa; dizer
    // aqui evita a ida e volta.
    if (!comIA && !modo.memory.enabled && !monitorando && !modo.action?.enabled) {
      setError('Sem IA no fluxo, escolha guardar a informação, executar uma ação, ou monitorar uma fonte.')
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
      source: buildSource(),
      executionMode: modo.executionMode,
      memory: modo.memory,
      aiCondition: modo.aiCondition,
      action: modo.action,
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
      {/* Sem IA no fluxo não há a quem instruir. */}
      {comIA ? (
        <Field label="Objetivo" hint="O que o agente deve fazer a cada execução.">
          <Textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Ex.: consolidar as notícias políticas de ontem em um relatório." data-testid="routine-objective" />
        </Field>
      ) : null}
      <Field label="Nome (opcional)">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Relatório diário de notícias" data-testid="routine-name" />
      </Field>
      {/* --- fonte de entrada --------------------------------------------------
          Entrada fixa é o que sempre existiu. As outras duas transformam a rotina
          num monitoramento: ela passa a consultar um endereço e só aciona o agente
          quando encontra algo novo. */}
      <Field label="Fonte de entrada" hint="De onde vem o que o agente processa a cada execução.">
        <Select
          value={sourceKind}
          onChange={(e) => {
            const escolhida = e.target.value as 'fixed' | 'rss' | 'http'
            setSourceKind(escolhida)
            setPreview(null)
            // Minutos e "a cada hora" existem para monitorar. Voltando para entrada
            // fixa, uma frequência dessas passaria a chamar a LLM 288 vezes por dia
            // com a mesma entrada — então a rotina cai para diária em vez de
            // esperar o dono descobrir isso no erro de salvamento.
            if (escolhida === 'fixed' && (kind === 'minutes' || kind === 'hourly')) setKind('daily')
          }}
          data-testid="routine-source-kind"
          aria-label="Fonte de entrada"
          options={[
            { value: 'fixed', label: 'Entrada fixa (texto que você escreve)' },
            { value: 'rss', label: 'Feed RSS/Atom — só quando houver item novo' },
            { value: 'http', label: 'Página ou API — só quando o conteúdo mudar' },
          ]}
        />
      </Field>

      {monitorando ? (
        <div style={{ display: 'grid', gap: 12 }} data-testid="routine-source-config">
          <Field label="Endereço" hint="Precisa ser público e começar com http:// ou https://.">
            <Input
              value={sourceUrl}
              onChange={(e) => {
                setSourceUrl(e.target.value)
                setPreview(null)
              }}
              placeholder={sourceKind === 'rss' ? 'https://exemplo.com/feed.xml' : 'https://exemplo.com/pagina'}
              data-testid="routine-source-url"
              aria-label="Endereço da fonte"
            />
          </Field>

          {sourceKind === 'rss' ? (
            <Field label="Janela inicial" hint="Na primeira verificação, o que é recente o bastante para valer a pena. Depois disso, só o que for novo.">
              <Select
                value={initialWindow}
                onChange={(e) => setInitialWindow(e.target.value as InitialWindow)}
                data-testid="routine-initial-window"
                aria-label="Janela inicial"
                options={[
                  { value: '24h', label: 'Últimas 24 horas' },
                  { value: '3d', label: 'Últimos 3 dias' },
                  { value: '7d', label: 'Últimos 7 dias' },
                ]}
              />
            </Field>
          ) : null}

          <Field label="Foco (opcional)" hint="O que olhar no que chegar.">
            <Input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Ex.: só mudanças de preço" data-testid="routine-source-focus" />
          </Field>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="secondary" size="sm" icon="search" onClick={() => void testarFonte()} disabled={testando || !sourceUrl.trim()} data-testid="test-source">
              {testando ? 'Consultando…' : 'Testar fonte'}
            </Button>
            {/* O ponto que evita a pergunta mais comum sobre custo. */}
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="source-cost-note">
              A verificação não usa tokens. Eles só são consumidos quando o agente processa uma mudança.
            </span>
          </div>

          {preview ? (
            <div
              data-testid="source-preview"
              style={{
                padding: 12,
                borderRadius: 10,
                border: `1px solid ${preview.ok ? 'var(--border-subtle)' : 'var(--status-blocked)'}`,
                background: 'var(--surface-sunken)',
                display: 'grid',
                gap: 8,
              }}
            >
              <p style={{ margin: 0, fontSize: 13, color: preview.ok ? 'var(--text-body)' : 'var(--status-blocked)' }}>{preview.message}</p>
              {preview.items?.length ? (
                <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }} data-testid="source-preview-items">
                  {preview.items.map((item, i) => (
                    <li key={`${item.url}:${i}`} style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      {item.title || item.url}
                    </li>
                  ))}
                </ul>
              ) : null}
              {preview.excerpt ? (
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', overflowWrap: 'anywhere' }} data-testid="source-preview-excerpt">
                  {preview.excerpt.slice(0, 240)}
                  {preview.excerpt.length > 240 ? '…' : ''}
                </p>
              ) : null}
              {preview.ok && preview.itemCount === 0 ? (
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="source-preview-empty">
                  O feed respondeu, mas nada dentro da janela escolhida. Uma janela maior traria mais.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* A origem entra na frase de conferência: numa rotina de feed ela dizia
          "Webhook → validar → …", que é a única linha que explica o que vai
          acontecer — e começava errada. */}
      <ExecutionModeFields
        value={modo}
        onChange={setModo}
        idPrefix="routine-"
        agentId={agentId}
        origem={sourceKind === 'rss' ? 'Verificar o feed' : sourceKind === 'http' ? 'Verificar a página' : 'No horário'}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label={monitorando ? 'Verificar a cada' : 'Frequência'}>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as Recurrence['kind'])}
            data-testid="routine-frequency"
            aria-label="Frequência"
            options={[
              // Só quem monitora pode verificar de minuto em minuto: a consulta é
              // de graça e a LLM só roda quando há mudança. Numa rotina de entrada
              // fixa a mesma frequência seria conta alta em troca de nada.
              ...(monitorando ? [{ value: 'minutes', label: 'Minutos' }, { value: 'hourly', label: '1 hora' }] : []),
              { value: 'daily', label: 'Todo dia' },
              { value: 'weekly', label: 'Toda semana' },
              { value: 'monthly', label: 'Todo mês' },
            ]}
          />
        </Field>
        {kind === 'minutes' ? (
          <Field label="Intervalo">
            <Select
              value={String(every)}
              onChange={(e) => setEvery(Number(e.target.value) as 5 | 15 | 30)}
              data-testid="routine-every-minutes"
              aria-label="Intervalo em minutos"
              options={[
                { value: '5', label: 'A cada 5 minutos' },
                { value: '15', label: 'A cada 15 minutos' },
                { value: '30', label: 'A cada 30 minutos' },
              ]}
            />
          </Field>
        ) : kind === 'hourly' ? (
          // "A cada hora" não tem horário para escolher; dizer isso é melhor que
          // deixar um campo desabilitado sem explicação.
          <Field label="Horário">
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No começo de cada hora.</p>
          </Field>
        ) : (
          <Field label="Horário">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="routine-time" />
          </Field>
        )}
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
      {/* Com uma fonte configurada, a entrada do agente é o conteúdo novo — um
          texto fixo aqui não seria usado, e mostrá-lo prometeria o que não acontece. */}
      {monitorando ? null : (
        <Field label="Entrada fixa (opcional)" hint="Texto entregue ao agente em toda execução.">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ex.: foco em política nacional" data-testid="routine-input" />
        </Field>
      )}
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

// Quanto tempo faz, em palavras. "há 3 min" responde melhor que um timestamp à
// pergunta que o usuário está fazendo: isto ainda está funcionando?
function haQuantoTempo(iso: string | null): string | null {
  if (!iso) return null
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return null
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  return `há ${d} dia${d === 1 ? '' : 's'}`
}

const RESULTADO_LABEL: Record<string, string> = {
  changed: 'encontrou novidade',
  no_change: 'sem novidade',
  // Outra execução já estava verificando esta fonte. Não é erro, e dizer isso é
  // melhor que mostrar "sem novidade", que seria mentira.
  skipped_concurrent: 'já estava sendo verificada',
  // A execução carregava a fonte anterior. Some sozinho na próxima verificação, e
  // dizer isso evita a leitura de que a troca quebrou alguma coisa.
  skipped_stale: 'era da fonte anterior, descartada',
  failed: 'falhou ao verificar',
}

function RoutineRow({ agentId, routine, onChanged }: { agentId: string; routine: Routine; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [verificando, setVerificando] = useState(false)
  const [verificado, setVerificado] = useState(false)

  // Enfileira a MESMA execução do agendador, fora do horário. Se não houver
  // novidade, ela termina como sucesso sem alteração — não é o "testar fonte",
  // que não executa nada.
  const verificarAgora = async () => {
    setVerificando(true)
    setFailed(false)
    try {
      await checkRoutineNow(agentId, routine.id)
      setVerificado(true)
      onChanged()
    } catch {
      setFailed(true)
    } finally {
      setVerificando(false)
    }
  }
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
            {/* Que tipo de fonte esta rotina vigia — ou nenhuma. */}
            {routine.source.kind !== 'fixed' ? (
              <Tag data-testid="routine-source-tag">{routine.source.kind === 'rss' ? 'Feed RSS' : 'Página/API'}</Tag>
            ) : null}{' '}
            {routine.scheduleLabel} · {routine.timezone}
          </p>

          {/* O estado do monitoramento. Sem isto, uma rotina que verifica de 15 em
              15 minutos e nunca encontra nada parece parada — e o usuário não tem
              como distinguir "está tudo calmo" de "quebrou". */}
          {routine.monitoring ? (
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="routine-monitoring">
              {(() => {
                const m = routine.monitoring
                const partes: string[] = []
                const verificou = haQuantoTempo(m.lastCheckedAt)
                partes.push(verificou ? `Verificado ${verificou}` : 'Ainda não verificado')
                if (m.lastResult) partes.push(RESULTADO_LABEL[m.lastResult] ?? m.lastResult)
                const mudou = haQuantoTempo(m.lastChangedAt)
                partes.push(mudou ? `última novidade ${mudou}` : 'nenhuma novidade ainda')
                if (routine.nextRunAt) partes.push(`próxima ${new Date(routine.nextRunAt).toLocaleString('pt-BR')}`)
                return partes.join(' · ')
              })()}
            </p>
          ) : null}
          {/* A confirmação fica FORA do rótulo do botão: o botão continua dizendo o
              que ele faz, e o aviso some junto com a próxima atualização da lista. */}
          {verificado ? (
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--intent-brand)' }} data-testid="check-now-queued">
              Verificação enfileirada. O resultado aparece aqui quando terminar.
            </p>
          ) : null}
          {routine.monitoring?.lastError ? (
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--status-blocked)' }} data-testid="routine-monitoring-error">
              {routine.monitoring.lastError.message}
            </p>
          ) : null}
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 520 }}>{routine.objective}</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
          {/* "Verificar agora" executa; "Testar fonte", no formulário, não. São
              coisas diferentes e ficam em lugares diferentes de propósito. */}
          {routine.source.kind !== 'fixed' ? (
            <Button variant="secondary" size="sm" icon="refresh-cw" onClick={() => void verificarAgora()} disabled={busy || verificando} data-testid="check-now">
              {verificando ? 'Verificando…' : 'Verificar agora'}
            </Button>
          ) : null}
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
      {/* "Carregando…" só na primeira vez. Numa reatualização depois de uma ação a
          lista continua na tela: trocá-la por um texto desmonta as linhas, apaga o
          que elas estavam mostrando e faz a página piscar a cada clique. */}
      {loading && visible.length === 0 ? (
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
