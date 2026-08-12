import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { blankStep, getAutomation, patchAutomation, publishAutomation, runAutomation, setAutomationStatus, validateAutomation } from '../lib/automations'
import type { Automation, AutomationDefinition, StepType, ValidationIssue } from '../lib/automations'
import { Button } from '../ui'

const STEP_TYPES: StepType[] = ['source.rss', 'source.http', 'agent.execute', 'transform.template', 'delivery.send']

// The config field that matters per step type (the linear MVP editor).
const CONFIG_FIELD: Record<StepType, { key: string; label: string }[]> = {
  'source.rss': [{ key: 'url', label: 'URL do feed (RSS)' }],
  'source.http': [{ key: 'url', label: 'URL (GET público)' }],
  'agent.execute': [
    { key: 'agentId', label: 'ID do agente' },
    { key: 'instruction', label: 'Instrução da etapa' },
  ],
  'transform.template': [{ key: 'template', label: 'Template ({{s1}} etc.)' }],
  'delivery.send': [
    { key: 'connectionId', label: 'ID da conexão' },
    { key: 'fromStepId', label: 'Etapa de origem (id)' },
    { key: 'destination', label: 'Destino (e-mail/chatId)' },
  ],
}

export function AutomationEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [automation, setAutomation] = useState<Automation | null>(null)
  const [def, setDef] = useState<AutomationDefinition | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    const a = await getAutomation(id)
    setAutomation(a)
    setDef(a.draftDefinition)
  }, [id])
  useEffect(() => {
    void load()
  }, [load])

  if (!automation || !def) {
    return (
      <AppLayout current="/automations" title="Automação">
        <p style={{ color: 'var(--text-muted)' }}>Carregando…</p>
      </AppLayout>
    )
  }

  const update = (next: Partial<AutomationDefinition>) => setDef({ ...def, ...next })
  const setStepConfig = (i: number, key: string, value: string) => {
    const steps = def.steps.map((s, j) => (j === i ? { ...s, config: { ...s.config, [key]: value } } : s))
    update({ steps })
  }
  const addStep = (type: StepType) => update({ steps: [...def.steps, blankStep(type, def.steps.length + 1)] })
  const removeStep = (i: number) => update({ steps: def.steps.filter((_, j) => j !== i) })

  async function save() {
    setMsg('Salvando…')
    await patchAutomation(automation!.id, { definition: def! })
    await load()
    setMsg('Rascunho salvo.')
  }
  async function validate() {
    await save()
    const r = await validateAutomation(automation!.id)
    setIssues(r.errors)
    setMsg(r.valid ? 'Definição válida.' : `${r.errors.length} problema(s).`)
  }
  async function publish() {
    await save()
    const res = await publishAutomation(automation!.id)
    if (res.ok) {
      setMsg('Versão publicada.')
      await load()
    } else {
      const body = await res.json().catch(() => ({}))
      setIssues((body as { issues?: ValidationIssue[] }).issues ?? [])
      setMsg('Não foi possível publicar — veja os problemas.')
    }
  }
  async function activate() {
    const a = await setAutomationStatus(automation!.id, automation!.status === 'active' ? 'pause' : 'activate')
    setAutomation(a)
  }
  async function run() {
    const r = await runAutomation(automation!.id)
    navigate(`/runs?highlight=${r.id}`)
  }

  return (
    <AppLayout
      current="/automations"
      title={automation.name}
      subtitle={`Status: ${automation.status} · versão publicada: ${automation.lastPublishedVersion ?? '—'}`}
      actions={
        <Link to="/automations" style={{ textDecoration: 'none' }}>
          <Button variant="ghost" icon="arrow-left">
            Automações
          </Button>
        </Link>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section style={panel}>
          <Row label="Gatilho">
            <select value={def.trigger.type} onChange={(e) => update({ trigger: { ...def.trigger, type: e.target.value as AutomationDefinition['trigger']['type'] } })} style={input}>
              <option value="manual">Manual</option>
              <option value="schedule">Agendado</option>
              <option value="webhook">Webhook</option>
            </select>
          </Row>
          {def.trigger.type === 'schedule' && (
            <>
              <Row label="Cron">
                <input value={def.trigger.cron ?? ''} onChange={(e) => update({ trigger: { ...def.trigger, cron: e.target.value } })} placeholder="0 8 * * *" style={input} />
              </Row>
              <Row label="Timezone">
                <input value={def.trigger.timezone ?? ''} onChange={(e) => update({ trigger: { ...def.trigger, timezone: e.target.value } })} placeholder="America/Sao_Paulo" style={input} />
              </Row>
            </>
          )}
          <Row label="Formato do resultado">
            <select value={def.resultFormat} onChange={(e) => update({ resultFormat: e.target.value as AutomationDefinition['resultFormat'] })} style={input}>
              <option value="markdown">Markdown</option>
              <option value="text">Texto</option>
              <option value="json">JSON</option>
            </select>
          </Row>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong>Etapas</strong>
          {def.steps.map((s, i) => (
            <div key={s.id} style={panel}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>
                  {s.id} · {s.type}
                </span>
                <Button variant="ghost" size="sm" onClick={() => removeStep(i)}>
                  Remover
                </Button>
              </div>
              {CONFIG_FIELD[s.type].map((f) => (
                <Row key={f.key} label={f.label}>
                  <input value={String(s.config[f.key] ?? '')} onChange={(e) => setStepConfig(i, f.key, e.target.value)} style={input} />
                </Row>
              ))}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STEP_TYPES.map((t) => (
              <Button key={t} variant="soft" size="sm" onClick={() => addStep(t)}>
                + {t}
              </Button>
            ))}
          </div>
        </section>

        {issues && issues.length > 0 && (
          <ul style={{ ...panel, color: 'var(--intent-danger, #d92d20)', fontSize: 13 }}>
            {issues.map((iss, k) => (
              <li key={k}>
                {iss.path}: {iss.message}
              </li>
            ))}
          </ul>
        )}
        {msg && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{msg}</p>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={save}>Salvar rascunho</Button>
          <Button variant="secondary" onClick={validate}>
            Validar
          </Button>
          <Button variant="secondary" onClick={publish}>
            Publicar versão
          </Button>
          <Button variant="soft" onClick={activate}>
            {automation.status === 'active' ? 'Pausar' : 'Ativar'}
          </Button>
          <Button icon="play" onClick={run}>
            Executar agora
          </Button>
        </div>
      </div>
    </AppLayout>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  )
}

const panel: React.CSSProperties = { display: 'flex', flexDirection: 'column', padding: 14, borderRadius: 12, border: '1px solid var(--border-1,#e4e7ec)', background: 'var(--paper-0,#fff)' }
const input: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-1,#d0d5dd)', font: 'inherit', background: 'var(--paper-0,#fff)', color: 'inherit' }
