import type { Collection, Document } from 'mongodb'

// O ÍNDICE DE PRAZO, quando o prazo MUDA.
//
// `createIndex` não altera um índice que já existe: ele compara as opções e, se elas diferem,
// recusa com `IndexOptionsConflict` (código 85). Para um índice comum isso é irrelevante —
// ninguém muda a chave. Para um TTL é o contrário: mudar o prazo é justamente o que se faz.
//
// O efeito de ignorar isso é silencioso e caro. A retenção de `token_usage_charges` foi de 30
// para 45 dias no código, e o banco continuou apagando aos 30 — enquanto o comentário logo
// acima da chamada explicava que a janela precisa ser maior que um mês, senão uma linha some
// antes de ser somada no relatório. O erro aparecia como um stack trace gigante a cada
// arranque, que é exatamente o formato que ninguém lê.
//
// `collMod` é o comando que o MongoDB oferece para isso: ele muda `expireAfterSeconds` no
// índice existente, sem derrubá-lo. Derrubar e recriar também funcionaria, e é pior: entre o
// drop e o create a coleção fica sem prazo, e num banco grande a reconstrução leva minutos.

/** O código que o servidor devolve quando o índice existe com outras opções. */
const CONFLITO_DE_OPCOES = 85

export async function ensureTtlIndex<T extends Document>(
  colecao: Collection<T>,
  chave: Record<string, 1 | -1>,
  segundos: number,
  nome?: string,
): Promise<'criado' | 'ajustado'> {
  const opcoes = { expireAfterSeconds: segundos, ...(nome ? { name: nome } : {}) }
  try {
    await colecao.createIndex(chave, opcoes)
    return 'criado'
  } catch (erro) {
    const codigo = (erro as { code?: number; errorResponse?: { code?: number } })?.code ?? (erro as { errorResponse?: { code?: number } })?.errorResponse?.code
    if (codigo !== CONFLITO_DE_OPCOES) throw erro

    /**
     * O índice existe com OUTRO prazo. Qual é o nome dele?
     *
     * Quando quem chama não passou um nome, o Mongo gerou um a partir da chave (`createdAt_1`).
     * Procurar pela chave, e não pelo nome, é o que faz isto funcionar nos dois casos.
     */
    const existentes = await colecao.indexes()
    const alvo = existentes.find((i) => (nome ? i.name === nome : JSON.stringify(i.key) === JSON.stringify(chave)))
    if (!alvo?.name) throw erro

    const { db } = await import('./db.js')
    await db.command({ collMod: colecao.collectionName, index: { name: alvo.name, expireAfterSeconds: segundos } })
    return 'ajustado'
  }
}
