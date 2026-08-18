// A pergunta com alternativas, em TEXTO — e a resposta curta entendida sem modelo.
//
// Botão não existe em WhatsApp, e-mail, SMS nem na maioria dos canais para onde estas
// conversas vão. Uma interface que só funciona no Playground não é uma interface: é uma
// demonstração. Então a pergunta carrega as alternativas escritas, numeradas, e o
// visitante responde do jeito que quiser — "2", "b", "a segunda" ou a frase inteira.
//
// A leitura da resposta é DETERMINÍSTICA. Mandar "2" para o modelo e torcer para ele
// lembrar do que era a opção 2 gasta uma inferência para adivinhar o que já está escrito
// — e erra justamente quando a conversa é longa e o contexto ficou para trás.

/** Rótulos na ordem em que aparecem: 1/a, 2/b, 3/c… */
const LETRAS = 'abcdefghijklmnopqrstuvwxyz'

const semAcento = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/**
 * As alternativas, escritas embaixo da pergunta.
 *
 * Numeradas E com letra porque cada canal tem seu costume, e aceitar os dois custa uma
 * linha. A instrução final existe para quem não percebeu que pode responder com o número.
 */
export function formatOptions(options: string[]): string {
  const limpas = options.map((o) => o.trim()).filter(Boolean).slice(0, 9)
  if (limpas.length === 0) return ''
  const linhas = limpas.map((o, i) => `${i + 1}) ${o}`)
  return `\n\n${linhas.join('\n')}\n\nResponda com o número da opção — ou escreva sua resposta, se nenhuma servir.`
}

/**
 * Qual alternativa o visitante escolheu, se escolheu alguma.
 *
 * Aceita o número ("2", "2)", "opção 2"), a letra ("b", "B)"), o texto exato e o texto
 * sem acento/maiúscula. `null` quando a resposta é outra coisa — e aí ela vale como
 * resposta livre, que é o certo: quem escreveu uma frase inteira não quis escolher da
 * lista.
 */
export function resolveChoice(resposta: string, options: string[]): string | null {
  const limpas = options.map((o) => o.trim()).filter(Boolean).slice(0, 9)
  if (limpas.length === 0) return null
  const bruta = resposta.trim()
  if (!bruta) return null

  // Número: "2", "2)", "2.", "opção 2", "alternativa 2".
  const numero = bruta.match(/^(?:op[çc][ãa]o\s*|alternativa\s*|n[º°]?\s*)?(\d{1,2})\s*[).:-]?$/i)
  if (numero) {
    const indice = Number(numero[1]) - 1
    return limpas[indice] ?? null
  }

  // Letra: "b", "B)", "letra b".
  const letra = bruta.match(/^(?:letra\s*)?([a-z])\s*[).:-]?$/i)
  if (letra) {
    const indice = LETRAS.indexOf(letra[1].toLowerCase())
    return indice >= 0 ? (limpas[indice] ?? null) : null
  }

  // O texto da própria opção, com ou sem acento e maiúscula.
  const alvo = semAcento(bruta)
  const exata = limpas.find((o) => semAcento(o) === alvo)
  if (exata) return exata

  // Uma resposta curta que é claramente uma das opções ("enviamos" para "A que
  // enviamos"). Só quando UMA bate: com duas, escolher seria adivinhar.
  if (alvo.length >= 3) {
    const parciais = limpas.filter((o) => semAcento(o).includes(alvo))
    if (parciais.length === 1) return parciais[0]
  }
  return null
}
