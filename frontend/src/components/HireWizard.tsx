import { useEffect, useMemo, useState } from 'react'
import { API_URL } from '../lib/api'
import { randomAgentName } from '../lib/agentNames'
import { listAgentPresets, type AgentPresetSpec } from '../lib/agentPresets'
import { assignAgentToSector } from '../lib/sectors'
import type { AgentPreset, AgentSummary, SectorSummary } from '../lib/types'
import { Button, Card, Field, Input, Select, Textarea } from '../ui'

// Hiring in three steps: Função → Trabalho → Revisar e contratar.
//
// Each role asks only for what IT needs, in plain language — never ids, contracts or
// policy jargon. The safe permissions (who it may call, who may call it) come from
// the preset and stay editable later under "Avançado".
//
// What a role cannot finish here (connecting an app, writing a routine) is not a
// blocker: the agent is hired and the remaining steps are handed over as a checklist.

const STEPS = ['Função', 'Trabalho', 'Revisar'] as const

// The questions each role actually needs answered, in its own words.
interface RoleForm {
  // A short sentence describing what the role delivers, shown under the objective.
  hint: string
  subject?: { label: string; placeholder: string; help?: string } // → inputContract
  deliverable?: { label: string; placeholder: string } // → outputContract
  tone?: boolean
  collaborators?: boolean // manager: who it coordinates
  needsTool?: 'research' | 'action' | 'source' // finish later via checklist
  needsRoutine?: boolean
  needsDestination?: boolean
}

const ROLE_FORM: Record<AgentPreset, RoleForm> = {
  manager: {
    hint: 'Recebe um pedido, aciona quem sabe fazer e devolve uma resposta só.',
    collaborators: true,
  },
  researcher: {
    hint: 'Recebe um tema, pesquisa e devolve o resultado com as fontes.',
    subject: { label: 'Tema que ele pesquisa', placeholder: 'Ex.: notícias do setor de alimentação' },
    deliverable: { label: 'Formato da resposta', placeholder: 'Ex.: lista com 5 itens e o link de cada fonte' },
    needsTool: 'research',
  },
  analyst: {
    hint: 'Recebe dados prontos e devolve uma conclusão fundamentada.',
    subject: { label: 'Dados que ele recebe', placeholder: 'Ex.: as vendas da semana por produto' },
    deliverable: { label: 'Conclusão esperada', placeholder: 'Ex.: o que subiu, o que caiu e o porquê' },
  },
  operator: {
    hint: 'Executa uma ação de verdade num app conectado e confirma o que fez.',
    subject: { label: 'Ação que ele executa', placeholder: 'Ex.: registrar o pedido no sistema' },
    needsTool: 'action',
  },
  communicator: {
    hint: 'Transforma um resultado em texto pronto para o público certo.',
    subject: { label: 'Para quem ele escreve', placeholder: 'Ex.: clientes do delivery, no Instagram' },
    deliverable: { label: 'Formato da entrega', placeholder: 'Ex.: legenda curta com chamada para reserva' },
    tone: true,
    needsDestination: true,
  },
  monitor: {
    hint: 'Olha uma fonte de tempos em tempos e avisa quando algo muda.',
    subject: { label: 'O que ele acompanha', placeholder: 'Ex.: o estoque de massas e molhos' },
    deliverable: { label: 'Quando deve avisar', placeholder: 'Ex.: quando algum item ficar abaixo do mínimo' },
    needsTool: 'source',
    needsRoutine: true,
  },
  secretary: {
    hint: 'Recebe demandas, organiza e encaminha para quem resolve.',
    subject: { label: 'Demandas que ele recebe', placeholder: 'Ex.: pedidos de orçamento e dúvidas gerais' },
    collaborators: true,
  },
  custom: {
    hint: 'Você define tudo do zero.',
    subject: { label: 'O que ele recebe', placeholder: 'Ex.: uma mensagem do cliente' },
    deliverable: { label: 'O que ele entrega', placeholder: 'Ex.: uma resposta curta e cordial' },
  },
}

// What still has to be done after hiring, in the user's words.
const PENDING_LABEL: Record<string, string> = {
  research: 'Conectar uma fonte de pesquisa (app ou ferramenta)',
  action: 'Conectar o app onde ele vai executar a ação',
  source: 'Conectar a fonte que ele vai acompanhar',
  routine: 'Criar a rotina que acorda ele',
  destination: 'Definir para onde a entrega vai',
  collaborators: 'Escolher os colegas que ele pode acionar',
}

const TONES = [
  { value: 'neutral', label: 'Neutro' },
  { value: 'friendly', label: 'Amigável' },
  { value: 'formal', label: 'Formal' },
]
const LANGS = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'Inglês' },
  { value: 'es', label: 'Espanhol' },
]

function Choice({ on, label, hint, onClick }: { on: boolean; label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '10px 12px',
        borderRadius: 'var(--radius-control)',
        border: `1px solid ${on ? 'var(--accent-500)' : 'var(--border-subtle)'}`,
        background: on ? 'var(--accent-50)' : 'var(--surface-card)',
        color: on ? 'var(--accent-700)' : 'var(--text-heading)',
        cursor: 'pointer',
        fontFamily: 'var(--font-ui)',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{label}</div>
      {hint ? <div style={{ fontSize: 12, color: on ? 'var(--accent-700)' : 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{hint}</div> : null}
    </button>
  )
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export function HireWizard({
  floorId,
  agents,
  sectors,
  onHired,
  onCancel,
  // Hiring FOR something (a sector stage, a team slot): the role is pre-picked and
  // the wizard opens on the work step, so the user answers only what is new.
  initialPreset,
  initialSectorId,
}: {
  floorId?: string
  agents: AgentSummary[]
  sectors: SectorSummary[]
  onHired: (agent?: { _id: string; name: string }) => void
  onCancel: () => void
  initialPreset?: AgentPreset
  initialSectorId?: string
}) {
  const [step, setStep] = useState(initialPreset ? 1 : 0)
  const [presets, setPresets] = useState<AgentPresetSpec[]>([])
  const [preset, setPreset] = useState<AgentPreset>(initialPreset ?? 'custom')

  const [language, setLanguage] = useState('pt')
  const [name, setName] = useState(() => randomAgentName('pt').name)
  const [objective, setObjective] = useState('')
  const [subject, setSubject] = useState('')
  const [deliverable, setDeliverable] = useState('')
  const [tone, setTone] = useState('neutral')
  const [collaborators, setCollaborators] = useState<string[]>([])
  const [collaboratorSectors, setCollaboratorSectors] = useState<string[]>([])
  const [sectorId, setSectorId] = useState(initialSectorId ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hired, setHired] = useState<{ _id: string; name: string } | null>(null)

  useEffect(() => {
    listAgentPresets()
      .then((list) => {
        setPresets(list)
        // Pre-picked role: adopt its default objective as if the user had clicked it.
        const picked = initialPreset ? list.find((p) => p.preset === initialPreset) : null
        if (picked) setObjective((prev) => (prev.trim() ? prev : picked.objective))
      })
      .catch(() => setPresets([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const spec = useMemo(() => presets.find((p) => p.preset === preset), [presets, preset])
  const form = ROLE_FORM[preset]
  const otherAgents = useMemo(() => agents.filter((a) => a.name), [agents])
  const callableSectors = useMemo(() => sectors.filter((s) => s.mode !== 'organization'), [sectors])

  const applyPreset = (s: AgentPresetSpec) => {
    setPreset(s.preset)
    setObjective(s.objective)
    setSubject('')
    setDeliverable('')
  }

  // What this agent will still be missing right after hiring.
  const pending = useMemo(() => {
    const items: string[] = []
    if (form.needsTool) items.push(PENDING_LABEL[form.needsTool])
    if (form.needsRoutine) items.push(PENDING_LABEL.routine)
    if (form.needsDestination) items.push(PENDING_LABEL.destination)
    if (form.collaborators && collaborators.length === 0 && collaboratorSectors.length === 0 && preset !== 'manager') items.push(PENDING_LABEL.collaborators)
    return items
  }, [form, collaborators.length, collaboratorSectors.length, preset])

  const canAdvance = step !== 1 || name.trim().length > 0

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      // Permissions come from the ROLE, never from a checkbox the user had to
      // understand. A manager that picked specific colleagues gets 'selected'.
      const picked = collaborators.length > 0 || collaboratorSectors.length > 0
      const delegationPolicy = form.collaborators ? (picked ? 'selected' : (spec?.delegationPolicy ?? 'all')) : (spec?.delegationPolicy ?? 'none')

      const res = await fetch(`${API_URL}/api/agents`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          objective: objective.trim(),
          provider: 'anthropic',
          language,
          floorId,
          preset,
          capabilities: spec?.capabilities ?? [],
          activationModes: spec?.activationModes ?? ['manual'],
          inputContract: subject.trim(),
          outputContract: deliverable.trim(),
          ...(form.tone ? { responseTone: tone } : {}),
          delegationPolicy,
          callableAgentIds: picked ? collaborators : [],
          callableSectorIds: picked ? collaboratorSectors : [],
          // Reachable by other agents — the permission that replaced agent_only.
          callerPolicy: spec?.callerPolicy ?? 'all',
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const created = (await res.json()) as { _id: string; name: string }
      if (sectorId) await assignAgentToSector(created._id, sectorId).catch(() => undefined)
      // Nothing pending → close. Otherwise show the handover checklist.
      if (pending.length === 0) onHired(created)
      else setHired(created)
    } catch {
      setError('Não foi possível contratar o agente.')
      setSaving(false)
    }
  }

  // ------------------------------------------------- post-hire handover
  if (hired) {
    return (
      <div style={{ display: 'grid', gap: 16 }} data-testid="hire-checklist">
        <div>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 16, fontWeight: 800, color: 'var(--text-heading)' }}>{hired.name} foi contratado</h3>
          <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--text-muted)' }}>Falta pouco para ele começar a trabalhar:</p>
        </div>
        <Card padding="14px 16px" style={{ display: 'grid', gap: 10 }}>
          {pending.map((item) => (
            <div key={item} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ width: 18, height: 18, borderRadius: 999, border: '1px solid var(--border-strong)', flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 13.5, color: 'var(--text-heading)' }}>{item}</span>
            </div>
          ))}
        </Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => onHired(hired)}>Abrir o agente</Button>
          <Button variant="ghost" onClick={() => onHired()}>
            Depois
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 18 }} data-testid="hire-wizard">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {STEPS.map((label, i) => (
          <span
            key={label}
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: 999,
              fontFamily: 'var(--font-ui)',
              background: i === step ? 'var(--accent-500)' : i < step ? 'var(--accent-50)' : 'var(--surface-sunken)',
              color: i === step ? 'white' : i < step ? 'var(--accent-700)' : 'var(--text-muted)',
            }}
          >
            {i + 1}. {label}
          </span>
        ))}
      </div>

      <div style={{ minHeight: 260 }}>
        {/* 1 — Função */}
        {step === 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 10 }} data-testid="role-picker">
            {presets.map((s) => (
              <Choice key={s.preset} on={preset === s.preset} label={s.label} hint={ROLE_FORM[s.preset]?.hint ?? s.description} onClick={() => applyPreset(s)} />
            ))}
          </div>
        ) : null}

        {/* 2 — Trabalho (only what THIS role needs) */}
        {step === 1 ? (
          <div style={{ display: 'grid', gap: 14 }} data-testid="work-step">
            <Field label="Nome" hint="Gerado automaticamente conforme o idioma.">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Input value={name} onChange={(e) => setName(e.target.value)} style={{ flex: '1 1 200px', minWidth: 0 }} />
                <Button variant="secondary" icon="dice-5" type="button" onClick={() => setName(randomAgentName(language, name).name)}>
                  Outro
                </Button>
              </div>
            </Field>
            <Field label="Idioma">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {LANGS.map((l) => (
                  <Choice
                    key={l.value}
                    on={language === l.value}
                    label={l.label}
                    onClick={() => {
                      setLanguage(l.value)
                      setName(randomAgentName(l.value).name)
                    }}
                  />
                ))}
              </div>
            </Field>
            <Field label="O que ele faz" hint={form.hint}>
              <Textarea rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Descreva em uma ou duas frases." />
            </Field>

            {form.subject ? (
              <Field label={form.subject.label} hint={form.subject.help}>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={form.subject.placeholder} />
              </Field>
            ) : null}
            {form.deliverable ? (
              <Field label={form.deliverable.label}>
                <Input value={deliverable} onChange={(e) => setDeliverable(e.target.value)} placeholder={form.deliverable.placeholder} />
              </Field>
            ) : null}
            {form.tone ? (
              <Field label="Tom da escrita">
                <Select value={tone} onChange={(e) => setTone(e.target.value)} options={TONES} />
              </Field>
            ) : null}

            {form.collaborators ? (
              <Field label="Quem ele pode acionar" hint="Deixe vazio para ele poder acionar qualquer colega do prédio.">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 8, maxHeight: 190, overflowY: 'auto' }}>
                  {otherAgents.map((a) => (
                    <Choice key={a._id} on={collaborators.includes(a._id)} label={a.name} onClick={() => setCollaborators((l) => toggle(l, a._id))} />
                  ))}
                  {callableSectors.map((s) => (
                    <Choice key={s._id} on={collaboratorSectors.includes(s._id)} label={`Equipe ${s.name}`} onClick={() => setCollaboratorSectors((l) => toggle(l, s._id))} />
                  ))}
                </div>
              </Field>
            ) : null}

            <Field label="Setor (opcional)" hint="Onde ele aparece no mapa. Pode definir depois.">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 8 }}>
                <Choice on={sectorId === ''} label="Sem setor" onClick={() => setSectorId('')} />
                {sectors.map((s) => (
                  <Choice key={s._id} on={sectorId === s._id} label={s.name} onClick={() => setSectorId(s._id)} />
                ))}
              </div>
            </Field>
          </div>
        ) : null}

        {/* 3 — Revisar */}
        {step === 2 ? (
          <div style={{ display: 'grid', gap: 12 }} data-testid="review-step">
            <Card padding="16px" style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
              <Row label="Função" value={spec?.label ?? preset} />
              <Row label="Nome" value={name} />
              <Row label="O que faz" value={objective || '—'} />
              {subject ? <Row label={form.subject?.label ?? 'Recebe'} value={subject} /> : null}
              {deliverable ? <Row label={form.deliverable?.label ?? 'Entrega'} value={deliverable} /> : null}
              {form.collaborators ? (
                <Row label="Pode acionar" value={collaborators.length + collaboratorSectors.length > 0 ? `${collaborators.length + collaboratorSectors.length} escolhido(s)` : 'Qualquer colega do prédio'} />
              ) : null}
              <Row label="Setor" value={sectors.find((s) => s._id === sectorId)?.name ?? 'Sem setor'} />
            </Card>
            {pending.length > 0 ? (
              <Card padding="14px 16px" style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)' }}>Depois de contratar, falta:</span>
                {pending.map((p) => (
                  <span key={p} style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    • {p}
                  </span>
                ))}
              </Card>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? <p style={{ margin: 0, color: 'var(--status-blocked)', fontSize: 13 }}>{error}</p> : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="ghost" type="button" disabled={saving} onClick={step === 0 ? onCancel : () => setStep((s) => s - 1)}>
          {step === 0 ? 'Cancelar' : 'Voltar'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
            Próximo
          </Button>
        ) : (
          <Button type="button" disabled={saving} onClick={submit}>
            Contratar agente
          </Button>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ minWidth: 140, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-heading)', fontWeight: 600, minWidth: 0 }}>{value}</span>
    </div>
  )
}
