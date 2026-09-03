import { ObjectId } from 'mongodb'
import { listWidgets } from '../widgets.js'
import { listConnections } from '../connections/service.js'
import { db } from '../db.js'
import { getBuilding } from '../building.js'
import { listFloors } from '../floors.js'
import { listSectors } from '../sectors.js'
import { listAgents } from '../agents.js'
import { listInstallations } from '../apps/installations.js'
import { listDataStores, listDatasets, listGrants } from '../databases/store.js'
import { listSources } from '../monitoring/service.js'
import { describeMonitors } from '../monitors/service.js'
import { listAutomations } from '../automations/service.js'
import { listTools } from '../tools.js'
import { computeHealth } from '../monitoring/health.js'

// O INVENTÁRIO — o que a conta REALMENTE tem, lido dos serviços canônicos.
//
// O Arquiteto V1 montava o contexto à mão, escolhendo alguns campos de alguns domínios. Isso
// tem duas consequências, e as duas aparecem em produção: ele não consegue decidir entre
// expandir e criar (não sabe o que existe), e duplica recursos que já estavam lá.
//
// Duas representações, com propósitos diferentes e nada em comum além da origem:
//
//   `OfficeInventory`  — completo, paginado, owner-scoped. É lido pelo CÓDIGO. É ele que
//                        decide reuso, detecta duplicata e calcula diff.
//   `OfficeInventorySummary` — o mínimo da rodada. É o que vai para o MODELO.
//
// Mandar o inventário completo ao modelo seria pagar contexto por dado que ele não usa, e
// oferecer a uma superfície de texto tudo o que a conta tem. O resumo é uma decisão de
// custo e de exposição, não uma otimização.
//
// Nada aqui decide autorização. O inventário lista o que existe; quem pode usar o quê
// continua sendo decidido pelo adapter de cada domínio, imediatamente antes do uso.

/** Tetos: um inventário é um retrato, não um dump. Acima disto, a resposta é truncada e diz. */
export const INVENTORY_LIMITS = {
  perKind: 200,
  summaryPerKind: 12,
  labelChars: 80,
} as const

export interface InventoryItem {
  id: string
  label: string
  /** O escopo de posse, como o domínio o define: `building:<id>`, `floor:<id>`, `account`. */
  ownerScope: string
  status?: string
  /** O que distingue este item dos outros do mesmo tipo, sem carregar conteúdo. */
  meta?: Record<string, string | number | boolean | null>
}

export interface InventorySection {
  kind: string
  items: InventoryItem[]
  /** Quantos existem de verdade. Diferente de `items.length` quando o teto cortou. */
  total: number
  truncated: boolean
}

export interface OfficeInventory {
  ownerId: string
  at: Date
  building: { id: string; name: string } | null
  sections: Record<string, InventorySection>
}

const secao = (kind: string, items: InventoryItem[], total?: number): InventorySection => {
  const completo = total ?? items.length
  return {
    kind,
    items: items.slice(0, INVENTORY_LIMITS.perKind),
    total: completo,
    truncated: completo > INVENTORY_LIMITS.perKind,
  }
}

const rotulo = (texto: unknown): string => String(texto ?? '').slice(0, INVENTORY_LIMITS.labelChars)

/**
 * O inventário completo de uma conta.
 *
 * Cada seção sai do serviço canônico do domínio — nenhuma consulta direta a coleção que já
 * tem dono. Onde o serviço não expõe listagem (canais vinculados, entregas), a consulta é
 * feita aqui com `ownerId` explícito e está marcada como tal.
 */
export async function loadOfficeInventory(ownerId: string): Promise<OfficeInventory> {
  const [predio, andares, agentes, instalacoes, stores, fontes, monitores, flows, ferramentas, canais, conexoes] = await Promise.all([
    getBuilding(ownerId).catch(() => null),
    listFloors(ownerId, { includeArchived: true }).catch(() => []),
    listAgents(ownerId).catch(() => []),
    listInstallations(ownerId).catch(() => []),
    listDataStores(ownerId).catch(() => []),
    listSources(ownerId).catch(() => []),
    describeMonitors(ownerId).catch(() => []),
    listAutomations(ownerId, { limit: INVENTORY_LIMITS.perKind, skip: 0 }).catch(() => ({ items: [], total: 0 })),
    listTools(ownerId).catch(() => []),
    // CANAIS e ENTREGAS: sem eles, o Arquiteto propunha criar o canal que já existe e não
    // sabia dizer o que a exclusão de um andar levaria junto.
    listWidgets(ownerId).catch(() => []),
    listConnections(ownerId).catch(() => []),
  ])

  const setores = (await Promise.all(andares.map((f) => listSectors(ownerId, f._id).catch(() => [])))).flat()

  // Os datasets e os grants de cada Database — a forma que o Blueprint precisa referenciar.
  const datasets: InventoryItem[] = []
  const grants: InventoryItem[] = []
  for (const s of stores.slice(0, INVENTORY_LIMITS.perKind)) {
    for (const d of await listDatasets(ownerId, s._id).catch(() => [])) {
      datasets.push({
        id: `${s._id.toString()}:${d.key}`,
        label: rotulo(d.name),
        ownerScope: `database:${s._id.toString()}`,
        meta: { dataStoreId: s._id.toString(), key: d.key, mutability: String(d.mutability ?? '') },
      })
    }
    for (const g of await listGrants(ownerId, s._id).catch(() => [])) {
      grants.push({
        id: g._id.toString(),
        label: rotulo(`${g.subjectType}`),
        ownerScope: `database:${s._id.toString()}`,
        meta: { subjectType: String(g.subjectType), effect: String(g.effect ?? 'allow') },
      })
    }
  }

  const agora = new Date()
  const flowItems = (flows as { items?: unknown[] }).items ?? (Array.isArray(flows) ? flows : [])

  return {
    ownerId,
    at: agora,
    building: predio ? { id: predio._id.toString(), name: rotulo(predio.name) } : null,
    sections: {
      floor: secao(
        'floor',
        andares.map((f) => ({
          id: f._id.toString(),
          label: rotulo(f.name),
          ownerScope: predio ? `building:${predio._id.toString()}` : 'account',
          status: String(f.status ?? 'active'),
          meta: { workMode: String(f.workMode ?? 'organization'), updatedAt: (f.updatedAt ?? f.createdAt ?? agora).toISOString() },
        })),
      ),
      sector: secao(
        'sector',
        setores.map((s) => ({
          id: s._id.toString(),
          label: rotulo(s.name),
          ownerScope: s.officeId ? `floor:${s.officeId.toString()}` : 'account',
          meta: { mode: String(s.mode ?? 'organization'), members: (s.members ?? []).length },
        })),
      ),
      agent: secao(
        'agent',
        agentes.map((a) => ({
          id: a._id.toString(),
          label: rotulo(a.name),
          ownerScope: a.officeId ? `floor:${a.officeId.toString()}` : 'account',
          // `role` é o que o Flow mostra. Guardar se ele existe é o que permite ao
          // compilador dizer "este agente já tem responsabilidade" sem carregar o texto.
          meta: { hasRole: Boolean(String(a.role ?? '').trim()), preset: String(a.preset ?? '') },
        })),
      ),
      app: secao(
        'app',
        instalacoes.map((i) => ({
          id: i._id.toString(),
          label: rotulo(i.name ?? i.appKey),
          ownerScope: 'account',
          status: String(i.status ?? ''),
          // A credencial NUNCA entra aqui — nem cifrada, nem por referência resolvível.
          meta: { appKey: String(i.appKey), connected: String(i.status) === 'connected' },
        })),
      ),
      database: secao(
        'database',
        stores.map((s) => ({
          id: s._id.toString(),
          label: rotulo(s.name),
          ownerScope: `${s.owner?.ownerType ?? 'account'}:${s.owner?.ownerId ?? ''}`,
          status: String(s.status ?? ''),
          meta: { adapterKind: String(s.adapterKind ?? '') },
        })),
      ),
      dataset: secao('dataset', datasets),
      databaseGrant: secao('databaseGrant', grants),
      tool: secao(
        'tool',
        ferramentas.map((t) => ({
          id: t._id.toString(),
          label: rotulo(t.name),
          ownerScope: 'account',
          // Uma ferramenta que empresta credencial de uma conexão depende dela: é o que
          // permite ao impacto dizer que remover a conexão deixa a ferramenta muda.
          meta: { method: String(t.method ?? ''), installationId: t.installationId ? String(t.installationId) : null },
        })),
      ),
      source: secao(
        'source',
        fontes.map((f) => ({
          id: f._id.toString(),
          label: rotulo(f.name),
          ownerScope: `${f.scope?.ownerType ?? 'account'}:${f.scope?.ownerId ?? ''}`,
          status: String(f.status),
          meta: {
            kind: String(f.kind),
            health: computeHealth(f, agora).health,
            live: Boolean(f.destination?.live),
            history: Boolean(f.destination?.history),
            // A chave do conjunto que a fonte alimenta: é por ela que um monitor a alcança.
            datasetKey: f.destination?.recorderId ? f.destination.recorderId.toString() : null,
          },
        })),
      ),
      monitor: secao(
        'monitor',
        (monitores as { id: string; name: string; status: string; source?: Record<string, unknown> }[]).map((m) => ({
          id: String(m.id),
          label: rotulo(m.name),
          ownerScope: 'account',
          status: String(m.status),
          meta: {
            sourceKind: String((m.source as { kind?: string } | undefined)?.kind ?? ''),
            datasetKey: String((m.source as { datasetKey?: string } | undefined)?.datasetKey ?? ''),
          },
        })),
      ),
      /**
       * O CANAL é o vínculo: por onde a mensagem entra e quem recebe.
       *
       * Um App desconectado continua aparecendo — como pendência. Some-lo esconderia
       * justamente o que precisa de atenção.
       */
      channel: secao(
        'channel',
        (canais as { _id?: unknown; name?: unknown; channel?: unknown; agentId?: unknown; sectorId?: unknown }[]).map((c) => ({
          id: String(c._id ?? ''),
          label: rotulo(c.name),
          ownerScope: 'account',
          status: c.agentId || c.sectorId ? 'bound' : 'unbound',
          meta: {
            kind: String(c.channel ?? 'web_chat'),
            // Quem recebe, sem carregar o id para o resumo que vai ao modelo.
            entry: c.agentId ? 'agent' : c.sectorId ? 'sector' : 'none',
          },
        })),
      ),
      /**
       * A ENTREGA é por onde a resposta SAI — a conexão da conta.
       *
       * O endereço não aparece aqui: `maskDestination` existe porque um e-mail ou um número
       * num inventário é dado pessoal viajando para uma tela e para o resumo do modelo.
       */
      delivery: secao(
        'delivery',
        (conexoes as { _id?: unknown; name?: unknown; provider?: unknown; status?: unknown }[]).map((c) => ({
          id: String(c._id ?? ''),
          label: rotulo(c.name),
          ownerScope: 'account',
          status: String(c.status ?? ''),
          meta: { provider: String(c.provider ?? '') },
        })),
      ),
      flow: secao(
        'flow',
        (flowItems as { id?: unknown; _id?: unknown; name?: unknown; status?: unknown; floorId?: unknown }[]).map((a) => ({
          id: String(a.id ?? a._id ?? ''),
          label: rotulo(a.name),
          ownerScope: a.floorId ? `floor:${String(a.floorId)}` : 'account',
          status: String(a.status ?? ''),
          meta: {},
        })),
        (flows as { total?: number }).total,
      ),
    },
  }
}

// --- o resumo para o modelo -------------------------------------------------------------

export interface OfficeInventorySummary {
  building: string | null
  /** Uma linha por tipo: quantos existem e os primeiros nomes. Nada de id. */
  counts: Record<string, number>
  samples: Record<string, string[]>
  /** O que está pela metade e muda a decisão: App desconectado, fonte degradada. */
  attention: string[]
}

/**
 * O RESUMO — o mínimo que o modelo precisa para descrever o negócio.
 *
 * Ele não carrega ObjectId de propósito. Um id no contexto é um id que o modelo pode
 * devolver, e um id devolvido pelo modelo é um id inventado — que, se casar por acaso com
 * o de outra conta, é a diferença entre uma proposta e um vazamento.
 */
export function summarizeInventory(inv: OfficeInventory): OfficeInventorySummary {
  const counts: Record<string, number> = {}
  const samples: Record<string, string[]> = {}
  const attention: string[] = []

  for (const [kind, s] of Object.entries(inv.sections)) {
    counts[kind] = s.total
    if (s.items.length) samples[kind] = s.items.slice(0, INVENTORY_LIMITS.summaryPerKind).map((i) => i.label)
  }

  /**
   * O App que não está de pé — dito com o motivo REAL.
   *
   * O vocabulário é o do domínio (`connected | error | revoked | needs_reauth`), e cada um
   * deles pede uma ação diferente de quem lê: reautenticar não é o mesmo que reconectar, e
   * "não conectado" para os três esconderia justamente o que fazer a seguir.
   */
  const MOTIVO: Record<string, string> = {
    error: 'está com erro',
    revoked: 'teve o acesso revogado',
    needs_reauth: 'precisa ser reautenticado',
  }
  for (const app of inv.sections.app?.items ?? []) {
    if (app.meta?.connected !== false) continue
    attention.push(`o App "${app.label}" ${MOTIVO[app.status ?? ''] ?? 'não está conectado'}`)
  }
  for (const fonte of inv.sections.source?.items ?? []) {
    if (fonte.meta?.health === 'degraded') attention.push(`a fonte "${fonte.label}" está degradada`)
    if (fonte.status === 'draft') attention.push(`a fonte "${fonte.label}" ainda é rascunho`)
  }
  for (const agente of inv.sections.agent?.items ?? []) {
    if (agente.meta?.hasRole === false) attention.push(`o agente "${agente.label}" está sem responsabilidade escrita`)
  }

  return { building: inv.building?.name ?? null, counts, samples, attention: attention.slice(0, 20) }
}

// --- o grafo de dependências --------------------------------------------------------------

export interface ResourceNode {
  kind: string
  id: string
  ownerScope: string
  label: string
}

export interface ResourceEdge {
  from: string
  to: string
  relation: string
  /** `true` quando o destino não existe sem a origem. É o que separa impacto de vínculo. */
  required: boolean
}

export interface DependencyGraph {
  nodes: ResourceNode[]
  edges: ResourceEdge[]
}

/** O identificador de um nó no grafo. `kind:id` — legível e estável. */
export const nodeRef = (kind: string, id: string): string => `${kind}:${id}`

/**
 * O grafo do escritório — para IMPACTO e ORDEM, nunca para autorização.
 *
 * Uma herança genérica de permissão aqui seria mais simples de escrever e estaria errada em
 * pelo menos um domínio no primeiro mês: App decide por instalação + ação + escrita
 * autônoma, Knowledge por política de escopo, Database e Source por grants próprios. O
 * grafo responde "o que quebra se eu mexer neste nó" e "em que ordem aplicar". Só isso.
 */
export function buildDependencyGraph(inv: OfficeInventory): DependencyGraph {
  const nodes: ResourceNode[] = []
  const edges: ResourceEdge[] = []

  for (const [kind, s] of Object.entries(inv.sections)) {
    for (const item of s.items) nodes.push({ kind, id: item.id, ownerScope: item.ownerScope, label: item.label })
  }

  const existe = new Set(nodes.map((n) => nodeRef(n.kind, n.id)))
  const ligar = (from: string, to: string, relation: string, required: boolean) => {
    if (existe.has(from) && existe.has(to) && from !== to) edges.push({ from, to, relation, required })
  }

  // Organização: setor e agente moram num andar, e não existem sem ele.
  for (const kind of ['sector', 'agent']) {
    for (const item of inv.sections[kind]?.items ?? []) {
      const andar = item.ownerScope.startsWith('floor:') ? item.ownerScope.slice(6) : null
      if (andar) ligar(nodeRef(kind, item.id), nodeRef('floor', andar), 'mora_em', true)
    }
  }

  // Operação: Flow mora num andar; fonte alimenta dataset; monitor observa dataset.
  for (const flow of inv.sections.flow?.items ?? []) {
    const andar = flow.ownerScope.startsWith('floor:') ? flow.ownerScope.slice(6) : null
    if (andar) ligar(nodeRef('flow', flow.id), nodeRef('floor', andar), 'mora_em', true)
  }
  for (const dataset of inv.sections.dataset?.items ?? []) {
    const store = String(dataset.meta?.dataStoreId ?? '')
    if (store) ligar(nodeRef('dataset', dataset.id), nodeRef('database', store), 'pertence_a', true)
  }
  for (const fonte of inv.sections.source?.items ?? []) {
    const chave = fonte.meta?.datasetKey
    if (!chave) continue
    // A fonte ALIMENTA o conjunto: o dataset existe sem ela, então o vínculo não é
    // obrigatório — apagar a fonte deixa a série parada, não inexistente.
    const alvo = (inv.sections.dataset?.items ?? []).find((d) => d.meta?.key === chave)
    if (alvo) ligar(nodeRef('source', fonte.id), nodeRef('dataset', alvo.id), 'alimenta', false)
  }
  for (const monitor of inv.sections.monitor?.items ?? []) {
    const chave = String(monitor.meta?.datasetKey ?? '')
    if (!chave) continue
    const alvo = (inv.sections.dataset?.items ?? []).find((d) => d.meta?.key === chave)
    // O monitor NÃO existe sem o que observa: sem o dataset, ele nunca dispara.
    if (alvo) ligar(nodeRef('monitor', monitor.id), nodeRef('dataset', alvo.id), 'observa', true)
  }

  return { nodes, edges }
}

/**
 * O que depende deste nó — direta e indiretamente.
 *
 * É a pergunta da exclusão: "o que quebra se isto sumir?". A travessia é limitada em
 * profundidade porque um grafo com ciclo (que o produto não deveria ter, mas dado real
 * tem) transformaria a análise de impacto num laço.
 */
export function dependentsOf(graph: DependencyGraph, ref: string, maxDepth = 6): ResourceEdge[] {
  const encontrados: ResourceEdge[] = []
  const vistos = new Set<string>([ref])
  let fronteira = [ref]

  for (let d = 0; d < maxDepth && fronteira.length; d++) {
    const proxima: string[] = []
    for (const alvo of fronteira) {
      for (const e of graph.edges) {
        if (e.to !== alvo || vistos.has(e.from)) continue
        encontrados.push(e)
        vistos.add(e.from)
        proxima.push(e.from)
      }
    }
    fronteira = proxima
  }
  return encontrados
}

/** O nó de um andar, para a análise de impacto perguntar por ele. */
export const floorRef = (floorId: ObjectId | string): string => nodeRef('floor', String(floorId))
