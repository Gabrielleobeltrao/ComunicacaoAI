// De "o que o usuário escolheu" para "quais etapas existem".
//
// A decisão de gastar token é tomada AQUI, na compilação, e não em tempo de
// execução: num modo sem IA a etapa `agent.execute` simplesmente não é gerada. Isso
// é mais forte que uma checagem no runner — não há o que pular, não há flag para
// alguém inverter, e quem abrir a definição publicada vê que não existe passo de
// modelo nenhum.
//
// O runner ainda tem uma segunda tranca para definições vindas de outro caminho.
// Duas travas para o mesmo erro é proposital: este é o erro que custa dinheiro do
// usuário sem ele pedir.
import { ObjectId } from 'mongodb'
import { describeCondition } from './conditions.js'
import type { StepCondition } from './conditions.js'
import { isMemoryScope, isMemoryStrategy } from '../memory/model.js'
import type { MemoryScope, MemoryStrategy } from '../memory/model.js'
import type { ExecutionMode, StepDefinition } from './types.js'

export const STEP_MEMORY = 'memoria'
export const STEP_APP = 'acao'

/**
 * O que gravar, e onde.
 *
 * `fieldMap` mapeia campos do evento para campos do registro: `{ total: 'pedido.valor' }`
 * guarda em `total` o que veio em `pedido.valor`. Vazio = guarda o evento inteiro,
 * que é o que a maioria quer e ninguém precisa configurar.
 */
export interface MemoryPlan {
  enabled: boolean
  scope: MemoryScope
  agentId?: string | null
  sectorId?: string | null
  floorId?: string | null
  buildingId?: string | null
  strategy: MemoryStrategy
  // Chave do registro. Aceita `{{campo}}` para vir do próprio evento.
  key: string
  // O que torna este evento único. Também aceita `{{campo}}`.
  dedupeKey?: string | null
  fieldMap?: Record<string, string>
  ttlSeconds?: number | null
}

export const emptyMemoryPlan = (): MemoryPlan => ({ enabled: false, scope: 'agent', strategy: 'append', key: 'evento' })

// Normaliza o que veio da API antes de virar definição. Um plano com destino
// incoerente é desligado em vez de gravar em lugar nenhum silenciosamente.
export function normalizeMemoryPlan(raw: unknown): MemoryPlan {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  if (p.enabled !== true) return emptyMemoryPlan()

  const scope: MemoryScope = isMemoryScope(p.scope) ? p.scope : 'agent'
  const strategy: MemoryStrategy = isMemoryStrategy(p.strategy) ? p.strategy : 'append'
  const key = typeof p.key === 'string' && p.key.trim() ? p.key.trim() : 'evento'
  const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

  const fieldMap: Record<string, string> = {}
  if (typeof p.fieldMap === 'object' && p.fieldMap !== null) {
    for (const [k, v] of Object.entries(p.fieldMap as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim() && k.trim()) fieldMap[k.trim()] = v.trim()
    }
  }

  const ttl = typeof p.ttlSeconds === 'number' && Number.isFinite(p.ttlSeconds) && p.ttlSeconds > 0 ? Math.floor(p.ttlSeconds) : null

  return {
    enabled: true,
    scope,
    agentId: texto(p.agentId),
    sectorId: texto(p.sectorId),
    floorId: texto(p.floorId),
    buildingId: texto(p.buildingId),
    strategy,
    key,
    dedupeKey: texto(p.dedupeKey),
    ...(Object.keys(fieldMap).length ? { fieldMap } : {}),
    ttlSeconds: ttl,
  }
}

/**
 * Uma ação de App executada direto, sem modelo no caminho.
 *
 * `args` aceita `{{campo}}` apontando para o que a etapa anterior produziu. Quando o
 * valor é exatamente um template, o valor ORIGINAL é passado adiante — é o que
 * permite entregar uma lista de quinhentos candles sem transformá-la em texto.
 */
export interface AppActionPlan {
  enabled: boolean
  appKey: string
  actionKey: string
  args?: Record<string, unknown>
}

export const emptyAppActionPlan = (): AppActionPlan => ({ enabled: false, appKey: '', actionKey: '' })

export function normalizeAppActionPlan(raw: unknown): AppActionPlan {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  if (p.enabled !== true) return emptyAppActionPlan()
  const appKey = typeof p.appKey === 'string' ? p.appKey.trim() : ''
  const actionKey = typeof p.actionKey === 'string' ? p.actionKey.trim() : ''
  // Sem App ou sem ação não há o que executar: desligado é mais honesto que uma etapa
  // que falharia na primeira execução.
  if (!appKey || !actionKey) return emptyAppActionPlan()
  return {
    enabled: true,
    appKey,
    actionKey,
    ...(typeof p.args === 'object' && p.args !== null ? { args: p.args as Record<string, unknown> } : {}),
  }
}

export const appStep = (plan: AppActionPlan, dependsOn: string[], ownerAgentId: ObjectId): StepDefinition => ({
  id: STEP_APP,
  name: 'Executar ação',
  type: 'app.execute',
  enabled: true,
  dependsOn,
  inputMapping: {},
  config: {
    // Sob a permissão deste agente. Um App só é alcançável por grant, e o grant é do
    // agente — não da conta.
    ownerAgentId: ownerAgentId.toString(),
    appKey: plan.appKey,
    actionKey: plan.actionKey,
    ...(plan.args ? { args: plan.args } : {}),
  },
  timeoutMs: 60_000,
  // Vale repetir uma falha de rede; uma recusa de permissão não é retentável e o
  // runner já a classifica como definitiva.
  retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
  continueOnError: false,
})

// A ação lida de volta da definição, para a interface reabrir preenchida.
export function readAppActionFromSteps(steps: { id: string; type: string; config?: Record<string, unknown> }[] | undefined): AppActionPlan {
  const passo = (steps ?? []).find((s) => s.id === STEP_APP && s.type === 'app.execute')
  if (!passo) return emptyAppActionPlan()
  return normalizeAppActionPlan({ ...(passo.config ?? {}), enabled: true })
}

/**
 * A etapa de gravação.
 *
 * `ownerAgentId` fica na configuração de propósito: é sob a permissão DESTE agente
 * que a gravação acontece. Deduzi-lo do passo de IA funcionaria só nos modos que têm
 * um — e é justamente nos modos sem IA que a checagem não pode sumir.
 */
export const memoryStep = (plan: MemoryPlan, dependsOn: string[], ownerAgentId: ObjectId): StepDefinition => ({
  id: STEP_MEMORY,
  name: 'Salvar na memória',
  type: 'memory.write',
  enabled: true,
  dependsOn,
  inputMapping: {},
  config: {
    ownerAgentId: ownerAgentId.toString(),
    scope: plan.scope,
    ...(plan.agentId ? { agentId: plan.agentId } : {}),
    ...(plan.sectorId ? { sectorId: plan.sectorId } : {}),
    ...(plan.floorId ? { floorId: plan.floorId } : {}),
    ...(plan.buildingId ? { buildingId: plan.buildingId } : {}),
    strategy: plan.strategy,
    key: plan.key,
    ...(plan.dedupeKey ? { dedupeKey: plan.dedupeKey } : {}),
    ...(plan.fieldMap ? { fieldMap: plan.fieldMap } : {}),
    ...(plan.ttlSeconds ? { ttlSeconds: plan.ttlSeconds } : {}),
  },
  timeoutMs: 10_000,
  // Vale repetir: falha de banco é transitória, e a marca de deduplicação garante
  // que a segunda tentativa não vire um segundo registro.
  retryPolicy: { maxAttempts: 3, backoffMs: 500 },
  continueOnError: false,
})

/**
 * A etapa da IA existe neste modo?
 *
 * `collect_only` e `deterministic` nunca. `hybrid` e `automatic` só com condição —
 * sem ela, "automático" viraria "sempre", que é o modo `ai` com outro nome e uma
 * conta que o dono não escolheu.
 */
/**
 * A condição, apontada para a etapa que REALMENTE tem o conteúdo.
 *
 * O dono escreve "quando o campo X for Y" e não deveria precisar saber de onde X vem —
 * ids de etapa são detalhe de compilação. Mas a diferença importa: num webhook o
 * conteúdo está no corpo (`input`); numa rotina que monitora, está no resultado da
 * fonte; e quando há ação de App, está no resultado dela.
 *
 * Apontar sempre para `input`, como a interface fazia, deixava a condição de uma rotina
 * lendo um lugar vazio — e "campo ausente" avalia como falso, então a IA nunca era
 * chamada e nada explicava por quê.
 *
 * Uma origem que o dono declarou explicitamente é respeitada: quem sabe o que está
 * fazendo não é corrigido.
 */
export function resolveConditionSource(condition: StepCondition | null | undefined, origemDoConteudo: string): StepCondition | null {
  if (!condition) return null
  const declarada = condition.source?.trim()
  const automatica = !declarada || declarada === 'input' || declarada === 'auto'
  return automatica ? { ...condition, source: origemDoConteudo } : condition
}

export function aiStepPlanned(mode: ExecutionMode, condition: StepCondition | null | undefined): boolean {
  if (mode === 'collect_only' || mode === 'deterministic') return false
  if (mode === 'ai') return true
  return !!condition
}

/**
 * Esta configuração faz alguma coisa?
 *
 * O caso concreto: modo "somente coletar", sem fonte, sem destino de memória e sem
 * ação de App. O gatilho responderia 200 e encerraria — nenhuma etapa, nenhum efeito.
 * Aceitar isso salva uma configuração que parece pronta e não é, e o dono só descobre
 * quando o relatório vem vazio.
 *
 * Devolve a mensagem do problema, ou `null` quando há trabalho.
 */
export function semTrabalho(opts: { mode: ExecutionMode; memory: MemoryPlan; condition?: StepCondition | null; temFonte?: boolean; temAcao?: boolean }): string | null {
  if (aiStepPlanned(opts.mode, opts.condition)) return null
  if (opts.memory.enabled || opts.temAcao || opts.temFonte) return null
  if (opts.mode === 'hybrid' || opts.mode === 'automatic') {
    return 'Neste modo, a IA só roda com uma condição preenchida. Preencha a condição, ou escolha guardar a informação, ou use o modo com IA.'
  }
  return 'Sem IA no fluxo, é preciso ter o que fazer: escolha guardar a informação na memória, executar uma ação de App, ou monitorar uma fonte.'
}

/**
 * A frase que a interface mostra antes de salvar.
 *
 * Existe porque a combinação de modo, destino e condição é fácil de configurar
 * errado e difícil de conferir depois: a diferença entre "grava e para" e "grava e
 * chama o modelo a cada evento" é uma linha do formulário e um zero a mais na conta.
 * Ler a frase é mais rápido que descobrir no fim do mês.
 */
export function describeFlow(opts: {
  mode: ExecutionMode
  origem: string
  memory: MemoryPlan
  condition?: StepCondition | null
  hasDelivery?: boolean
  destinoLabel?: string | null
  action?: AppActionPlan | null
  actionLabel?: string | null
}): string {
  const partes: string[] = [opts.origem, 'validar']

  if (opts.action?.enabled) partes.push(opts.actionLabel ?? `executar ${opts.action.actionKey}`)

  if (opts.memory.enabled) {
    const onde =
      opts.destinoLabel ??
      { agent: 'do agente', sector: 'do setor', floor: 'do andar', building: 'do prédio' }[opts.memory.scope]
    partes.push(`salvar na memória ${onde}`)
  }

  const comIA = aiStepPlanned(opts.mode, opts.condition)
  if (comIA && (opts.mode === 'hybrid' || opts.mode === 'automatic')) {
    partes.push(`chamar a IA ${describeCondition(opts.condition)}`)
  } else if (comIA) {
    partes.push('processar com IA')
  }

  if (opts.hasDelivery) partes.push('entregar')
  partes.push(comIA ? 'encerrar' : 'encerrar sem IA')
  return partes.join(' → ')
}

// Um rótulo curto por modo, com o custo dito na frente. É o texto que a interface
// mostra na escolha — e o dono decide olhando para ele.
export const MODE_LABELS: Record<ExecutionMode, string> = {
  collect_only: 'Somente coletar — 0 tokens de LLM',
  deterministic: 'Executar ações — 0 tokens de LLM',
  ai: 'Processar com IA — consome tokens',
  hybrid: 'Híbrido — IA somente quando a condição for atendida',
  automatic: 'Automático por regras — IA somente quando necessário',
}

export const oidOrNull = (v: string | null | undefined): ObjectId | null => (v && ObjectId.isValid(v) ? new ObjectId(v) : null)
