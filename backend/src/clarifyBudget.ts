// Quantas vezes é razoável perguntar antes de simplesmente responder.
//
// Dar a um agente o direito de pedir esclarecimento cria um modo de falha novo: perguntar,
// receber, e perguntar de novo. Do outro lado isso não parece cuidado — parece que ninguém
// está trabalhando. E é pior que chutar, porque custa uma inferência por rodada e não
// entrega nada.
//
// O teto não proíbe pensar; ele obriga a decidir. Ao atingi-lo, a saída deixa de ser "não
// sei o suficiente" e passa a ser "assumi ISTO, e estou dizendo que assumi" — que é o que
// uma pessoa competente faz quando a pergunta já foi feita e o assunto precisa andar.
//
// Puro: conta e devolve texto. Sem banco, sem modelo.

/** Depois disto, responder com a suposição declarada vale mais que perguntar de novo. */
export const CLARIFY_LIMIT = 2

/**
 * A orientação que entra no prompt quando já houve pergunta nesta conversa.
 *
 * `null` enquanto ainda cabe perguntar — nada é dito, e o modelo decide como decidiria.
 */
export function clarificationGuidance(jaPerguntou: number, limite = CLARIFY_LIMIT): string | null {
  if (jaPerguntou <= 0) return null
  if (jaPerguntou < limite) {
    return (
      `Você já pediu esclarecimento ${jaPerguntou}x nesta conversa. ` +
      'Só pergunte de novo se a dúvida for OUTRA e mudar a resposta; repetir a mesma pergunta com outras palavras não ajuda ninguém.'
    )
  }
  return (
    `Você já pediu esclarecimento ${jaPerguntou}x nesta conversa e não deve pedir mais. ` +
    'Responda agora com o que tem, DECLARANDO a suposição que você escolheu — por exemplo "assumindo os últimos 30 dias: ...". ' +
    'Uma resposta com a premissa dita é útil; mais uma pergunta, não.'
  )
}

/** O orçamento acabou? É o que a ferramenta consulta antes de aceitar mais uma pergunta. */
export const clarifyBudgetSpent = (jaPerguntou: number, limite = CLARIFY_LIMIT): boolean => jaPerguntou >= limite
