import { useEffect, useMemo, useState } from 'react'
import { API_URL } from '../lib/api'
import { randomAgentName } from '../lib/agentNames'
import { listAgentPresets, type AgentPresetSpec } from '../lib/agentPresets'
import { assignAgentToSector } from '../lib/sectors'
import type { AgentPreset, AgentSummary, DelegationPolicy, SectorSummary } from '../lib/types'
import { Button, Card, Field, Input, Select, Tag, Textarea } from '../ui'

// The hiring wizard: 4 adaptive steps — Função, Configuração essencial,
// Equipe/funcionamento, Revisão. Each preset shows ONLY its relevant fields;
// everything else stays editable later on the agent page. No IDs, cron or raw
// contracts are shown — the user works in names, presets and plain language.

const STEPS = ['Função', 'Configuração', 'Equipe', 'Revisão']

// Which essential fields each preset shows on step 2. subject → inputContract,
// deliverable → outputContract, tone → responseTone, capabilities → free editor.
const PRESET_ESSENTIALS: Record<AgentPreset, { subject?: string; deliverable?: string; tone?: boolean; capabilities?: boolean; note?: string }> = {
  manager: { note: 'Os colaboradores que ele pode acionar você define no próximo passo.' },
  researcher: { subject: 'Tema / assunto a pesquisar', deliverable: 'Formato do resultado (ex.: lista com fontes)' },
  analyst: { subject: 'O que ele recebe para analisar', deliverable: 'Conclusão esperada' },
  secretary: { note: 'Ele organiza e encaminha demandas — ajuste os detalhes depois em Ajustes.' },
  operator: { subject: 'Ação principal que ele executa', note: 'Conecte a integração na aba Ferramentas do agente. Sem ela, ele fica incompleto.' },
  communicator: { tone: true, deliverable: 'Formato / canal de entrega' },
  monitor: { subject: 'Fonte a acompanhar', deliverable: 'Condição que dispara o alerta', note: 'Defina a frequência criando uma Rotina no agente depois.' },
  custom: { capabilities: true },
}

const TONES: { value: string; label: string }[] = [
  { value: 'neutral', label: 'Neutro' },
  { value: 'friendly', label: 'Amigável' },
  { value: 'formal', label: 'Formal' },
]

const LANGS: { value: string; label: string }[] = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'Inglês' },
  { value: 'es', label: 'Espanhol' },
]

// none|all|selected in plain language.
const POLICY_OPTIONS: { value: DelegationPolicy; label: string }[] = [
  { value: 'none', label: 'Ninguém' },
  { value: 'all', label: 'Qualquer agente do prédio' },
  { value: 'selected', label: 'Apenas os que eu escolher' },
]

function ChipToggle({ on, label, hint, onClick }: { on: boolean; label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '8px 12px',
        borderRadius: 'var(--radius-control)',
        border: `1px solid ${on ? 'var(--accent-500)' : 'var(--border-subtle)'}`,
        background: on ? 'var(--accent-50)' : 'var(--surface-card)',
        color: on ? 'var(--accent-700)' : 'var(--text-heading)',
        cursor: 'pointer',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{label}</div>
      {hint ? <div style={{ fontSize: 12, color: on ? 'var(--accent-700)' : 'var(--text-muted)', marginTop: 2 }}>{hint}</div> : null}
    </button>
  )
}

// A 3-way none|all|selected picker with an optional agent multiselect for 'selected'.
function PolicyPicker({
  value,
  onChange,
  selectedIds,
  onToggleId,
  agents,
}: {
  value: DelegationPolicy
  onChange: (v: DelegationPolicy) => void
  selectedIds: string[]
  onToggleId: (id: string) => void
  agents: AgentSummary[]
}) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {POLICY_OPTIONS.map((o) => (
          <ChipToggle key={o.value} on={value === o.value} label={o.label} onClick={() => onChange(o.value)} />
        ))}
      </div>
      {value === 'selected' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
          {agents.length === 0 ? (
            <span style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Nenhum outro agente ainda.</span>
          ) : (
            agents.map((a) => <ChipToggle key={a._id} on={selectedIds.includes(a._id)} label={a.name} onClick={() => onToggleId(a._id)} />)
          )}
        </div>
      ) : null}
    </div>
  )
}

const toggle = (list: string[], v: string): string[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export function HireWizard({
  floorId,
  agents,
  sectors,
  onHired,
  onCancel,
}: {
  floorId?: string
  agents: AgentSummary[]
  sectors: SectorSummary[]
  onHired: () => void
  onCancel: () => void
}) {
  const [step, setStep] = useState(0)
  const [presets, setPresets] = useState<AgentPresetSpec[]>([])
  const [preset, setPreset] = useState<AgentPreset>('custom')

  const [language, setLanguage] = useState('pt')
  const [name, setName] = useState(() => randomAgentName('pt').name)
  const [objective, setObjective] = useState('')
  const [subject, setSubject] = useState('') // → inputContract
  const [deliverable, setDeliverable] = useState('') // → outputContract
  const [tone, setTone] = useState('neutral')
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [capDraft, setCapDraft] = useState('')

  // Team/operation
  const [delegationPolicy, setDelegationPolicy] = useState<DelegationPolicy>('none')
  const [callableAgentIds, setCallableAgentIds] = useState<string[]>([])
  const [callableSectorIds, setCallableSectorIds] = useState<string[]>([])
  const [callerPolicy, setCallerPolicy] = useState<DelegationPolicy>('all')
  const [allowedCallerAgentIds, setAllowedCallerAgentIds] = useState<string[]>([])
  const [sectorId, setSectorId] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listAgentPresets().then(setPresets).catch(() => setPresets([]))
  }, [])

  const specOf = (p: AgentPreset) => presets.find((s) => s.preset === p)
  const essentials = PRESET_ESSENTIALS[preset]
  const otherAgents = useMemo(() => agents.filter((a) => a.name), [agents])
  // Only executable teams (orchestrated/pipeline) can be delegated to.
  const callableSectors = useMemo(() => sectors.filter((s) => s.mode !== 'organization'), [sectors])

  const applyPreset = (spec: AgentPresetSpec) => {
    setPreset(spec.preset)
    setObjective(spec.objective)
    setCapabilities(spec.capabilities)
    setSubject('')
    setDeliverable('')
    // A manager delegates by default; every other role starts as a leaf.
    setDelegationPolicy(spec.preset === 'manager' ? 'all' : 'none')
  }

  const reroll = () => setName(randomAgentName(language, name).name)
  const changeLang = (lang: string) => {
    setLanguage(lang)
    setName(randomAgentName(lang).name)
  }
  const addCapability = () => {
    const v = capDraft.trim()
    if (v && !capabilities.includes(v)) setCapabilities((c) => [...c, v])
    setCapDraft('')
  }

  const canNext = step !== 1 || name.trim().length > 0

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const spec = specOf(preset)
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
          capabilities,
          activationModes: spec?.activationModes ?? ['manual', 'channel'],
          inputContract: subject.trim(),
          outputContract: deliverable.trim(),
          ...(essentials.tone ? { responseTone: tone } : {}),
          delegationPolicy,
          callableAgentIds: delegationPolicy === 'selected' ? callableAgentIds : [],
          callableSectorIds: delegationPolicy === 'selected' ? callableSectorIds : [],
          callerPolicy,
          allowedCallerAgentIds: callerPolicy === 'selected' ? allowedCallerAgentIds : [],
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const created = (await res.json()) as { _id: string }
      if (sectorId) await assignAgentToSector(created._id, sectorId).catch(() => undefined)
      onHired()
    } catch {
      setError('Não foi possível contratar o agente.')
      setSaving(false)
    }
  }

  const policyLabel = (p: DelegationPolicy, n: number) => (p === 'all' ? 'qualquer agente do prédio' : p === 'none' ? 'ninguém' : `${n} selecionado(s)`)

  return (
    <div style={{ display: 'grid', gap: 18 }}>
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

      <div style={{ minHeight: 250 }}>
        {/* Step 1 — Função */}
        {step === 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {presets.map((spec) => (
              <ChipToggle key={spec.preset} on={preset === spec.preset} label={spec.label} hint={spec.description} onClick={() => applyPreset(spec)} />
            ))}
          </div>
        ) : null}

        {/* Step 2 — Configuração essencial (preset-specific) */}
        {step === 1 ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <Field label="Nome" hint="Gerado automaticamente conforme o idioma — gere outro se quiser.">
              <div style={{ display: 'flex', gap: 8 }}>
                <Input value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
                <Button variant="secondary" icon="dice-5" onClick={reroll} type="button">
                  Outro
                </Button>
              </div>
            </Field>
            <Field label="Idioma">
              <div style={{ display: 'flex', gap: 6 }}>
                {LANGS.map((l) => (
                  <ChipToggle key={l.value} on={language === l.value} label={l.label} onClick={() => changeLang(l.value)} />
                ))}
              </div>
            </Field>
            <Field label="Objetivo" hint="O que este agente faz — sua instrução principal.">
              <Textarea rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Ex.: pesquisar notícias e entregar um resumo diário." />
            </Field>
            {essentials.subject ? (
              <Field label={essentials.subject}>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </Field>
            ) : null}
            {essentials.deliverable ? (
              <Field label={essentials.deliverable}>
                <Input value={deliverable} onChange={(e) => setDeliverable(e.target.value)} />
              </Field>
            ) : null}
            {essentials.tone ? (
              <Field label="Tom">
                <Select value={tone} onChange={(e) => setTone(e.target.value)} options={TONES} />
              </Field>
            ) : null}
            {essentials.capabilities ? (
              <Field label="Competências" hint="Tags usadas por gerentes para achar este agente por competência.">
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <Input
                    value={capDraft}
                    onChange={(e) => setCapDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCapability()
                      }
                    }}
                    placeholder="Ex.: pesquisa web"
                    style={{ flex: 1 }}
                  />
                  <Button variant="secondary" onClick={addCapability} type="button">
                    Adicionar
                  </Button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {capabilities.map((c) => (
                    <Tag key={c} onRemove={() => setCapabilities((list) => list.filter((x) => x !== c))}>
                      {c}
                    </Tag>
                  ))}
                </div>
              </Field>
            ) : null}
            {essentials.note ? <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{essentials.note}</p> : null}
          </div>
        ) : null}

        {/* Step 3 — Equipe / funcionamento */}
        {step === 2 ? (
          <div style={{ display: 'grid', gap: 18 }}>
            <Field label="Quem este agente pode acionar?" hint="Para delegar tarefas a colaboradores.">
              <PolicyPicker value={delegationPolicy} onChange={setDelegationPolicy} selectedIds={callableAgentIds} onToggleId={(id) => setCallableAgentIds((l) => toggle(l, id))} agents={otherAgents} />
            </Field>
            {delegationPolicy === 'selected' && callableSectors.length > 0 ? (
              <Field label="Equipes (setores) que ele pode acionar">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {callableSectors.map((s) => (
                    <ChipToggle key={s._id} on={callableSectorIds.includes(s._id)} label={s.name} onClick={() => setCallableSectorIds((l) => toggle(l, s._id))} />
                  ))}
                </div>
              </Field>
            ) : null}
            <Field label="Quem pode acionar este agente?">
              <PolicyPicker value={callerPolicy} onChange={setCallerPolicy} selectedIds={allowedCallerAgentIds} onToggleId={(id) => setAllowedCallerAgentIds((l) => toggle(l, id))} agents={otherAgents} />
            </Field>
            <Field label="Setor (opcional)" hint="Equipe onde ele aparece no mapa. Pode definir depois.">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <ChipToggle on={sectorId === ''} label="Sem setor" onClick={() => setSectorId('')} />
                {sectors.map((s) => (
                  <ChipToggle key={s._id} on={sectorId === s._id} label={s.name} onClick={() => setSectorId(s._id)} />
                ))}
              </div>
            </Field>
          </div>
        ) : null}

        {/* Step 4 — Revisão */}
        {step === 3 ? (
          <Card padding="16px" style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
            <Row label="Função" value={specOf(preset)?.label ?? preset} />
            <Row label="Nome" value={name} />
            <Row label="Objetivo" value={objective || '—'} />
            {subject ? <Row label="Recebe" value={subject} /> : null}
            {deliverable ? <Row label="Entrega" value={deliverable} /> : null}
            <Row label="Pode acionar" value={policyLabel(delegationPolicy, callableAgentIds.length)} />
            <Row label="Pode ser acionado por" value={policyLabel(callerPolicy, allowedCallerAgentIds.length)} />
            <Row label="Setor" value={sectors.find((s) => s._id === sectorId)?.name ?? 'Sem setor'} />
          </Card>
        ) : null}
      </div>

      {error ? <p style={{ margin: 0, color: 'var(--status-blocked)', fontSize: 13 }}>{error}</p> : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <Button variant="ghost" onClick={step === 0 ? onCancel : () => setStep((s) => s - 1)} disabled={saving} type="button">
          {step === 0 ? 'Cancelar' : 'Voltar'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext} type="button">
            Próximo
          </Button>
        ) : (
          <Button onClick={submit} disabled={saving} type="button">
            Contratar agente
          </Button>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <span style={{ minWidth: 150, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-heading)', fontWeight: 600 }}>{value}</span>
    </div>
  )
}
