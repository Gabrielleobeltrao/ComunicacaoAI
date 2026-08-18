// O veredito de escopo, lembrado.
//
// A checagem de escopo é barata — uma chamada ao modelo auxiliar, 50 tokens, esforço
// baixo — mas ela acontece em TODA mensagem de um agente com guardrail ligado. Num canal
// movimentado, "bom dia", "obrigado" e a mesma pergunta fora de assunto repetida por
// pessoas diferentes pagam a mesma checagem centenas de vezes por dia para chegar sempre
// à mesma conclusão.
//
// Guardar o veredito por agente resolve isso sem risco: a pergunta "isto está no escopo
// deste agente?" depende do objetivo do agente e do texto — e os dois são os mesmos.
//
// Em memória e com prazo, de propósito: o objetivo do agente muda, e um veredito eterno
// sobreviveria à mudança dizendo que "cardápio" está fora do escopo de um restaurante que
// acabou de virar restaurante.

const TTL_MS = 30 * 60_000
const MAX_ENTRADAS = 500

interface Entrada {
  inScope: boolean
  expiraEm: number
}

const cache = new Map<string, Entrada>()

const normalizar = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)

/**
 * A chave inclui o AGENTE: a mesma pergunta está no escopo de um e fora do de outro, e
 * misturar os dois faria o cache responder pelo agente errado.
 */
const chaveDe = (agentId: string, mensagem: string): string => `${agentId}|${normalizar(mensagem)}`

export function rememberedScope(agentId: string, mensagem: string, agora = Date.now()): boolean | null {
  const entrada = cache.get(chaveDe(agentId, mensagem))
  if (!entrada) return null
  if (entrada.expiraEm <= agora) {
    cache.delete(chaveDe(agentId, mensagem))
    return null
  }
  return entrada.inScope
}

export function rememberScope(agentId: string, mensagem: string, inScope: boolean, agora = Date.now()): void {
  // Teto simples: quando enche, o mais antigo sai. Um cache que cresce sem limite é um
  // vazamento com outro nome.
  if (cache.size >= MAX_ENTRADAS) {
    const primeiro = cache.keys().next()
    if (!primeiro.done) cache.delete(primeiro.value)
  }
  cache.set(chaveDe(agentId, mensagem), { inScope, expiraEm: agora + TTL_MS })
}

/** Para os testes e para quando o objetivo do agente muda. */
export function forgetScope(agentId?: string): void {
  if (!agentId) {
    cache.clear()
    return
  }
  for (const chave of [...cache.keys()]) if (chave.startsWith(`${agentId}|`)) cache.delete(chave)
}
