import { useEffect, useMemo, useState } from 'react'
import { API_URL } from '../lib/api'
import { randomAgentName } from '../lib/agentNames'
import { listAgentPresets, type AgentPresetSpec } from '../lib/agentPresets'
import { assignAgentToSector } from '../lib/sectors'
import type { ActivationMode, AgentPreset, AgentSummary, SectorSummary } from '../lib/types'
import { Button, Card, Field, Input, Tag, Textarea } from '../ui'

// The 8-step hiring wizard. A preset seeds an editable starting configuration; the
// remaining steps capture the agent-as-primary-unit fields (competencies,
// activations, collaborators, placement) and create the agent. Tools are attached
// afterwards in the agent's Ferramentas tab — kept out of hiring so a new agent is
// never blocked on connecting an app.
// ponytail: tools step is informational (config lives in Ferramentas), upgrade to
// inline app-connect if hiring-time tool setup is ever needed.

const STEPS = ['Perfil', 'Nome & objetivo', 'Competências', 'Ferramentas', 'Acionamentos', 'Colaboração', 'Setor & andar', 'Revisão']

const ACTIVATION_OPTIONS: { value: ActivationMode; label: string; hint: string }[] = [
  { value: 'manual', label: 'Manual', hint: 'Você aciona quando quiser' },
  { value: 'scheduled', label: 'Agendado', hint: 'Roda em rotinas' },
  { value: 'event', label: 'Evento', hint: 'Disparado por um webhook' },
  { value: 'channel', label: 'Canal', hint: 'Responde em um canal' },
  { value: 'agent_only', label: 'Só por agente', hint: 'Só outro agente aciona' },
]

const LANGS: { value: string; label: string }[] = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'Inglês' },
  { value: 'es', label: 'Espanhol' },
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

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export function HireWizard({
  floorId,
  floorName,
  agents,
  sectors,
  onHired,
  onCancel,
}: {
  floorId?: string
  floorName?: string
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
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [capDraft, setCapDraft] = useState('')
  const [activationModes, setActivationModes] = useState<ActivationMode[]>(['manual', 'channel'])
  const [inputContract, setInputContract] = useState('')
  const [outputContract, setOutputContract] = useState('')
  const [callableAgentIds, setCallableAgentIds] = useState<string[]>([])
  const [callableSectorIds, setCallableSectorIds] = useState<string[]>([])
  const [allowedCallerAgentIds, setAllowedCallerAgentIds] = useState<string[]>([])
  const [sectorId, setSectorId] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listAgentPresets().then(setPresets).catch(() => setPresets([]))
  }, [])

  // Selecting a preset seeds the editable fields (only where still untouched-ish:
  // we always overwrite from a preset pick, since it's an explicit choice).
  const applyPreset = (spec: AgentPresetSpec) => {
    setPreset(spec.preset)
    setObjective(spec.objective)
    setCapabilities(spec.capabilities)
    setActivationModes(spec.activationModes)
    setInputContract(spec.inputContract)
    setOutputContract(spec.outputContract)
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

  const otherAgents = useMemo(() => agents.filter((a) => a.name), [agents])

  const canNext = step !== 1 || name.trim().length > 0

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
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
          activationModes,
          inputContract: inputContract.trim(),
          outputContract: outputContract.trim(),
          callableAgentIds,
          callableSectorIds,
          allowedCallerAgentIds,
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

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Stepper */}
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

      <div style={{ minHeight: 240 }}>
        {step === 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {presets.map((spec) => (
              <ChipToggle key={spec.preset} on={preset === spec.preset} label={spec.label} hint={spec.description} onClick={() => applyPreset(spec)} />
            ))}
          </div>
        ) : null}

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
          </div>
        ) : null}

        {step === 2 ? (
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
              {capabilities.length === 0 ? (
                <span style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Nenhuma competência ainda.</span>
              ) : (
                capabilities.map((c) => (
                  <Tag key={c} onRemove={() => setCapabilities((list) => list.filter((x) => x !== c))}>
                    {c}
                  </Tag>
                ))
              )}
            </div>
          </Field>
        ) : null}

        {step === 3 ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-heading)', fontWeight: 700 }}>Ferramentas</p>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>
              As ferramentas (apps e integrações) são conectadas depois da contratação, na aba <strong>Ferramentas</strong> do agente. Quando faltar alguma
              capacidade, o próprio agente sinaliza e sugere contratar quem falta.
            </p>
          </div>
        ) : null}

        {step === 4 ? (
          <Field label="Acionamentos" hint="Como este agente pode ser disparado.">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {ACTIVATION_OPTIONS.map((o) => (
                <ChipToggle key={o.value} on={activationModes.includes(o.value)} label={o.label} hint={o.hint} onClick={() => setActivationModes((m) => toggle(m, o.value))} />
              ))}
            </div>
          </Field>
        ) : null}

        {step === 5 ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <Field label="Pode acionar estes agentes" hint="Vazio = pode acionar qualquer agente do prédio (se o outro permitir).">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxHeight: 160, overflowY: 'auto' }}>
                {otherAgents.map((a) => (
                  <ChipToggle key={a._id} on={callableAgentIds.includes(a._id)} label={a.name} onClick={() => setCallableAgentIds((l) => toggle(l, a._id))} />
                ))}
              </div>
            </Field>
            {sectors.length > 0 ? (
              <Field label="Pode acionar estes setores">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {sectors.map((s) => (
                    <ChipToggle key={s._id} on={callableSectorIds.includes(s._id)} label={s.name} onClick={() => setCallableSectorIds((l) => toggle(l, s._id))} />
                  ))}
                </div>
              </Field>
            ) : null}
            <Field label="Pode ser acionado por" hint="Vazio = qualquer agente do prédio.">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxHeight: 160, overflowY: 'auto' }}>
                {otherAgents.map((a) => (
                  <ChipToggle key={a._id} on={allowedCallerAgentIds.includes(a._id)} label={a.name} onClick={() => setAllowedCallerAgentIds((l) => toggle(l, a._id))} />
                ))}
              </div>
            </Field>
          </div>
        ) : null}

        {step === 6 ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <Field label="Andar">
              <Input value={floorName ?? 'Andar atual'} disabled />
            </Field>
            <Field label="Setor (opcional)" hint="Equipe onde o agente vai trabalhar. Pode definir depois.">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <ChipToggle on={sectorId === ''} label="Sem setor" onClick={() => setSectorId('')} />
                {sectors.map((s) => (
                  <ChipToggle key={s._id} on={sectorId === s._id} label={s.name} onClick={() => setSectorId(s._id)} />
                ))}
              </div>
            </Field>
          </div>
        ) : null}

        {step === 7 ? (
          <Card padding="16px" style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
            <Row label="Perfil" value={presets.find((p) => p.preset === preset)?.label ?? preset} />
            <Row label="Nome" value={name} />
            <Row label="Objetivo" value={objective || '—'} />
            <Row label="Competências" value={capabilities.join(', ') || '—'} />
            <Row label="Acionamentos" value={activationModes.map((m) => ACTIVATION_OPTIONS.find((o) => o.value === m)?.label ?? m).join(', ') || '—'} />
            <Row label="Pode acionar" value={`${callableAgentIds.length} agente(s), ${callableSectorIds.length} setor(es)`} />
            <Row label="Acionado por" value={allowedCallerAgentIds.length === 0 ? 'Qualquer agente' : `${allowedCallerAgentIds.length} agente(s)`} />
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
      <span style={{ minWidth: 130, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-heading)', fontWeight: 600 }}>{value}</span>
    </div>
  )
}
