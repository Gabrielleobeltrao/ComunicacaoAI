import type { ObjectId } from 'mongodb'

// O CONTRATO COMUM dos recursos do escritório — e o que ele deliberadamente não é.
//
// Não é uma supercoleção. Knowledge, App, Tool e Database têm ciclos de vida, validações
// e políticas próprios, e juntá-los numa tabela polimórfica produziria um `if` por tipo em
// todo lugar, com o agravante de existirem duas verdades sobre o mesmo objeto — a da
// coleção comum e a do subsistema.
//
// O que existe aqui é o contrato para LISTAR, REFERENCIAR e EXPLICAR acesso. Cada tipo
// continua respondendo pela sua regra; esta camada delega. Uma abstração que enfraquece o
// gate do App para caber num formato genérico é pior que não ter abstração.

export type ResourceKind = 'knowledge' | 'app' | 'database' | 'tool'
export const RESOURCE_KINDS: readonly ResourceKind[] = ['knowledge', 'app', 'database', 'tool']
export const isResourceKind = (v: unknown): v is ResourceKind => RESOURCE_KINDS.includes(v as ResourceKind)

/** Quem ADMINISTRA o recurso. `platform` é o catálogo oficial; `account`, a conta. */
export type ResourceOwnerType = 'platform' | 'account' | 'building' | 'floor' | 'sector' | 'agent'

/** Quem PODE USAR. Sempre uma coisa da organização — plataforma não usa, oferece. */
export type ResourceSubjectType = 'building' | 'floor' | 'sector' | 'agent'
export const RESOURCE_SUBJECT_TYPES: readonly ResourceSubjectType[] = ['building', 'floor', 'sector', 'agent']

export interface ResourceRef {
  kind: ResourceKind
  id: string
}

export interface ResourceOwnerRef {
  ownerType: ResourceOwnerType
  ownerId: string
}

export interface ResourceSubjectRef {
  subjectType: ResourceSubjectType
  subjectId: string
}

/**
 * As CAPACIDADES por tipo.
 *
 * Acesso binário não serve: "o agente pode usar o banco" não distingue ler de apagar, e
 * é a distinção que impede um agente de consulta de virar um agente de exclusão por um
 * grant escrito às pressas.
 *
 * As administrativas existem para a interface saber que elas NÃO são de agente: schema,
 * publicação e concessão nunca viram ferramenta de LLM.
 */
export const CAPABILITIES: Record<ResourceKind, readonly string[]> = {
  knowledge: ['discover', 'retrieve', 'curate', 'manage'],
  // App usa as ações do manifesto; estas são as capacidades genéricas de catálogo.
  app: ['discover', 'execute', 'manage'],
  database: ['discover', 'query', 'insert', 'update', 'delete', 'manage_schema', 'manage_access'],
  tool: ['discover', 'execute', 'test', 'edit', 'publish', 'manage_access'],
}

/** O que um agente pode receber. O resto é ação humana, e a UI precisa saber a diferença. */
export const AGENT_CAPABILITIES: Record<ResourceKind, readonly string[]> = {
  knowledge: ['discover', 'retrieve'],
  app: ['discover', 'execute'],
  database: ['discover', 'query', 'insert', 'update', 'delete'],
  tool: ['discover', 'execute'],
}

export const isAgentCapability = (kind: ResourceKind, capability: string): boolean =>
  AGENT_CAPABILITIES[kind].includes(capability)

/**
 * A TRAVA: o que um agente pode receber, independente do que o adapter devolveu.
 *
 * Ela é redundante por desenho. Os adapters já limitam as capacidades de agente; esta
 * função existe para o caso em que um deles não limite — um tipo novo escrito às pressas,
 * um grant malformado, um `return CAPABILITIES[kind]` copiado do ramo administrativo.
 * "Publicar", "editar schema" e "conceder acesso" não podem virar ferramenta de LLM por
 * um caminho que ninguém revisou, e é aqui que isso é garantido em um lugar só.
 */
export const agentCapabilitiesOnly = (kind: ResourceKind, capabilities: string[]): string[] =>
  capabilities.filter((c) => isAgentCapability(kind, c))

/** De onde a permissão veio. Sem isto, "tem acesso" não tem como ser conferido. */
export type AccessOrigin = 'direct' | 'sector' | 'floor' | 'building' | 'specialized_policy' | 'owner' | 'none'

export interface ResourceAccessDecision {
  allowed: boolean
  /** As capacidades EFETIVAS — o que sobrou depois de todas as regras. */
  capabilities: string[]
  origin: AccessOrigin
  /**
   * Por que sim ou por que não, em português e sem vazar nada.
   *
   * "Não encontrado" e "sem permissão" são a mesma frase quando o recurso é de outra
   * conta: distinguir os dois conta que aquele id existe em algum lugar.
   */
  reason: string
  /** Uma pendência acionável: conexão pausada, versão incompatível, segredo ausente. */
  pending?: { code: string; message: string } | null
}

export interface ResourceSummary {
  kind: ResourceKind
  id: string
  name: string
  description?: string
  owner: ResourceOwnerRef
  /** O estado do recurso na linguagem dele — `enabled`, `needs_reauth`, `error`… */
  status?: string
  /** Sinais discretos: pendência, vencido, em conflito. */
  flags?: string[]
  updatedAt?: Date
}

export interface ResourceDetail extends ResourceSummary {
  capabilities: string[]
  /** Metadados seguros e reconstruíveis. NUNCA credencial, conteúdo ou registro. */
  meta: Record<string, unknown>
}

export interface ResourceImpact {
  resource: ResourceRef
  /** Quem PODE usar — permissão potencial. */
  accessibleBy: { subjectType: ResourceSubjectType; subjectId: string; name: string }[]
  /** Quem REALMENTE usou — evidência. Vazio é evidência, não estimativa. */
  usedBy: { executionId: string; kind: string; at: Date }[]
  usedCount: number
  /** O que quebra: rotinas, monitores, ferramentas e agentes que dependem disto. */
  dependents: { kind: string; id: string; name: string; reason: string }[]
  recommendation: 'safe_to_delete' | 'prefer_archive'
}

export interface ResourceListContext {
  accountId: string
  /** Recorte por contexto: os recursos DESTE andar, setor ou agente. */
  subject?: ResourceSubjectRef | null
  /** `owned` = de quem é; `available` = o que o sujeito consegue usar. */
  access?: 'owned' | 'available'
  search?: string | null
  limit?: number
  skip?: number
}

export interface ResourceAccessContext {
  accountId: string
  /** O agente que vai usar. Ausente = pergunta administrativa, não operacional. */
  actorAgentId?: ObjectId | null
  resourceId: string
  requestedCapability?: string | null
  /** O contexto REAL da execução — setor validado, e não um id que chegou do cliente. */
  executionContext?: { verifiedSectorId?: ObjectId | null } | null
}

export interface ResourceAdapter {
  kind: ResourceKind
  list(ctx: ResourceListContext): Promise<ResourceSummary[]>
  get(accountId: string, resourceId: string): Promise<ResourceDetail | null>
  capabilities(): readonly string[]
  resolveAccess(ctx: ResourceAccessContext): Promise<ResourceAccessDecision>
  impact(accountId: string, resourceId: string): Promise<ResourceImpact | null>
}

/** A recusa padrão. A MESMA para id inválido, inexistente e de outra conta. */
export const denied = (reason = 'este recurso não está disponível para esta conta'): ResourceAccessDecision => ({
  allowed: false,
  capabilities: [],
  origin: 'none',
  reason,
})
