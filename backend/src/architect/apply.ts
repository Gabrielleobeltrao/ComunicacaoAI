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
import type { OfficeBlueprintV2 } from './typesV2.js'
import { V2_ITEM_PATHS, itemsAt } from './typesV2.js'
import { applyV2Resources } from './applyV2.js'
import type { ApplyV2Step } from './applyV2.js'

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
  /** O plano V2, quando o projeto tem um. Ausente = a aplicação é a do V1, inteira. */
  v2?: OfficeBlueprintV2 | null
  /**
   * As `key`s que o dono autorizou a ENTRAR NO AR nesta aplicação.
   *
   * Ativar é diferente de criar: um recurso criado fica parado até alguém olhar. Sem esta
   * lista, aplicar uma proposta colocaria a operação para rodar sozinha no mesmo instante.
   */
  ativacoesAprovadas: Set<string>
  /** A conexão escolhida para cada entrega. O endereço nunca vem do plano. */
  conexoesDeEntrega: Map<string, string>
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
  input: { blueprintHash: string; idempotencyKey: string; approvedAppKeys?: string[]; approvedUpdateKeys?: string[]; approvedActivationKeys?: string[]; deliveryConnections?: { key: string; connectionId: string }[] },
  hooks: ApplyHooks = {},
): Promise<ArchitectApplyOperation> {
  const bp = project.blueprint
  if (!bp) throw new ApplyConflict('ainda não existe proposta para aplicar')

  const hashAtual = computeBlueprintHash(bp, project.blueprintV2)
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

  return rodar(ownerId, operation, bp, hooks, new Set(input.approvedAppKeys ?? []), new Set(input.approvedUpdateKeys ?? []), project.blueprintV2 ?? null, new Set(input.approvedActivationKeys ?? []), new Map((input.deliveryConnections ?? []).map((d) => [String(d.key), String(d.connectionId)])))
}

/** O corpo compartilhado por aplicar e retomar: roda a saga, fecha e solta o arrendamento. */
async function rodar(
  ownerId: string,
  operation: ArchitectApplyOperation,
  bp: OfficeBlueprintV1,
  hooks: ApplyHooks,
  grantsAprovados: Set<string>,
  updatesAprovados: Set<string>,
  v2: OfficeBlueprintV2 | null,
  ativacoesAprovadas: Set<string>,
  conexoesDeEntrega: Map<string, string>,
): Promise<ArchitectApplyOperation> {
  const ctx: Contexto = {
    ownerId,
    operation,
    bp,
    mapa: new Map(Object.entries(operation.resourceMap ?? {})),
    hooks,
    grantsAprovados,
    updatesAprovados,
    v2,
    ativacoesAprovadas,
    conexoesDeEntrega,
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

        /**
         * A TOPOLOGIA também é atualizada — membros, coordenador, modo, etapas e andar.
         *
         * Antes, `update` só trocava nome, cor, instrução e contratos: uma revisão que
         * acrescentava um agente ao setor era aprovada, aplicada e não acontecia. Quem
         * olhava a proposta via o agente novo na equipe; quem abria o setor não via.
         *
         * O membro é resolvido pela `key` no mapa da operação, como em `create`. Uma key
         * que não virou recurso é erro, e não uma equipe silenciosamente menor.
         */
        if (sector.memberAgentKeys) {
          patch.members = sector.memberAgentKeys.map((k, indice) => {
            const agenteId = ctx.mapa.get(chave('agent', k))
            if (!agenteId) throw new Error(`o agente ${k} do setor ${sector.name} não existe nesta operação`)
            return {
              agentId: new ObjectId(agenteId),
              sector: '',
              routingDescription: bp.agents?.find((a) => a.key === k)?.routingDescription ?? '',
              advanceWhen: '',
              transitions: [],
              isDefault: indice === 0,
            }
          })
        }
        if (sector.mode) patch.mode = sector.mode
        if (sector.coordinatorAgentKey !== undefined) {
          const coordenador = sector.coordinatorAgentKey ? ctx.mapa.get(chave('agent', sector.coordinatorAgentKey)) : null
          if (sector.coordinatorAgentKey && !coordenador) {
            throw new Error(`o coordenador ${sector.coordinatorAgentKey} do setor ${sector.name} não existe nesta operação`)
          }
          patch.coordinatorAgentId = coordenador ? new ObjectId(coordenador) : null
        }
        if (sector.stages) {
          // A MESMA forma de `create`: uma etapa parcial aqui viraria um pipeline com
          // política de erro e saída esperada diferentes das que a criação produz.
          patch.stages = sector.stages.map((etapa, indice) => {
            const agenteId = ctx.mapa.get(chave('agent', etapa.agentKey))
            if (!agenteId) throw new Error(`o agente ${etapa.agentKey} da etapa ${indice + 1} não existe nesta operação`)
            return {
              id: etapa.key || `etapa-${indice + 1}`,
              name: etapa.key || `Etapa ${indice + 1}`,
              agentId: new ObjectId(agenteId),
              instruction: etapa.instruction ?? '',
              dependsOn: etapa.dependsOn ?? [],
              inputMapping: {},
              expectedOutput: etapa.outputContract ?? '',
              retryPolicy: { maxAttempts: 1, backoffMs: 0 },
              onError: 'stop' as const,
            }
          })
        }
        /**
         * MOVER de andar atualiza a referência — ou BLOQUEIA dizendo quem teria de ir junto.
         *
         * Duas coisas se juntam aqui. A primeira: um setor cujo `floorKey` mudou e cujo
         * `officeId` não muda fica apontando para o andar anterior — ele some da tela do
         * andar novo e continua aparecendo no antigo.
         *
         * A segunda: todo membro de um setor trabalha no andar dele, e mover um agente
         * entre andares não existe na API canônica de agentes. Então mover o setor sem
         * mover a equipe produziria um setor inválido. Em vez de fazer isso em silêncio, a
         * aplicação para e diz exatamente quem precisaria mudar de andar antes.
         */
        const andarNovo = ctx.mapa.get(chave('floor', sector.floorKey))
        if (andarNovo) {
          const atual = await (await import('../sectors.js')).getSectorById(ctx.ownerId, new ObjectId(id))
          if (atual && atual.officeId?.toString() !== andarNovo) {
            const { listAgents } = await import('../agents.js')
            const noAndarNovo = new Set((await listAgents(ctx.ownerId, new ObjectId(andarNovo))).map((a) => a._id.toString()))
            const membros = (patch.members as { agentId: ObjectId }[] | undefined) ?? atual.members ?? []
            const forade = membros.map((m) => m.agentId.toString()).filter((a) => !noAndarNovo.has(a))
            if (forade.length) {
              const nomes = (await listAgents(ctx.ownerId))
                .filter((a) => forade.includes(a._id.toString()))
                .map((a) => a.name)
              throw new Error(
                `mover "${sector.name}" de andar exige mover antes ${nomes.length} agente(s): ${nomes.join(', ')}. Um setor cujos membros ficam em outro andar não é válido.`,
              )
            }
          }
          patch.officeId = new ObjectId(andarNovo)
        }

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

  // 8. Recursos e operações do V2 — Databases, datasets, fontes, destinos, monitores e
  //    Flows. É a MESMA saga: os passos entram na mesma lista, escrevem no mesmo
  //    `resourceMap` e são retomados pelo mesmo caminho. Um projeto sem plano V2 nem
  //    chega aqui, e continua aplicando exatamente o que aplicava antes.
  await aplicarV2(ctx)

  // 9. Os testes de aceitação, e só então a ativação. A ordem não é negociável: ativar
  //    antes de testar é exatamente o que "pronto = o documento existe" fazia.
  await provarEAtivar(ctx)
}

/**
 * Prova a operação e liga o que passou.
 *
 * "Pronto" exige teste observável. Um recurso sem teste declarado NÃO é ativado: ausência de
 * teste não é prova de nada, e ligar por falta de evidência contrária é o defeito que os
 * testes de aceitação existem para fechar.
 */
async function provarEAtivar(ctx: Contexto): Promise<void> {
  if (!ctx.v2) return
  const { runAcceptanceTests, activatableKeys } = await import('./acceptance.js')
  const resultados = await runAcceptanceTests({
    ownerId: ctx.ownerId,
    blueprint: ctx.v2,
    resourceMap: ctx.mapa,
    operationId: ctx.operation._id,
  })
  await repo.recordAcceptance(ctx.ownerId, ctx.operation._id, resultados)
  if (!resultados.length) return

  /**
   * As DUAS condições, e as duas obrigatórias: o teste passou E o dono autorizou.
   *
   * Devolve o id quando pode ligar; `null` quando não — registrando o motivo, para a
   * pessoa saber por que o recurso ficou parado.
   */
  const autorizado = async (kind: ApplyStepKind, key: string): Promise<string | null> => {
    if (!ctx.ativacoesAprovadas.has(key)) {
      await registrar(ctx, { kind, key, status: 'skipped', message: 'passou no teste, mas entrar no ar não foi autorizado nesta aplicação' })
      return null
    }
    const id = ctx.mapa.get(chave(kind, key))
    return id && ObjectId.isValid(id) ? id : null
  }

  const { setSourceStatus } = await import('../monitoring/service.js')
  for (const key of activatableKeys(resultados, 'source')) {
    const id = await autorizado('source', key)
    if (!id) continue
    // O portão de ativação do próprio domínio continua valendo: ele exige uma leitura
    // bem-sucedida, e é ela que o teste de aceitação acabou de produzir.
    const fonte = await setSourceStatus(ctx.ownerId, new ObjectId(id), 'active')
    await registrar(ctx, {
      kind: 'source',
      key,
      status: fonte?.status === 'active' ? 'updated' : 'skipped',
      resourceId: id,
      message: fonte?.status === 'active' ? 'no ar: passou no teste e foi autorizada' : 'o portão de ativação do domínio ainda não deixou',
    })
  }

  /**
   * O FLOW vem antes do monitor, e não é uma preferência de ordem.
   *
   * `publishMonitor` recusa um monitor cujo Flow não está publicado — e está certo: um
   * monitor que reconhece a transição e aciona um Flow que não existe em versão nenhuma é
   * um alarme que toca no vazio. Publicar é o que congela a definição que vai rodar.
   */
  const { publishAutomation, setStatus } = await import('../automations/service.js')
  for (const key of activatableKeys(resultados, 'flow')) {
    const id = await autorizado('flow', key)
    if (!id) continue
    try {
      await publishAutomation(ctx.ownerId, new ObjectId(id), ctx.ownerId)
      const flow = await setStatus(ctx.ownerId, new ObjectId(id), 'active')
      await registrar(ctx, {
        kind: 'flow',
        key,
        status: flow?.status === 'active' ? 'updated' : 'skipped',
        resourceId: id,
        message: flow?.status === 'active' ? 'publicado e no ar: passou no teste e foi autorizado' : 'o portão do domínio ainda não deixou',
      })
    } catch (erro) {
      // Uma recusa do domínio é DITA, e não derruba o resto: o escritório já está montado.
      await registrar(ctx, { kind: 'flow', key, status: 'skipped', resourceId: id, message: String((erro as Error).message).slice(0, 200) })
    }
  }

  /**
   * A SEGUNDA PASSADA — o que a ativação da fonte acabou de destravar.
   *
   * O histórico e o dataset só existem depois que a fonte entra no ar: até lá, o monitor que
   * os observa é uma pendência honesta. Ativar sem voltar para criá-lo deixaria a cadeia pela
   * metade, com um Flow que ninguém aciona.
   *
   * É a MESMA engine, com o mesmo mapa: o que já foi criado volta como `reused`, e só o que
   * estava esperando é criado agora. Uma segunda função aqui seria a segunda engine que este
   * trabalho inteiro existe para não ter.
   */
  if (resultados.some((r) => r.kind === 'source' && r.status === 'passed')) {
    let criouAlgo = false
    for (const p of await aplicarV2(ctx, false)) {
      if (p.status === 'created') {
        criouAlgo = true
        await registrar(ctx, { kind: p.kind, key: p.key, status: 'created', resourceId: p.resourceId ?? null, ...(p.message ? { message: p.message } : {}) })
      }
    }
    /**
     * O que nasceu na segunda passada precisa ser PROVADO antes de entrar no ar.
     *
     * A rodada de provas anterior viu o monitor como "não criado nesta aplicação" — e um
     * teste `skipped` não torna nada ativável. Sem reprovar aqui, o monitor recém-criado
     * ficaria rascunho para sempre, com o Flow ativo e ninguém para acioná-lo.
     */
    if (criouAlgo) {
      const segunda = await runAcceptanceTests({ ownerId: ctx.ownerId, blueprint: ctx.v2, resourceMap: ctx.mapa, operationId: ctx.operation._id })
      // O melhor resultado de cada teste vale: o que era `skipped` por ausência agora tem
      // veredito, e o que já passara não é rebaixado por uma segunda leitura.
      for (const nova of segunda) {
        const i = resultados.findIndex((r) => r.key === nova.key)
        if (i < 0) resultados.push(nova)
        else if (resultados[i].status !== 'passed') resultados[i] = nova
      }
      await repo.recordAcceptance(ctx.ownerId, ctx.operation._id, resultados)
    }
  }

  const { setMonitorStatus } = await import('../monitors/service.js')
  for (const key of activatableKeys(resultados, 'monitor')) {
    const id = await autorizado('monitor', key)
    if (!id) continue
    try {
      const m = await setMonitorStatus(ctx.ownerId, new ObjectId(id), 'published')
      await registrar(ctx, {
        kind: 'monitor',
        key,
        status: m?.status === 'published' ? 'updated' : 'skipped',
        resourceId: id,
        message: m?.status === 'published' ? 'publicado: a simulação passou e foi autorizado' : 'o portão do domínio ainda não deixou',
      })
    } catch (erro) {
      await registrar(ctx, { kind: 'monitor', key, status: 'skipped', resourceId: id, message: String((erro as Error).message).slice(0, 200) })
    }
  }
}

/**
 * O bloco V2 dentro da saga do V1.
 *
 * A ordem importa: os andares e agentes já existem no `mapa` quando esta função roda, e é
 * de lá que saem os ids — nunca do plano. Uma falha aqui derruba a operação inteira, que é
 * o que faz o desfazer e a retomada continuarem valendo para o que o V2 criou.
 */
async function aplicarV2(ctx: Contexto, registrarPassos = true): Promise<ApplyV2Step[]> {
  const bp = ctx.v2
  if (!bp) return []

  /**
   * O que está aprovado: criar e reusar vêm da aprovação da proposta inteira; ALTERAR um
   * recurso que já existe exige a aprovação individual, a mesma do V1. Sem esta distinção,
   * clicar em aplicar reescreveria recurso que a pessoa não marcou.
   */
  const aprovadas = new Set<string>()
  for (const path of V2_ITEM_PATHS) {
    for (const item of itemsAt(bp, path)) {
      const key = String((item as { key?: unknown }).key ?? '')
      if (!key) continue
      const acao = String((item as { action?: unknown }).action ?? 'create')
      if (acao === 'create' || acao === 'reuse' || ctx.updatesAprovados.has(key)) aprovadas.add(key)
    }
  }

  const passos = await applyV2Resources({
    ownerId: ctx.ownerId,
    blueprint: bp,
    resourceMap: ctx.mapa,
    approvedKeys: aprovadas,
    deliveryConnections: ctx.conexoesDeEntrega,
    // A MARCA da operação: é ela que faz a retomada reconhecer o que ficou de pé numa queda
    // entre criar o recurso e registrar o passo.
    operationId: ctx.operation._id.toString(),
    projectId: ctx.operation.projectId.toString(),
    ...(ctx.hooks.afterCreate ? { afterCreate: ctx.hooks.afterCreate as never } : {}),
  })
  if (registrarPassos) {
    for (const p of passos) {
      await registrar(ctx, { kind: p.kind, key: p.key, status: p.status, resourceId: p.resourceId ?? null, ...(p.message ? { message: p.message } : {}) })
    }
  }

  // Uma falha registrada e engolida seria pior que nenhuma: a operação apareceria
  // "concluída" com um monitor que nunca foi criado.
  const falhou = passos.find((p) => p.status === 'failed')
  if (falhou) throw new Error(`${falhou.kind} "${falhou.key}": ${falhou.message ?? 'falhou'}`)
  return passos
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
  if (computeBlueprintHash(project.blueprint, project.blueprintV2) !== anterior.blueprintHash) {
    throw new ApplyConflict('a proposta mudou depois da falha; revise e aplique de novo')
  }

  // O LOCK que segura duas retomadas simultâneas. O estado do projeto não basta: um
  // projeto travado em `applying` aceita retomar, e duas abas passariam as duas por lá.
  if (!(await repo.claimOperation(ownerId, anterior._id))) {
    throw new ApplyConflict('esta aplicação já está sendo retomada')
  }

  // O que já virou permissão está no mapa; o resto foi pulado e continua pulado até o
  // dono aprovar de novo — retomar não é lugar de conceder acesso novo.
  return rodar(ownerId, anterior, project.blueprint, hooks, new Set(), new Set(), project.blueprintV2 ?? null, new Set(), new Map())
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
/**
 * Desfaz UM recurso do V2 — pelo serviço canônico, e só se ele ainda for desta operação.
 *
 * As três regras do desfazer valem aqui inteiras: nada que já não exista, nada que tenha
 * sido editado depois de criado, e nada que tenha vindo de outra aplicação. Sem elas, um
 * "desfazer" apagaria o Database que alguém passou a semana enchendo.
 */
async function desfazerV2(
  ownerId: string,
  kind: ApplyStepKind,
  id: string,
  criadoEm: Date,
  operationId: ObjectId,
  kept: { key: string; reason: string }[],
  key: string,
): Promise<boolean> {
  const { db } = await import('../db.js')

  if (kind === 'dataset') {
    // O id de um dataset é `storeId:key` — ele não é um documento com _id próprio no mapa.
    const [storeId, datasetKey] = id.split(':')
    if (!storeId || !datasetKey || !ObjectId.isValid(storeId)) return false
    const { deleteDataset } = await import('../databases/store.js')
    return deleteDataset(ownerId, new ObjectId(storeId), datasetKey)
  }

  if (!ObjectId.isValid(id)) return false
  const oid = new ObjectId(id)
  const colecao = kind === 'database' ? 'data_stores' : kind === 'source' ? 'monitoring_sources' : kind === 'monitor' ? 'monitors' : 'automations'
  const doc = await db.collection(colecao).findOne({ _id: oid, ownerId })
  if (!doc) return false

  if (doc.updatedAt instanceof Date && doc.updatedAt.getTime() > criadoEm.getTime() + 1000) {
    kept.push({ key, reason: 'foi editado depois de criado' })
    return false
  }
  const marca = (doc as { architect?: { operationId?: string } }).architect
  if (marca?.operationId && marca.operationId !== operationId.toString()) {
    kept.push({ key, reason: 'foi criado por outra aplicação' })
    return false
  }

  if (kind === 'database') {
    const { deleteDataStore } = await import('../databases/store.js')
    return deleteDataStore(ownerId, oid)
  }
  if (kind === 'source') {
    // `deleteSource` leva junto o alias em tempo real e o valor ao vivo, e DEIXA o histórico:
    // o que a fonte gravou é fato acontecido, e apagar o passado é outra decisão.
    const { deleteSource } = await import('../monitoring/service.js')
    return deleteSource(ownerId, oid)
  }
  if (kind === 'monitor') {
    const { deleteMonitor } = await import('../monitors/service.js')
    return deleteMonitor(ownerId, oid)
  }
  const { deleteAutomationCascade } = await import('../automations/repository.js')
  await deleteAutomationCascade(ownerId, oid)
  return true
}

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

  // Ordem inversa da criação: o V2 sai primeiro (ele nasceu por último), monitor antes da
  // fonte, dataset antes do Database, setor antes de agente, agente antes de andar.
  const ordem: ApplyStepKind[] = [
    'monitor',
    'flow',
    'live',
    'history',
    'source',
    'dataset',
    'database',
    'grant',
    'routine',
    'knowledge',
    'wiring',
    'sector',
    'agent',
    'floor',
  ]
  for (const kind of ordem) {
    for (const step of operacao.steps.filter((s) => s.kind === kind && s.status === 'created' && s.resourceId)) {
      const id = step.resourceId!
      if (kind === 'live' || kind === 'history') {
        // Os dois são DESTINOS ligados numa fonte que pode ser preexistente. Desligá-los às
        // cegas apagaria o histórico que alguém já vinha alimentando.
        kept.push({ key: step.key, reason: 'destino ligado numa fonte existente: revise à mão' })
        continue
      }

      if (kind === 'database' || kind === 'dataset' || kind === 'source' || kind === 'monitor' || kind === 'flow') {
        if (await desfazerV2(ownerId, kind, id, step.at, operationId, kept, step.key)) removed.push(`${kind}:${step.key}`)
        continue
      }

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
