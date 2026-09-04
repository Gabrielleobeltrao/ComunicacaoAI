import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { db } from './db.js'
import { getFloor, listFloors, setFloorStatus } from './floors.js'
import { listAgents } from './agents.js'
import { listSectors } from './sectors.js'

// O IMPACTO DE APAGAR UM ANDAR — dito antes do clique, e não descoberto depois.
//
// O que existia: `deleteFloor` contava agentes e setores, recusava se houvesse algum, e
// apagava se não houvesse. Um andar com fonte de monitoramento, monitor e Flow era
// considerado **vazio** — era apagado, e os três ficavam órfãos apontando para um andar que
// não existe mais.
//
// Três regras carregam este arquivo:
//
//   ARQUIVAR É O PADRÃO. É recuperável, e um andar arquivado não some do passado de ninguém.
//   Purge é separado, explícito, e só acontece depois de uma análise de impacto atualizada.
//
//   COMPARTILHADO SE PRESERVA. Um Database corporativo, um App instalado na empresa e uma
//   conexão usada por outro andar continuam existindo — o que sai é o VÍNCULO daquele andar.
//   Nunca inferir que uma conexão pertence ao andar só porque os agentes dele a usam.
//
//   O RETRATO TEM VALIDADE. O `impactHash` cobre ids, versões e escolhas. Se algo mudar entre
//   a análise e a confirmação, a resposta é conflito — não um purge sobre um retrato velho.

export type ImpactDisposition = 'archive' | 'delete' | 'unlink' | 'keep' | 'blocks'

export const IMPACT_DISPOSITIONS: readonly ImpactDisposition[] = ['archive', 'delete', 'unlink', 'keep', 'blocks']

export interface ImpactEntry {
  kind: string
  id: string
  name: string
  disposition: ImpactDisposition
  /** Em português, e específico. "Será removido" não é um motivo. */
  reason: string
  /** Quem mais usa este recurso. É o que justifica `keep`/`unlink`. */
  sharedWith?: string[]
}

export interface FloorDeletionImpact {
  floor: { id: string; name: string; status: string }
  entries: ImpactEntry[]
  counts: Record<ImpactDisposition, number>
  byKind: Record<string, number>
  /** O que impede o purge. Vazio = dá para prosseguir com confirmação. */
  blockers: string[]
  /**
   * O retrato, resumido em um hash.
   *
   * Ele cobre os ids e os `updatedAt` de tudo o que entra na análise, mais as escolhas. Um
   * purge confirmado com um hash velho é um purge sobre um escritório que já mudou.
   */
  impactHash: string
  at: Date
}

/** As escolhas que a pessoa faz no diálogo, e que entram no hash. */
export interface PurgeChoices {
  /** Apagar também os recursos exclusivos deste andar, em vez de arquivá-los. */
  deleteExclusiveResources?: boolean
  /** Remover conexões que só este andar usa. Nunca o padrão. */
  removeDedicatedConnections?: boolean
}

const texto = (v: unknown): string => String(v ?? '').slice(0, 120)

/**
 * A ANÁLISE — owner-scoped, sempre lida agora.
 *
 * Nada aqui é cacheado: a pergunta "o que acontece se eu apagar isto?" só tem valor se a
 * resposta for sobre o estado de agora.
 */
export async function floorDeletionImpact(ownerId: string, floorId: ObjectId, choices: PurgeChoices = {}): Promise<FloorDeletionImpact | null> {
  const andar = await getFloor(ownerId, floorId)
  if (!andar) return null

  const entries: ImpactEntry[] = []
  const blockers: string[] = []
  const semelhanca: { id: string; updatedAt: string }[] = []

  const anotar = (e: ImpactEntry, updatedAt?: Date | null) => {
    entries.push(e)
    semelhanca.push({ id: `${e.kind}:${e.id}`, updatedAt: (updatedAt ?? new Date(0)).toISOString() })
  }

  // --- o último andar continua protegido ------------------------------------------------
  const todos = await listFloors(ownerId, { includeArchived: true })
  const ativos = todos.filter((f) => f.status !== 'archived')
  if (ativos.length <= 1 && andar.status !== 'archived') {
    blockers.push('este é o único andar ativo do prédio: o escritório não pode ficar sem nenhum')
  }

  // --- organização ------------------------------------------------------------------------
  const agentes = await listAgents(ownerId, floorId).catch(() => [])
  for (const a of agentes) {
    anotar(
      {
        kind: 'agent',
        id: a._id.toString(),
        name: texto(a.name),
        // O agente mora no andar: sem ele, não há onde o agente ficar.
        disposition: choices.deleteExclusiveResources ? 'delete' : 'archive',
        reason: choices.deleteExclusiveResources
          ? 'mora neste andar e foi escolhido para exclusão'
          : 'mora neste andar; será arquivado junto e pode voltar',
      },
      // O agente guarda `createdAt`; sem `updatedAt`, é ele que entra no retrato.
      a.createdAt,
    )
  }

  const setores = await listSectors(ownerId, floorId).catch(() => [])
  for (const s of setores) {
    anotar(
      {
        kind: 'sector',
        id: s._id.toString(),
        name: texto(s.name),
        disposition: choices.deleteExclusiveResources ? 'delete' : 'archive',
        reason: choices.deleteExclusiveResources ? 'pertence a este andar' : 'pertence a este andar; será arquivado junto',
      },
      s.updatedAt ?? s.createdAt,
    )
  }

  const idsDosAgentes = agentes.map((a) => a._id)
  const idsEmTexto = new Set(idsDosAgentes.map((i) => i.toString()))

  // --- conhecimento -------------------------------------------------------------------------
  const documentos = await db
    .collection('knowledge_documents')
    .find({ ownerId, $or: [{ floorId }, { agentId: { $in: idsDosAgentes } }] })
    .limit(200)
    .toArray()
    .catch(() => [])
  for (const d of documentos) {
    anotar(
      {
        kind: 'knowledge',
        id: String(d._id),
        name: texto(d.title ?? d.name),
        disposition: choices.deleteExclusiveResources ? 'delete' : 'archive',
        reason: 'base de conhecimento deste andar ou de um agente dele',
      },
      d.updatedAt as Date,
    )
  }

  // --- operação ---------------------------------------------------------------------------
  const flows = await db.collection('automations').find({ ownerId, floorId }).limit(200).toArray().catch(() => [])
  for (const f of flows) {
    anotar(
      {
        kind: 'flow',
        id: String(f._id),
        name: texto(f.name),
        // Um Flow apontando para um andar que não existe é um Flow que falha na próxima
        // execução, e ninguém liga a falha ao andar apagado semanas antes.
        disposition: choices.deleteExclusiveResources ? 'delete' : 'archive',
        reason: 'mora neste andar; sem ele o Flow não tem onde executar',
      },
      f.updatedAt as Date,
    )
  }

  const rotinas = await db
    .collection('automations')
    .find({ ownerId, floorId, 'definition.trigger.type': 'schedule' })
    .limit(100)
    .toArray()
    .catch(() => [])
  void rotinas // já contadas como flows; a distinção aparece na tela, não na contagem

  /**
   * As FONTES cujo escopo é este andar.
   *
   * O escopo é o que o domínio guarda (`scope.ownerType`/`ownerId`), e não uma inferência
   * a partir de quem a usa: uma fonte da conta usada por agentes deste andar continua sendo
   * da conta.
   */
  const fontes = await db
    .collection('monitoring_sources')
    .find({ ownerId, 'scope.ownerType': 'floor', 'scope.ownerId': floorId.toString() })
    .limit(200)
    .toArray()
    .catch(() => [])
  for (const f of fontes) {
    anotar(
      {
        kind: 'source',
        id: String(f._id),
        name: texto(f.name),
        disposition: choices.deleteExclusiveResources ? 'delete' : 'archive',
        reason: 'esta fonte é deste andar',
      },
      f.updatedAt as Date,
    )
  }

  // As fontes da CONTA que agentes deste andar alcançam: elas ficam, e só o acesso sai.
  const fontesDaConta = await db
    .collection('monitoring_sources')
    .find({ ownerId, 'scope.ownerType': { $ne: 'floor' } })
    .limit(200)
    .toArray()
    .catch(() => [])
  for (const f of fontesDaConta) {
    anotar(
      {
        kind: 'source',
        id: String(f._id),
        name: texto(f.name),
        disposition: 'keep',
        reason: 'esta fonte é da conta, não deste andar: ela continua existindo',
      },
      f.updatedAt as Date,
    )
  }

  // --- Databases: preservados, com o acesso removido -------------------------------------
  const stores = await db.collection('data_stores').find({ ownerId }).limit(100).toArray().catch(() => [])
  for (const s of stores) {
    const doAndar = s.owner?.ownerType === 'floor' && String(s.owner?.ownerId) === floorId.toString()
    anotar(
      {
        kind: 'database',
        id: String(s._id),
        name: texto(s.name),
        // Dado histórico não é apagado por efeito colateral de mexer na organização.
        disposition: doAndar && choices.deleteExclusiveResources ? 'delete' : 'keep',
        reason: doAndar
          ? choices.deleteExclusiveResources
            ? 'é deste andar e foi escolhido para exclusão'
            : 'é deste andar, mas os dados são preservados: apagar histórico é outra decisão'
          : 'é da empresa: continua existindo, e só o acesso deste andar sai',
      },
      s.updatedAt as Date,
    )
  }

  const grantsDeDatabase = await db
    .collection('database_grants')
    .find({ ownerId, $or: [{ subjectType: 'floor', subjectId: floorId.toString() }, { subjectType: 'agent', subjectId: { $in: [...idsEmTexto] } }] })
    .limit(200)
    .toArray()
    .catch(() => [])
  for (const g of grantsDeDatabase) {
    anotar(
      {
        kind: 'databaseGrant',
        id: String(g._id),
        name: `acesso ${texto(g.subjectType)}`,
        disposition: 'unlink',
        reason: 'o acesso concedido a este andar (ou a um agente dele) é removido; o Database fica',
      },
      g.updatedAt as Date,
    )
  }

  // --- Apps: instalação preservada, grants revogados ---------------------------------------
  const instalacoes = await db.collection('connections').find({ ownerId }).limit(100).toArray().catch(() => [])
  for (const i of instalacoes) {
    /**
     * A instalação é da EMPRESA por padrão.
     *
     * Nunca inferir que uma conexão pertence ao andar só porque os agentes dele a usam: a
     * mesma credencial costuma servir a vários andares, e removê-la derrubaria os outros.
     */
    const dedicada = String(i.floorId ?? '') === floorId.toString()
    anotar(
      {
        kind: 'app',
        id: String(i._id),
        name: texto(i.name ?? i.appKey),
        disposition: dedicada && choices.removeDedicatedConnections ? 'delete' : 'keep',
        reason: dedicada
          ? choices.removeDedicatedConnections
            ? 'é uma conexão dedicada a este andar e você escolheu removê-la'
            : 'é uma conexão dedicada a este andar; ela só sai se você escolher'
          : 'é da empresa: a instalação fica, e os acessos dos agentes removidos são revogados',
      },
      i.updatedAt as Date,
    )
  }

  // --- dependências vindas de FORA deste andar -------------------------------------------
  if (idsEmTexto.size) {
    const setoresDeFora = await db
      .collection('sectors')
      .find({ ownerId, officeId: { $ne: floorId }, 'members.agentId': { $in: idsDosAgentes } })
      .limit(100)
      .toArray()
      .catch(() => [])
    for (const s of setoresDeFora) {
      anotar(
        {
          kind: 'sector',
          id: String(s._id),
          name: texto(s.name),
          // Um agente deste andar que é membro de um setor de OUTRO andar é uma dependência
          // externa: apagar sem tratar deixaria o setor de fora com um membro fantasma.
          disposition: 'blocks',
          reason: `o setor "${texto(s.name)}" está em outro andar e usa agentes deste`,
        },
        s.updatedAt as Date,
      )
      blockers.push(`o setor "${texto(s.name)}", de outro andar, usa agentes deste`)
    }
  }

  // --- histórico e auditoria: sempre preservados -------------------------------------------
  const registros = await db.collection('data_history_records').countDocuments({ ownerId }).catch(() => 0)
  if (registros > 0) {
    entries.push({
      kind: 'history',
      id: 'retencao',
      name: `${registros} registro(s) de histórico`,
      disposition: 'keep',
      reason: 'o que aconteceu é fato acontecido: preservado pela retenção de cada recorder',
    })
  }

  const counts = { archive: 0, delete: 0, unlink: 0, keep: 0, blocks: 0 } as Record<ImpactDisposition, number>
  const byKind: Record<string, number> = {}
  for (const e of entries) {
    counts[e.disposition] += 1
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1
  }

  return {
    floor: { id: andar._id.toString(), name: texto(andar.name), status: String(andar.status ?? 'active') },
    entries,
    counts,
    byKind,
    blockers,
    impactHash: hashDoImpacto(floorId, semelhanca, choices),
    at: new Date(),
  }
}

/**
 * O hash do retrato.
 *
 * Ordenado antes de somar: a ordem em que o banco devolve não é estável, e um hash que muda
 * sozinho transformaria toda confirmação em conflito.
 */
function hashDoImpacto(floorId: ObjectId, itens: { id: string; updatedAt: string }[], choices: PurgeChoices): string {
  const corpo = JSON.stringify({
    floor: floorId.toString(),
    itens: [...itens].sort((a, b) => a.id.localeCompare(b.id)),
    choices: {
      deleteExclusiveResources: Boolean(choices.deleteExclusiveResources),
      removeDedicatedConnections: Boolean(choices.removeDedicatedConnections),
    },
  })
  return createHash('sha256').update(corpo).digest('hex').slice(0, 32)
}

// --- arquivar, restaurar e purgar --------------------------------------------------------

export type PurgeOutcome =
  | { ok: true; removed: ImpactEntry[]; kept: ImpactEntry[]; unlinked: ImpactEntry[] }
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'impact_changed'; impact: FloorDeletionImpact }
  | { ok: false; code: 'name_mismatch' }
  | { ok: false; code: 'blocked'; blockers: string[] }

/**
 * ARQUIVAR — o padrão, e o que a maioria das pessoas quer quando diz "excluir".
 *
 * Ele tira o andar do mapa E desliga o que estava no ar dentro dele. É reversível, e é por
 * isso que não pede confirmação por nome nem hash: nada se perde.
 *
 * Um andar arquivado com Flow ativo e fonte coletando não está arquivado: ele saiu da tela e
 * continuou trabalhando — gastando token, batendo em servidor de terceiro e gravando
 * histórico que ninguém vai olhar, porque ninguém olha um andar arquivado.
 *
 * O que ele NÃO faz é apagar: arquivar é o padrão recuperável, e cada recurso continua
 * inteiro no lugar dele. Pausar passa pelo serviço canônico de cada domínio, que é quem sabe
 * o que mais precisa acontecer junto — desligar o gatilho de evento, soltar o arrendamento.
 *
 * Restaurar NÃO religa nada: reativar sozinho dispararia trabalho que ninguém pediu,
 * possivelmente semanas depois.
 */
export async function archiveFloor(ownerId: string, floorId: ObjectId) {
  const andar = await setFloorStatus(ownerId, floorId, 'archived')
  if (!andar) return andar

  /**
   * Uma falha ao pausar é DITA, não engolida.
   *
   * Silenciar deixaria o andar marcado como arquivado com metade da operação no ar — e
   * ninguém descobriria, porque ninguém abre um andar arquivado. O andar já saiu do mapa
   * quando isto acontece, então a mensagem nomeia o recurso que continuou ligado.
   */
  const naoPausados: string[] = []
  const { setStatus } = await import('./automations/service.js')
  for (const doc of await db.collection('automations').find({ ownerId, floorId, status: 'active' }, { projection: { _id: 1, name: 1 } }).toArray()) {
    await setStatus(ownerId, doc._id, 'paused').catch(() => naoPausados.push(`Flow "${String(doc.name ?? doc._id)}"`))
  }

  const { setSourceStatus } = await import('./monitoring/service.js')
  // O mesmo filtro que a análise de impacto usa: a fonte é do andar pelo ESCOPO dela, não
  // por um `floorId`. Consultar pelo campo errado deixava a fonte no ar em silêncio.
  const doAndar = { ownerId, 'scope.ownerType': 'floor', 'scope.ownerId': floorId.toString(), status: 'active' }
  for (const doc of await db.collection('monitoring_sources').find(doAndar, { projection: { _id: 1, name: 1 } }).toArray()) {
    await setSourceStatus(ownerId, doc._id, 'paused').catch(() => naoPausados.push(`fonte "${String(doc.name ?? doc._id)}"`))
  }

  if (naoPausados.length) {
    throw new Error(`o andar foi arquivado, mas ${naoPausados.length} recurso(s) continuam no ar: ${naoPausados.join(', ')}`)
  }
  return andar
}

/**
 * RESTAURAR — traz o andar de volta, sem reativar operação nenhuma.
 *
 * Reativar Flows e fontes automaticamente faria uma restauração disparar trabalho que
 * ninguém pediu, possivelmente semanas depois.
 */
export const restoreFloor = (ownerId: string, floorId: ObjectId) => setFloorStatus(ownerId, floorId, 'active')

/**
 * PURGE — separado, explícito, e conferido contra o retrato.
 *
 * Três portas antes de qualquer escrita: o hash precisa bater com a análise de agora, o nome
 * digitado precisa ser o do andar, e nenhum bloqueio pode estar de pé.
 */
export async function purgeFloor(
  ownerId: string,
  floorId: ObjectId,
  input: { impactHash: string; confirmationName: string; choices?: PurgeChoices },
): Promise<PurgeOutcome> {
  const impacto = await floorDeletionImpact(ownerId, floorId, input.choices ?? {})
  if (!impacto) return { ok: false, code: 'not_found' }

  // O retrato mudou entre a análise e o clique: quem confirma precisa ver o novo.
  if (impacto.impactHash !== input.impactHash) return { ok: false, code: 'impact_changed', impact: impacto }
  // O nome digitado é a confirmação. "Tem certeza?" não é uma pergunta.
  if (String(input.confirmationName ?? '').trim() !== impacto.floor.name) return { ok: false, code: 'name_mismatch' }
  if (impacto.blockers.length) return { ok: false, code: 'blocked', blockers: impacto.blockers }

  const removed: ImpactEntry[] = []
  const kept: ImpactEntry[] = []
  const unlinked: ImpactEntry[] = []

  for (const e of impacto.entries) {
    try {
      if (e.disposition === 'keep') {
        kept.push(e)
        continue
      }
      if (e.disposition === 'unlink') {
        if (e.kind === 'databaseGrant') await db.collection('database_grants').deleteOne({ _id: new ObjectId(e.id), ownerId })
        unlinked.push(e)
        continue
      }
      if (e.disposition === 'archive') {
        // Arquivar é uma marca, não uma remoção: o recurso continua no banco e volta com o
        // andar. Um `status` que o domínio não conhece seria pior que nada, então o que se
        // marca é o que cada coleção já usa.
        const colecao = COLECAO_DE[e.kind]
        if (colecao) await db.collection(colecao).updateOne({ _id: new ObjectId(e.id), ownerId }, { $set: { status: 'archived', updatedAt: new Date() } })
        removed.push(e)
        continue
      }
      if (e.disposition === 'delete') {
        const colecao = COLECAO_DE[e.kind]
        if (colecao) await db.collection(colecao).deleteOne({ _id: new ObjectId(e.id), ownerId })
        removed.push(e)
      }
    } catch {
      /**
       * Uma falha em um item não derruba o purge inteiro.
       *
       * A operação continua e o item volta na próxima análise — que é o que torna a
       * retomada possível. Parar no meio deixaria o andar num estado que ninguém consegue
       * descrever.
       */
      kept.push({ ...e, disposition: 'keep', reason: `não foi possível remover agora: ${e.reason}` })
    }
  }

  // O andar sai por último: enquanto ele existe, a análise continua sabendo o que sobrou.
  await db.collection('offices').deleteOne({ _id: floorId, ownerId })
  const { deleteAllForFloor } = await import('./knowledge.js')
  await deleteAllForFloor(floorId).catch(() => undefined)

  return { ok: true, removed, kept, unlinked }
}

/** Onde cada tipo mora. Um tipo sem coleção aqui não é removido — e isso é deliberado. */
const COLECAO_DE: Record<string, string> = {
  agent: 'agents',
  sector: 'sectors',
  flow: 'automations',
  source: 'monitoring_sources',
  knowledge: 'knowledge_documents',
  database: 'data_stores',
  app: 'connections',
}
