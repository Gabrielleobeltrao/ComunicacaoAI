// "Automático": qual modelo este agente merece.
//
// Antes existia só "Padrão do sistema", que é uma CONSTANTE por provedor — todo agente
// deixado no padrão rodava exatamente o mesmo modelo, o mais caro, inclusive o que só
// reescreve um texto. A tela dizia "padrão" e quem lia entendia "o sistema escolhe"; o
// sistema não escolhia nada.
//
// Aqui a escolha existe, e é uma REGRA, não um palpite: dá para ler, prever e discordar.
// Duas classes, que é o que os provedores realmente oferecem — o modelo principal e o
// auxiliar, barato. A pergunta que a regra responde é uma só: *errar aqui custa caro?*
import type { Agent } from './agents.js'

/** O valor guardado em `agent.model` quando o dono escolhe "Automático". */
export const AUTO_MODEL = 'auto'

export type ModelTier = 'main' | 'aux'

export interface AutoModelChoice {
  tier: ModelTier
  /** Por que esta classe — em uma frase, para a tela mostrar e o dono discordar. */
  reason: string
}

// Por perfil. Quem PLANEJA, DECIDE ou AGE fica no principal; quem transforma texto que
// já existe resolve com o barato.
const POR_PRESET: Record<string, AutoModelChoice> = {
  manager: { tier: 'main', reason: 'coordena e decide a quem delegar' },
  analyst: { tier: 'main', reason: 'precisa raciocinar sobre os dados' },
  researcher: { tier: 'main', reason: 'precisa seguir a fonte e citar de onde tirou' },
  operator: { tier: 'main', reason: 'executa ações reais' },
  communicator: { tier: 'aux', reason: 'reescreve um resultado que já existe' },
  secretary: { tier: 'aux', reason: 'organiza e encaminha' },
  monitor: { tier: 'aux', reason: 'compara e avisa quando muda' },
  // Sem perfil declarado não se sabe o que ele faz — e não saber é motivo para não
  // economizar.
  custom: { tier: 'main', reason: 'perfil personalizado: sem como prever o que ele faz' },
}

/**
 * A classe de modelo para este agente.
 *
 * Só SOBE de classe, nunca desce: um agente que o perfil colocou no principal não é
 * rebaixado por causa de outra configuração. Errar para o lado caro é um custo; errar
 * para o lado barato é uma resposta ruim que ninguém pediu.
 */
export function chooseModelTier(
  agent: Pick<Agent, 'preset' | 'defaultOutputFormat' | 'outputJsonSchema' | 'requireGrounding' | 'runConfig'>,
  // O risco das ferramentas que ele realmente tem em mãos. Ausente = nenhuma.
  toolRisks: ('read' | 'write' | 'high_risk')[] = [],
): AutoModelChoice {
  const base = POR_PRESET[agent.preset ?? 'custom'] ?? POR_PRESET.custom
  if (base.tier === 'main') return base

  // --- os motivos para SUBIR ----------------------------------------------------------
  //
  // Uma ferramenta que escreve: o erro vira e-mail enviado, cobrança feita, pedido
  // criado. Risco desconhecido conta como escrita, como em todo o resto do sistema.
  if (toolRisks.some((r) => (r ?? 'write') !== 'read')) {
    return { tier: 'main', reason: 'tem ferramenta que executa ação real' }
  }
  // Saída com schema: cumprir uma estrutura é exatamente onde o modelo barato falha, e a
  // falha custa a inferência de reparo — que às vezes sai mais cara que a economia.
  if (agent.defaultOutputFormat === 'json' && agent.outputJsonSchema) {
    return { tier: 'main', reason: 'precisa entregar JSON no formato exato' }
  }
  // Quem só pode responder pela base tem que ler a base direito.
  if (agent.requireGrounding) {
    return { tier: 'main', reason: 'só pode responder a partir da base' }
  }
  // O dono pediu raciocínio explicitamente: respeitar isso é o mínimo.
  if (agent.runConfig?.reasoningEffort === 'high') {
    return { tier: 'main', reason: 'o dono pediu esforço de raciocínio alto' }
  }
  return base
}

/**
 * O modelo concreto, dado o que cada provedor chama de principal e de auxiliar.
 *
 * `null` no principal significa "deixa o padrão do adapter decidir" — é o mesmo valor de
 * antes, e é o que preserva o comportamento de quem nunca escolheu nada.
 */
export function resolveAutoModel(
  agent: Pick<Agent, 'preset' | 'defaultOutputFormat' | 'outputJsonSchema' | 'requireGrounding' | 'runConfig'>,
  modelos: { main: string | null; aux: string },
  toolRisks: ('read' | 'write' | 'high_risk')[] = [],
): { model: string | null; tier: ModelTier; reason: string } {
  const escolha = chooseModelTier(agent, toolRisks)
  return {
    model: escolha.tier === 'aux' ? modelos.aux : modelos.main,
    tier: escolha.tier,
    reason: escolha.reason,
  }
}
