import { useCallback, useEffect, useState } from 'react'
import {
  createEventTrigger,
  eventTriggerAction,
  eventTriggerExample,
  listEventTriggers,
  rotateEventTriggerSecret,
  type EventTrigger,
  type RoutineStatus,
} from '../lib/agentRoutines'
import type { AgentSummary } from '../lib/types'
import { Button, Card, EmptyState, Field, Input, StatusPill, Tag, Textarea } from '../ui'
import type { AgentStatus } from '../ui'

// "Gatilhos por webhook" inside the agent's Fluxos tab: an endpoint another system
// calls to put THIS agent to work. It is an automation underneath, but nothing here
// says so — the user names it, says what the agent should do, and gets a URL.
//
// The signing secret is shown exactly once, right after it is created or rotated.
// It is never listed, never re-fetched and never stored in the browser.

const PILL: Record<RoutineStatus, [AgentStatus, string]> = {
  active: ['working', 'Aguardando evento'],
  paused: ['break', 'Pausado'],
  draft: ['idle', 'Rascunho'],
  archived: ['idle', 'Arquivado'],
}

const label = { margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' } as const
const code: React.CSSProperties = {
  margin: 0,
  padding: 10,
  borderRadius: 8,
  background: 'var(--surface-sunken)',
  fontSize: 11.5,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

function CopyButton({ value, children, testId }: { value: string; children: string; testId?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="secondary"
      icon="copy"
      data-testid={testId}
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
    >
      {copied ? 'Copiado' : children}
    </Button>
  )
}

// The one moment the credential is visible. It is deliberately loud and it never
// comes back: closing this card is the user saying they saved it.
function SecretOnce({ secret, onDismiss }: { secret: string; onDismiss: () => void }) {
  return (
    <Card padding="14px 16px" style={{ display: 'grid', gap: 8, borderColor: 'var(--accent-500)' }} data-testid="trigger-secret">
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-heading)' }}>Guarde a credencial agora</p>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
        Ela é exibida uma única vez. Use-a para assinar o corpo da requisição (HMAC-SHA256) no cabeçalho <strong>x-signature</strong>. Se perder, gere outra — a anterior deixa de valer.
      </p>
      <pre style={code}>{secret}</pre>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <CopyButton value={secret} testId="copy-secret">
          Copiar credencial
        </CopyButton>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Já guardei
        </Button>
      </div>
    </Card>
  )
}

function NewTriggerForm({ agentId, onCreated }: { agentId: string; onCreated: (secret: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!objective.trim()) {
      setError('Descreva o que o agente deve fazer quando o evento chegar.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await createEventTrigger(agentId, { name: name.trim() || undefined, objective: objective.trim() })
      setName('')
      setObjective('')
      setOpen(false)
      onCreated(created.secret)
    } catch {
      setError('Não foi possível criar o gatilho.')
    } finally {
      setSaving(false)
    }
  }

  if (!open)
    return (
      <Button variant="secondary" icon="plus" onClick={() => setOpen(true)} data-testid="new-event-trigger">
        Novo gatilho
      </Button>
    )

  return (
    <Card padding="16px" style={{ display: 'grid', gap: 12 }}>
      <Field label="O que o agente faz com o evento" hint="Ex.: analisar o pedido recebido e responder com o resumo para o time.">
        <Textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} data-testid="trigger-objective" />
      </Field>
      <Field label="Nome (opcional)">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Novo pedido no site" data-testid="trigger-name" />
      </Field>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
        A assinatura HMAC vem ativada: quem chamar o endereço precisa assiná-lo com a credencial. A credencial aparece uma única vez, logo depois de criar.
      </p>
      {error ? <p style={{ margin: 0, fontSize: 13, color: 'var(--status-blocked)' }}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => void submit()} disabled={saving} data-testid="save-event-trigger">
          {saving ? 'Criando…' : 'Criar gatilho'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </Card>
  )
}

function TriggerCard({ agentId, trigger, onChanged, onSecret }: { agentId: string; trigger: EventTrigger; onChanged: () => void; onSecret: (secret: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [showExample, setShowExample] = useState(false)
  const [error, setError] = useState(false)
  const [pill, pillLabel] = PILL[trigger.status]

  const act = async (action: 'activate' | 'pause' | 'archive') => {
    setBusy(true)
    setError(false)
    try {
      await eventTriggerAction(agentId, trigger.id, action)
      onChanged()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  const rotate = async () => {
    if (!window.confirm('Gerar uma nova credencial? Quem já usa a atual para de funcionar imediatamente.')) return
    setBusy(true)
    setError(false)
    try {
      const rotated = await rotateEventTriggerSecret(agentId, trigger.id)
      onSecret(rotated.secret)
      onChanged()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card padding="14px 16px" style={{ display: 'grid', gap: 10 }} data-testid="event-trigger-card">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, color: 'var(--text-heading)' }}>{trigger.name}</span>
            <StatusPill status={pill} label={pillLabel} pulse={false} />
            {trigger.requireSignature ? <Tag>Assinatura obrigatória</Tag> : null}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{trigger.objective}</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
          {trigger.status === 'active' ? (
            <Button size="sm" variant="ghost" icon="pause" onClick={() => void act('pause')} disabled={busy} data-testid="pause-trigger">
              Pausar
            </Button>
          ) : trigger.status !== 'archived' ? (
            <Button size="sm" variant="ghost" icon="play" onClick={() => void act('activate')} disabled={busy} data-testid="activate-trigger">
              Ativar
            </Button>
          ) : null}
          {trigger.status !== 'archived' ? (
            <Button size="sm" variant="ghost" icon="archive" onClick={() => void act('archive')} disabled={busy}>
              Arquivar
            </Button>
          ) : null}
        </div>
      </div>

      <div>
        <p style={label}>Endereço para chamar</p>
        <pre style={code} data-testid="trigger-endpoint">
          {trigger.endpoint ?? '—'}
        </pre>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {trigger.endpoint ? (
          <CopyButton value={trigger.endpoint} testId="copy-trigger-endpoint">
            Copiar endereço
          </CopyButton>
        ) : null}
        <Button size="sm" variant="ghost" icon="code" onClick={() => setShowExample((v) => !v)} data-testid="toggle-example">
          {showExample ? 'Ocultar exemplo' : 'Ver exemplo'}
        </Button>
        <Button size="sm" variant="ghost" icon="rotate-cw" onClick={() => void rotate()} disabled={busy} data-testid="rotate-secret">
          Gerar nova credencial
        </Button>
      </div>

      {showExample ? (
        <div>
          <p style={label}>Exemplo de requisição</p>
          <pre style={code} data-testid="trigger-example">
            {eventTriggerExample(trigger.endpoint, trigger.requireSignature)}
          </pre>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
            O cabeçalho <strong>x-event-id</strong> evita execução duplicada: o mesmo id nunca roda duas vezes.
          </p>
        </div>
      ) : null}

      {error ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--status-blocked)' }}>Não foi possível concluir. Tente de novo.</p> : null}
    </Card>
  )
}

export function AgentEventTriggers({ agent }: { agent: AgentSummary }) {
  const [triggers, setTriggers] = useState<EventTrigger[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // Held in memory only, and only until the user dismisses it.
  const [secret, setSecret] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    listEventTriggers(agent._id)
      .then(setTriggers)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [agent._id])
  useEffect(load, [load])

  const visible = triggers.filter((t) => t.status !== 'archived')

  return (
    <div style={{ display: 'grid', gap: 16 }} data-testid="agent-event-triggers">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>Gatilhos por webhook</h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Um endereço que outro sistema chama para colocar este agente para trabalhar.</p>
        </div>
        <NewTriggerForm
          agentId={agent._id}
          onCreated={(created) => {
            setSecret(created)
            load()
          }}
        />
      </div>

      {secret ? <SecretOnce secret={secret} onDismiss={() => setSecret(null)} /> : null}

      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Carregando…</p>
      ) : error ? (
        <Card padding="16px" style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--status-blocked)' }}>Não foi possível carregar os gatilhos.</p>
          <Button size="sm" variant="secondary" icon="refresh-cw" onClick={load}>
            Tentar de novo
          </Button>
        </Card>
      ) : visible.length === 0 ? (
        <EmptyState icon="webhook" title="Nenhum gatilho" body="Crie um gatilho para o agente reagir a eventos de outro sistema (um pedido novo, um formulário enviado, um alerta)." />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {visible.map((t) => (
            <TriggerCard key={t.id} agentId={agent._id} trigger={t} onChanged={load} onSecret={setSecret} />
          ))}
        </div>
      )}
    </div>
  )
}
