// Para quem o visitante está falando.
//
// Um widget SEM destino não é um widget: é uma caixa de texto que engole mensagem. Antes
// isso era aceito — os dois campos podiam ficar nulos —, e o resultado era um chat no
// site do cliente que recebia perguntas e nunca respondia, sem nada na tela dizendo por
// quê.
//
// E os dois campos podiam vir preenchidos ao mesmo tempo. A rota escolhia o setor em
// silêncio, então quem trocou de agente para setor e voltou ficava com o destino antigo
// gravado embaixo, esperando para reaparecer.
//
// Aqui há UMA resposta: ou agente, ou setor, e nunca os dois. Puro; quem chama passa o
// que leu do banco.
import { ObjectId } from 'mongodb'
import { normalizeSectorMode, sectorReadiness } from './sectors.js'
import type { SectorReadinessInput } from './sectors.js'

export interface DestinationChoice {
  agentId: ObjectId | null
  sectorId: ObjectId | null
}

export type DestinationError =
  | 'destination_required'
  | 'destination_conflict'
  | 'invalid_agent'
  | 'invalid_sector'
  | 'sector_not_executable'
  | 'sector_archived'

export interface DestinationVerdict {
  ok: boolean
  code?: DestinationError
  /** Uma frase para a tela — o que houve e o que fazer. */
  reason?: string
  destination?: DestinationChoice
}

/** O setor como o validador precisa vê-lo. Vem carregado; este módulo não busca. */
export interface SectorForDestination extends SectorReadinessInput {
  _id: ObjectId
  name: string
  archivedAt?: Date | null
}

/**
 * Decide o destino — ou recusa, dizendo por quê.
 *
 * `agentPresent` e `sector` são o que EXISTE de fato na conta: quem chama já conferiu a
 * posse. Passar um id de outra conta como se fosse válido é o único jeito de furar isto,
 * e é por isso que a resolução de posse acontece antes, no chamador.
 */
export function resolveWidgetDestination(entrada: {
  agentId?: ObjectId | null
  sectorId?: ObjectId | null
  agentPresent?: boolean
  sector?: SectorForDestination | null
}): DestinationVerdict {
  const querAgente = Boolean(entrada.agentId)
  const querSetor = Boolean(entrada.sectorId)

  if (querAgente && querSetor) {
    return {
      ok: false,
      code: 'destination_conflict',
      reason: 'Escolha um agente OU um setor para atender — não os dois.',
    }
  }
  if (!querAgente && !querSetor) {
    return {
      ok: false,
      code: 'destination_required',
      reason: 'Escolha quem vai atender este chat: um agente ou um setor.',
    }
  }

  if (querAgente) {
    if (!entrada.agentPresent) {
      return { ok: false, code: 'invalid_agent', reason: 'Este agente não existe mais nesta conta.' }
    }
    // Trocar de destino LIMPA o outro lado. Sem isto o anterior ficava gravado embaixo,
    // esperando para reaparecer numa edição futura.
    return { ok: true, destination: { agentId: entrada.agentId!, sectorId: null } }
  }

  const setor = entrada.sector
  if (!setor) {
    return { ok: false, code: 'invalid_sector', reason: 'Este setor não existe mais nesta conta.' }
  }
  if (setor.archivedAt) {
    return { ok: false, code: 'sector_archived', reason: `O setor “${setor.name}” está arquivado e não atende.` }
  }

  /**
   * Um setor só atende se ele EXECUTA.
   *
   * "Só organizar" é um agrupamento no mapa — ele não roda nada, e apontar um chat para
   * ele produz exatamente o silêncio que este módulo existe para evitar. O mesmo vale
   * para uma equipe sem coordenador, sem membros ou com etapa sem agente: a verificação
   * é a MESMA que a página do setor usa, para as duas telas nunca discordarem.
   */
  const modo = normalizeSectorMode(setor.mode)
  if (modo === 'organization') {
    return {
      ok: false,
      code: 'sector_not_executable',
      reason: `O setor “${setor.name}” só organiza agentes no mapa — ele não executa. Escolha um setor que trabalha em equipe ou em etapas.`,
    }
  }

  const pronto = sectorReadiness({ ...setor, mode: modo })
  if (!pronto.ready) {
    const primeiro = pronto.issues.find((i) => i.severity === 'blocking')
    return {
      ok: false,
      code: 'sector_not_executable',
      reason: `O setor “${setor.name}” ainda não consegue trabalhar: ${primeiro?.message ?? 'falta configuração'}`,
    }
  }

  return { ok: true, destination: { agentId: null, sectorId: setor._id } }
}
