import type { StreamAdapter } from './types.js'

/**
 * O mapa de adapters de stream, e nada mais.
 *
 * Fica num módulo próprio para poder ser lido por quem monta o catálogo de Apps sem
 * arrastar junto a camada de serviço — que importa conexão, instalação e, por tabela, o
 * próprio catálogo. O ciclo funcionava por sorte de ordem de import; um módulo sem
 * dependência nenhuma não depende de sorte.
 */
const adapters = new Map<string, StreamAdapter>()

export function registerStreamAdapter(adapter: StreamAdapter): void {
  adapters.set(adapter.appKey, adapter)
}

export const streamAdapters = (): Map<string, StreamAdapter> => adapters
export const clearStreamAdapters = (): void => adapters.clear()
export const hasStreamAdapter = (appKey: string): boolean => adapters.has(appKey)
