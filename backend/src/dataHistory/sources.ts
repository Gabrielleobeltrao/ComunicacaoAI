import { ObjectId } from 'mongodb'
import { ValidationError } from '../building.js'
import { EVENT_TYPES } from '../events/types.js'
import { listInstallations } from '../apps/installations.js'
import type { DataSourceDefinition } from './types.js'

/**
 * De onde o dado pode vir — e a prova de que aquela fonte é MESMO desta conta.
 *
 * A referência chega do cliente, e um id que chega do cliente não vale nada até ser
 * conferido com o dono no filtro. Sem isto, alguém poderia apontar um histórico para a
 * conexão de outra conta e ler, pelo próprio histórico, o dado que ela recebe.
 */

/** Uma opção para a tela: o que a pessoa lê, e o que o servidor guarda. */
export interface SourceOption {
  ref: string
  label: string
  hint?: string
}

export interface SourceCatalog {
  live_data: SourceOption[]
  event: SourceOption[]
}

/**
 * O catálogo do dono.
 *
 * Conexões vêm das instalações do App de WebSocket — só as desta conta, com o nome que
 * a pessoa deu. Os tipos de evento são os do barramento, que são fixos e do sistema:
 * não há id de ninguém neles, e por isso a lista é a mesma para todo mundo.
 */
export async function catalogoDeFontes(ownerId: string): Promise<SourceCatalog> {
  const instalacoes = await listInstallations(ownerId, 'websocket')
  return {
    live_data: instalacoes
      // Revogada não entra: apontar um histórico para uma conexão que não existe mais
      // criaria uma regra que nunca vai receber nada.
      .filter((i) => i.status !== 'revoked')
      .map((i) => ({ ref: i._id.toString(), label: i.name, hint: i.status === 'connected' ? 'Conexão de WebSocket' : 'Precisa ser reconectada' })),
    event: EVENT_TYPES.map((t) => ({ ref: t, label: t, hint: rotuloDoEvento(t) })),
  }
}

/** O que aquele evento é, em uma linha, para quem nunca leu o código do barramento. */
function rotuloDoEvento(tipo: string): string {
  if (tipo.startsWith('market.')) return 'Mercado'
  if (tipo.startsWith('trade.')) return 'Ordens e posições'
  if (tipo.startsWith('integration.')) return 'Integrações'
  return 'Sistema'
}

/**
 * A fonte existe e é desta conta?
 *
 * `live_data` aponta para uma instalação: conferida com o dono no filtro. `event` é um
 * tipo do barramento: ele precisa EXISTIR, senão o histórico nasce mudo e ninguém
 * descobre por quê. `manual` é nome livre — quem publica ali é código desta conta, e o
 * dono já vem do contexto de execução.
 */
export async function conferirFonte(ownerId: string, source: DataSourceDefinition): Promise<void> {
  if (source.kind === 'live_data') {
    if (!ObjectId.isValid(source.ref)) throw new ValidationError('fonte: escolha uma conexão da lista.')
    const [instalacao] = await listInstallations(ownerId, 'websocket').then((l) => l.filter((i) => i._id.toString() === source.ref))
    if (!instalacao) throw new ValidationError('fonte: essa conexão não existe nesta conta.')
    return
  }
  if (source.kind === 'event') {
    if (!EVENT_TYPES.includes(source.ref as (typeof EVENT_TYPES)[number])) {
      throw new ValidationError(`fonte: "${source.ref}" não é um evento conhecido do sistema.`)
    }
    return
  }
  // `manual`: nome livre, e o dono vem de quem chama `recordFact`.
  if (!/^[A-Za-z0-9_.:-]{1,60}$/.test(source.ref)) {
    throw new ValidationError('fonte: use letras, números, ponto, traço ou sublinhado — até 60 caracteres.')
  }
}
