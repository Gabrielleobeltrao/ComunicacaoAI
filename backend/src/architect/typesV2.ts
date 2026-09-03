import type {
  ArchitectAssumption,
  ArchitectChecklistItem,
  ArchitectLocale,
  ArchitectWarning,
  BlueprintKnowledgeRequirement,
  BlueprintLayer,
  BlueprintStage,
  OfficeBlueprintV1,
} from './types.js'

// O BLUEPRINT V2 — a operação inteira, e não só quem existe.
//
// O V1 descreve prédio, andares, agentes, setores, rotinas e requisitos de App e Knowledge.
// O produto tem muito mais: Databases e datasets, Tools, Sources, destinos Live e History,
// Monitors, Flows, canais, entregas e grants por recurso. Um plano que não os representa não
// consegue prometer o que o produto faz — e é por isso que "observe CXSE3 e me avise quando
// o RSI cair" virava uma rotina com cron das oito da manhã.
//
// Estender o V1 no lugar mudaria o significado de documentos já aplicados: um projeto de
// janeiro passaria a ser lido com regras de hoje, e ninguém saberia disso. Por isso o V2 é
// um formato NOVO, com `version: 2`, que convive com o V1.
//
// Três invariantes que atravessam o arquivo inteiro:
//
//   1. referência interna é `key`, nunca ObjectId. `resourceId` só é anexado pelo inventário
//      do servidor ou por escolha owner-scoped na tela;
//   2. segredo não entra em campo nenhum — nem cifrado, nem por referência resolvível;
//   3. um item que ainda depende de conexão ou teste nasce rascunho/pausado. "Pronto" exige
//      prova, não documento.

export type BlueprintActionV2 = 'create' | 'reuse' | 'update' | 'archive'
export const BLUEPRINT_ACTIONS_V2: readonly BlueprintActionV2[] = ['create', 'reuse', 'update', 'archive']

export type BlueprintChangeKindV2 = 'create' | 'expand' | 'repair' | 'reorganize'
export const BLUEPRINT_CHANGE_KINDS: readonly BlueprintChangeKindV2[] = ['create', 'expand', 'repair', 'reorganize']

export interface BlueprintItemBaseV2 {
  key: string
  action: BlueprintActionV2
  /** O recurso real, quando `reuse`/`update`/`archive`. Nunca vem do modelo. */
  resourceId?: string | null
  layer: BlueprintLayer
  /** Por que este item existe, em português. Aparece na prévia e não é decoração. */
  rationale: string
  /** As `key` de que este item depende. É daqui que sai a ordem de aplicação. */
  dependsOn: string[]
}

// --- organização -------------------------------------------------------------------------

export interface BlueprintBuildingPatch {
  name?: string
  description?: string
}

export interface BlueprintFloorV2 extends BlueprintItemBaseV2 {
  name: string
  mission?: string
  description?: string
  language?: ArchitectLocale
  timezone?: string
  workMode: 'organization' | 'coordinated'
  coordinatorAgentKey?: string | null
}

/**
 * O AGENTE, com tudo o que o Flow precisa mostrar.
 *
 * `role` e os dois contratos deixam de ser opcionais aqui — e isso é a correção de um
 * defeito, não uma preferência: um agente sem responsabilidade renderiza uma ficha vazia
 * no Flow, e quem olha não descobre o que ele faz nem em qual tela procurar.
 */
export interface BlueprintAgentV2 extends BlueprintItemBaseV2 {
  floorKey: string
  name: string
  /** O papel: o que ele é responsável por fazer. Obrigatório. */
  role: string
  /** Quando ele entra. Obrigatório: um agente sem gatilho nunca é acionado. */
  trigger: string
  inputContract: string
  outputContract: string
  /** O julgamento que ele faz. É o que separa um agente de uma função. */
  judgement?: string
  /**
   * A ação que ele executa ao final.
   *
   * `performs`, e não `action`: a base já usa `action` para dizer se o item é criado,
   * reusado ou arquivado. Dois significados no mesmo nome é o tipo de ambiguidade que só
   * aparece quando alguém lê o campo errado.
   */
  performs?: string
  /** O que ele NÃO faz. Um limite escrito vale mais que uma instrução longa. */
  boundaries?: string[]
  objective?: string
  preset?: string
  instructions?: string
  constraints?: string
  capabilities?: string[]
  routingDescription?: string
  executorKind?: 'llm' | 'function' | 'tool'
  responseMode?: 'structured' | 'text' | 'structured_and_text'
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
  /** Para onde vai quando não consegue resolver. Vazio é um beco sem saída. */
  fallbackAgentKey?: string | null
  /** O que ele usa: `app:<key>`, `tool:<key>`, `knowledge:<key>`, `database:<key>`. */
  usesKeys?: string[]
}

export interface BlueprintSectorV2 extends BlueprintItemBaseV2 {
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

// --- recursos ----------------------------------------------------------------------------

export type BlueprintKnowledgeV2 = BlueprintKnowledgeRequirement & { dependsOn?: string[] }

export interface BlueprintMemoryPolicyV2 extends BlueprintItemBaseV2 {
  targetKey: string
  memoryType: 'none' | 'facts' | 'structured' | 'semantic'
  retentionDays?: number | null
  requireGrounding: boolean
}

/**
 * O App, com as AÇÕES EXATAS.
 *
 * `actionKeys` vazio não satisfaz requisito nenhum: um grant sem ação resolve para zero
 * ferramentas, e o agente fica com o App declarado e sem poder usá-lo. Escrita autônoma
 * começa vazia sempre — ela é uma aprovação por ação, não um efeito colateral de conectar.
 */
export interface BlueprintAppRequirementV2 extends BlueprintItemBaseV2 {
  appKey: string
  installationRef?: string | null
  agentKeys: string[]
  actionKeys: string[]
  autonomousWriteActionKeys: string[]
  resourceConfig: Record<string, string>
  required: boolean
}

export interface BlueprintDatabaseV2 extends BlueprintItemBaseV2 {
  name: string
  description?: string
  owner: { ownerType: 'account' | 'building' | 'floor'; ownerKey?: string | null }
  adapterKind: string
  retentionDays?: number | null
}

export interface BlueprintDatasetV2 extends BlueprintItemBaseV2 {
  databaseKey: string
  datasetKey: string
  name: string
  /** JSON Schema do que este conjunto guarda. Sem ele, um monitor não sabe o que observar. */
  schema: Record<string, unknown>
  mutability: 'append_only' | 'mutable'
  timeField?: string
}

export interface BlueprintToolRequirementV2 extends BlueprintItemBaseV2 {
  name: string
  description: string
  /** `existing` aponta uma ferramenta da conta; `function` é cálculo a registrar. */
  provider: 'existing' | 'function' | 'app_action'
  /** Quando `app_action`: qual App e qual ação. */
  appKey?: string | null
  actionKey?: string | null
  inputSchema?: Record<string, unknown>
  agentKeys: string[]
}

// --- operação ----------------------------------------------------------------------------

export interface BlueprintChannelBindingV2 extends BlueprintItemBaseV2 {
  /** O App de canal: `whatsapp`, `telegram`, `web_chat`, `email`. */
  appKey: string
  installationRef?: string | null
  /** Quem RECEBE o que chega por este canal. Sem ele, a porta não leva a lugar nenhum. */
  entryAgentKey: string
  /** O setor que atende, quando a entrada é por setor e não por agente. */
  entrySectorKey?: string | null
  direction: 'inbound' | 'outbound' | 'both'
}

/**
 * A FONTE — exatamente a união discriminada da Central de Monitoramento.
 *
 * `config` não é validado aqui: quem sabe a forma de cada tipo é `monitoring/config.ts`, e
 * uma segunda validação divergiria dela no primeiro campo novo. O que este bloco garante é
 * a referência (`key`, destino, cadência declarada) e que nenhum segredo esteja dentro.
 */
export interface BlueprintMonitoringSourceV2 extends BlueprintItemBaseV2 {
  name: string
  kind: string
  config: Record<string, unknown>
  mapping: { version: number; itemsPath?: string | null; fields: Record<string, unknown>[] }
  cadence: Record<string, unknown>
  connectionRef?: string | null
  entityKeyPath?: string | null
}

export interface BlueprintLiveDestinationV2 extends BlueprintItemBaseV2 {
  sourceKey: string
  /** O alias pelo qual um agente consulta o valor de agora. */
  alias: string
  staleAfterSeconds: number
  /** Quais agentes podem consultar. Vazio = nenhum: acesso é concessão, não padrão. */
  agentKeys: string[]
}

export interface BlueprintHistoryV2 extends BlueprintItemBaseV2 {
  sourceKey: string
  /** O conjunto que a série alimenta. Sem ele, o monitor não tem o que observar. */
  datasetKey?: string | null
  retentionDays?: number | null
}

export interface BlueprintMonitorV2 extends BlueprintItemBaseV2 {
  name: string
  /** O que ele observa: um dataset do Blueprint, ou um evento da plataforma. */
  observes: { kind: 'dataset'; datasetKey: string } | { kind: 'internal_event'; eventType: string }
  /** A AST canônica de `monitors/condition.ts`. Validada por ela, não por uma cópia. */
  condition: Record<string, unknown>
  triggerMode: string
  threshold?: number | null
  thresholdField?: string | null
  debounceMs: number
  cooldownMs: number
  onStale: 'ignore' | 'degrade'
  /** O Flow que ele aciona ao disparar. Ausente = observa e registra, sem agir. */
  flowKey?: string | null
}

export interface BlueprintFlowV2 extends BlueprintItemBaseV2 {
  floorKey: string
  name: string
  description?: string
  trigger: { type: 'manual' | 'schedule' | 'monitor'; cron?: string; timezone?: string; monitorKey?: string }
  /** As etapas, no contrato atual de `automations`. */
  steps: Record<string, unknown>[]
  resultFormat?: string
}

export interface BlueprintRoutineV2 extends BlueprintItemBaseV2 {
  floorKey: string
  ownerAgentKey: string
  name: string
  description?: string
  triggerType: 'manual' | 'schedule'
  cron?: string
  timezone?: string
  executionMode?: string
  steps?: Record<string, unknown>[]
}

export interface BlueprintDeliveryV2 extends BlueprintItemBaseV2 {
  /** O que dispara a entrega: um Flow, um monitor ou uma rotina. */
  fromKey: string
  channelKey?: string | null
  /** Para onde. Endereço concreto NÃO entra aqui — ele é escolhido na tela. */
  destinationHint: string
  format: 'text' | 'markdown' | 'json'
}

// --- acesso e testes ----------------------------------------------------------------------

export interface BlueprintGrantV2 extends BlueprintItemBaseV2 {
  /** Sobre qual recurso: `database:<key>`, `source:<key>`, `knowledge:<key>`, `app:<key>`. */
  resourceRef: string
  subjectType: 'building' | 'floor' | 'sector' | 'agent'
  /** A `key` do sujeito no próprio Blueprint. Resolvida para id na aplicação. */
  subjectKey: string
  capabilities: string[]
  effect: 'allow' | 'deny'
}

export type AcceptanceTestKind =
  | 'source'
  | 'channel'
  | 'agent_contract'
  | 'flow'
  | 'app_dry_run'
  | 'database_permission'
  | 'monitor_simulation'
  | 'delivery'

export const ACCEPTANCE_TEST_KINDS: readonly AcceptanceTestKind[] = [
  'source',
  'channel',
  'agent_contract',
  'flow',
  'app_dry_run',
  'database_permission',
  'monitor_simulation',
  'delivery',
]

/**
 * O TESTE que prova que a operação funciona.
 *
 * "Pronto" no V1 significava "o documento existe". Aqui significa "o teste passou": um
 * checklist que fica verde porque alguém criou um recurso é um checklist decorativo.
 */
export interface BlueprintAcceptanceTestV2 {
  key: string
  kind: AcceptanceTestKind
  /** A `key` do que está sendo testado. */
  targetKey: string
  /** O que se espera observar, em português. É o que aparece no resultado. */
  expectation: string
  required: boolean
}

// --- o documento --------------------------------------------------------------------------

export interface OfficeBlueprintV2 {
  version: 2
  title: string
  objective: string
  changeKind: BlueprintChangeKindV2
  organization: {
    buildingPatch?: BlueprintBuildingPatch
    floors: BlueprintFloorV2[]
    sectors: BlueprintSectorV2[]
    agents: BlueprintAgentV2[]
  }
  resources: {
    knowledge: BlueprintKnowledgeV2[]
    memoryPolicies: BlueprintMemoryPolicyV2[]
    appRequirements: BlueprintAppRequirementV2[]
    databases: BlueprintDatabaseV2[]
    datasets: BlueprintDatasetV2[]
    tools: BlueprintToolRequirementV2[]
  }
  operations: {
    channels: BlueprintChannelBindingV2[]
    sources: BlueprintMonitoringSourceV2[]
    liveDestinations: BlueprintLiveDestinationV2[]
    histories: BlueprintHistoryV2[]
    monitors: BlueprintMonitorV2[]
    flows: BlueprintFlowV2[]
    routines: BlueprintRoutineV2[]
    deliveries: BlueprintDeliveryV2[]
  }
  access: BlueprintGrantV2[]
  acceptanceTests: BlueprintAcceptanceTestV2[]
  assumptions: ArchitectAssumption[]
  warnings: ArchitectWarning[]
  checklist: ArchitectChecklistItem[]
}

/** Qualquer um dos dois formatos. Os leitores aceitam os dois, e é isso que preserva o V1. */
export type OfficeBlueprint = OfficeBlueprintV1 | OfficeBlueprintV2

export const isV2 = (bp: OfficeBlueprint | null | undefined): bp is OfficeBlueprintV2 =>
  Boolean(bp) && (bp as OfficeBlueprintV2).version === 2

export const emptyBlueprintV2 = (title: string, objective: string, changeKind: BlueprintChangeKindV2 = 'create'): OfficeBlueprintV2 => ({
  version: 2,
  title,
  objective,
  changeKind,
  organization: { floors: [], sectors: [], agents: [] },
  resources: { knowledge: [], memoryPolicies: [], appRequirements: [], databases: [], datasets: [], tools: [] },
  operations: { channels: [], sources: [], liveDestinations: [], histories: [], monitors: [], flows: [], routines: [], deliveries: [] },
  access: [],
  acceptanceTests: [],
  assumptions: [],
  warnings: [],
  checklist: [],
})

/**
 * Todas as listas de itens, com o caminho de cada uma.
 *
 * Uma lista só de nomes seria repetida em cinco lugares (validação, hash, diff, merge,
 * conversão) e divergiria no primeiro campo novo. Aqui ela é uma só.
 */
export const V2_ITEM_PATHS = [
  'organization.floors',
  'organization.sectors',
  'organization.agents',
  'resources.knowledge',
  'resources.memoryPolicies',
  'resources.appRequirements',
  'resources.databases',
  'resources.datasets',
  'resources.tools',
  'operations.channels',
  'operations.sources',
  'operations.liveDestinations',
  'operations.histories',
  'operations.monitors',
  'operations.flows',
  'operations.routines',
  'operations.deliveries',
  'access',
] as const

export type V2ItemPath = (typeof V2_ITEM_PATHS)[number]

/** Lê uma lista pelo caminho. Devolve `[]` quando o bloco ainda não existe. */
export function itemsAt(bp: OfficeBlueprintV2, path: V2ItemPath): { key?: unknown }[] {
  const partes = path.split('.')
  let atual: unknown = bp
  for (const p of partes) {
    if (!atual || typeof atual !== 'object') return []
    atual = (atual as Record<string, unknown>)[p]
  }
  return Array.isArray(atual) ? (atual as { key?: unknown }[]) : []
}

/** Todos os itens, com o caminho de origem. É o que a validação e o diff percorrem. */
export function allItems(bp: OfficeBlueprintV2): { path: V2ItemPath; item: Record<string, unknown> }[] {
  const saida: { path: V2ItemPath; item: Record<string, unknown> }[] = []
  for (const path of V2_ITEM_PATHS) {
    for (const item of itemsAt(bp, path)) saida.push({ path, item: item as Record<string, unknown> })
  }
  return saida
}

/** Tetos: um Blueprint é uma proposta, não um depósito. */
export const V2_LIMITS = {
  itemsPerList: 40,
  totalItems: 220,
  keyChars: 60,
  textChars: 600,
  dependsOn: 12,
  acceptanceTests: 40,
} as const
