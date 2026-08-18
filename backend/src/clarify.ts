// Perguntar, em vez de responder — quando responder seria chutar.
//
// Não é uma regra sobre volume. É sobre INCERTEZA QUE MUDA A RESPOSTA, e ela aparece de
// várias formas: "a proposta" pode ser a que enviamos ou a que recebemos; um nome pode
// ser de duas pessoas na mesma conta; "no último mês" pode ser trinta dias ou o mês
// fechado; um pedido pode ter critérios que se contradizem. Busca ampla demais é só o
// caso mais fácil de perceber.
//
// Sem esta ferramenta o modelo faz a única coisa que sabe: escolhe um dos sentidos e
// responde com a confiança de quem sabia. Quem lê não tem como perceber que houve uma
// escolha — e ela foi feita por sorteio.
//
// O contrapeso está escrito na descrição da ferramenta, e importa tanto quanto: perguntar
// por tudo é tão ruim quanto chutar. Uma pergunta, a que mais restringe, e só quando o
// que ela resolve muda a resposta.
//
// Aqui há um caminho explícito para o outro comportamento: dizer "é amplo demais, e é ISTO
// que eu preciso saber". Duas coisas mudam com isso.
//
// Numa conversa, a pergunta vira a resposta — e o histórico continua, então a próxima
// mensagem do visitante é lida com tudo que veio antes.
//
// Numa DELEGAÇÃO, é o que faltava: hoje o especialista só sabe devolver texto, e o
// coordenador recebe "aqui estão 40 itens" sem saber que aquilo é o começo de 2000. Com a
// ferramenta, ele recebe `needs_clarification` com a pergunta pronta e decide: pergunta ao
// visitante, ou responde sozinho se já souber o recorte.
import type { ResolvedTool } from './agentTools.js'

export const CLARIFY_TOOL_NAME = 'pedir_esclarecimento'

/** O que o agente precisa saber antes de continuar. */
export interface ClarificationRequest {
  question: string
  /** Por que perguntar é melhor que responder agora — em uma frase. */
  reason: string
  /** Recortes concretos que resolveriam a dúvida, quando existirem. */
  options?: string[]
}

const j = (v: unknown): string => JSON.stringify(v)

/**
 * A ferramenta.
 *
 * `risk: 'read'` porque ela não muda nada: registra uma intenção. É o que permite usá-la
 * no Playground, onde as ferramentas de escrita ficam bloqueadas — e perguntar é
 * justamente o que se quer poder testar.
 */
export function clarifyTool(): ResolvedTool {
  return {
    name: CLARIFY_TOOL_NAME,
    description:
      'Use quando responder AGORA seria chutar, e uma pergunta curta resolveria. Serve para qualquer incerteza que muda a resposta, não só para busca ampla:\n' +
      '- o pedido tem dois sentidos possíveis e cada um leva a uma resposta diferente ("a proposta" — a que enviamos ou a que recebemos?);\n' +
      '- um nome, termo ou identificador pode se referir a mais de uma coisa nesta conta;\n' +
      '- falta um recorte que muda tudo: período, pessoa, produto, canal, moeda, unidade;\n' +
      '- o pedido tem critérios que se contradizem, ou pressupõe algo que você não confirmou;\n' +
      '- uma busca voltou ampla demais para caber numa resposta útil.\n' +
      'NÃO use quando der para responder razoavelmente com o que você já tem, nem para confirmar o óbvio — perguntar por tudo é tão ruim quanto chutar. ' +
      'Faça UMA pergunta, a que mais restringe. Quando existirem alternativas concretas, ofereça-as: escolher é mais rápido que redigir.',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        pergunta: { type: 'string', description: 'a pergunta a fazer a quem pediu — uma só, direta' },
        motivo: { type: 'string', description: 'por que responder agora seria chutar (ex: "1.842 resultados no período")' },
        opcoes: {
          type: 'array',
          items: { type: 'string' },
          description: 'recortes concretos que resolveriam a dúvida (ex: "últimos 7 dias", "só BBSE3")',
        },
      },
      required: ['pergunta', 'motivo'],
      additionalProperties: false,
    },
    run: async (args: Record<string, unknown>) => {
      const pergunta = typeof args.pergunta === 'string' ? args.pergunta.trim() : ''
      const motivo = typeof args.motivo === 'string' ? args.motivo.trim() : ''
      if (!pergunta) return { ok: false, result: j({ status: 'error', reason: 'pergunta é obrigatória' }) }
      const opcoes = Array.isArray(args.opcoes)
        ? args.opcoes.filter((o): o is string => typeof o === 'string' && o.trim().length > 0).slice(0, 6)
        : []
      // O retorno instrui o próprio modelo sobre o que fazer em seguida: sem isso ele
      // tende a chamar a ferramenta e responder assim mesmo, que é o pior dos dois mundos.
      return {
        ok: true,
        result: j({
          status: 'clarification_requested',
          pergunta,
          motivo,
          ...(opcoes.length ? { opcoes } : {}),
          instrucao: 'Responda AGORA com essa pergunta, e nada mais. Não tente responder ao pedido original.',
        }),
      }
    },
  }
}

/**
 * O pedido de esclarecimento que aconteceu nesta execução, se houve.
 *
 * Lido das chamadas de ferramenta, e não de um campo à parte: quem decide perguntar é o
 * modelo, no meio do próprio raciocínio, e a chamada é o registro disso. A ÚLTIMA vale —
 * se ele refinou a pergunta, é a refinada que interessa.
 */
export function clarificationFrom(
  toolCalls: { name: string; arguments: Record<string, unknown>; ok: boolean }[] | undefined,
): ClarificationRequest | null {
  const chamadas = (toolCalls ?? []).filter((c) => c.name === CLARIFY_TOOL_NAME && c.ok)
  const ultima = chamadas[chamadas.length - 1]
  if (!ultima) return null
  const pergunta = typeof ultima.arguments?.pergunta === 'string' ? ultima.arguments.pergunta.trim() : ''
  if (!pergunta) return null
  const opcoes = Array.isArray(ultima.arguments?.opcoes)
    ? (ultima.arguments.opcoes as unknown[]).filter((o): o is string => typeof o === 'string').slice(0, 6)
    : []
  return {
    question: pergunta,
    reason: typeof ultima.arguments?.motivo === 'string' ? ultima.arguments.motivo.trim() : '',
    ...(opcoes.length ? { options: opcoes } : {}),
  }
}
