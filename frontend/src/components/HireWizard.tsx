import { useEffect, useMemo, useState } from 'react'
import { API_URL } from '../lib/api'
import { randomAgentName } from '../lib/agentNames'
import { AgentDefinitionFields, AgentRunConfigFields, type AgentDefinitionValue } from './AgentDefinitionFields'
import { cleanRunConfig, type RunConfig } from '../lib/runConfig'
import { listAgentPresets, type AgentPresetSpec } from '../lib/agentPresets'
import { PAPEIS_OUTROS, PAPEIS_PRINCIPAIS, ehPrincipal } from '../lib/agentRoles'
import { AgentExecutorSection, executorProblems } from './AgentExecutorSection'
import type { ExecutorDraft } from './AgentExecutorSection'
import { roleConfigOf } from '../lib/agentCapabilities'
import { reachableCollaboratorCount } from '../lib/agentReadiness'
import { useBuildingPeers } from '../lib/useBuildingPeers'
import { assignAgentToSector } from '../lib/sectors'
import type { AgentPreset, AgentSummary, SectorSummary, ProviderInfo} from '../lib/types'
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

// What still has to be done after hiring, in the user's words — and WHERE it is
// done, so every item is a button straight to that section instead of a sentence
// the user has to go hunting for.
interface PendingItem {
  key: string
  label: string
  action: string
  section: 'como-trabalha' | 'fluxos' | 'visao-geral' | 'fluxos#colaboracao'
}
const PENDING: Record<string, PendingItem> = {
  research: { key: 'research', label: 'Conectar uma fonte de pesquisa (app ou ferramenta)', action: 'Conectar ferramenta', section: 'como-trabalha' },
  action: { key: 'action', label: 'Conectar o app onde ele vai executar a ação', action: 'Conectar app', section: 'como-trabalha' },
  source: { key: 'source', label: 'Conectar a fonte que ele vai acompanhar', action: 'Conectar fonte', section: 'como-trabalha' },
  knowledge: { key: 'knowledge', label: 'Dar a ele o conhecimento que precisa consultar', action: 'Abrir conhecimento', section: 'como-trabalha' },
  routine: { key: 'routine', label: 'Criar a rotina que acorda ele', action: 'Criar rotina', section: 'fluxos' },
  channel: { key: 'channel', label: 'Vincular o canal onde ele vai atender', action: 'Vincular canal', section: 'fluxos' },
  destination: { key: 'destination', label: 'Definir para onde a entrega vai', action: 'Definir destino', section: 'fluxos' },
  collaborators: { key: 'collaborators', label: 'Escolher os colegas que ele pode acionar', action: 'Escolher colegas', section: 'fluxos#colaboracao' },
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

function Choice({ on, label, cargo, hint, onClick, testId }: { on: boolean; label: string; cargo?: string; hint?: string; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      style={{
        textAlign: 'left',
        padding: '10px 12px',
        borderRadius: 'var(--radius-control)',
        border: `1px solid ${on ? 'var(--intent-brand)' : 'var(--border-subtle)'}`,
        background: on ? 'var(--intent-brand-soft)' : 'var(--surface-card)',
        color: on ? 'var(--text-heading)' : 'var(--text-heading)',
        cursor: 'pointer',
        fontFamily: 'var(--font-ui)',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 700 }}>
        {label}
        {/* O cargo continua visível: quem já conhece o sistema procura por ele. */}
        {cargo ? <span style={{ fontWeight: 500, color: on ? 'var(--text-heading)' : 'var(--text-faint)' }}> · {cargo}</span> : null}
      </div>
      {hint ? <div style={{ fontSize: 12, color: on ? 'var(--text-heading)' : 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{hint}</div> : null}
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
  // `section` deep-links the agent page straight to where the pendency is solved.
  onHired: (agent?: { _id: string; name: string }, section?: string) => void
  onCancel: () => void
  initialPreset?: AgentPreset
  initialSectorId?: string
}) {
  const [step, setStep] = useState(initialPreset ? 1 : 0)
  const [presets, setPresets] = useState<AgentPresetSpec[]>([])
  // Só nasce aberto quando ALGUÉM já escolheu um papel de lá — vindo de um checklist,
  // por exemplo: fechar em cima do que está marcado esconderia justamente a resposta.
  // Sem escolha nenhuma, o padrão interno é 'custom', e abrir por causa dele deixaria a
  // seção sempre aberta, que é o contrário do ponto.
  const [outrosAbertos, setOutrosAbertos] = useState(initialPreset ? !ehPrincipal(initialPreset) : false)
  const [preset, setPreset] = useState<AgentPreset>(initialPreset ?? 'custom')
  // A definição sugerida pelo modelo, editável. Fica em "Configuração avançada": o
  // caminho simples continua sendo três perguntas.
  const [definicao, setDefinicao] = useState<AgentDefinitionValue>({ role: '', instructions: '', constraints: '' })
  const [runConfig, setRunConfig] = useState<RunConfig>({})
  const [avancadoAberto, setAvancadoAberto] = useState(false)
  /**
   * COMO ele executa — a decisão mais consequente do formulário.
   *
   * Ela vivia só na edição, sob "Avançado": não dava para CRIAR um agente de função pelo
   * painel. Era preciso criar um agente de IA, salvar, entrar nele e trocar o tipo — três
   * passos para uma escolha que muda tudo o que vem depois, e que quem não sabia que
   * existia nunca encontrava.
   */
  const [executor, setExecutor] = useState<ExecutorDraft>({
    kind: 'llm',
    functionName: '',
    functionVersion: '',
    appKey: '',
    actionKey: '',
    responseMode: 'text',
    config: {},
  })
  const executando = executor.kind !== 'llm'
  /**
   * Busca na web, escolhida JÁ na contratação.
   *
   * Antes ela só existia na edição, e por um motivo acidental: o bloco inteiro dependia
   * de um agente já criado, porque os SITES precisam de um id para serem gravados. A
   * busca não precisa — ela é configuração, e vai junto no primeiro salvamento.
   */
  const [buscaWeb, setBuscaWeb] = useState<{ enabled: boolean; policy: 'automatic' | 'fallback_only' | 'always'; rememberDays?: number; maxPagesToRead?: number }>({
    enabled: false,
    // O padrão passa a ser o que evita resposta incompleta: procurar também quando a base
    // responde de longe. "Só quando não tiver nada" deixava passar o caso comum — trechos
    // que falam do assunto sem responder à pergunta.
    policy: 'automatic',
  })
  // O catálogo real de provedores/modelos, o MESMO da edição. Fixar `anthropic`/`null`
  // aqui obrigava a contratar e depois editar para escolher o modelo — e a escolha do
  // modelo é justamente o que muda custo e qualidade desde a primeira execução.
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic')
  const [model, setModel] = useState('')

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
    fetch(`${API_URL}/api/providers`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: ProviderInfo[]) => setProviders(Array.isArray(lista) ? lista : []))
      .catch(() => setProviders([]))
  }, [])

  useEffect(() => {
    listAgentPresets()
      .then((list) => {
        setPresets(list)
        // Pre-picked role: adopt its default objective as if the user had clicked it.
        const picked = initialPreset ? list.find((p) => p.preset === initialPreset) : null
        if (picked) {
          setObjective((prev) => (prev.trim() ? prev : picked.objective))
          setDefinicao((atual) => ({
            role: atual.role.trim() ? atual.role : (picked.role ?? ''),
            instructions: atual.instructions.trim() ? atual.instructions : (picked.instructions ?? ''),
            constraints: atual.constraints.trim() ? atual.constraints : (picked.constraints ?? ''),
          }))
        }
      })
      .catch(() => setPresets([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const spec = useMemo(() => presets.find((p) => p.preset === preset), [presets, preset])
  const form = ROLE_FORM[preset]
  // A mesma regra do resto do sistema: só quem COLETA pode procurar páginas novas.
  const podeBuscar = roleConfigOf({ preset }).sections.includes('busca-web')
  // Collaboration spans the whole building: a colleague one floor up is a real
  // collaborator, and the backend has always counted it as one.
  const peers = useBuildingPeers()
  const otherAgents = useMemo(() => (peers.agents.length > 0 ? peers.agents : agents).filter((a) => a.name), [peers.agents, agents])
  const callableSectors = useMemo(() => (peers.sectors.length > 0 ? peers.sectors : sectors.filter((s) => s.mode !== 'organization')), [peers.sectors, sectors])

  /**
   * Trocar de modelo preenche o que está VAZIO, e só isso.
   *
   * O objetivo continua sendo substituído porque no assistente ele é gerado a partir do
   * modelo e das respostas — quem escreveu texto próprio já está em "Configuração
   * avançada", e é lá que ele fica protegido.
   *
   * Os blocos da definição, esses, nunca são sobrescritos: passar por cima de uma
   * instrução que a pessoa escreveu, sem avisar, é perder trabalho dela.
   */
  const applyPreset = (s: AgentPresetSpec) => {
    setPreset(s.preset)
    setObjective(s.objective)
    setSubject('')
    setDeliverable('')
    setDefinicao((atual) => ({
      role: atual.role.trim() ? atual.role : (s.role ?? ''),
      instructions: atual.instructions.trim() ? atual.instructions : (s.instructions ?? ''),
      constraints: atual.constraints.trim() ? atual.constraints : (s.constraints ?? ''),
    }))
  }

  // How many colleagues this agent could REALLY reach once hired — the same rule the
  // API uses, so the wizard never promises a manager that is alone in the building.
  const reachable = useMemo(() => {
    const picked = collaborators.length > 0 || collaboratorSectors.length > 0
    return reachableCollaboratorCount(
      {
        delegationPolicy: form.collaborators ? (picked ? 'selected' : (spec?.delegationPolicy ?? 'all')) : (spec?.delegationPolicy ?? 'none'),
        callableAgentIds: collaborators,
        callableSectorIds: collaboratorSectors,
      },
      otherAgents,
      callableSectors,
    )
  }, [form.collaborators, spec, collaborators, collaboratorSectors, otherAgents, callableSectors])

  // What this agent will still be missing right after hiring.
  const pending = useMemo(() => {
    const items: PendingItem[] = []
    if (form.needsTool) items.push(PENDING[form.needsTool])
    if (form.needsRoutine) items.push(PENDING.routine)
    if (form.needsDestination) items.push(PENDING.destination)
    // A manager is no exception: a permission is not a colleague.
    if (form.collaborators && reachable === 0) items.push(PENDING.collaborators)
    return items
  }, [form, reachable])

  // Um agente de função sem função escolhida é uma configuração que a API recusa. Barrar
  // aqui é a diferença entre uma frase no formulário e um erro depois de clicar em criar.
  const problemasDoExecutor = executorProblems(executor)
  const canAdvance = step !== 1 || (name.trim().length > 0 && problemasDoExecutor.length === 0)

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
          provider,
          // Vazio = padrão do sistema, que é o comportamento de sempre.
          model: model || null,
          language,
          floorId,
          preset,
          capabilities: spec?.capabilities ?? [],
          // A specialist ships with NO operational trigger: it is called by a manager
          // or a sector, and "Testar" runs it without one.
          activationModes: spec?.activationModes ?? [],
          inputContract: subject.trim(),
          outputContract: deliverable.trim(),
          // Só para quem PODE buscar. Mandar o campo para outro papel gravaria uma
          // configuração que o motor ignora — e que apareceria como promessa na tela.
          ...(podeBuscar && buscaWeb.enabled ? { webSearch: buscaWeb } : {}),
          ...(form.tone ? { responseTone: tone } : {}),
          delegationPolicy,
          callableAgentIds: picked ? collaborators : [],
          callableSectorIds: picked ? collaboratorSectors : [],
          // Reachable by other agents — the permission that replaced agent_only.
          callerPolicy: spec?.callerPolicy ?? 'all',
          // A definição e a configuração vão na CRIAÇÃO. Antes elas só existiam no
          // PATCH: contratar um agente pronto exigia criar e depois editar, e o que
          // fosse esquecido no segundo passo simplesmente não existia.
          role: definicao.role.trim(),
          instructions: definicao.instructions.trim(),
          constraints: definicao.constraints.trim(),
          runConfig: cleanRunConfig(runConfig),
          /**
           * O tipo e a referência, na CRIAÇÃO.
           *
           * Só quando não é `llm`: um agente de IA continua sendo gravado exatamente como
           * sempre foi, sem ganhar campo que ninguém pediu. Os schemas não vão daqui — o
           * servidor os deriva do registro, que é quem executa.
           */
          ...(executor.kind === 'function'
            ? {
                executorKind: 'function',
                responseMode: 'structured',
                executorConfig: {
                  kind: 'function',
                  functionName: executor.functionName,
                  ...(executor.functionVersion ? { version: executor.functionVersion } : {}),
                  ...(Object.keys(executor.config).length > 0 ? { config: executor.config } : {}),
                },
              }
            : {}),
          ...(executor.kind === 'tool'
            ? {
                executorKind: 'tool',
                responseMode: executor.responseMode,
                executorConfig: { kind: 'tool', appKey: executor.appKey, actionKey: executor.actionKey },
              }
            : {}),
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
            <div key={item.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} data-testid="hire-pending-item">
              <span style={{ width: 18, height: 18, borderRadius: 999, border: '1px solid var(--border-strong)', flexShrink: 0 }} />
              <span style={{ fontSize: 13.5, color: 'var(--text-heading)', flex: 1, minWidth: 180 }}>{item.label}</span>
              {/* Every pendency is one click from being solved, in the exact section. */}
              <Button variant="ghost" onClick={() => onHired(hired, item.section)} data-testid={`hire-pending-action-${item.key}`}>
                {item.action}
              </Button>
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
              background: i === step ? 'var(--intent-brand)' : i < step ? 'var(--intent-brand-soft)' : 'var(--surface-sunken)',
              color: i === step ? 'var(--text-on-brand)' : i < step ? 'var(--text-heading)' : 'var(--text-muted)',
            }}
          >
            {i + 1}. {label}
          </span>
        ))}
      </div>

      <div style={{ minHeight: 260 }}>
        {/* 1 — Função */}
        {step === 0 ? (
          <div style={{ display: 'grid', gap: 12 }} data-testid="role-picker">
            {/* O verbo primeiro. Oito cargos lado a lado obrigam a ler os oito para
                descobrir que a diferença entre dois deles é quem chama quem. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 10 }}>
              {PAPEIS_PRINCIPAIS.map((papel) => {
                const s = presets.find((p) => p.preset === papel.preset)
                return s ? (
                  <Choice
                    key={papel.preset}
                    on={preset === papel.preset}
                    label={papel.verbo}
                    cargo={papel.cargo}
                    hint={ROLE_FORM[papel.preset]?.hint ?? s.description}
                    onClick={() => applyPreset(s)}
                    testId={`role-${papel.preset}`}
                  />
                ) : null
              })}
            </div>
            <div>
              <button
                type="button"
                onClick={() => setOutrosAbertos((v) => !v)}
                aria-expanded={outrosAbertos}
                data-testid="role-picker-others-toggle"
                style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12.5, color: 'var(--text-muted)' }}
              >
                {outrosAbertos ? '▾' : '▸'} Outros perfis (casos específicos)
              </button>
              {outrosAbertos ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 10, marginTop: 10 }} data-testid="role-picker-others">
                  {PAPEIS_OUTROS.map((papel) => {
                    const s = presets.find((p) => p.preset === papel.preset)
                    return s ? (
                      <Choice
                        key={papel.preset}
                        on={preset === papel.preset}
                        label={papel.verbo}
                        cargo={papel.cargo}
                        hint={ROLE_FORM[papel.preset]?.hint ?? s.description}
                        onClick={() => applyPreset(s)}
                        testId={`role-${papel.preset}`}
                      />
                    ) : null
                  })}
                </div>
              ) : null}
            </div>
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

            {/*
              A escolha do EXECUTOR, entre as perguntas principais.
              Ela decide se este agente chama um provedor ou roda código — e decide quais
              das perguntas abaixo fazem sentido. Escondê-la em "avançado" era pedir que
              alguém adivinhasse que ela existe.
            */}
            <div data-testid="hire-executor">
              <AgentExecutorSection draft={executor} onChange={setExecutor} />
            </div>

            {!executando && form.subject ? (
              <Field label={form.subject.label} hint={form.subject.help}>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={form.subject.placeholder} />
              </Field>
            ) : null}
            {!executando && form.deliverable ? (
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
                  <span key={p.key} style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    • {p.label}
                  </span>
                ))}
              </Card>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Configuração avançada: recolhida, e fora do caminho das três perguntas. Quem
          quer contratar rápido não vê nada disto; quem quer ajustar não precisa criar e
          editar depois. */}
      <div className="border-t border-(--border-subtle) pt-3">
        <button
          type="button"
          onClick={() => setAvancadoAberto((v) => !v)}
          className="flex w-full items-center gap-1.5 text-sm text-(--text-muted) transition hover:text-(--text-heading)"
          data-testid="hire-advanced-toggle"
        >
          <span className={`transition-transform ${avancadoAberto ? 'rotate-90' : ''}`}>▸</span>
          Configuração avançada
          <span className="text-xs text-(--text-faint)">(opcional)</span>
        </button>
        {avancadoAberto ? (
          <div className="mt-3 grid gap-5" data-testid="hire-advanced">
            <AgentDefinitionFields value={definicao} onChange={setDefinicao} presetLabel={spec?.label ?? null} />

            {/* BUSCA EM TODA A WEB — só para quem coleta, e desligada por padrão.

                Os SITES específicos ficam para depois de criar: cada endereço é gravado
                na hora em que é adicionado, e para isso o agente precisa existir. Esta
                configuração não precisa, então não há razão para adiá-la. */}
            {podeBuscar && (
              <div className="grid gap-2 rounded-lg border border-(--border-subtle) p-3" data-testid="hire-web-search">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={buscaWeb.enabled}
                    onChange={(e) => setBuscaWeb({ ...buscaWeb, enabled: e.target.checked })}
                    data-testid="hire-web-search-enabled"
                  />
                  <span>
                    Permitir busca na web
                    <span className="block text-xs text-(--text-faint)">
                      Deixa o pesquisador procurar novas fontes na internet quando a base e os sites cadastrados não bastarem. Os sites você
                      cadastra depois de criar.
                    </span>
                  </span>
                </label>
                {buscaWeb.enabled && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs text-(--text-muted)">Quando pesquisar</label>
                      <select
                        value={buscaWeb.policy}
                        onChange={(e) => setBuscaWeb({ ...buscaWeb, policy: e.target.value as typeof buscaWeb.policy })}
                        data-testid="hire-web-search-policy"
                        className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                      >
                        <option value="fallback_only">Só quando a base não responder</option>
                        <option value="automatic">Automático</option>
                        <option value="always">Sempre</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-(--text-muted)">Guardar o que achou por (dias)</label>
                      <input
                        type="number"
                        min={0}
                        placeholder="7"
                        value={buscaWeb.rememberDays ?? ''}
                        onChange={(e) => setBuscaWeb({ ...buscaWeb, rememberDays: e.target.value ? Number(e.target.value) : undefined })}
                        data-testid="hire-web-search-remember"
                        className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                      />
                      <p className="mt-0.5 text-[11px] text-(--text-faint)">0 = não guardar. O resto se ajusta depois, no agente.</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-(--text-muted)">Provedor</label>
                <select
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value as 'anthropic' | 'openai')
                    // Modelo é específico do provedor: manter o anterior apontaria para
                    // um nome que o novo não conhece.
                    setModel('')
                  }}
                  className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                  data-testid="hire-provider"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-(--text-muted)">Modelo</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                  data-testid="hire-model"
                >
                  <option value="">Padrão do sistema</option>
                  {(providers.find((p) => p.id === provider)?.models ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* A matriz decide o que aparece aqui, e ela depende do modelo escolhido
                acima — por isso os dois selects vêm antes. */}
            <AgentRunConfigFields value={runConfig} onChange={setRunConfig} provider={provider} model={model || null} />
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
