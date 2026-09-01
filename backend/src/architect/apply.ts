import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import type { ArchitectStamp } from '../architectStamp.js'
import { createFloor, updateFloor } from '../floors.js'
import { createAgent, updateAgent } from '../agents.js'
import { createSector } from '../sectors.js'
import { writeArchitectKnowledge, deleteArchitectKnowledge } from './knowledge.js'
import { translateSteps } from './routineSteps.js'
import { createAutomation } from '../automations/service.js'
import { DEFAULT_LIMITS } from '../automations/types.js'
import { loadOwnershipContext } from './context.js'
import { validateOfficeBlueprint } from './validate.js'
import { computeBlueprintHash } from './blueprint.js'
import * as repo from './repository.js'
import type { ArchitectProject, ArchitectApplyOperation } from './repository.js'
import type { ApplyStepKind, ApplyStepResult, BlueprintAgent, OfficeBlueprintV1 } from './types.js'

// A APLICAÇÃO: a única parte do Arquiteto que escreve no escritório.
//
// É uma saga, e não uma transação: o produto não exige replica set, e uma transação
// que não existe em toda instalação seria uma garantia falsa. O que substitui a
// transação é o `resourceMap` — cada recurso criado é gravado com a `key` que o
// originou, ANTES do próximo passo. Repetir a aplicação encontra o que já existe e
// segue adiante; retomar depois de uma falha recomeça de onde parou.
//
// O que a saga nunca faz: apagar, sobrescrever ou desligar recurso preexistente.

export class ApplyConflict extends Error {}

/**
 * A saga falhou DEPOIS de a operação existir.
 *
 * Carrega o id junto porque o estado do projeto precisa apontar para a operação de
 * verdade — inclusive na falha. Sem isso, "retomar" não sabia o que retomar, e o
 * `applyState` guardava uma string vazia.
 */
export class ApplyFailure extends Error {
  operationId: string
  constructor(message: string, operationId: string) {
    super(message)
    this.operationId = operationId
  }
}

/** Onde o passo escreve o resultado — separado para o teste conseguir injetar falha. */
export interface ApplyHooks {
  /** Chamado antes de cada passo. Lançar aqui simula uma queda no meio da aplicação. */
  beforeStep?: (kind: ApplyStepKind, key: string) => void | Promise<void>
  /**
   * Chamado DEPOIS de criar e ANTES de registrar o passo.
   *
   * É a janela que o marcador de origem existe para cobrir, e o único jeito de
   * exercitá-la num teste: lançar aqui deixa o recurso criado e a operação sem saber.
   */
  afterCreate?: (kind: ApplyStepKind, key: string) => void | Promise<void>
}

interface Contexto {
  ownerId: string
  operation: ArchitectApplyOperation
  bp: OfficeBlueprintV1
  /** `kind:key` → id real. Começa com o que a operação já tinha feito antes. */
  mapa: Map<string, string>
  hooks: ApplyHooks
  /** Requisitos de App que o dono aprovou explicitamente nesta aplicação. */
  grantsAprovados: Set<string>
  /** As `key`s de alteração em recurso existente que o dono aprovou, uma a uma. */
  updatesAprovados: Set<string>
}

const chave = (kind: ApplyStepKind, key: string): string => `${kind}:${key}`

/** A `key` reservada do prédio: ele não está em lista nenhuma do blueprint. */
export const BUILDING_UPDATE_KEY = 'building'

/**
 * Uma alteração em recurso EXISTENTE só acontece com aprovação individual.
 *
 * A aprovação vem do corpo da requisição de aplicar (`approvedUpdateKeys`) e é conferida
 * de novo aqui, no servidor: o checkbox da tela decide o que é ENVIADO, e este `if`
 * decide o que é FEITO. Sem esta linha, marcar ou desmarcar seria decoração.
 */
const aprovado = (ctx: Contexto, key: string): boolean => ctx.updatesAprovados.has(key)

async function registrar(ctx: Contexto, step: Omit<ApplyStepResult, 'at'>): Promise<void> {
  const completo: ApplyStepResult = { ...step, at: new Date() }
  if (completo.resourceId) ctx.mapa.set(chave(step.kind, step.key), completo.resourceId)
  await repo.recordStep(ctx.ownerId, ctx.operation._id, completo)
}

/**
 * Faz o passo — ou devolve o que ele já tinha feito.
 *
 * O `resourceMap` é consultado ANTES de criar. É por isso que aplicar duas vezes não
 * duplica: a segunda passagem encontra o id da primeira e não chama o `create`.
 */
async function passo(ctx: Contexto, kind: ApplyStepKind, key: string, criar: () => Promise<{ id: string; status: ApplyStepResult['status']; message?: string }>): Promise<string> {
  const jaFeito = ctx.mapa.get(chave(kind, key))
  if (jaFeito) return jaFeito

  // A JANELA. Entre criar o recurso e registrar o passo há um instante em que o
  // recurso existe e a operação não sabe. Uma queda ali fazia a retomada criar o
  // segundo. Procurar pela marca de origem antes de criar fecha isso — e o índice
  // único garante que, mesmo numa corrida, o segundo insert seja recusado.
  const recuperado = await recuperarPelaMarca(ctx, kind, key)
  if (recuperado) {
    await registrar(ctx, { kind, key, status: 'created', resourceId: recuperado, message: 'recuperado: já tinha sido criado antes da queda' })
    return recuperado
  }

  await ctx.hooks.beforeStep?.(kind, key)
  const r = await criar()
  await ctx.hooks.afterCreate?.(kind, key)
  await registrar(ctx, { kind, key, status: r.status, resourceId: r.id, ...(r.message ? { message: r.message } : {}) })
  return r.id
}

const COLECAO_DA_MARCA: Partial<Record<ApplyStepKind, string>> = {
  floor: 'offices',
  agent: 'agents',
  sector: 'sectors',
  routine: 'automations',
}

/** Já existe um recurso desta operação para esta `key`? */
async function recuperarPelaMarca(ctx: Contexto, kind: ApplyStepKind, key: string): Promise<string | null> {
  const colecao = COLECAO_DA_MARCA[kind]
  if (!colecao) return null
  const doc = await db
    .collection(colecao)
    .findOne({ ownerId: ctx.ownerId, 'architect.operationId': ctx.operation._id.toString(), 'architect.blueprintKey': key }, { projection: { _id: 1 } })
  return doc ? doc._id.toString() : null
}

/** A marca gravada junto com o recurso, na mesma escrita. */
const marcaDe = (ctx: Contexto, key: string): ArchitectStamp => ({
  projectId: ctx.operation.projectId.toString(),
  operationId: ctx.operation._id.toString(),
  blueprintKey: key,
})

/**
 * Aplica a proposta.
 *
 * `blueprintHash` vem do cliente e é conferido contra o hash atual: uma confirmação
 * feita sobre uma prévia antiga é recusada, e não aplicada às cegas.
 */
export async function applyBlueprint(
  ownerId: string,
  project: ArchitectProject,
  input: { blueprintHash: string; idempotencyKey: string; approvedAppKeys?: string[]; approvedUpdateKeys?: string[] },
  hooks: ApplyHooks = {},
): Promise<ArchitectApplyOperation> {
  const bp = project.blueprint
  if (!bp) throw new ApplyConflict('ainda não existe proposta para aplicar')

  const hashAtual = computeBlueprintHash(bp)
  if (input.blueprintHash !== hashAtual) {
    throw new ApplyConflict('a proposta mudou desde a última revisão; revise de novo antes de aplicar')
  }

  // Revalidação com a posse LIDA AGORA. Entre a prévia e o clique, o dono pode ter
  // apagado o andar que a proposta ia reutilizar.
  const ctxPosse = await loadOwnershipContext(ownerId)
  const validacao = validateOfficeBlueprint(bp, ctxPosse)
  if (!validacao.valid) throw new ApplyConflict('a proposta não está válida; revise as pendências antes de aplicar')

  const { operation } = await repo.openOperation(ownerId, project._id, hashAtual, input.idempotencyKey)
  if (operation.status === 'completed') return operation

  // Mesmo na primeira aplicação: dois cliques com a MESMA chave chegam à mesma
  // operação, e sem o arrendamento os dois rodariam a saga em paralelo.
  if (!(await repo.claimOperation(ownerId, operation._id))) {
    throw new ApplyConflict('esta aplicação já está em andamento')
  }

  return rodar(ownerId, operation, bp, hooks, new Set(input.approvedAppKeys ?? []), new Set(input.approvedUpdateKeys ?? []))
}

/** O corpo compartilhado por aplicar e retomar: roda a saga, fecha e solta o arrendamento. */
async function rodar(
  ownerId: string,
  operation: ArchitectApplyOperation,
  bp: OfficeBlueprintV1,
  hooks: ApplyHooks,
  grantsAprovados: Set<string>,
  updatesAprovados: Set<string>,
): Promise<ArchitectApplyOperation> {
  const ctx: Contexto = {
    ownerId,
    operation,
    bp,
    mapa: new Map(Object.entries(operation.resourceMap ?? {})),
    hooks,
    grantsAprovados,
    updatesAprovados,
  }

  try {
    await executarSaga(ctx)
    await repo.finishOperation(ownerId, operation._id, 'completed', null)
    return (await repo.getOperation(ownerId, operation._id)) ?? operation
  } catch (error) {
    const motivo = error instanceof Error ? error.message : 'falha ao aplicar'
    await repo.finishOperation(ownerId, operation._id, 'failed', motivo)
    throw new ApplyFailure(motivo, operation._id.toString())
  } finally {
    await repo.releaseOperation(ownerId, operation._id).catch(() => undefined)
  }
}

async function executarSaga(ctx: Contexto): Promise<void> {
  const { bp } = ctx

  // 1. Andares.
  for (const floor of bp.floors ?? []) {
    await passo(ctx, 'floor', floor.key, async () => {
      if (floor.action === 'reuse') return { id: String(floor.resourceId), status: 'reused' }
      if (floor.action === 'update') {
        const id = String(floor.resourceId)
        if (!aprovado(ctx, floor.key)) return { id, status: 'skipped', message: 'alteração não aprovada nesta aplicação' }
        // Só os campos que a proposta declara, e pelo serviço canônico — que valida o
        // andar coordenado e o coordenador junto, como qualquer edição pela tela.
        const patch: Parameters<typeof updateFloor>[2] = {}
        if (floor.name?.trim()) patch.name = floor.name
        if (floor.mission !== undefined) patch.mission = floor.mission
        if (floor.description !== undefined) patch.description = floor.description
        if (floor.timezone) patch.timezone = floor.timezone
        const r = await updateFloor(ctx.ownerId, new ObjectId(id), patch)
        if (!r) throw new Error(`o andar "${floor.name}" não existe mais nesta conta`)
        return { id, status: 'updated' }
      }
      const criado = await createFloor(ctx.ownerId, {
        name: floor.name,
        mission: floor.mission ?? '',
        description: floor.description ?? '',
        ...(floor.timezone ? { timezone: floor.timezone } : {}),
        architect: marcaDe(ctx, floor.key),
      })
      return { id: criado._id.toString(), status: 'created' }
    })
  }

  // 2. Agentes. O andar já existe: o id sai do mapa, nunca da proposta.
  for (const agent of bp.agents ?? []) {
    await passo(ctx, 'agent', agent.key, async () => {
      if (agent.action === 'reuse') return { id: String(agent.resourceId), status: 'reused' }
      if (agent.action === 'update') {
        const id = String(agent.resourceId)
        if (!aprovado(ctx, agent.key)) return { id, status: 'skipped', message: 'alteração não aprovada nesta aplicação' }
        const r = await updateAgent(ctx.ownerId, new ObjectId(id), camposDoAgente(agent, { name: agent.name }))
        if (!r) throw new Error(`o agente "${agent.name}" não existe mais nesta conta`)
        return { id, status: 'updated' }
      }
      const floorId = ctx.mapa.get(chave('floor', agent.floorKey))
      if (!floorId) throw new Error(`o andar do agente ${agent.name} não foi criado`)
      const criado = await createAgent(ctx.ownerId, new ObjectId(floorId), agent.name, { ...camposDoAgente(agent), architect: marcaDe(ctx, agent.key) })
      return { id: criado._id.toString(), status: 'created' }
    })
  }

  // 3. Setores.
  for (const sector of bp.sectors ?? []) {
    await passo(ctx, 'sector', sector.key, async () => {
      if (sector.action === 'reuse') return { id: String(sector.resourceId), status: 'reused' }
      if (sector.action === 'update') {
        const id = String(sector.resourceId)
        if (!aprovado(ctx, sector.key)) return { id, status: 'skipped', message: 'alteração não aprovada nesta aplicação' }
        const { updateSector } = await import('../sectors.js')
        const patch: Record<string, unknown> = {}
        if (sector.name?.trim()) patch.name = sector.name
        if (sector.color) patch.color = sector.color
        if (sector.instruction !== undefined) patch.instruction = sector.instruction
        if (sector.inputContract !== undefined) patch.inputContract = sector.inputContract
        if (sector.outputContract !== undefined) patch.outputContract = sector.outputContract
        const r = await updateSector(ctx.ownerId, new ObjectId(id), patch)
        if (!r) throw new Error(`o setor "${sector.name}" não existe mais nesta conta`)
        return { id, status: 'updated' }
      }
      const floorId = ctx.mapa.get(chave('floor', sector.floorKey))
      if (!floorId) throw new Error(`o andar do setor ${sector.name} não foi criado`)
      const membros = (sector.memberAgentKeys ?? []).map((k) => {
        const id = ctx.mapa.get(chave('agent', k))
        if (!id) throw new Error(`o agente ${k} do setor ${sector.name} não foi criado`)
        const membro = (sector.memberAgentKeys ?? []).indexOf(k) === 0
        return {
          agentId: new ObjectId(id),
          sector: '',
          routingDescription: bp.agents?.find((a) => a.key === k)?.routingDescription ?? '',
          advanceWhen: '',
          transitions: [],
          isDefault: membro,
        }
      })
      const coordenador = sector.coordinatorAgentKey ? ctx.mapa.get(chave('agent', sector.coordinatorAgentKey)) : null
      const criado = await createSector(ctx.ownerId, new ObjectId(floorId), sector.name, sector.color ?? '#6366f1', sector.mode, membros, {
        architect: marcaDe(ctx, sector.key),
        ...(coordenador ? { coordinatorAgentId: new ObjectId(coordenador) } : {}),
        ...(sector.instruction ? { instruction: sector.instruction } : {}),
        ...(sector.inputContract ? { inputContract: sector.inputContract } : {}),
        ...(sector.outputContract ? { outputContract: sector.outputContract } : {}),
        ...(sector.stages?.length
          ? {
              stages: sector.stages.map((s) => ({
                id: s.key,
                name: s.key,
                agentId: new ObjectId(ctx.mapa.get(chave('agent', s.agentKey))!),
                instruction: s.instruction ?? '',
                dependsOn: s.dependsOn ?? [],
                inputMapping: {},
                expectedOutput: s.outputContract ?? '',
                retryPolicy: { maxAttempts: 1, backoffMs: 0 },
                onError: 'stop' as const,
              })),
            }
          : {}),
      })
      return { id: criado._id.toString(), status: 'created' }
    })
  }

  // 4. Vínculos: coordenador do andar e políticas de delegação, agora que todo mundo
  //    tem id. É um passo separado porque ele depende de recursos criados depois.
  await passo(ctx, 'wiring', 'delegacao', async () => {
    for (const floor of bp.floors ?? []) {
      if (floor.action !== 'create' || floor.workMode !== 'coordinated' || !floor.coordinatorAgentKey) continue
      const floorId = ctx.mapa.get(chave('floor', floor.key))
      const coordenador = ctx.mapa.get(chave('agent', floor.coordinatorAgentKey))
      if (!floorId || !coordenador) continue
      await updateFloor(ctx.ownerId, new ObjectId(floorId), { workMode: 'coordinated', coordinatorAgentId: coordenador })
    }
    for (const agent of bp.agents ?? []) {
      if (agent.action !== 'create') continue
      const id = ctx.mapa.get(chave('agent', agent.key))
      if (!id) continue
      const chamaveis = (agent.callableAgentKeys ?? []).map((k) => ctx.mapa.get(chave('agent', k))).filter(Boolean) as string[]
      const chamadores = (agent.allowedCallerAgentKeys ?? []).map((k) => ctx.mapa.get(chave('agent', k))).filter(Boolean) as string[]
      if (!chamaveis.length && !chamadores.length) continue
      await updateAgent(ctx.ownerId, new ObjectId(id), {
        ...(chamaveis.length ? { callableAgentIds: chamaveis } : {}),
        ...(chamadores.length ? { allowedCallerAgentIds: chamadores } : {}),
      })
    }
    return { id: 'ok', status: 'created' }
  })

  // 4b. O prédio. Ele não está em lista nenhuma do blueprint, e antes era ignorado em
  //     silêncio: a proposta pedia renomear o prédio e nada acontecia, sem aviso.
  if (bp.buildingPatch && (bp.buildingPatch.name?.trim() || bp.buildingPatch.description !== undefined)) {
    if (!aprovado(ctx, BUILDING_UPDATE_KEY)) {
      await registrar(ctx, { kind: 'wiring', key: BUILDING_UPDATE_KEY, status: 'skipped', message: 'a mudança no prédio não foi aprovada nesta aplicação' })
    } else {
      await passo(ctx, 'wiring', BUILDING_UPDATE_KEY, async () => {
        const { updateBuilding } = await import('../building.js')
        const b = await updateBuilding(ctx.ownerId, {
          ...(bp.buildingPatch?.name?.trim() ? { name: bp.buildingPatch.name } : {}),
          ...(bp.buildingPatch?.description !== undefined ? { description: bp.buildingPatch.description } : {}),
        })
        return { id: b._id.toString(), status: 'updated' }
      })
    }
  }

  // 5. Conhecimento — SOMENTE com conteúdo que a pessoa forneceu.
  for (const req of bp.knowledgeRequirements ?? []) {
    const conteudo = req.content?.trim()
    if (!conteudo) {
      // Sem cardápio, o agente não recebe cardápio: fica a pendência, e ela já está
      // na checklist. Registrar o pulo deixa isso visível em vez de silencioso.
      await registrar(ctx, { kind: 'knowledge', key: req.key, status: 'skipped', message: 'sem conteúdo: continua pendente' })
      continue
    }
    await passo(ctx, 'knowledge', req.key, async () => {
      // Cada escopo grava no lugar canônico DELE. Um alvo que não está no mapa faz a
      // etapa falhar — antes, virava um documento sob um ObjectId novo, que não era de
      // agente nenhum e não aparecia em tela nenhuma.
      const r = await writeArchitectKnowledge(ctx.ownerId, req, conteudo, { resolve: (kind, key) => ctx.mapa.get(chave(kind as ApplyStepKind, key)) })
      // Os quatro escopos gravam na base canônica: mesma indexação, mesma busca.
      return { id: r.id, status: 'created', message: undefined }
    })
  }

  // 6. Rotinas — sempre rascunho. `createAutomation` já nasce com status `draft`, e
  //    nada aqui publica: quem publica é o dono, na página do agente.
  for (const routine of bp.routines ?? []) {
    await passo(ctx, 'routine', routine.key, async () => {
      if (routine.action === 'reuse') return { id: String(routine.resourceId), status: 'reused' }
      if (routine.action === 'update') {
        const id = String(routine.resourceId)
        if (!aprovado(ctx, routine.key)) return { id, status: 'skipped', message: 'alteração não aprovada nesta aplicação' }
        // `updateDraft` já confere a posse e recusa mexer no que foi publicado — a
        // rotina é do dono e continua sendo editada pelas regras dela.
        const { updateDraft } = await import('../automations/service.js')
        const r = await updateDraft(ctx.ownerId, new ObjectId(id), {
          ...(routine.name?.trim() ? { name: routine.name } : {}),
          ...(routine.description !== undefined ? { description: routine.description } : {}),
        })
        if (!r) throw new Error(`a rotina "${routine.name}" não existe mais nesta conta`)
        return { id, status: 'updated' }
      }
      const floorId = ctx.mapa.get(chave('floor', routine.floorKey))
      const agentId = ctx.mapa.get(chave('agent', routine.ownerAgentKey))
      if (!floorId || !agentId) throw new Error(`a rotina ${routine.name} depende de recurso que não foi criado`)
      const criada = await createAutomation(ctx.ownerId, {
        floorId,
        architect: marcaDe(ctx, routine.key),
        name: routine.name,
        description: routine.description ?? '',
        agentId: new ObjectId(agentId),
        definition: {
          trigger:
            routine.triggerType === 'schedule'
              ? { type: 'schedule', cron: routine.cron ?? '0 9 * * *', timezone: routine.timezone ?? 'America/Sao_Paulo' }
              : { type: 'manual' },
          inputs: [],
          // `key` vira id AQUI, com o id real do que acabou de ser criado.
          steps: translateSteps(routine.steps ?? [], (kind, key) => ctx.mapa.get(chave(kind as ApplyStepKind, key)), (await (await import('../building.js')).ensureDefaultBuilding(ctx.ownerId))._id.toString()) as never,
          resultFormat: 'markdown',
          deliveries: [],
          limits: { ...DEFAULT_LIMITS },
        },
      })
      return { id: criada._id.toString(), status: 'created' }
    })
  }

  // 7. Permissões de App. Duas condições, e as duas obrigatórias: instalação ATIVA e
  //    aprovação explícita nesta aplicação. Sem as duas, vira pendência na checklist —
  //    nunca um grant apontando para uma conexão que não existe.
  const posse = await loadOwnershipContext(ctx.ownerId)
  const { listInstallations } = await import('../apps/installations.js')
  const instalacoes = await listInstallations(ctx.ownerId)
  for (const req of bp.appRequirements ?? []) {
    const instalacao = instalacoes.find((i) => i.appKey === req.appKey && i.status !== 'revoked')
    if (!posse.installedAppKeys.has(req.appKey) || !instalacao) {
      await registrar(ctx, { kind: 'grant', key: req.key, status: 'skipped', message: `${req.appKey} não está conectado: fica na checklist` })
      continue
    }
    if (!ctx.grantsAprovados.has(req.appKey)) {
      await registrar(ctx, { kind: 'grant', key: req.key, status: 'skipped', message: `${req.appKey} não foi aprovado nesta aplicação` })
      continue
    }
    await passo(ctx, 'grant', req.key, async () => {
      for (const agentKey of req.agentKeys ?? []) {
        const id = ctx.mapa.get(chave('agent', agentKey))
        if (!id) continue
        const { getAgentById } = await import('../agents.js')
        const agente = await getAgentById(ctx.ownerId, new ObjectId(id))
        if (!agente) continue
        // ACRESCENTA. Um grant que já existisse não é substituído nem removido.
        const jaTem = (agente.appGrants ?? []).some((g) => g.appKey === req.appKey)
        if (jaTem) continue
        await updateAgent(ctx.ownerId, new ObjectId(id), {
          appGrants: [
            ...(agente.appGrants ?? []),
            { installationId: instalacao._id.toString(), appKey: req.appKey, actionKeys: req.actionKeys ?? [], resourceConfig: {}, autonomousWriteActionKeys: [] },
          ],
        })
      }
      return { id: instalacao._id.toString(), status: 'created' }
    })
  }
}

/** Só o que o domínio de agentes aceita, campo a campo. */
function camposDoAgente(agent: BlueprintAgent, extra: { name?: string } = {}): Parameters<typeof createAgent>[3] & { name?: string } {
  return {
    ...(extra.name?.trim() ? { name: extra.name } : {}),
    objective: agent.objective ?? '',
    ...(agent.role ? { role: agent.role } : {}),
    ...(agent.instructions ? { instructions: agent.instructions } : {}),
    ...(agent.constraints ? { constraints: agent.constraints } : {}),
    ...(agent.preset ? { preset: agent.preset as never } : {}),
    ...(agent.capabilities?.length ? { capabilities: agent.capabilities } : {}),
    ...(agent.provider ? { provider: agent.provider } : {}),
    ...(agent.model !== undefined ? { model: agent.model } : {}),
    ...(agent.language ? { language: agent.language } : {}),
    ...(agent.memoryType ? { memoryType: agent.memoryType } : {}),
    ...(agent.inputContract ? { inputContract: agent.inputContract } : {}),
    ...(agent.outputContract ? { outputContract: agent.outputContract } : {}),
    ...(agent.executorKind ? { executorKind: agent.executorKind } : {}),
    ...(agent.responseMode ? { responseMode: agent.responseMode } : {}),
    ...(agent.inputJsonSchema !== undefined ? { inputJsonSchema: agent.inputJsonSchema } : {}),
    ...(agent.outputJsonSchema !== undefined ? { outputJsonSchema: agent.outputJsonSchema } : {}),
    ...(agent.requireGrounding !== undefined ? { requireGrounding: agent.requireGrounding } : {}),
    ...(agent.handoffEnabled !== undefined ? { handoffEnabled: agent.handoffEnabled } : {}),
    ...(agent.delegationPolicy ? { delegationPolicy: agent.delegationPolicy } : {}),
    ...(agent.callerPolicy ? { callerPolicy: agent.callerPolicy } : {}),
    ...(agent.activationModes?.length ? { activationModes: agent.activationModes as never } : {}),
  }
}

/**
 * Retoma uma aplicação que parou no meio.
 *
 * Continua a MESMA operação: o `resourceMap` dela é o ponto de partida, então cada
 * passo já concluído é pulado e nada é criado duas vezes. Uma retomada não pede nova
 * confirmação, mas confere o hash — se a proposta mudou depois da falha, retomar
 * escreveria metade de uma coisa e metade de outra.
 */
export async function resumeApply(ownerId: string, project: ArchitectProject, hooks: ApplyHooks = {}): Promise<ArchitectApplyOperation> {
  const anterior = await repo.lastOperation(ownerId, project._id)
  if (!anterior) throw new ApplyConflict('não há aplicação para retomar')
  if (anterior.status === 'completed') return anterior
  if (!project.blueprint) throw new ApplyConflict('a proposta não existe mais')
  if (computeBlueprintHash(project.blueprint) !== anterior.blueprintHash) {
    throw new ApplyConflict('a proposta mudou depois da falha; revise e aplique de novo')
  }

  // O LOCK que segura duas retomadas simultâneas. O estado do projeto não basta: um
  // projeto travado em `applying` aceita retomar, e duas abas passariam as duas por lá.
  if (!(await repo.claimOperation(ownerId, anterior._id))) {
    throw new ApplyConflict('esta aplicação já está sendo retomada')
  }

  // O que já virou permissão está no mapa; o resto foi pulado e continua pulado até o
  // dono aprovar de novo — retomar não é lugar de conceder acesso novo.
  return rodar(ownerId, anterior, project.blueprint, hooks, new Set(), new Set())
}

/**
 * Desfaz o que ESTA operação criou — e só isso.
 *
 * Três regras, e cada uma existe por um jeito diferente de destruir dado alheio:
 * remove apenas o que tem `status: 'created'` nesta operação (nunca o reutilizado),
 * apenas o que ainda existe, e apenas o que não foi tocado depois — um agente que a
 * pessoa editou desde então virou trabalho dela, não sobra da aplicação.
 *
 * O que não é seguro remover fica de pé e vira aviso. Um rollback que apaga o que não
 * devia é pior do que um rollback que não completa.
 */
export async function rollbackOperation(
  ownerId: string,
  operationId: ObjectId,
  blueprint: OfficeBlueprintV1 | null,
): Promise<{ removed: string[]; kept: { key: string; reason: string }[] }> {
  const operacao = await repo.getOperation(ownerId, operationId)
  if (!operacao) throw new ApplyConflict('operação não encontrada')
  if (operacao.status === 'rolled_back') return { removed: [], kept: [] }

  const { deleteAgent } = await import('../agents.js')
  const { deleteSector } = await import('../sectors.js')
  const { deleteFloor } = await import('../floors.js')
  const { deleteAllForAgent, deleteAllForSector } = await import('../knowledge.js')
  const { deleteAutomationCascade } = await import('../automations/repository.js')
  const { db } = await import('../db.js')

  const removed: string[] = []
  const kept: { key: string; reason: string }[] = []

  // Ordem inversa da criação: setor antes de agente, agente antes de andar.
  const ordem: ApplyStepKind[] = ['grant', 'routine', 'knowledge', 'wiring', 'sector', 'agent', 'floor']
  for (const kind of ordem) {
    for (const step of operacao.steps.filter((s) => s.kind === kind && s.status === 'created' && s.resourceId)) {
      const id = step.resourceId!
      if (kind === 'wiring' || kind === 'grant') {
        // Vínculo e permissão são ALTERAÇÕES em recurso que pode ser preexistente.
        // Desfazê-las às cegas apagaria configuração que não era desta operação.
        kept.push({ key: step.key, reason: 'alteração em recurso existente: revise à mão' })
        continue
      }

      if (kind === 'knowledge') {
        // Escopo manda: documento sai por `deleteDocumentFor`, que leva os chunks
        // junto; memória sai por `deleteMemory`. Um `deleteOne` na coleção de
        // documentos deixaria os pedaços indexados órfãos, aparecendo na busca de um
        // documento que não existe mais.
        const escopo = (blueprint?.knowledgeRequirements ?? []).find((r) => r.key === step.key)?.scope
        if (!escopo) {
          kept.push({ key: step.key, reason: 'não dá para saber onde ele foi gravado' })
          continue
        }
        if (await deleteArchitectKnowledge(ownerId, escopo, id)) removed.push(`${kind}:${step.key}`)
        continue
      }

      if (!ObjectId.isValid(id)) continue
      const oid = new ObjectId(id)
      const colecao = kind === 'agent' ? 'agents' : kind === 'sector' ? 'sectors' : kind === 'floor' ? 'offices' : 'automations'
      const doc = await db.collection(colecao).findOne({ _id: oid, ownerId })
      if (!doc) continue // já não existe: nada a desfazer

      // Editado depois de criado é trabalho de quem editou, não sobra da aplicação.
      const tocadoDepois = doc.updatedAt instanceof Date && doc.updatedAt.getTime() > step.at.getTime() + 1000
      if (tocadoDepois) {
        kept.push({ key: step.key, reason: 'foi editado depois de criado' })
        continue
      }
      // O marcador é a prova de origem: sem ele, o recurso não foi criado por esta
      // operação, e não é dela para remover.
      const marca = (doc as { architect?: { operationId?: string } }).architect
      if (marca?.operationId && marca.operationId !== operationId.toString()) {
        kept.push({ key: step.key, reason: 'foi criado por outra aplicação' })
        continue
      }

      if (kind === 'agent') {
        // O caminho canônico do produto: a base do agente sai junto. Só `deleteAgent`
        // deixaria documento e chunk apontando para um agente que não existe mais.
        await deleteAllForAgent(oid)
        await deleteAgent(ownerId, oid)
      } else if (kind === 'sector') {
        await deleteAllForSector(oid)
        await deleteSector(ownerId, oid)
      } else if (kind === 'routine') {
        await deleteAutomationCascade(ownerId, oid)
      } else {
        // O domínio recusa remover o último andar do prédio, e essa recusa vale aqui
        // como vale em qualquer outro lugar: o desfazer não é um caminho privilegiado
        // para deixar a conta num estado que a interface nunca permitiria.
        const r = await deleteFloor(ownerId, oid)
        if (!r || r.ok !== true) {
          kept.push({ key: step.key, reason: r?.code === 'LAST_FLOOR' ? 'é o único andar do prédio' : 'o andar não pôde ser removido' })
          continue
        }
      }
      removed.push(`${kind}:${step.key}`)
    }
  }

  await repo.finishOperation(ownerId, operationId, 'rolled_back', null)
  return { removed, kept }
}
