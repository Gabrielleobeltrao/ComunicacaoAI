// O destino continua válido AGORA?
//
// A validação de criação/edição prova que o destino era bom no dia em que foi escolhido.
// Depois disso o mundo anda: o agente é excluído, o setor é arquivado, alguém tira o
// coordenador ou o último membro. O widget segue apontando para um lugar que não atende
// mais, e o visitante manda mensagem para o vazio — a mensagem é gravada, a execução é
// disparada, e o resultado é silêncio pago.
//
// Aqui a mesma regra da criação é aplicada ao que está no banco AGORA. Fonte única:
// `resolveWidgetDestination` e, por dentro dele, `sectorReadiness`. Duas verificações
// diferentes para a mesma pergunta acabariam discordando, e a que discordasse seria
// justamente a que deixa passar.
import { ObjectId } from 'mongodb'
import { getAgentById, listAgents } from './agents.js'
import { getSectorById } from './sectors.js'
import { resolveWidgetDestination } from './widgetDestination.js'

/** Estável, e por isso parte do contrato: a tela decide por este código. */
export const WIDGET_DESTINATION_INVALID = 'widget_destination_invalid'

export interface RuntimeDestination {
  ok: boolean
  status?: number
  code?: string
  /** Legível para quem administra — nunca conta o que é interno da conta. */
  error?: string
  agentId?: ObjectId | null
  sectorId?: ObjectId | null
}

export async function resolveRuntimeDestination(widget: {
  ownerId: string
  agentId?: ObjectId | null
  sectorId?: ObjectId | null
}): Promise<RuntimeDestination> {
  const temAgente = Boolean(widget.agentId)
  const temSetor = Boolean(widget.sectorId)

  // Um widget legado pode ter os dois nulos (ou os dois preenchidos): ele foi criado
  // antes de a regra existir. Recusar aqui é o certo — o que não pode é gravar mensagem
  // e disparar execução para um destino que ninguém consegue nomear.
  if (temAgente === temSetor) {
    const r = resolveWidgetDestination({
      agentId: widget.agentId ?? null,
      sectorId: widget.sectorId ?? null,
      agentPresent: temAgente,
    })
    return { ok: false, status: 409, code: WIDGET_DESTINATION_INVALID, error: r.reason! }
  }

  if (temAgente) {
    const agente = await getAgentById(widget.ownerId, widget.agentId!)
    const r = resolveWidgetDestination({ agentId: widget.agentId!, agentPresent: Boolean(agente) })
    if (!r.ok) return { ok: false, status: 409, code: WIDGET_DESTINATION_INVALID, error: r.reason! }
    return { ok: true, agentId: r.destination!.agentId, sectorId: null }
  }

  const setor = await getSectorById(widget.ownerId, widget.sectorId!)
  const doDono = setor ? await listAgents(widget.ownerId) : []
  const r = resolveWidgetDestination({
    sectorId: widget.sectorId!,
    sector: setor
      ? {
          _id: setor._id,
          name: setor.name,
          mode: setor.mode,
          members: setor.members ?? [],
          coordinatorAgentId: setor.coordinatorAgentId ?? null,
          stages: setor.stages ?? [],
          knownAgentIds: doDono.map((a) => a._id.toString()),
          archivedAt: (setor as { archivedAt?: Date | null }).archivedAt ?? null,
        }
      : null,
  })
  if (!r.ok) return { ok: false, status: 409, code: WIDGET_DESTINATION_INVALID, error: r.reason! }
  return { ok: true, agentId: null, sectorId: r.destination!.sectorId }
}
