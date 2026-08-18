// "Isto é comigo?" — decidido uma vez, antes de gastar qualquer coisa.
//
// Um sistema de restaurante perguntado sobre a previsão do tempo não deve pagar por uma
// resposta. Ele já não pagava no chat e no canal de agente único — havia o guardrail —,
// mas pagava no SETOR: a pergunta fora de assunto acordava o coordenador, que podia
// delegar, e o time inteiro trabalhava para dizer "não sei disso". A execução mais cara
// era a única sem porteiro.
//
// Aqui está o porteiro, um só para os três caminhos. Ele responde antes da busca de
// conhecimento e antes de qualquer inferência principal — e o veredito fica lembrado,
// porque "e o tempo?" chega o dia inteiro e a resposta é sempre a mesma.
import type { ChatTurn } from './systemPrompt.js'
import { rememberScope, rememberedScope } from './scopeCache.js'

export interface ScopeVerdict {
  inScope: boolean
  /** Houve chamada ao modelo? `false` quando o veredito veio da lembrança. */
  checked: boolean
}

/**
 * O escopo é do AGENTE que responde — ou do setor, quando é um time.
 *
 * `verificar` é injetado para este módulo não conhecer provedor nenhum, e para o teste
 * poder contar quantas vezes o modelo foi chamado, que é o número que importa aqui.
 */
export async function checkScope(opts: {
  scopeId: string
  objective: string
  history: ChatTurn[]
  message: string
  verificar: () => Promise<boolean>
}): Promise<ScopeVerdict> {
  const lembrado = rememberedScope(opts.scopeId, opts.message)
  if (lembrado !== null) return { inScope: lembrado, checked: false }

  try {
    const inScope = await opts.verificar()
    rememberScope(opts.scopeId, opts.message, inScope)
    return { inScope, checked: true }
  } catch {
    // Falha do porteiro NÃO fecha a porta: recusar por causa de um erro de rede seria
    // negar atendimento a quem perguntou algo legítimo. Deixa passar e não lembra.
    return { inScope: true, checked: true }
  }
}
