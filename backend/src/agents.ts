import { ObjectId } from 'mongodb'
import { roleUIConfigOf } from './agentCapabilities.js'
import { MAX_ORCHESTRATION_ROUNDS, MAX_TASKS } from './sectorPlanner.js'
import { normalizeWebSearch } from './webSearch/policy.js'
import type { ExecutorConfig, ExecutorKind, ResponseMode } from './executors/types.js'
import { agentContractOf, parseAgentContract } from './executors/contract.js'
import type { AgentContract, AgentContractInput } from './executors/contract.js'
import type { WebSearchSettings } from './webSearch/policy.js'
import type { RoleUIConfig } from './agentCapabilities.js'
import { db } from './db.js'
import type { ArchitectStamp } from './architectStamp.js'
import { isValidToolSchema } from './jsonSchema.js'
import type { Provider } from './llm.js'
import type { AgentAppGrant } from './apps/types.js'
import type { RunConfig } from './runConfig.js'
import { isSecretLegacyConfigKey } from './apps/registry.js'
// Type-only cycle back to agents.ts, so there is no runtime import loop.
import { sanitizeActivationWrite } from './agentReadiness.js'

export const DEFAULT_HISTORY_LIMIT = 6

export type MemoryType = 'none' | 'facts' | 'structured' | 'semantic'
export const MEMORY_TYPES: MemoryType[] = ['none', 'facts', 'structured', 'semantic']

export type ConversationPersistence = 'same_browser' | 'always_new'
export const CONVERSATION_PERSISTENCE_TYPES: ConversationPersistence[] = ['same_browser', 'always_new']

export type GuardrailMode = 'none' | 'prompt' | 'verification'
export const GUARDRAIL_MODES: GuardrailMode[] = ['none', 'prompt', 'verification']

export type ResponseTone = 'neutral' | 'friendly' | 'formal' | 'enthusiastic'
export const RESPONSE_TONES: ResponseTone[] = ['neutral', 'friendly', 'formal', 'enthusiastic']

export type ResponseDetail = 'balanced' | 'concise' | 'detailed'
export const RESPONSE_DETAILS: ResponseDetail[] = ['balanced', 'concise', 'detailed']

export type Language = 'pt' | 'en' | 'es' | 'auto'
export const LANGUAGES: Language[] = ['pt', 'en', 'es', 'auto']

// The role preset an agent was created from — a STARTING configuration, never a hard
// limit (every field stays editable afterwards). 'custom' = the old free-form agent.
export type AgentPreset = 'manager' | 'secretary' | 'researcher' | 'analyst' | 'operator' | 'communicator' | 'monitor' | 'custom'
export const AGENT_PRESETS: AgentPreset[] = ['manager', 'secretary', 'researcher', 'analyst', 'operator', 'communicator', 'monitor', 'custom']

// How an agent may be triggered. An agent can have several.
//
// 'agent_only' is LEGACY and read-only: it never was a trigger, it meant "reachable
// only by another agent", which callerPolicy models. Old documents still carry it and
// keep working (normalizeActivation drops it, callerPolicyFromLegacy preserves the
// permission); nothing writes it again — see sanitizeActivationWrite.
export type ActivationMode = 'manual' | 'scheduled' | 'event' | 'channel' | 'agent_only'
// The modes a client may SET. agent_only is deliberately absent.
export const ACTIVATION_MODES: ActivationMode[] = ['manual', 'scheduled', 'event', 'channel']
// Accepted on input for backward compatibility, then converted, never stored.
export const LEGACY_ACTIVATION_MODES: ActivationMode[] = ['agent_only']

// Delegation permission, modelled explicitly so an empty list is never ambiguous
// (it used to mean both "anyone" and "no one"). Applies to BOTH directions:
//   outgoing (delegationPolicy): whom this agent may delegate to.
//   incoming (callerPolicy): who may call this agent.
// 'none' = nobody; 'all' = any agent in the SAME BUILDING; 'selected' = only the
// matching id list (callableAgentIds / allowedCallerAgentIds).
// 'floor' = only agents and executable sectors of the SAME floor. It sits between
// 'selected' (explicit ids) and 'all' (the whole building) and is what a floor
// coordinator normally wants: reach my area, not the building.
export type DelegationPolicy = 'none' | 'all' | 'selected' | 'floor'
export const DELEGATION_POLICIES: DelegationPolicy[] = ['none', 'all', 'selected', 'floor']

// The card KPI an agent shows in position 3. A concrete key is a MANUAL choice and
// is never overwritten by a preset change; 'auto' derives the key from the preset at
// read time (so changing the preset moves only the automatic default).
export type MetricKey = 'executions' | 'delegations' | 'tool_actions' | 'deliveries' | 'conversations' | 'leads'
export type MetricProfile = 'auto' | MetricKey
export const METRIC_PROFILES: MetricProfile[] = ['auto', 'executions', 'delegations', 'tool_actions', 'deliveries', 'conversations', 'leads']

export const MAX_DAILY_MESSAGE_LIMIT = 1000
export const MAX_TOOLS = 10
export const MAX_TOOL_PARAMS = 10

export type ToolMethod = 'GET' | 'POST'
export const TOOL_METHODS: ToolMethod[] = ['GET', 'POST']

export type ToolParamType = 'string' | 'number' | 'boolean'
export const TOOL_PARAM_TYPES: ToolParamType[] = ['string', 'number', 'boolean']

export interface AgentToolParam {
  name: string
  type: ToolParamType
  description: string
  required: boolean
}

export interface AgentToolHeader {
  key: string
  value: string
}

// DEPRECATED per-agent HTTP tool. Superseded by the reusable Custom Tools
// (collection `tools`, assigned by id), which carry an encrypted credential, a
// domain allow list, per-run call limits and an explicit authorisation for
// state-changing methods.
//
// Existing tools keep working untouched: agentTools.legacyToolToExecutable adapts
// this shape at resolution time so it runs through the SAME executor as everything
// else. Nothing new should be written in this format.
export interface AgentTool {
  name: string
  description: string
  method: ToolMethod
  url: string
  headers: AgentToolHeader[]
  parameters: AgentToolParam[]
}

// Reusable Custom Tools (collection `tools`) this agent is allowed to call, by id.
// An agent can ONLY call what is listed here — assignment is the permission.
// The legacy per-agent `tools` array below still works and is resolved alongside.

// A built-in integration ("app") enabled on the agent, with its per-agent config
// (e.g. which spreadsheet). See builtinTools.ts for the catalog.
//
// DEPRECATED — this is where a credential used to live in the clear, inside the
// agent document. It is read-only during the transition: the migration moves the
// credential into an encrypted installation and leaves only non-secret selection
// here. New configuration goes through `appGrants`.
export interface AgentBuiltinTool {
  key: string
  config: Record<string, string>
  // Stamped by the migration. Present = the credential already lives in an
  // installation and must not be read from here again.
  migratedAt?: Date
}

/**
 * Quando um endereço é consultado.
 *
 *   on_demand — só quando o agente julgar que a pergunta pede. Custa zero enquanto
 *               ninguém precisa; é o padrão.
 *   always    — em toda chamada, e o conteúdo entra no contexto. Previsível e caro:
 *               paga tokens mesmo quando a pergunta não tem nada a ver com o site.
 *   on_change — consulta em toda chamada e só injeta quando MUDOU desde a última vez.
 *               Zero na maioria dos turnos, com o conteúdo aparecendo quando importa.
 */
export type WatchedSourceWhen = 'on_demand' | 'always' | 'on_change'
export const WATCHED_SOURCE_WHEN: readonly WatchedSourceWhen[] = ['on_demand', 'always', 'on_change']

/** Um endereço que o agente pode consultar. */
export interface WatchedSource {
  id: string
  name: string
  kind: 'rss' | 'http'
  url: string
  /** Quando o conteúdo entra no PROMPT: sempre, quando mudar, ou só se o agente pedir. */
  when: WatchedSourceWhen
  /** Só feed: quanto para trás olhar. Ignorado numa página. */
  initialWindow: '24h' | '3d' | '7d'

  /**
   * Como este endereço vira CONHECIMENTO — documento na base, e não texto de um prompt.
   *
   * Tudo opcional, e ausente significa `manual`: uma fonte cadastrada antes disto existir
   * não passa a consumir banda sozinha. Ver `webSourcePolicy.ts` para a decisão.
   */
  enabled?: boolean
  refreshMode?: WebRefreshMode
  intervalMinutes?: number
  maxStalenessMinutes?: number
  discoveryMode?: WebDiscoveryMode
  /**
   * Como LER cada página: `auto` tenta HTTP e cai para o navegador quando o conteúdo só
   * existe depois do JavaScript; `http` nunca abre navegador; `browser` já começa nele.
   */
  readMode?: 'auto' | 'http' | 'browser'
  crawlArticles?: boolean
  maxArticlesPerRun?: number
  maxDepth?: number
  sameDomainOnly?: boolean
  /** Endereços que o dono apagou da base e não quer de volta no próximo scan. */
  ignoredUrls?: string[]
  /** Marca da migração de padrão: `manual` → `on_demand`. Impede que ela rode duas vezes. */
  refreshModeMigratedAt?: Date

  /** O que aconteceu na última leitura. Escrito pelo gerente, lido pela tela. */
  lastFetchedAt?: Date | null
  lastSuccessfulFetchAt?: Date | null
  nextScheduledAt?: Date | null
  lastError?: string | null
  status?: 'never_run' | 'ok' | 'error' | 'running'
  discoveredUrls?: number
  newDocuments?: number
  updatedDocuments?: number
}

export type WebRefreshMode = 'scheduled' | 'on_demand' | 'manual' | 'hybrid'
export type WebDiscoveryMode = 'auto' | 'rss' | 'sitemap' | 'listing' | 'single_page'

/**
 * O que o dono decide sobre o custo dessas consultas.
 *
 * Eram números que EU escolhi, escondidos no código: quantos itens voltam, quanto texto
 * cabe, quantos endereços existem. Quem paga a conta é quem deve decidir — dentro de um
 * teto de sistema, que existe para um engano de digitação não virar um prompt de cem mil
 * caracteres.
 */
export interface AgentSourceSettings {
  maxItems: number
  charBudget: number
  maxSources: number
  /** O nome da ferramenta como o modelo a vê. Saneado: provedor só aceita [a-zA-Z0-9_-]. */
  toolName?: string
  /** Quando o agente deve consultar, nas palavras do dono. */
  toolDescription?: string
}

// Tetos de SISTEMA. O dono escolhe abaixo deles; acima seria transformar um engano de
// digitação numa conta inesperada.
export const SOURCE_LIMITS = {
  maxItems: { padrao: 8, min: 1, max: 30 },
  charBudget: { padrao: 2400, min: 200, max: 20000 },
  maxSources: { padrao: 5, min: 1, max: 20 },
} as const

export const MAX_WATCHED_SOURCES = SOURCE_LIMITS.maxSources.max

export const sourceSettingsOf = (agent: { sourceSettings?: Partial<AgentSourceSettings> | null }): AgentSourceSettings => {
  const s = agent.sourceSettings ?? {}
  const clamp = (v: unknown, faixa: { padrao: number; min: number; max: number }): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(faixa.min, Math.min(Math.round(v), faixa.max)) : faixa.padrao
  return {
    maxItems: clamp(s.maxItems, SOURCE_LIMITS.maxItems),
    charBudget: clamp(s.charBudget, SOURCE_LIMITS.charBudget),
    maxSources: clamp(s.maxSources, SOURCE_LIMITS.maxSources),
    ...(s.toolName ? { toolName: s.toolName } : {}),
    ...(s.toolDescription ? { toolDescription: s.toolDescription } : {}),
  }
}

/**
 * O nome que o provedor aceita.
 *
 * A API de ferramentas só admite `[a-zA-Z0-9_-]{1,64}`. Um nome com espaço ou acento —
 * que é exatamente o que uma pessoa digita — faria a chamada inteira ser recusada pelo
 * provedor, e o erro apareceria como "falha do modelo". Então saneia-se aqui, e a tela
 * mostra o resultado.
 */
export function sanitizeToolName(bruto: string, padrao: string): string {
  const limpo = bruto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return limpo || padrao
}

export interface Agent {
  _id: ObjectId
  /** A marca do Arquiteto, quando foi ele que criou. Ausente em tudo o mais. */
  architect?: ArchitectStamp
  ownerId: string
  // The Escritório this agent belongs to (children of the office). Every agent
  // has one; a sector is optional (orphan agents are allowed).
  officeId: ObjectId
  name: string
  objective: string
  provider: Provider
  model: string | null
  memoryType: MemoryType
  historyLimit: number
  identityEnabled: boolean
  identityFields: string[]
  conversationPersistence: ConversationPersistence
  guardrailMode: GuardrailMode
  structuredOutputEnabled: boolean
  structuredOutputFields: string[]
  structuredOutputWebhookUrl: string | null
  responseTone: ResponseTone
  responseDetail: ResponseDetail
  responseEmojis: boolean
  responseFormatting: boolean
  handoffEnabled: boolean
  firstMessage: string | null
  proactivityEnabled: boolean
  proactivityGuidance: string
  language: Language
  dailyMessageLimit: number
  cheapAuxModel: boolean
  promptCaching: boolean
  tools: AgentTool[]
  builtinTools: AgentBuiltinTool[]
  // What this agent may do with the owner's connected Apps: which installation,
  // which actions, and which of those may run without being asked. Not listed
  // means not reachable — assignment IS the permission.
  appGrants: AgentAppGrant[]
  // --- Agent-as-the-primary-unit model (additive; legacy agents get safe defaults
  // via withAgentDefaults on read, so no destructive migration is needed) ---
  preset: AgentPreset
  /**
   * A DESCRIÇÃO da função, editável. Nova.
   *
   * `preset` diz de que molde o agente saiu; `role` diz o que ele é agora. Os dois
   * existem porque o preset é escolhido uma vez, na contratação, e a função muda com o
   * uso — e sobrescrever a segunda com o primeiro apagaria trabalho do dono.
   *
   * Ausente = o comportamento de antes: o prompt não ganha bloco de função nenhum.
   */
  role?: string
  // Instruções operacionais: COMO fazer. Novo. Ausente = prompt igual ao de antes.
  instructions?: string
  // Limites: o que NÃO fazer. Novo. Texto livre ou lista por linha.
  constraints?: string
  /**
   * Quando o dono editou a definição pela última vez.
   *
   * É o que impede o preset de sobrescrever em silêncio. Trocar de preset preenche
   * sugestões em campo VAZIO; onde há texto escrito por gente, ele não passa. Sem esta
   * marca, a única alternativa seria perguntar a cada troca — ou apagar sem avisar.
   */
  definitionEditedAt?: Date
  /**
   * Como o modelo é chamado. Tudo opcional; ausente = padrão do sistema.
   *
   * `provider` e `model` continuam canônicos nos campos próprios — duplicá-los aqui
   * criaria duas verdades sobre qual modelo roda. Ver runConfig.ts.
   */
  runConfig?: RunConfig
  capabilities: string[] // free-form competency tags used for capability-based discovery/delegation
  activationModes: ActivationMode[] // how this agent may be triggered
  inputContract: string // what data the agent expects to receive (free text)
  outputContract: string // what result the agent must produce (free text)
  /**
   * COMO o trabalho deste agente é feito.
   *
   * Hoje todo agente é uma chamada a um modelo, e vai continuar sendo: ausente lê como
   * `llm`. Nem todo trabalho precisa de um, porém — somar uma coluna ou chamar um
   * endpoint por modelo é caro, lento e não determinístico, e para uma soma isso não
   * serve.
   *
   * Não se chama `executionMode`: esse nome já é das rotinas, e dois campos com o mesmo
   * nome e sentidos diferentes é um erro esperando quem for ler depois. Também não é o
   * `preset` — aquele diz o PAPEL do agente (quem coleta, quem conduz), que é outra
   * pergunta.
   */
  executorKind?: ExecutorKind
  /** O que ele devolve: dado, texto, ou os dois. Ausente = derivado de `defaultOutputFormat`. */
  responseMode?: ResponseMode
  /** A configuração do executor, coerente com o tipo. Nunca credencial. */
  executorConfig?: ExecutorConfig
  /** O que ele espera RECEBER, verificável. O `inputContract` em texto continua existindo. */
  inputJsonSchema?: Record<string, unknown> | null
  // --- executable side of the contract (all optional, all additive) --------------
  // The format a task produces when the caller does not ask for a specific one.
  // Absent = the previous behaviour (whatever the caller requested, else text).
  defaultOutputFormat?: 'text' | 'markdown' | 'json'
  // For JSON: the schema the answer must satisfy. Validated with the same validator
  // the tools use; an invalid answer earns ONE correction and then fails as
  // `validation` instead of being delivered.
  outputJsonSchema?: Record<string, unknown> | null
  // When true, a task refuses to run without curated knowledge (the retrieval
  // failed or found nothing above the relevance floor). Default false: the agent
  // answers anyway and is told the base was unavailable.
  requireGrounding?: boolean
  /**
   * QUANDO mandar trabalho para este agente — a frase do dono.
   *
   * Já existia por SETOR, no membro. Ela é a informação mais útil que o planejador tem,
   * e ficava indisponível para todo agente que não estivesse num setor — e para o dono,
   * que só a encontrava editando o setor, longe do agente que ela descreve.
   *
   * Aqui é o padrão do agente; o valor escrito no membro do setor continua mandando
   * quando existe. Nada foi migrado: um setor que já tem a frase não muda em nada.
   */
  routingDescription?: string
  /**
   * Procurar páginas NOVAS na internet. Só o pesquisador usa; ausente = desligado.
   *
   * Não confundir com `watchedSources`: aquilo é ler os endereços que o dono cadastrou,
   * isto é descobrir endereços que ninguém cadastrou. Custo, risco e configuração
   * diferentes — por isso campo separado, e por isso desligado por padrão.
   */
  webSearch?: {
    enabled?: boolean
    policy?: 'automatic' | 'fallback_only' | 'always'
    maxSearchResults?: number
    maxPagesToRead?: number
    maxCharsPerPage?: number
    maxEvidenceChunks?: number
    searchTimeoutMs?: number
    pageReadTimeoutMs?: number
  }
  /**
   * Os limites de quem CONDUZ. Só o coordenador usa; ausente = o padrão do sistema.
   *
   * Não são preferências: cada tarefa é uma inferência inteira, com a base e as
   * ferramentas de um agente. Quem paga a conta decide o teto.
   */
  orchestration?: {
    /** Quantos agentes o plano pode acionar por pedido. */
    maxTasks?: number
    /** Quantas rodadas de planejamento, quando a primeira não bastou. */
    maxRounds?: number
    /**
     * Um membro falhou e os outros responderam. Consolidar o que veio, dizendo o que
     * faltou, ou não responder? Padrão: consolidar — meia resposta declarada é melhor
     * que nenhuma, desde que a falta esteja escrita.
     */
    onPartialFailure?: 'synthesize' | 'fail'
  }
  /**
   * A porta de saída da regra do TIPO: liga (ou desliga) a base própria à mão.
   *
   * Ausente = o tipo decide (ver `agentCapabilities`). Um analista não consulta base
   * própria por padrão, e um coordenador também não — mas quem sabe o que quer pode
   * ligar. Nada é apagado: a configuração antiga continua gravada, só não é usada.
   */
  knowledgeEnabled?: boolean
  delegationPolicy: DelegationPolicy // outgoing: whom this agent may delegate to
  callerPolicy: DelegationPolicy // incoming: who may call this agent
  callableAgentIds: string[] // when delegationPolicy='selected': the agents this one may call
  callableSectorIds: string[] // when delegationPolicy='selected': the sectors this one may call
  // Ids from the `tools` collection this agent may call.
  toolIds: string[]
  /**
   * Sites que este agente consulta QUANDO É CHAMADO — não por horário.
   *
   * A rotina responde "verifique de hora em hora"; isto responde "quando alguém
   * perguntar, olhe aqui". Sem agendamento, sem checkpoint e sem custo enquanto
   * ninguém pergunta: a consulta acontece pela ferramenta `verificar_fonte`, e só
   * quando o próprio agente julgar que a pergunta pede.
   */
  watchedSources?: WatchedSource[]
  /** Limites e nomes que o dono escolheu para essas consultas. */
  sourceSettings?: AgentSourceSettings
  allowedCallerAgentIds: string[] // when callerPolicy='selected': the agents allowed to call this one
  metricProfile: MetricProfile // which KPI the card shows ('auto' = derive from preset)
  createdAt: Date
}

// Legacy documents predate the explicit policy fields. Derive a compatible policy
// from the old id lists + preset so behaviour is preserved: a manager could always
// delegate, a non-empty list meant "these only", and an empty allowedCaller list
// meant "any caller".
function deriveDelegationPolicy(a: Agent): DelegationPolicy {
  if (a.delegationPolicy) return a.delegationPolicy
  if ((a.callableAgentIds?.length ?? 0) > 0 || (a.callableSectorIds?.length ?? 0) > 0) return 'selected'
  return a.preset === 'manager' ? 'all' : 'none'
}
function deriveCallerPolicy(a: Agent): DelegationPolicy {
  if (a.callerPolicy) return a.callerPolicy
  return (a.allowedCallerAgentIds?.length ?? 0) > 0 ? 'selected' : 'all'
}

// The legacy per-agent tool format keeps its credential in a plain header, and that
// header can be called anything. Nothing outside the executor may see those values:
// they are masked on every way out of the API, and a masked value sent back on save
// means "keep the stored one" (see parseTools).
export const MASKED_HEADER_VALUE = '***'

/**
 * O agente como a API o entrega — com o que ele PODE fazer já resolvido.
 *
 * `roleConfig` é derivado, nunca guardado: é a mesma matriz que o runtime consulta na
 * hora de montar as ferramentas. Vai junto para a tela não precisar manter uma segunda
 * cópia da regra — uma cópia que envelhece sozinha e acaba escondendo um campo que o
 * motor ainda usa, ou oferecendo um que ele ignora.
 */
export function toPublicAgent<T extends { tools?: AgentTool[]; builtinTools?: AgentBuiltinTool[]; preset?: AgentPreset; knowledgeEnabled?: boolean | null }>(
  agent: T,
): T & { roleConfig: RoleUIConfig; contract: AgentContract } {
  const roleConfig = roleUIConfigOf({ preset: agent.preset ?? 'custom', knowledgeEnabled: agent.knowledgeEnabled })
  /**
   * O contrato já resolvido, como o `roleConfig`.
   *
   * Um agente antigo não tem nenhum destes campos gravados, e a tela não deveria precisar
   * saber disso: aqui ele sai completo, com o padrão que descreve o comportamento que ele
   * SEMPRE teve. Derivar do lado do cliente criaria uma segunda cópia da regra, e uma das
   * duas envelheceria.
   */
  const contract = agentContractOf(agent as AgentContractInput)
  return { ...publicFields(agent), roleConfig, contract }
}

function publicFields<T extends { tools?: AgentTool[]; builtinTools?: AgentBuiltinTool[] }>(agent: T): T {
  // Legacy built-in config could hold a token in the clear. Until the migration has
  // moved every one of them into an installation, nothing from it leaves the API
  // with a readable value.
  const builtinTools = agent.builtinTools?.length
    ? agent.builtinTools.map((entry) => ({
        ...entry,
        config: Object.fromEntries(
          Object.entries(entry.config ?? {}).map(([key, value]) => [key, isSecretLegacyConfigKey(entry.key, key) && value ? MASKED_HEADER_VALUE : value]),
        ),
      }))
    : agent.builtinTools

  if (!agent.tools?.length) return builtinTools === agent.builtinTools ? agent : { ...agent, builtinTools }
  return {
    ...agent,
    builtinTools,
    tools: agent.tools.map((tool) => ({
      ...tool,
      headers: (tool.headers ?? []).map((header) => ({ key: header.key, value: header.value ? MASKED_HEADER_VALUE : '' })),
    })),
  }
}

// Fill the agent-as-primary-unit fields for documents written before they existed,
// so every reader sees a complete Agent without a destructive backfill.
export function withAgentDefaults(a: Agent): Agent {
  return {
    ...a,
    preset: a.preset ?? 'custom',
    capabilities: a.capabilities ?? [],
    activationModes: a.activationModes ?? ['manual', 'channel'],
    inputContract: a.inputContract ?? '',
    outputContract: a.outputContract ?? '',
    callableAgentIds: a.callableAgentIds ?? [],
    callableSectorIds: a.callableSectorIds ?? [],
    toolIds: a.toolIds ?? [],
    appGrants: a.appGrants ?? [],
    allowedCallerAgentIds: a.allowedCallerAgentIds ?? [],
    delegationPolicy: deriveDelegationPolicy(a),
    callerPolicy: deriveCallerPolicy(a),
    metricProfile: a.metricProfile ?? 'auto',
  }
}

export interface AgentModelFields {
  preset?: AgentPreset
  /** Liga ou desliga a base própria à mão; `undefined` deixa o TIPO decidir. */
  knowledgeEnabled?: boolean
  capabilities?: string[]
  activationModes?: ActivationMode[]
  inputContract?: string
  outputContract?: string
  defaultOutputFormat?: 'text' | 'markdown' | 'json'
  outputJsonSchema?: Record<string, unknown> | null
  requireGrounding?: boolean
  delegationPolicy?: DelegationPolicy
  callerPolicy?: DelegationPolicy
  callableAgentIds?: string[]
  callableSectorIds?: string[]
  allowedCallerAgentIds?: string[]
  toolIds?: string[]
  metricProfile?: MetricProfile
  executorKind?: ExecutorKind
  responseMode?: ResponseMode
  executorConfig?: ExecutorConfig
  inputJsonSchema?: Record<string, unknown> | null
  routingDescription?: string
  orchestration?: { maxTasks?: number; maxRounds?: number; onPartialFailure?: 'synthesize' | 'fail' }
  webSearch?: Partial<WebSearchSettings>
}

// Parse + validate the agent-as-primary-unit fields from a request body. Only sets a
// key when the client sent a valid value, so a PATCH stays a true partial update.
// Returns an error string when a present value is the wrong type/shape.
export function parseAgentModelFields(
  body: Record<string, unknown>,
  /** O agente como está gravado. Ausente = criação, onde tudo pode ser definido. */
  atual?: { preset?: AgentPreset; executorKind?: ExecutorKind } | null,
): { fields: AgentModelFields; error?: string } {
  const fields: AgentModelFields = {}
  if (body.preset !== undefined) {
    if (typeof body.preset !== 'string' || !(AGENT_PRESETS as string[]).includes(body.preset)) return { fields, error: 'Unknown preset' }
    /**
     * O tipo é escolhido UMA vez, na contratação.
     *
     * Trocá-lo depois mudava o que o agente pode fazer — base própria, sites,
     * ferramentas, e o lugar dele num plano — sem tocar em uma linha do que estava
     * escrito nele. Sobrava um agente com a definição de pesquisador e o comportamento
     * de coordenador, e nada ligava uma coisa à outra para quem fosse investigar.
     *
     * Quem quer outro tipo contrata outro agente. Aqui o campo só é aceito para
     * DEFINIR o que ainda não existe: um documento antigo, gravado antes de o tipo
     * existir, continua podendo ganhar o seu. Recusar seria quebrar quem já funciona.
     */
    // `custom` é a AUSÊNCIA de molde — é o que um documento antigo lê por padrão, e é o
    // que "Personalizado, do zero" quer dizer. Ele ainda pode ganhar um tipo de verdade,
    // uma vez. Um tipo já declarado não muda mais.
    if (atual?.preset && atual.preset !== 'custom' && atual.preset !== body.preset) {
      return { fields, error: 'O tipo do agente é definido na contratação e não pode ser trocado depois.' }
    }
    fields.preset = body.preset as AgentPreset
  }
  if (body.activationModes !== undefined) {
    const v = body.activationModes
    const accepted = [...ACTIVATION_MODES, ...LEGACY_ACTIVATION_MODES] as string[]
    if (!Array.isArray(v) || !v.every((m) => typeof m === 'string' && accepted.includes(m))) return { fields, error: 'activationModes must be a list of known modes' }
    // A legacy agent_only in the payload is converted here and never stored.
    const explicit = typeof body.callerPolicy === 'string' && (DELEGATION_POLICIES as string[]).includes(body.callerPolicy) ? (body.callerPolicy as DelegationPolicy) : undefined
    const sanitized = sanitizeActivationWrite(v as string[], explicit)
    fields.activationModes = sanitized.activationModes
    if (sanitized.callerPolicy) fields.callerPolicy = sanitized.callerPolicy
  }
  for (const key of ['capabilities', 'callableAgentIds', 'callableSectorIds', 'allowedCallerAgentIds', 'toolIds'] as const) {
    const v = body[key]
    if (v === undefined) continue
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return { fields, error: `${key} must be a list of strings` }
    fields[key] = [...new Set((v as string[]).map((s) => s.trim()).filter(Boolean))]
  }
  for (const key of ['inputContract', 'outputContract'] as const) {
    const v = body[key]
    if (v === undefined) continue
    if (typeof v !== 'string') return { fields, error: `${key} must be a string` }
    fields[key] = v.slice(0, 4000)
  }
  for (const key of ['delegationPolicy', 'callerPolicy'] as const) {
    const v = body[key]
    if (v === undefined) continue
    if (typeof v !== 'string' || !(DELEGATION_POLICIES as string[]).includes(v)) return { fields, error: `${key} must be one of ${DELEGATION_POLICIES.join(', ')}` }
    fields[key] = v as DelegationPolicy
  }
  if (body.metricProfile !== undefined) {
    if (typeof body.metricProfile !== 'string' || !(METRIC_PROFILES as string[]).includes(body.metricProfile)) return { fields, error: `metricProfile must be one of ${METRIC_PROFILES.join(', ')}` }
    fields.metricProfile = body.metricProfile as MetricProfile
  }
  // --- executable contract (optional; absent leaves the agent exactly as it was) ---
  if (body.defaultOutputFormat !== undefined) {
    if (body.defaultOutputFormat === null || body.defaultOutputFormat === '') fields.defaultOutputFormat = undefined
    else if (typeof body.defaultOutputFormat !== 'string' || !['text', 'markdown', 'json'].includes(body.defaultOutputFormat)) {
      return { fields, error: 'defaultOutputFormat must be text, markdown or json' }
    } else fields.defaultOutputFormat = body.defaultOutputFormat as 'text' | 'markdown' | 'json'
  }
  if (body.outputJsonSchema !== undefined) {
    if (body.outputJsonSchema === null || body.outputJsonSchema === '') fields.outputJsonSchema = null
    else {
      // The same validator the tools use: a schema that cannot be enforced is not
      // accepted, so an agent can never promise a shape nothing checks.
      if (!isValidToolSchema(body.outputJsonSchema)) return { fields, error: 'outputJsonSchema must be an object JSON Schema' }
      fields.outputJsonSchema = body.outputJsonSchema as Record<string, unknown>
    }
  }
  if (body.requireGrounding !== undefined) {
    if (typeof body.requireGrounding !== 'boolean') return { fields, error: 'requireGrounding must be a boolean' }
    fields.requireGrounding = body.requireGrounding
  }
  if (body.routingDescription !== undefined) {
    if (typeof body.routingDescription !== 'string') return { fields, error: 'routingDescription must be a string' }
    fields.routingDescription = body.routingDescription.slice(0, 400)
  }
  if (body.orchestration !== undefined) {
    const bruto = (body.orchestration ?? {}) as Record<string, unknown>
    if (typeof bruto !== 'object' || Array.isArray(bruto)) return { fields, error: 'orchestration must be an object' }
    // Os tetos são do SISTEMA; o dono escolhe dentro deles. Um número maior aqui não
    // compraria mais cobertura — compraria mais inferência pela mesma resposta.
    const inteiro = (v: unknown, min: number, max: number): number | undefined => {
      if (v === undefined || v === null || v === '') return undefined
      const n = Math.trunc(Number(v))
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined
    }
    const maxTasks = inteiro(bruto.maxTasks, 1, MAX_TASKS)
    const maxRounds = inteiro(bruto.maxRounds, 1, MAX_ORCHESTRATION_ROUNDS)
    const onPartialFailure = bruto.onPartialFailure === 'fail' ? 'fail' : bruto.onPartialFailure === 'synthesize' ? 'synthesize' : undefined
    fields.orchestration = {
      ...(maxTasks !== undefined ? { maxTasks } : {}),
      ...(maxRounds !== undefined ? { maxRounds } : {}),
      ...(onPartialFailure ? { onPartialFailure } : {}),
    }
  }
  // O contrato de execução. Só mexe no que FOI ENVIADO: um payload antigo sai daqui sem
  // nenhum destes campos, e o agente é gravado exatamente como sempre foi.
  const contrato = parseAgentContract(body, atual)
  if (contrato.error) return { fields, error: contrato.error }
  Object.assign(fields, contrato.fields)

  if (body.webSearch !== undefined) {
    const bruto = (body.webSearch ?? {}) as Record<string, unknown>
    if (typeof bruto !== 'object' || Array.isArray(bruto)) return { fields, error: 'webSearch must be an object' }
    // `normalizeWebSearch` aplica os TETOS do sistema: o dono escolhe dentro deles, e um
    // número absurdo vindo pela API não vira dez leituras de página por tarefa.
    fields.webSearch = normalizeWebSearch(bruto as Partial<WebSearchSettings>)
  }
  if (body.knowledgeEnabled !== undefined) {
    // `null` volta a decisão para o TIPO — é como se desfaz a escolha manual.
    if (body.knowledgeEnabled !== null && typeof body.knowledgeEnabled !== 'boolean') {
      return { fields, error: 'knowledgeEnabled must be a boolean or null' }
    }
    fields.knowledgeEnabled = body.knowledgeEnabled as boolean | undefined
  }
  return { fields }
}

const agents = db.collection<Agent>('agents')

export async function createAgent(
  ownerId: string,
  officeId: ObjectId,
  name: string,
  options: {
    objective?: string
    // Os blocos da definição, na criação e não só no PATCH. Sem isto, contratar um
    // agente já configurado exigia criar e depois editar — e o que fosse esquecido no
    // segundo passo simplesmente não existia.
    role?: string
    instructions?: string
    constraints?: string
    runConfig?: RunConfig
    provider?: Provider
    model?: string | null
    memoryType?: MemoryType
    historyLimit?: number
    identityEnabled?: boolean
    identityFields?: string[]
    conversationPersistence?: ConversationPersistence
    guardrailMode?: GuardrailMode
    structuredOutputEnabled?: boolean
    structuredOutputFields?: string[]
    structuredOutputWebhookUrl?: string | null
    responseTone?: ResponseTone
    responseDetail?: ResponseDetail
    responseEmojis?: boolean
    responseFormatting?: boolean
    handoffEnabled?: boolean
    firstMessage?: string | null
    proactivityEnabled?: boolean
    proactivityGuidance?: string
    language?: Language
    dailyMessageLimit?: number
    cheapAuxModel?: boolean
    promptCaching?: boolean
    tools?: AgentTool[]
    builtinTools?: AgentBuiltinTool[]
    appGrants?: AgentAppGrant[]
    preset?: AgentPreset
    capabilities?: string[]
    activationModes?: ActivationMode[]
    inputContract?: string
    outputContract?: string
    /**
     * O CONTRATO, na criação e não só no PATCH.
     *
     * O documento aqui é montado campo a campo — de propósito, para nada que o cliente
     * mande entrar no banco sem passar por uma decisão. O efeito colateral é que um campo
     * que não esteja escrito aqui é descartado em silêncio: o `...modelFields` do chamador
     * não reclama, porque espalhamento não dispara verificação de propriedade excedente.
     * Um agente de função criado pela API saía como agente de modelo, sem erro nenhum, e
     * só se descobria na primeira execução.
     */
    executorKind?: ExecutorKind
    responseMode?: ResponseMode
    executorConfig?: ExecutorConfig
    inputJsonSchema?: Record<string, unknown> | null
    outputJsonSchema?: Record<string, unknown> | null
    defaultOutputFormat?: 'text' | 'markdown' | 'json'
    requireGrounding?: boolean
    delegationPolicy?: DelegationPolicy
    callerPolicy?: DelegationPolicy
    callableAgentIds?: string[]
    callableSectorIds?: string[]
    allowedCallerAgentIds?: string[]
    toolIds?: string[]
    watchedSources?: WatchedSource[]
    metricProfile?: MetricProfile
    /** A marca do Arquiteto, quando foi ele que criou. Ver `architectStamp.ts`. */
    architect?: ArchitectStamp
  } = {},
) {
  const agent: Omit<Agent, '_id'> = {
    ownerId,
    officeId,
    name,
    objective: options.objective ?? '',
    // Ausentes viram ausentes, não string vazia: é a ausência que faz o prompt não ganhar
    // bloco nenhum — exatamente como um agente criado antes destes campos.
    ...(options.role?.trim() ? { role: options.role.trim() } : {}),
    ...(options.instructions?.trim() ? { instructions: options.instructions.trim() } : {}),
    ...(options.constraints?.trim() ? { constraints: options.constraints.trim() } : {}),
    ...(options.runConfig && Object.keys(options.runConfig).length ? { runConfig: options.runConfig } : {}),
    // Quem já nasce com definição escrita nasce EDITADO: uma troca de preset depois não
    // pode passar por cima do que foi dito na contratação.
    ...(options.role?.trim() || options.instructions?.trim() || options.constraints?.trim() ? { definitionEditedAt: new Date() } : {}),
    provider: options.provider ?? 'anthropic',
    model: options.model ?? null,
    memoryType: options.memoryType ?? 'none',
    historyLimit: options.historyLimit ?? DEFAULT_HISTORY_LIMIT,
    identityEnabled: options.identityEnabled ?? false,
    identityFields: options.identityFields ?? [],
    conversationPersistence: options.conversationPersistence ?? 'same_browser',
    guardrailMode: options.guardrailMode ?? 'none',
    structuredOutputEnabled: options.structuredOutputEnabled ?? false,
    structuredOutputFields: options.structuredOutputFields ?? [],
    structuredOutputWebhookUrl: options.structuredOutputWebhookUrl ?? null,
    responseTone: options.responseTone ?? 'neutral',
    responseDetail: options.responseDetail ?? 'balanced',
    responseEmojis: options.responseEmojis ?? false,
    responseFormatting: options.responseFormatting ?? false,
    handoffEnabled: options.handoffEnabled ?? false,
    firstMessage: options.firstMessage ?? null,
    proactivityEnabled: options.proactivityEnabled ?? false,
    proactivityGuidance: options.proactivityGuidance ?? '',
    language: options.language ?? 'pt',
    dailyMessageLimit: options.dailyMessageLimit ?? 0,
    cheapAuxModel: options.cheapAuxModel ?? true,
    promptCaching: options.promptCaching ?? true,
    tools: options.tools ?? [],
    builtinTools: options.builtinTools ?? [],
    appGrants: options.appGrants ?? [],
    preset: options.preset ?? 'custom',
    capabilities: options.capabilities ?? [],
    // agent_only is never stored, whatever the caller passed.
    activationModes: sanitizeActivationWrite(options.activationModes ?? ['manual', 'channel']).activationModes,
    inputContract: options.inputContract ?? '',
    outputContract: options.outputContract ?? '',
    /**
     * Só o que FOI ENVIADO. Um agente criado sem nenhum destes campos fica sem nenhum deles
     * no banco — e `agentContractOf` o lê como `llm`/`text`, que é o que ele sempre foi.
     * Gravar um padrão aqui criaria, em todo agente novo, um campo que ninguém pediu.
     */
    ...(options.executorKind !== undefined ? { executorKind: options.executorKind } : {}),
    ...(options.responseMode !== undefined ? { responseMode: options.responseMode } : {}),
    ...(options.executorConfig !== undefined ? { executorConfig: options.executorConfig } : {}),
    ...(options.inputJsonSchema !== undefined ? { inputJsonSchema: options.inputJsonSchema } : {}),
    ...(options.outputJsonSchema !== undefined ? { outputJsonSchema: options.outputJsonSchema } : {}),
    ...(options.defaultOutputFormat !== undefined ? { defaultOutputFormat: options.defaultOutputFormat } : {}),
    ...(options.requireGrounding !== undefined ? { requireGrounding: options.requireGrounding } : {}),
    callableAgentIds: options.callableAgentIds ?? [],
    callableSectorIds: options.callableSectorIds ?? [],
    toolIds: options.toolIds ?? [],
    allowedCallerAgentIds: options.allowedCallerAgentIds ?? [],
    // A manager delegates by default; every other role starts as a leaf (none) and
    // opts in. Any agent can be called by default (callerPolicy='all') so a manager
    // can reach a fresh specialist without extra wiring.
    delegationPolicy: options.delegationPolicy ?? (options.preset === 'manager' ? 'all' : 'none'),
    callerPolicy: options.callerPolicy ?? 'all',
    metricProfile: options.metricProfile ?? 'auto',
    ...(options.architect ? { architect: options.architect } : {}),
    createdAt: new Date(),
  }
  const result = await agents.insertOne(agent as Agent)
  return { ...agent, _id: result.insertedId }
}

export async function listAgents(ownerId: string, floorId?: ObjectId): Promise<Agent[]> {
  const filter: Record<string, unknown> = { ownerId }
  if (floorId) filter.officeId = floorId
  const docs = await agents.find(filter).sort({ createdAt: -1 }).toArray()
  return docs.map(withAgentDefaults)
}

export async function getAgentById(ownerId: string, agentId: ObjectId): Promise<Agent | null> {
  const doc = await agents.findOne({ _id: agentId, ownerId })
  return doc ? withAgentDefaults(doc) : null
}

export async function updateAgent(
  ownerId: string,
  agentId: ObjectId,
  updates: {
    name?: string
    objective?: string
    provider?: Provider
    model?: string | null
    memoryType?: MemoryType
    historyLimit?: number
    identityEnabled?: boolean
    identityFields?: string[]
    conversationPersistence?: ConversationPersistence
    guardrailMode?: GuardrailMode
    structuredOutputEnabled?: boolean
    structuredOutputFields?: string[]
    structuredOutputWebhookUrl?: string | null
    responseTone?: ResponseTone
    responseDetail?: ResponseDetail
    responseEmojis?: boolean
    responseFormatting?: boolean
    handoffEnabled?: boolean
    firstMessage?: string | null
    proactivityEnabled?: boolean
    proactivityGuidance?: string
    language?: Language
    dailyMessageLimit?: number
    cheapAuxModel?: boolean
    promptCaching?: boolean
    tools?: AgentTool[]
    builtinTools?: AgentBuiltinTool[]
    appGrants?: AgentAppGrant[]
    preset?: AgentPreset
    capabilities?: string[]
    activationModes?: ActivationMode[]
    inputContract?: string
    /**
     * O contrato, DECLARADO.
     *
     * O `$set` grava o que receber, então estes campos já chegavam ao banco — por acidente
     * do espalhamento, não por decisão. Declará-los é o que faz o compilador cobrar o tipo
     * certo, e o que impede o próximo campo de contrato de depender da mesma sorte.
     */
    executorKind?: ExecutorKind
    responseMode?: ResponseMode
    executorConfig?: ExecutorConfig
    inputJsonSchema?: Record<string, unknown> | null
    outputJsonSchema?: Record<string, unknown> | null
    outputContract?: string
    delegationPolicy?: DelegationPolicy
    callerPolicy?: DelegationPolicy
    callableAgentIds?: string[]
    callableSectorIds?: string[]
    allowedCallerAgentIds?: string[]
    toolIds?: string[]
    // Sites consultados sob demanda — ver `WatchedSource`.
    watchedSources?: WatchedSource[]
    sourceSettings?: AgentSourceSettings
    metricProfile?: MetricProfile
  },
) {
  // Same rule as creation: a legacy agent_only coming back in an update is converted
  // to the incoming permission it meant and dropped from the stored triggers.
  const patch = { ...updates }
  if (patch.activationModes) {
    const sanitized = sanitizeActivationWrite(patch.activationModes, patch.callerPolicy)
    patch.activationModes = sanitized.activationModes
    if (sanitized.callerPolicy) patch.callerPolicy = sanitized.callerPolicy
  }
  const doc = await agents.findOneAndUpdate(
    { _id: agentId, ownerId },
    { $set: patch },
    { returnDocument: 'after' },
  )
  return doc ? withAgentDefaults(doc) : null
}

// Keep the "allowed" side in sync when a trigger is really configured: creating a
// routine implies scheduled, linking a widget implies channel, a webhook implies
// event. activationModes stays the single source of truth for what is allowed, and
// new configuration can never contradict it. Idempotent.
export async function ensureActivationMode(ownerId: string, agentId: ObjectId, mode: ActivationMode): Promise<void> {
  await agents.updateOne({ _id: agentId, ownerId }, { $addToSet: { activationModes: mode } })
}

// A deleted tool must not linger in any agent's allow list: an id that resolves
// to nothing is confusing in the UI and pointless at execution time.
export async function pullToolFromAgents(ownerId: string, toolId: string): Promise<number> {
  const res = await agents.updateMany({ ownerId, toolIds: toolId }, { $pull: { toolIds: toolId } })
  return res.modifiedCount
}

export async function deleteAgent(ownerId: string, agentId: ObjectId) {
  const result = await agents.deleteOne({ _id: agentId, ownerId })
  return result.deletedCount > 0
}
