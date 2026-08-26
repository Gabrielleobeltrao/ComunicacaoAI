// Segredo digitado no chat.
//
// Ninguém deveria colar uma chave aqui — mas as pessoas colam, e a conversa é
// guardada. Mascarar na ENTRADA é a única defesa que funciona: depois de gravado,
// o segredo já vazou para o banco, para o backup e para a próxima chamada ao modelo.
//
// O que não dá para fazer é adivinhar tudo. Isto pega os formatos anunciados pelos
// próprios provedores (prefixo fixo + corpo longo), cabeçalhos de autorização e
// atribuições explícitas ("api key = ..."). O resto continua sendo problema de quem
// colou, e por isso a interface avisa onde credencial se configura.

export const SECRET_MASK = '[credencial removida]'

const PADROES: RegExp[] = [
  // Prefixos anunciados: OpenAI (sk-), Anthropic (sk-ant-), GitHub (ghp_/gho_/...),
  // Slack (xox.-), Stripe (sk_live/rk_live), Google (AIza), AWS (AKIA).
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bAIza[A-Za-z0-9_-]{30,}/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  // JWT: três blocos base64url separados por ponto.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // "Authorization: Bearer xxx" e afins.
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  // Atribuição explícita: "senha: xxx", "api_key = xxx", "token=xxx".
  /\b(?:api[_-]?key|apikey|secret|token|senha|password|passwd|client[_-]?secret|access[_-]?token)\b\s*[:=]\s*["']?[^\s"',;]{8,}/gi,
]

/** Devolve o texto com todo padrão óbvio de segredo substituído pela máscara. */
export function maskSecrets(texto: string): string {
  let fora = texto
  for (const padrao of PADROES) fora = fora.replace(padrao, SECRET_MASK)
  return fora
}

/** `true` quando o texto tinha algo que foi mascarado — a tela avisa o dono. */
export const containsSecret = (texto: string): boolean => maskSecrets(texto) !== texto

/**
 * O mesmo, sobre uma estrutura inteira. Usado no blueprint: o modelo pode ecoar no
 * `instructions` de um agente a chave que o dono colou na conversa.
 */
export function maskSecretsDeep<T>(valor: T): T {
  if (typeof valor === 'string') return maskSecrets(valor) as unknown as T
  if (Array.isArray(valor)) return valor.map((v) => maskSecretsDeep(v)) as unknown as T
  if (valor && typeof valor === 'object') {
    const fora: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) fora[k] = maskSecretsDeep(v)
    return fora as T
  }
  return valor
}
