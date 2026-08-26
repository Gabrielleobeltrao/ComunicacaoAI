import * as L from './limits.js'
import type { ArchitectChecklistItem, ArchitectReadiness, OfficeBlueprintV1 } from './types.js'

// A checklist é DERIVADA do blueprint, aqui, por código.
//
// O modelo pode sugerir itens, e eles entram — mas como revisão manual e opcional. O
// que decide se um App está conectado ou se o cardápio chegou é o estado real, e um
// item "concluído" escrito pelo modelo diria "pronto" sobre algo que ninguém fez.
//
// Função pura: entra blueprint, sai lista. O estado real é aplicado depois, em
// `applyChecklistState`, com o que o serviço leu do banco.

const idDe = (categoria: string, chave: string): string => `${categoria}:${chave}`

export function deriveChecklist(bp: OfficeBlueprintV1): ArchitectChecklistItem[] {
  const itens: ArchitectChecklistItem[] = []

  // --- estrutura: existe de verdade depois de aplicar? --------------------------------
  for (const floor of bp.floors ?? []) {
    itens.push({
      id: idDe('structure', `floor-${floor.key}`),
      category: 'structure',
      title: `Andar “${floor.name}”`,
      description: floor.action === 'create' ? 'Será criado ao aplicar a proposta.' : 'Andar existente, reutilizado pela proposta.',
      required: true,
      status: 'pending',
      completionMode: 'resource_state',
      target: { kind: 'floor', key: floor.key },
      dependsOn: [],
    })
  }
  for (const agent of bp.agents ?? []) {
    itens.push({
      id: idDe('structure', `agent-${agent.key}`),
      category: 'structure',
      title: `Agente “${agent.name}”`,
      description: agent.rationale?.trim() || 'Faz parte da equipe proposta.',
      required: true,
      status: 'pending',
      completionMode: 'resource_state',
      target: { kind: 'agent', key: agent.key },
      dependsOn: [idDe('structure', `floor-${agent.floorKey}`)],
    })
  }
  for (const sector of bp.sectors ?? []) {
    itens.push({
      id: idDe('structure', `sector-${sector.key}`),
      category: 'structure',
      title: `Setor “${sector.name}”`,
      description: sector.rationale?.trim() || 'Organiza quem responde o quê.',
      required: true,
      status: 'pending',
      completionMode: 'resource_state',
      target: { kind: 'sector', key: sector.key },
      dependsOn: (sector.memberAgentKeys ?? []).map((k) => idDe('structure', `agent-${k}`)),
    })
  }

  // --- conhecimento: o que o dono precisa entregar ------------------------------------
  for (const req of bp.knowledgeRequirements ?? []) {
    itens.push({
      id: idDe('knowledge', req.key),
      category: 'knowledge',
      title: req.title,
      description: req.description || 'Sem isto, o agente responde sem base.',
      required: req.required !== false,
      status: 'pending',
      completionMode: 'resource_state',
      target: { kind: 'knowledge', key: req.key },
      dependsOn: req.targetKey && req.scope === 'agent' ? [idDe('structure', `agent-${req.targetKey}`)] : req.targetKey && req.scope === 'sector' ? [idDe('structure', `sector-${req.targetKey}`)] : [],
    })
  }

  // --- Apps: conexão é do dono, e nunca automática ------------------------------------
  for (const req of bp.appRequirements ?? []) {
    itens.push({
      id: idDe('app', req.key),
      category: 'app',
      title: `Conectar ${req.appKey}`,
      description: req.reason || 'O agente precisa deste App para agir.',
      required: req.required !== false,
      status: 'pending',
      completionMode: 'connection_state',
      target: { kind: 'app', key: req.appKey },
      actionPath: '/apps',
      dependsOn: [],
    })
  }

  // --- rotinas: nascem rascunho, publicar é decisão posterior --------------------------
  for (const routine of bp.routines ?? []) {
    itens.push({
      id: idDe('routine', routine.key),
      category: 'routine',
      title: `Revisar e publicar a rotina “${routine.name}”`,
      description: 'Ela é criada como rascunho e não roda até ser publicada.',
      required: false,
      status: 'pending',
      completionMode: 'resource_state',
      target: { kind: 'routine', key: routine.key },
      dependsOn: [idDe('structure', `agent-${routine.ownerAgentKey}`)],
    })
  }

  // --- teste e publicação ---------------------------------------------------------------
  const estruturaKeys = itens.filter((i) => i.category === 'structure').map((i) => i.id)
  if (estruturaKeys.length) {
    itens.push({
      id: idDe('test', 'conversa-de-teste'),
      category: 'test',
      title: 'Testar a operação com uma conversa real',
      description: 'Converse com o agente de entrada e confira se a resposta está de pé.',
      required: true,
      status: 'pending',
      completionMode: 'manual',
      dependsOn: estruturaKeys,
    })
  }

  // Sugestões do modelo: entram como revisão manual e opcional, sem id que colida com
  // os derivados acima.
  for (const sugerido of bp.checklist ?? []) {
    const id = `review:${String(sugerido?.id ?? '').trim() || String(itens.length)}`
    if (itens.some((i) => i.id === id)) continue
    const title = String(sugerido?.title ?? '').trim()
    if (!title) continue
    itens.push({
      id,
      category: 'review',
      title,
      description: String(sugerido?.description ?? '').slice(0, L.MAX_SHORT_TEXT_CHARS),
      required: false,
      status: 'pending',
      completionMode: 'manual',
      dependsOn: [],
    })
  }

  return itens.slice(0, L.MAX_CHECKLIST_ITEMS)
}

/**
 * Aplica o estado real e resolve `blocked`.
 *
 * `concluidos` é o conjunto de ids que o serviço apurou consultando o banco: recurso
 * criado, App conectado, documento indexado. Itens manuais preservam o que o dono
 * marcou (`marcados`) — e só eles.
 */
export function applyChecklistState(
  itens: ArchitectChecklistItem[],
  concluidos: Set<string>,
  marcados: Set<string> = new Set(),
): ArchitectChecklistItem[] {
  const feito = new Set<string>()
  for (const item of itens) {
    if (item.completionMode === 'manual' ? marcados.has(item.id) : concluidos.has(item.id)) feito.add(item.id)
  }
  return itens.map((item) => {
    if (feito.has(item.id)) return { ...item, status: 'done' as const }
    const travado = item.dependsOn.some((dep) => !feito.has(dep))
    return { ...item, status: travado ? ('blocked' as const) : ('ready' as const) }
  })
}

/** “100% pronto” só quando todo obrigatório está `done` e não sobrou bloqueio. */
export function computeReadiness(itens: ArchitectChecklistItem[], blockers: string[] = []): ArchitectReadiness {
  const obrigatorios = itens.filter((i) => i.required)
  const opcionais = itens.filter((i) => !i.required)
  const feitos = (lista: ArchitectChecklistItem[]) => lista.filter((i) => i.status === 'done').length
  const requiredDone = feitos(obrigatorios)
  return {
    requiredDone,
    requiredTotal: obrigatorios.length,
    optionalDone: feitos(opcionais),
    optionalTotal: opcionais.length,
    ready: blockers.length === 0 && obrigatorios.length > 0 && requiredDone === obrigatorios.length,
    blockers,
  }
}
