// O Arquiteto do Escritório — os tipos, e só eles.
//
// A separação que importa está aqui e não em prosa: a LLM produz um `OfficeBlueprintV1`
// e nada mais. Ele é uma DESCRIÇÃO, não um comando: referências internas usam `key`,
// que é texto escolhido no próprio blueprint, e nunca ObjectId. Um id de banco vindo do
// modelo seria um id inventado — e um id inventado que casa por acaso com o de outra
// conta é a diferença entre uma proposta e um vazamento.
//
// Ownership entra depois, quando o código determinístico resolve uma `key` para um
// recurso real do dono.

/** O ciclo de vida de um projeto. `applying` existe para a aplicação ser retomável. */
export type ArchitectStatus = 'discovery' | 'draft' | 'ready' | 'applying' | 'applied' | 'failed' | 'archived'

export const ARCHITECT_STATUSES: readonly ArchitectStatus[] = [
  'discovery',
  'draft',
  'ready',
  'applying',
  'applied',
  'failed',
  'archived',
]

export type ArchitectLocale = 'pt' | 'en' | 'es'
export const ARCHITECT_LOCALES: readonly ArchitectLocale[] = ['pt', 'en', 'es']

/** O que foi assumido por falta de resposta. Fica visível na prévia; não é fato. */
export interface ArchitectAssumption {
  key: string
  text: string
  /** A pergunta cuja resposta apagaria esta suposição. */
  questionKey?: string
}

export interface ArchitectWarning {
  path: string
  message: string
}

// --- checklist -----------------------------------------------------------------------

export type ChecklistCategory = 'structure' | 'knowledge' | 'app' | 'channel' | 'routine' | 'test' | 'review'
export const CHECKLIST_CATEGORIES: readonly ChecklistCategory[] = ['structure', 'knowledge', 'app', 'channel', 'routine', 'test', 'review']

export type ChecklistStatus = 'pending' | 'blocked' | 'ready' | 'done'

/**
 * Como um item sai de `pending`.
 *
 * `manual` é o único que o dono pode marcar. Os outros são calculados a partir do
 * estado real (documento existe, instalação conectada, rotina publicada) — deixar o
 * dono marcá-los à mão transformaria a checklist em decoração: ela diria "pronto"
 * sobre um App que ninguém conectou.
 */
export type ChecklistCompletionMode = 'manual' | 'resource_state' | 'connection_state' | 'test_result'

export interface ArchitectChecklistItem {
  id: string
  category: ChecklistCategory
  title: string
  description: string
  required: boolean
  status: ChecklistStatus
  completionMode: ChecklistCompletionMode
  target?: { kind: string; key: string; id?: string }
  /**
   * Para ONDE ir quando este item não é resolvido no próprio recurso.
   *
   * O conhecimento é o caso: o `target` dele é a pendência ("o cardápio chegou?"), que
   * não é um lugar — quem tem tela é o agente ou o setor que vai receber o documento.
   * Sem isto, "Enviar o cardápio" ficava marcado como pendente sem nenhum caminho.
   */
  linkTarget?: { kind: string; key: string }
  actionPath?: string
  dependsOn: string[]
}

export interface ArchitectReadiness {
  /** Obrigatórios concluídos / obrigatórios totais. */
  requiredDone: number
  requiredTotal: number
  optionalDone: number
  optionalTotal: number
  /** Só quando todo obrigatório está `done` E não há issue bloqueante. */
  ready: boolean
  blockers: string[]
}

// --- blueprint -----------------------------------------------------------------------

/** O que o plano manda fazer com um item. `reuse` aponta para recurso já existente. */
export type BlueprintAction = 'create' | 'reuse' | 'update'
export const BLUEPRINT_ACTIONS: readonly BlueprintAction[] = ['create', 'reuse', 'update']

interface BlueprintItemBase {
  key: string
  action: BlueprintAction
  /**
   * O recurso real, quando `reuse`/`update`. É um id de banco — e é justamente por isso
   * que ele NUNCA vem do modelo: quem preenche este campo é a tela, depois de o dono
   * escolher um recurso que já é dele. O validador confere a posse antes de aplicar.
   */
  resourceId?: string | null
  /** Por que este item existe, em português. Aparece na prévia. */
  rationale?: string
}

export interface BlueprintFloor extends BlueprintItemBase {
  name: string
  mission?: string
  description?: string
  language?: ArchitectLocale
  timezone?: string
  workMode: 'organization' | 'coordinated'
  coordinatorAgentKey?: string | null
}

export interface BlueprintAgent extends BlueprintItemBase {
  floorKey: string
  name: string
  objective?: string
  preset?: string
  role?: string
  instructions?: string
  constraints?: string
  capabilities?: string[]
  routingDescription?: string
  /** O mesmo vocabulário de `executors/types.ts`: um segundo aqui viraria tradução. */
  executorKind?: 'llm' | 'function' | 'tool'
  /** Também o vocabulário do domínio. `structured` é o que promete JSON. */
  responseMode?: 'structured' | 'text' | 'structured_and_text'
  inputContract?: string
  outputContract?: string
  inputJsonSchema?: Record<string, unknown> | null
  outputJsonSchema?: Record<string, unknown> | null
  provider?: 'anthropic' | 'openai'
  model?: string | null
  language?: 'pt' | 'en' | 'es' | 'auto'
  activationModes?: string[]
  delegationPolicy?: 'none' | 'all' | 'selected' | 'floor'
  callerPolicy?: 'none' | 'all' | 'selected' | 'floor'
  callableAgentKeys?: string[]
  allowedCallerAgentKeys?: string[]
  memoryType?: 'none' | 'facts' | 'structured' | 'semantic'
  requireGrounding?: boolean
  handoffEnabled?: boolean
}

export interface BlueprintStage {
  key: string
  agentKey: string
  instruction?: string
  dependsOn?: string[]
  outputContract?: string
}

export interface BlueprintSector extends BlueprintItemBase {
  floorKey: string
  name: string
  color?: string
  mode: 'organization' | 'orchestrated' | 'pipeline'
  memberAgentKeys: string[]
  coordinatorAgentKey?: string | null
  instruction?: string
  inputContract?: string
  outputContract?: string
  stages?: BlueprintStage[]
  entryPolicy?: string
  exposedAgentKeys?: string[]
}

export interface BlueprintRoutine extends BlueprintItemBase {
  floorKey: string
  ownerAgentKey: string
  name: string
  description?: string
  /**
   * `internal_event` e `webhook` NÃO são aceitos aqui.
   *
   * Os dois armam um recebedor: um cria assinatura de evento, o outro devolve uma URL
   * pública com segredo. Uma rotina que nasce rascunho e nunca é publicada não deveria
   * conseguir armar nada — e um segredo gerado por um plano que o dono ainda não
   * aprovou é um segredo que ninguém pediu.
   */
  triggerType: 'manual' | 'schedule'
  cron?: string
  timezone?: string
  executionMode?: string
  steps?: Record<string, unknown>[]
}

export interface BlueprintAppRequirement {
  key: string
  appKey: string
  reason: string
  required: boolean
  actionKeys: string[]
  /** Para quais agentes esta permissão seria concedida, se o dono aprovar. */
  agentKeys: string[]
}

export type KnowledgeSourceKind = 'user_answer' | 'upload' | 'url' | 'app' | 'manual'
export type KnowledgeState = 'missing' | 'supplied' | 'confirmed' | 'indexed'

export interface BlueprintKnowledgeRequirement {
  key: string
  scope: 'agent' | 'sector' | 'floor' | 'building'
  /** A key do agente/setor/andar de destino. Ausente quando o escopo é o prédio. */
  targetKey?: string
  title: string
  description: string
  required: boolean
  expectedSource: KnowledgeSourceKind
  state: KnowledgeState
  /**
   * O conteúdo, QUANDO o dono já o forneceu.
   *
   * Ausente é o caso normal e o mais importante: sem cardápio, o agente não recebe
   * cardápio nenhum — recebe uma pendência. Um texto inventado aqui viraria uma base de
   * conhecimento que parece pronta e responde errado.
   */
  content?: string
}

export interface OfficeBlueprintV1 {
  version: 1
  title: string
  objective: string
  buildingPatch?: { name?: string; description?: string }
  floors: BlueprintFloor[]
  agents: BlueprintAgent[]
  sectors: BlueprintSector[]
  routines: BlueprintRoutine[]
  appRequirements: BlueprintAppRequirement[]
  knowledgeRequirements: BlueprintKnowledgeRequirement[]
  assumptions: ArchitectAssumption[]
  warnings: ArchitectWarning[]
  checklist: ArchitectChecklistItem[]
}

// --- aplicação -----------------------------------------------------------------------

export type ApplyStepKind = 'floor' | 'agent' | 'sector' | 'wiring' | 'knowledge' | 'routine' | 'grant' | 'checklist'

export interface ApplyStepResult {
  kind: ApplyStepKind
  key: string
  status: 'created' | 'reused' | 'updated' | 'skipped' | 'failed'
  resourceId?: string | null
  message?: string
  at: Date
}

export type ApplyStatus = 'running' | 'completed' | 'failed' | 'rolled_back'

export interface ArchitectApplyState {
  operationId: string
  status: ApplyStatus
  blueprintHash: string
  startedAt: Date
  completedAt: Date | null
  error: string | null
}
