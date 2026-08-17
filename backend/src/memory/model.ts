// O vocabulário da memória, sem banco.
//
// Escopos e estratégias são parte do CONTRATO, não do armazenamento: o validador de
// definições precisa deles, e ele roda sem banco nenhum. Deixá-los em `records.ts`
// arrastava o `db` para dentro de todo módulo que só quisesse conferir um nome.

export type MemoryScope = 'agent' | 'sector' | 'floor' | 'building'
export const MEMORY_SCOPES: readonly MemoryScope[] = ['agent', 'sector', 'floor', 'building']
export const isMemoryScope = (v: unknown): v is MemoryScope => typeof v === 'string' && (MEMORY_SCOPES as readonly string[]).includes(v)

/**
 * Como gravar quando já existe algo com a mesma chave.
 *
 * `append` guarda histórico: cada evento vira um registro. É o certo para "os
 * pedidos que chegaram" — apagar o anterior perderia o pedido de ontem.
 *
 * `upsert` mantém UM registro por chave e MISTURA os campos novos nos antigos. É o
 * certo para um cadastro que chega em pedaços: o evento que traz só o telefone não
 * pode apagar o e-mail que veio antes.
 *
 * `replace` mantém um registro por chave e TROCA o conteúdo inteiro. É o certo para
 * um estado atual — o preço de hoje, o status do pedido — onde o valor antigo não é
 * parte do novo.
 */
export type MemoryStrategy = 'append' | 'upsert' | 'replace'
export const MEMORY_STRATEGIES: readonly MemoryStrategy[] = ['append', 'upsert', 'replace']
export const isMemoryStrategy = (v: unknown): v is MemoryStrategy =>
  typeof v === 'string' && (MEMORY_STRATEGIES as readonly string[]).includes(v)

export class MemoryError extends Error {}

// --- limites -----------------------------------------------------------------------------
//
// Um webhook público recebe o que mandarem. Sem teto, um remetente distraído — ou
// mal-intencionado — enche a coleção com um payload de dezenas de megabytes por
// evento. Os números são folgados para uso real e apertados para abuso.
export const MAX_KEY_LENGTH = 200
export const MAX_PAYLOAD_BYTES = 64 * 1024
export const MAX_METADATA_BYTES = 4 * 1024
export const MAX_PAGE_SIZE = 100
// O texto de busca é um espelho do conteúdo, não uma cópia dele: o registro inteiro
// continua no `payload`. Cortar aqui evita duplicar 64 KB por registro no índice.
export const MAX_SEARCH_TEXT = 8 * 1024
