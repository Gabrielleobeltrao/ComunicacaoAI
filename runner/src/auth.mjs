import { createHmac, timingSafeEqual } from 'node:crypto'

// A AUTENTICAÇÃO entre backend e runner — de serviço, nunca de navegador.
//
// Não existe sessão aqui: quem fala com o runner é o backend, e a prova disso é uma
// assinatura sobre o corpo inteiro com um segredo compartilhado. Cookie de browser seria
// a coisa errada em dois sentidos — ele viaja sozinho (CSRF) e ele identifica uma pessoa,
// quando o que precisa ser identificado é um serviço.
//
// Assinatura sozinha não basta: uma requisição capturada poderia ser reenviada para
// repetir um efeito. Por isso a janela de tempo e o nonce usado uma vez.

/** Fora desta janela, a requisição é velha demais para ser considerada. */
export const MAX_SKEW_MS = 60_000

const vistos = new Map()

/** Nonces expiram junto com a janela: guardar para sempre seria um vazamento de memória. */
function limpar(agora) {
  for (const [nonce, quando] of vistos) {
    if (agora - quando > MAX_SKEW_MS * 2) vistos.delete(nonce)
  }
}

export function sign(secret, { timestamp, nonce, body }) {
  return createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex')
}

const iguais = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  // Comprimentos diferentes vazam pelo próprio `timingSafeEqual`, que lança — a
  // comparação de tamanho vem antes, e é constante para o que interessa.
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Confere assinatura, janela e nonce. Devolve o motivo, nunca o que estava errado no
 * detalhe: dizer "assinatura inválida" e "nonce repetido" com mensagens diferentes já
 * ensina quem está tentando.
 */
export function verify(secret, headers, body, agora = Date.now()) {
  const timestamp = Number(headers['x-sandbox-timestamp'])
  const nonce = String(headers['x-sandbox-nonce'] ?? '')
  const assinatura = String(headers['x-sandbox-signature'] ?? '')

  if (!Number.isFinite(timestamp) || !nonce || !assinatura) return { ok: false, reason: 'unauthorized' }
  if (Math.abs(agora - timestamp) > MAX_SKEW_MS) return { ok: false, reason: 'unauthorized' }

  limpar(agora)
  if (vistos.has(nonce)) return { ok: false, reason: 'unauthorized' }
  if (!iguais(assinatura, sign(secret, { timestamp, nonce, body }))) return { ok: false, reason: 'unauthorized' }

  vistos.set(nonce, agora)
  return { ok: true }
}

export function __resetNonces() {
  vistos.clear()
}
