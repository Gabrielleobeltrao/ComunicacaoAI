import { API_URL } from './api'
import type { ProviderInfo } from './types'

/**
 * “Montar operação”, do lado da tela.
 *
 * Nada aqui monta recurso: as telas conversam, revisam e confirmam. Quem cria é o
 * servidor, e só depois de receber o hash da proposta que a pessoa de fato revisou.
 */

export type ArchitectStatus = 'discovery' | 'draft' | 'ready' | 'applying' | 'applied' | 'failed' | 'archived'

export interface ArchitectReadiness {
  requiredDone: number
  requiredTotal: number
  optionalDone: number
  optionalTotal: number
  ready: boolean
  blockers: string[]
}

export interface ChecklistItem {
  id: string
  category: 'structure' | 'knowledge' | 'app' | 'channel' | 'routine' | 'test' | 'review'
  title: string
  description: string
  required: boolean
  status: 'pending' | 'blocked' | 'ready' | 'done'
  completionMode: 'manual' | 'resource_state' | 'connection_state' | 'test_result'
  target?: { kind: string; key: string; id?: string }
  /** Para onde ir quando o item não se resolve no próprio alvo — ver o servidor. */
  linkTarget?: { kind: string; key: string }
  actionPath?: string
  dependsOn: string[]
}

export interface ArchitectQuestion {
  key: string
  text: string
  why: string
  choices?: { value: string; label: string }[]
  allowUnknown: boolean
}

export interface BlueprintIssue {
  path: string
  code: string
  message: string
  severity: 'error' | 'warning'
  suggestedAction?: string
}

export interface ArchitectLink {
  kind: string
  key: string
  id: string
  path: string
}

export interface ArchitectTargets {
  floors: { id: string; name: string }[]
  agents: { id: string; name: string; floorId: string }[]
  sectors: { id: string; name: string; floorId: string }[]
  routines: { id: string; name: string; status: string }[]
}

export interface BlueprintLink {
  kind: 'floor' | 'agent' | 'sector' | 'routine'
  key: string
  action: 'create' | 'reuse' | 'update'
  resourceId?: string | null
}

export interface ApplyStep {
  kind: string
  key: string
  status: string
  message?: string
  resourceId?: string | null
}

export interface ArchitectProject {
  id: string
  title: string
  objective: string
  status: ArchitectStatus
  locale: string
  readiness: ArchitectReadiness
  hasBlueprint: boolean
  createdAt: string
  updatedAt: string
  appliedAt: string | null
  provider?: 'anthropic' | 'openai'
  model?: string | null
  answers?: Record<string, unknown>
  pendingQuestion?: { key: string; text: string } | null
  assumptions?: { key: string; text: string; questionKey?: string }[]
  blueprint?: Blueprint | null
  /**
   * O PLANO INTEIRO — as três camadas juntas. `blueprint` é o recorte da escolhida.
   *
   * Os dois vêm porque respondem perguntas diferentes: o recorte é o que vai ser
   * aplicado, e o plano é do que sai a comparação entre as camadas.
   */
  plan?: Blueprint | null
  layer?: BlueprintLayer
  layerCounts?: Record<BlueprintLayer, { agents: number; sectors: number; routines: number; apps: number }> | null
  /** O que o Arquiteto entendeu do negócio. É o que a tela mostra como "O que entendi". */
  brief?: OperationBrief | null
  canUndoBrief?: boolean
  blueprintHash?: string | null
  checklist?: ChecklistItem[]
  applyState?: { operationId: string; status: string; error: string | null } | null
  /** Vem junto no GET: um reload de projeto aplicado precisa reconstruí-los. */
  links?: ArchitectLink[]
  /** O que a última revisão mexeu. Vazio na primeira proposta. */
  changes?: BlueprintChange[]
}

export type BlueprintLayer = 'essential' | 'recommended' | 'complete'

export const LAYERS: { key: BlueprintLayer; label: string; hint: string }[] = [
  { key: 'essential', label: 'Essencial', hint: 'o caminho mínimo até a primeira resposta' },
  { key: 'recommended', label: 'Recomendado', hint: 'o que faz a resposta ser boa' },
  { key: 'complete', label: 'Completo', hint: 'tudo o que foi entendido, inclusive o que roda sozinho' },
]

/** O ENTENDIMENTO: o que a operação faz, em fatos — antes de virar desenho. */
export interface OperationBrief {
  version: number
  businessGoal: string
  audience: string
  channels: string[]
  jobs: {
    id: string
    name: string
    trigger?: string
    input?: string
    decision?: string
    action?: string
    output?: string
    frequency?: string
    volume?: string
    risk?: string
  }[]
  knowledgeNeeds: { subject: string; required: boolean; source?: string }[]
  integrations: { name: string; purpose?: string; connected?: boolean }[]
  constraints: string[]
  assumptions: { id: string; text: string; status: string }[]
  openQuestions: string[]
}

export interface BlueprintChange {
  kind: 'floor' | 'agent' | 'sector' | 'routine' | 'app' | 'knowledge'
  key: string
  label: string
  change: 'added' | 'removed' | 'changed'
  fields: string[]
}

/** Uma correção à mão na proposta: um item, os campos de texto que mudaram. */
export interface BlueprintEdit {
  kind: PreviewItem['kind']
  key: string
  fields?: Record<string, string>
  remove?: boolean
}

export interface Blueprint {
  title: string
  objective: string
  floors: { key: string; name: string; workMode: string; mission?: string; description?: string; rationale?: string }[]
  agents: {
    key: string
    name: string
    floorKey: string
    preset?: string
    objective?: string
    role?: string
    instructions?: string
    constraints?: string
    rationale?: string
    executorKind?: 'llm' | 'function' | 'tool'
    functionName?: string
    inputContract?: string
    outputContract?: string
    activationModes?: string[]
    delegationPolicy?: string
    callableAgentKeys?: string[]
    handoffEnabled?: boolean
    layer?: BlueprintLayer
    layerReason?: string
  }[]
  sectors: { key: string; name: string; mode: string; floorKey?: string; memberAgentKeys: string[]; coordinatorAgentKey?: string | null; instruction?: string; rationale?: string }[]
  routines: { key: string; name: string; ownerAgentKey: string; description?: string; rationale?: string; triggerType?: string; cron?: string; layer?: BlueprintLayer; layerReason?: string }[]
  appRequirements: { key: string; appKey: string; reason: string; required: boolean; agentKeys?: string[]; layer?: BlueprintLayer; layerReason?: string }[]
  knowledgeRequirements: { key: string; title: string; description: string; required: boolean; state: string; content?: string; scope?: string; targetKey?: string; layer?: BlueprintLayer; layerReason?: string }[]
  assumptions: { key: string; text: string }[]
  warnings: { path: string; message: string }[]
}

export interface PreviewItem {
  kind: 'building' | 'floor' | 'agent' | 'sector' | 'routine' | 'app' | 'knowledge'
  key: string
  label: string
  action: 'create' | 'reuse' | 'update' | 'wait_user'
  detail: string
  /** Por que este item está na proposta. O modelo escreveu; a tela mostra. */
  rationale?: string
  dependsOn: string[]
  usesLlm: boolean
  requiresApproval: boolean
  issues: BlueprintIssue[]
}

export interface CriticFinding {
  source: 'responsibility' | 'executor' | 'architecture' | 'llm'
  code: string
  agentKey?: string
  message: string
  fix: string
  severity: 'error' | 'warning'
  evidence: string[]
}

export interface ArchitectureScore {
  coverage: number
  cohesion: number
  executorFit: number
  permissionSafety: number
  setupCompleteness: number
  handoffSimplicity: number
  /** Os fatos por trás de cada nota. Nota sem fato é palpite com número. */
  facts: Record<string, string[]>
}

export interface SimulationResult {
  caseId: string
  observedRoute: string[]
  steps: { kind: string; ref: string; detail: string }[]
  problems: { code: string; message: string; fix: string }[]
  sideEffectsAvoided: string[]
  matchedExpected: boolean
}

export interface SimulationRun {
  version: number
  createdAt?: string
  cases: { id: string; input: string; trigger: string; expectedRoute: string[]; expectsApproval: boolean }[]
  results: SimulationResult[]
  passed: number
}

export interface ArchitectPreview {
  blueprintHash: string
  valid: boolean
  issues: BlueprintIssue[]
  items: PreviewItem[]
  checklist: ChecklistItem[]
  readiness: ArchitectReadiness
  counts: { create: number; reuse: number; update: number; waitUser: number }
  /** O que a validação estrutural não vê: gerente sem equipe, executor incoerente. */
  critique?: {
    findings: CriticFinding[]
    score: ArchitectureScore
    mergeSplit: { agentKey: string; agentName: string; jobs: string[]; rationale: string }[]
    clean: boolean
    /**
     * A leitura auxiliar do modelo sobre ESTA revisão.
     *
     * `stale` é a leitura de outra revisão, descartada; `absent` é "ainda não houve".
     * A tela diz qual dos dois — fingir que a proposta foi revisada é pior que dizer
     * que não foi.
     */
    llmStatus?: 'ok' | 'failed' | 'stale' | 'absent'
  }
  /** O ensaio da operação, sem efeito nenhum. */
  simulation?: SimulationRun
  /** A camada que este recorte representa, e o que cada uma entrega. */
  layer?: BlueprintLayer
  layerCounts?: Record<BlueprintLayer, { agents: number; sectors: number; routines: number; apps: number }>
}

export interface ArchitectMessage {
  id: string
  role: 'user' | 'assistant' | 'system_notice'
  content: string
  /** Aviso de FALHA do provedor — o único tipo de aviso que uma rodada boa resolve. */
  failure?: boolean
  /** Já resolvido por uma rodada posterior: fica no histórico, sai do alarme. */
  resolved?: boolean
  createdAt: string
}

export interface TurnResponse extends ArchitectProject {
  assistantText: string
  question: ArchitectQuestion | null
  secretMasked?: boolean
}

export interface ApplyResponse extends ArchitectProject {
  operation: { id: string; status: string; steps: ApplyStep[]; error: string | null } | null
  links: ArchitectLink[]
}

/** O erro carrega o código do servidor: a tela reage a cada recusa de um jeito. */
export class ArchitectError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_URL}/api/architect${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string; error?: string } | null
    throw new ArchitectError(body?.code ?? 'error', body?.message ?? body?.error ?? 'Não foi possível concluir.')
  }
  return res.status === 204 ? (null as T) : ((await res.json()) as T)
}

export const listProjects = (includeArchived = false) => request<ArchitectProject[]>(`/projects${includeArchived ? '?includeArchived=true' : ''}`)
export const createProject = (objective: string) => request<ArchitectProject>('/projects', { method: 'POST', body: JSON.stringify({ objective }) })
export const getProject = (id: string) => request<ArchitectProject>(`/projects/${id}`)
export const listMessages = (id: string) => request<ArchitectMessage[]>(`/projects/${id}/messages`)
export const sendMessage = (id: string, content: string, forceProposal = false) =>
  request<TurnResponse>(`/projects/${id}/messages`, { method: 'POST', body: JSON.stringify({ content, forceProposal }) })
export const generateProposal = (id: string) => request<TurnResponse>(`/projects/${id}/generate`, { method: 'POST' })
/** Uma rodada sem mensagem nova — é o que responde à descrição inicial. */
export const advanceTurn = (id: string) => request<TurnResponse>(`/projects/${id}/turn`, { method: 'POST', body: JSON.stringify({}) })
export const validateProject = (id: string) => request<{ valid: boolean; issues: BlueprintIssue[] }>(`/projects/${id}/validate`, { method: 'POST' })
export const previewProject = (id: string) => request<ArchitectPreview>(`/projects/${id}/preview`)
export const listTargets = () => request<ArchitectTargets>('/targets')
export const setLinks = (id: string, links: BlueprintLink[]) => request<ArchitectProject>(`/projects/${id}/links`, { method: 'PATCH', body: JSON.stringify({ links }) })
/** Corrige a proposta sem chamar o modelo — texto, e só. Ver `editBlueprint` no servidor. */
export const setLayer = (id: string, layer: BlueprintLayer) =>
  request<ArchitectProject>(`/projects/${id}/layer`, { method: 'PATCH', body: JSON.stringify({ layer }) })

export const editBrief = (id: string, patch: Partial<OperationBrief>) =>
  request<ArchitectProject>(`/projects/${id}/brief`, { method: 'PATCH', body: JSON.stringify({ patch }) })

export const undoBrief = (id: string) => request<ArchitectProject>(`/projects/${id}/brief`, { method: 'PATCH', body: JSON.stringify({ undo: true }) })

export const editBlueprint = (id: string, edits: BlueprintEdit[]) =>
  request<ArchitectProject>(`/projects/${id}/blueprint`, { method: 'PATCH', body: JSON.stringify({ edits }) })
export const rollbackProject = (id: string) => request<ArchitectProject & { removed: string[]; kept: { key: string; reason: string }[] }>(`/projects/${id}/rollback`, { method: 'POST' })
/**
 * Os provedores da conta.
 *
 * O tipo vem de `types.ts`, que já descreve esta rota — redeclarar aqui foi o erro:
 * `models` é `{id, label}[]`, e a versão local dizia `string[]`. O TypeScript acreditou
 * na declaração errada, o `<option>` recebeu um objeto e a tela inteira caiu.
 */
export type ArchitectProvider = ProviderInfo & { configured: boolean }

export const listProviders = () =>
  fetch(`${API_URL}/api/providers`, { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : []))
    .then((v) => v as ArchitectProvider[])
export const patchProject = (id: string, patch: { provider?: 'anthropic' | 'openai'; model?: string | null; title?: string }) =>
  request<ArchitectProject>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })

export const applyProject = (id: string, body: { blueprintHash: string; idempotencyKey: string; approvedAppKeys: string[]; approvedUpdateKeys: string[] }) =>
  request<ApplyResponse>(`/projects/${id}/apply`, { method: 'POST', body: JSON.stringify({ ...body, confirm: true }) })
export const resumeProject = (id: string) => request<ApplyResponse>(`/projects/${id}/resume`, { method: 'POST' })
export const recheckProject = (id: string) => request<ApplyResponse>(`/projects/${id}/recheck`, { method: 'POST' })
export const markChecklistItem = (id: string, itemId: string, done: boolean) =>
  request<ArchitectProject>(`/projects/${id}/checklist/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify({ done }) })
export const archiveProject = (id: string) => request<ArchitectProject>(`/projects/${id}/archive`, { method: 'POST' })
/** Apaga a CONVERSA. O que ela criou continua de pé — ver `deleteProject` no servidor. */
export const deleteProject = (id: string) => request<null>(`/projects/${id}`, { method: 'DELETE' })

/**
 * A chave da operação, estável enquanto a aba estiver aberta e o hash for o mesmo.
 *
 * Sem isso, um clique duplo em "aplicar" seria duas operações; e uma nova revisão
 * precisa de chave nova, senão a segunda aplicação devolveria o resultado da primeira.
 */
export const idempotencyKeyFor = (projectId: string, hash: string): string => `${projectId}:${hash.slice(0, 16)}`
