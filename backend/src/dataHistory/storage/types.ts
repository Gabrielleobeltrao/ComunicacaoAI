import type { ObjectId } from 'mongodb'
import type { AggregationOp, DataHistoryRecord, DataRecorderDefinition } from '../types.js'
import type { RangeQuery } from '../store.js'

/**
 * ONDE um histórico é guardado.
 *
 * Hoje só existe um destino: o banco interno. A abstração existe mesmo assim porque a
 * pergunta "onde isso fica" é de quem configura, não de quem programa — e quando o
 * segundo destino aparecer (um Postgres da conta, uma planilha, um bucket), o motor não
 * pode precisar mudar. Ele já não sabe o que é uma coleção do Mongo: ele pede ao
 * adapter para gravar e para ler.
 *
 * O que um adapter futuro NUNCA recebe é segredo. A credencial de um Postgres da conta
 * vive onde toda credencial vive — cifrada, na instalação do App —, e o recorder guarda
 * só a referência (`connectionId`). Uma senha em texto claro dentro de uma definição de
 * histórico apareceria em tela, em log e em prévia.
 */

export interface StorageTarget {
  kind: string
  /** A conexão que dá acesso ao destino externo. `internal` não usa nenhuma. */
  connectionId?: string | null
}

/** O resultado de uma gravação, do ponto de vista de quem chamou. */
export type ResultadoDaGravacao = 'gravado' | 'repetido' | 'cota'

export interface HistoryStorageAdapter {
  /** O `kind` que a configuração usa. Único entre os adapters registrados. */
  readonly kind: string
  /** O nome que aparece na tela. */
  readonly label: string

  /**
   * Grava um registro — no máximo uma vez, e nunca acima da cota.
   *
   * As duas garantias são do ADAPTER, e não de quem chama: um destino que não souber
   * deduplicar precisa resolver isso do jeito dele. O motor só sabe o resultado.
   */
  gravar(doc: Omit<DataHistoryRecord, '_id'>, teto?: number): Promise<ResultadoDaGravacao>

  // --- leitura ---------------------------------------------------------------
  // Também no adapter, e não só a escrita: um histórico guardado fora daqui precisa
  // responder as mesmas perguntas, senão a tela e as tools quebrariam ao mudar o
  // destino — que é exatamente o que esta abstração existe para evitar.

  listar(ownerId: string, q: RangeQuery): Promise<DataHistoryRecord[]>
  contar(ownerId: string, q: RangeQuery): Promise<number>
  ultimo(ownerId: string, recorderId: ObjectId, entityKey: string | null, recordKind?: RangeQuery['recordKind']): Promise<DataHistoryRecord | null>
  agregar(ownerId: string, q: RangeQuery, regras: { from: string; op: AggregationOp; to: string }[]): Promise<Record<string, unknown>>
  chaves(ownerId: string, recorderId: ObjectId, limite?: number): Promise<unknown[]>
  /** Apagar o histórico de um recorder — chamado quando a regra é removida. */
  apagarTudo(ownerId: string, recorderId: ObjectId): Promise<void>
}

/** A parte do recorder que decide o destino. Só isto — nada de configuração de regra. */
export type ComDestino = Pick<DataRecorderDefinition, 'storage'>
