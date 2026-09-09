// Dois freios pequenos para as rotas que gastam: ritmo por dono e uma rodada por
// projeto de cada vez.
//
// ponytail: contadores em memória, por instância. Com várias instâncias o teto real
// vira N×teto — o que ainda impede o laço acidental, que é o caso que acontece. Se
// isso passar a importar, o mesmo contrato sai daqui para o Mongo com um TTL.

const janelas = new Map<string, { ate: number; usos: number }>()

/** `true` quando ainda cabe. Janela deslizante simples, por dono. */
export function allowRate(ownerId: string, limite: number, janelaMs: number, agora = Date.now()): boolean {
  const atual = janelas.get(ownerId)
  if (!atual || atual.ate <= agora) {
    janelas.set(ownerId, { ate: agora + janelaMs, usos: 1 })
    return true
  }
  if (atual.usos >= limite) return false
  atual.usos += 1
  return true
}

const emAndamento = new Set<string>()

/**
 * Uma rodada por projeto. Dois cliques no botão de enviar viram uma chamada só —
 * cobrada uma vez — em vez de duas propostas competindo pelo mesmo documento.
 */
export async function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  if (emAndamento.has(projectId)) throw new Error('já existe uma resposta sendo preparada para este projeto')
  emAndamento.add(projectId)
  try {
    return await fn()
  } finally {
    emAndamento.delete(projectId)
  }
}

/** Só para os testes: zera o estado entre casos. */
export function resetGuards(): void {
  janelas.clear()
  emAndamento.clear()
}
