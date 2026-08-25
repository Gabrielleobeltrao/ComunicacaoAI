import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { listInstallations } from '../apps/installations.js'
import { applyChecklistState, computeReadiness } from './checklist.js'
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
  knowledge: 'knowledge_documents',
}

export async function recheckProject(ownerId: string, project: ArchitectProject): Promise<{ checklist: ArchitectChecklistItem[]; readiness: ArchitectReadiness }> {
  const itens = project.checklist ?? []
  const mapa = await mapaDeRecursos(ownerId, project)
  const instalados = new Set((await listInstallations(ownerId)).filter((i) => i.status !== 'revoked').map((i) => i.appKey))

  const concluidos = new Set<string>()
  for (const item of itens) {
    if (item.completionMode === 'manual') continue
    if (item.completionMode === 'connection_state') {
      if (item.target && instalados.has(item.target.key)) concluidos.add(item.id)
      continue
    }
    const alvo = item.target
    if (!alvo) continue
    const id = mapa.get(`${alvo.kind}:${alvo.key}`)
    const colecao = COLECAO[alvo.kind]
    if (!id || !colecao || !ObjectId.isValid(id)) continue
    const doc = await db.collection(colecao).findOne({ _id: new ObjectId(id), ownerId }, { projection: { _id: 1, status: 1 } })
    if (!doc) continue
    // Uma rotina só conta como resolvida quando deixa de ser rascunho: ela nasce
    // parada, e dizer "pronto" enquanto ela não roda seria falso.
    if (alvo.kind === 'routine' && doc.status === 'draft') continue
    concluidos.add(item.id)
  }

  const marcados = new Set(itens.filter((i) => i.completionMode === 'manual' && i.status === 'done').map((i) => i.id))
  const checklist = applyChecklistState(itens, concluidos, marcados)
  return { checklist, readiness: computeReadiness(checklist, project.readiness?.blockers ?? []) }
}

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
