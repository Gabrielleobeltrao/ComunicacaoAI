import { ValidationError } from '../../building.js'
import { internalStorage } from './internal.js'
import type { ComDestino, HistoryStorageAdapter, StorageTarget } from './types.js'

export type { HistoryStorageAdapter, StorageTarget, ResultadoDaGravacao } from './types.js'

/**
 * Os destinos que este servidor sabe usar.
 *
 * Um mapa, e não uma cadeia de `if`: acrescentar um destino é registrar um adapter
 * aqui, e nada mais. O motor, as rotas, as tools e a tela leem desta lista — então um
 * adapter novo aparece nos três lugares de uma vez, sem que nenhum deles saiba o que é
 * um Postgres ou um bucket.
 *
 * Para adicionar um destino no futuro:
 *   1. escreva o adapter implementando `HistoryStorageAdapter` (gravar + as cinco
 *      leituras), guardando a credencial FORA da definição — só a referência da
 *      conexão entra no recorder;
 *   2. registre-o aqui;
 *   3. confira a posse da conexão em `conferirDestino`, como a fonte já faz.
 * Nada em `engine.ts` muda.
 */
const ADAPTERS = new Map<string, HistoryStorageAdapter>([[internalStorage.kind, internalStorage]])

export const STORAGE_KINDS = (): string[] => [...ADAPTERS.keys()]

/** Os destinos disponíveis, para a tela oferecer. */
export const destinosDisponiveis = (): { kind: string; label: string }[] => [...ADAPTERS.values()].map((a) => ({ kind: a.kind, label: a.label }))

export const DESTINO_PADRAO: StorageTarget = { kind: internalStorage.kind, connectionId: null }

/**
 * O adapter deste recorder.
 *
 * Um recorder gravado ANTES de `storage` existir não tem o campo — e ele sempre gravou
 * no banco interno, então é isso que ele continua fazendo. Ler ausente como interno é a
 * leitura verdadeira daqueles documentos, e evita uma migração para dizer o que já era.
 */
export function adapterDe(recorder: ComDestino): HistoryStorageAdapter {
  const kind = recorder.storage?.kind ?? internalStorage.kind
  const adapter = ADAPTERS.get(kind)
  // Um destino que este servidor não conhece não vira "grava no interno em silêncio":
  // isso mandaria o dado para um lugar que ninguém pediu.
  if (!adapter) throw new ValidationError(`destino de armazenamento desconhecido: "${kind}".`)
  return adapter
}

/**
 * O destino, normalizado — ou a recusa com o motivo.
 *
 * `internal` não aceita conexão: oferecer um campo que não é usado faria alguém
 * preenchê-lo achando que estava configurando alguma coisa.
 */
export function normalizarDestino(bruto: unknown): StorageTarget {
  const s = (bruto ?? {}) as Record<string, unknown>
  const kind = String(s.kind ?? internalStorage.kind)
  if (!ADAPTERS.has(kind)) throw new ValidationError(`destino: "${kind}" não está disponível neste servidor.`)
  const connectionId = s.connectionId ? String(s.connectionId) : null
  if (kind === internalStorage.kind && connectionId) throw new ValidationError('destino: o banco interno não usa conexão.')
  return { kind, connectionId }
}
