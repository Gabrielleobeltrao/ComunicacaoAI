import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { listInstallations } from '../apps/installations.js'
import { applyChecklistState, computeReadiness } from './checklist.js'
import { architectKnowledgeExists } from './knowledge.js'
import type { KnowledgeScope } from './knowledge.js'
import type { ArchitectChecklistItem, ArchitectReadiness } from './types.js'
import type { ArchitectProject } from './repository.js'

// A prontidão apurada contra o ESTADO REAL.
//
// Nada aqui confia no que foi gravado no projeto: cada item automático é conferido
// consultando o recurso. É a diferença entre "a aplicação disse que criou" e "existe".

const COLECAO: Record<string, string> = {
  floor: 'offices',
  agent: 'agents',
  sector: 'sectors',
  routine: 'automations',
}

export async function recheckProject(ownerId: string, project: ArchitectProject): Promise<{ checklist: ArchitectChecklistItem[]; readiness: ArchitectReadiness }> {
  const itens = project.checklist ?? []
  const mapa = await mapaDeRecursos(ownerId, project)
  const instalados = new Set((await listInstallations(ownerId)).filter((i) => i.status !== 'revoked').map((i) => i.appKey))

  const concluidos = new Set<string>()
  // A checklist pode ser reescrita aqui: o item de App muda de texto e de destino
  // conforme o que falta — conectar, ou conceder.
  const reescritos = new Map<string, Partial<ArchitectChecklistItem>>()

  for (const item of itens) {
    if (item.completionMode === 'manual') continue
    if (item.completionMode === 'connection_state') {
      const r = await estadoDoApp(ownerId, project, item, instalados, mapa)
      if (r.done) concluidos.add(item.id)
      else reescritos.set(item.id, { description: r.description, ...(r.actionPath ? { actionPath: r.actionPath } : {}) })
      continue
    }
    const alvo = item.target
    if (!alvo) continue
    const id = mapa.get(`${alvo.kind}:${alvo.key}`)
    if (!id) continue
    // Conhecimento não tem uma coleção só: agente e setor moram na base indexada,
    // andar e prédio na memória. Quem sabe onde procurar é o módulo do escopo.
    if (alvo.kind === 'knowledge') {
      const escopo = escopoDoConhecimento(project, alvo.key)
      if (escopo && (await architectKnowledgeExists(ownerId, escopo, id))) concluidos.add(item.id)
      continue
    }
    const colecao = COLECAO[alvo.kind]
    if (!colecao || !ObjectId.isValid(id)) continue
    const doc = await db.collection(colecao).findOne({ _id: new ObjectId(id), ownerId }, { projection: { _id: 1, status: 1 } })
    if (!doc) continue
    // Uma rotina só conta como resolvida quando deixa de ser rascunho: ela nasce
    // parada, e dizer "pronto" enquanto ela não roda seria falso.
    if (alvo.kind === 'routine' && doc.status === 'draft') continue
    concluidos.add(item.id)
  }

  const marcados = new Set(itens.filter((i) => i.completionMode === 'manual' && i.status === 'done').map((i) => i.id))
  const comTexto = itens.map((i) => (reescritos.has(i.id) ? { ...i, ...reescritos.get(i.id) } : i))
  const checklist = applyChecklistState(comTexto, concluidos, marcados)
  return { checklist, readiness: computeReadiness(checklist, project.readiness?.blockers ?? []) }
}

/**
 * Conectado NÃO é o mesmo que concedido.
 *
 * O App conectado é da conta; a permissão é de cada agente, e é ela que decide se o
 * agente consegue agir. Marcar o item como pronto só porque existe uma instalação
 * dizia "resolvido" sobre um agente que ainda não alcança o App — e o erro só
 * apareceria na primeira execução.
 *
 * São três estados, e cada um leva a um lugar diferente: sem instalação, vá conectar;
 * com instalação e sem permissão, vá ao agente; com as duas e com as ações que o
 * requisito pede, aí sim está pronto.
 */
async function estadoDoApp(
  ownerId: string,
  project: ArchitectProject,
  item: ArchitectChecklistItem,
  instalados: Set<string>,
  mapa: Map<string, string>,
): Promise<{ done: boolean; description: string; actionPath?: string }> {
  const appKey = item.target?.key ?? ''
  if (!instalados.has(appKey)) {
    return { done: false, description: `${appKey} ainda não está conectado nesta conta.`, actionPath: '/apps' }
  }

  const req = (project.blueprint?.appRequirements ?? []).find((r) => `app:${r.key}` === item.id)
  const agentKeys = req?.agentKeys ?? []
  // Um requisito sem agente declarado se resolve com a conexão: não há a quem conceder.
  if (!agentKeys.length) return { done: true, description: item.description }

  const acoesPedidas = req?.actionKeys ?? []
  const faltando: string[] = []
  let primeiroId: string | null = null
  for (const key of agentKeys) {
    const id = mapa.get(`agent:${key}`)
    if (!id || !ObjectId.isValid(id)) {
      faltando.push(key)
      continue
    }
    primeiroId = primeiroId ?? id
    const agente = await db.collection('agents').findOne({ _id: new ObjectId(id), ownerId }, { projection: { appGrants: 1, name: 1 } })
    const grant = ((agente?.appGrants ?? []) as { appKey: string; actionKeys?: string[] }[]).find((g) => g.appKey === appKey)
    // A permissão precisa cobrir as ações que o requisito pede. Uma permissão pela
    // metade falha exatamente na ação que ninguém concedeu.
    const cobre = grant && acoesPedidas.every((a) => (grant.actionKeys ?? []).includes(a))
    if (!cobre) faltando.push(String(agente?.name ?? key))
  }

  if (!faltando.length) return { done: true, description: item.description }
  return {
    done: false,
    description: `${appKey} está conectado, mas ${faltando.join(', ')} ainda não tem permissão para usá-lo.`,
    actionPath: primeiroId ? `/agents/${primeiroId}/apps` : '/apps',
  }
}

/** O escopo declarado no blueprint para aquele requisito — é ele que diz onde procurar. */
const escopoDoConhecimento = (project: ArchitectProject, key: string): KnowledgeScope | null =>
  (project.blueprint?.knowledgeRequirements ?? []).find((r) => r.key === key)?.scope ?? null

/** `kind:key` → id real, juntando o que TODAS as operações do projeto criaram. */
async function mapaDeRecursos(ownerId: string, project: ArchitectProject): Promise<Map<string, string>> {
  const operacoes = await db
    .collection('architect_apply_operations')
    .find({ ownerId, projectId: project._id })
    .sort({ startedAt: 1 })
    .toArray()
  const mapa = new Map<string, string>()
  for (const op of operacoes) {
    for (const [k, v] of Object.entries((op.resourceMap ?? {}) as Record<string, string>)) mapa.set(k, v)
  }
  return mapa
}

/** Os links da tela: para onde ir depois de aplicar. */
export async function appliedLinks(ownerId: string, project: ArchitectProject): Promise<{ kind: string; key: string; id: string; path: string }[]> {
  const mapa = await mapaDeRecursos(ownerId, project)
  const fora: { kind: string; key: string; id: string; path: string }[] = []
  for (const [chave, id] of mapa) {
    const [kind, key] = chave.split(':')
    if (kind === 'floor') fora.push({ kind, key, id, path: `/floors/${id}` })
    else if (kind === 'agent') fora.push({ kind, key, id, path: `/agents/${id}` })
    else if (kind === 'sector') fora.push({ kind, key, id, path: `/setores/${id}` })
  }
  return fora
}
