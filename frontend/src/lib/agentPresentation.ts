import { papelDe } from './agentRoles'
import { MEMORY_LABELS } from './agentLabels'
import type { AgentSummary } from './types'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// A short "role" line for an agent — its model, or the provider as a fallback.
/**
 * A FUNÇÃO do agente — o que ele é, não em que motor ele roda.
 *
 * Isto devolvia o modelo (ou o nome do provedor), e a tela mostrava "Função: Anthropic".
 * Provedor não é função: quem abre a visão geral quer saber o que o agente faz na
 * operação, e "Anthropic" não responde nada disso. O modelo continua visível, na linha
 * dele.
 *
 * A frase escrita pelo dono manda; sem ela, o cargo do tipo escolhido na contratação.
 */
export function roleLabelOf(agent: AgentSummary): string {
  const escrita = (agent.role ?? '').trim()
  if (escrita) return escrita.slice(0, 120)
  return papelDe(agent.preset)?.cargo ?? '—'
}

/**
 * O CARGO — sempre, e separado do que o dono escreveu.
 *
 * `roleLabelOf` prefere a frase do dono, e é isso que se quer numa descrição. Mas a frase
 * SUBSTITUÍA o cargo: um agente com "analisa contratos de fornecedores" escrito deixava de
 * mostrar em lugar nenhum que ele é um Analista — e "Analista" não é enfeite, é a regra
 * que decide se ele busca na base, se entra num plano com dependência e o que ele pode
 * fazer sozinho. Quem lê o card ficava sem a informação que mais muda o comportamento.
 *
 * Os dois passam a conviver: o cargo como etiqueta, a frase como descrição.
 */
export function presetLabelOf(agent: Pick<AgentSummary, 'preset'>): string {
  return papelDe(agent.preset)?.cargo ?? 'Personalizado'
}

/** O VERBO do papel — o que ele faz, em uma palavra. Para onde não cabe uma frase. */
export function presetVerbOf(agent: Pick<AgentSummary, 'preset'>): string {
  return papelDe(agent.preset)?.verbo ?? 'Executa'
}

/**
 * A descrição SEM repetir o cargo que já está na etiqueta ao lado.
 *
 * O texto padrão de cada molde começa pelo próprio cargo — "Pesquisador: encontra e resume
 * informação". Com a etiqueta "Pesquisador" ao lado, a tela mostra a palavra duas vezes
 * seguidas, e a segunda não acrescenta nada.
 *
 * Só o prefixo que COINCIDE com o cargo sai. Uma descrição escrita à mão que por acaso
 * comece com outra palavra seguida de dois-pontos é preservada inteira: ela é do dono.
 */
export function roleDescriptionOf(agent: AgentSummary): string {
  const texto = roleLabelOf(agent)
  const cargo = presetLabelOf(agent)
  const prefixo = `${cargo}:`
  return texto.toLowerCase().startsWith(prefixo.toLowerCase()) ? texto.slice(prefixo.length).trim() : texto
}

// Skill tags derived from what the agent can actually do. Tolerant of older
// agent documents that predate the tools/builtinTools fields.
export function skillsOf(agent: AgentSummary): string[] {
  return Array.from(
    new Set([
      ...(agent.tools ?? []).map((t) => t.name),
      ...(agent.builtinTools ?? []).map((t) => cap(t.key)),
      ...(agent.memoryType && agent.memoryType !== 'none' ? [MEMORY_LABELS[agent.memoryType]] : []),
      ...(agent.handoffEnabled ? ['Atendimento humano'] : []),
      ...(agent.structuredOutputEnabled ? ['Dados estruturados'] : []),
    ]),
  ).slice(0, 8)
}
