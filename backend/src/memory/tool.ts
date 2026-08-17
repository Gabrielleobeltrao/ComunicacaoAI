// `buscar_memoria`: a ferramenta que o agente chama quando precisa lembrar.
//
// A alternativa óbvia — injetar a memória no prompt — é a errada por três razões, e
// todas aparecem no primeiro mês de uso:
//
//   custo: mil registros viram mil registros de contexto em TODA mensagem, mesmo nas
//   que não têm nada a ver com eles;
//   limite: a janela acaba, e o que é cortado é escolhido por tamanho, não por
//   relevância — some justamente o registro que importava;
//   ruído: um modelo com quinhentos pedidos antigos na frente responde pior sobre o
//   pedido de agora.
//
// Buscar sob demanda inverte isso: o agente pergunta o que precisa, quando precisa,
// e recebe um punhado de registros. A busca é textual e determinística — nenhuma
// segunda chamada de modelo escondida aqui dentro.
import { ObjectId } from 'mongodb'
import type { ResolvedTool } from '../agentTools.js'
import { scopesForAgent } from './access.js'
import { searchMemory } from './records.js'

export const MEMORY_TOOL_NAME = 'buscar_memoria'

// Quantos registros voltam por consulta. Baixo de propósito: o valor de buscar sob
// demanda evapora se cada busca devolver o banco inteiro de volta para o prompt.
const LIMITE_PADRAO = 10
const LIMITE_MAXIMO = 25

export function memorySearchTool(ownerId: string, agentId: ObjectId): ResolvedTool {
  return {
    name: MEMORY_TOOL_NAME,
    // Consultar memória não altera nada: pode ir em paralelo com outras leituras.
    risk: 'read',
    description:
      'Busca informações guardadas na memória (do próprio agente, dos setores em que ele trabalha, do andar e do prédio). ' +
      'Use para lembrar de algo específico — um pedido, um cliente, uma decisão anterior. ' +
      'A busca é por texto: informe o que procura. Não devolve tudo, devolve o que casar.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'O que procurar. Ex.: o nome do cliente, o número do pedido.' },
        key: { type: 'string', description: 'Opcional: a chave exata do registro, se você souber.' },
        escopo: {
          type: 'string',
          enum: ['agent', 'sector', 'floor', 'building'],
          description: 'Opcional: onde procurar. Sem isto, procura em tudo que este agente pode ver.',
        },
        limite: { type: 'number', description: `Quantos registros trazer (máx. ${LIMITE_MAXIMO}).` },
      },
      required: [],
    },
    run: async (args) => {
      // A lista de alvos é montada AQUI, a partir de quem o agente é. O modelo pode
      // pedir um escopo, mas só consegue estreitar o que já lhe é permitido — nunca
      // alcançar a memória particular de outro agente ou de um setor de que não
      // participa.
      const permitidos = await scopesForAgent(ownerId, agentId)
      const escopoPedido = typeof args.escopo === 'string' ? args.escopo : null
      const alvos = (escopoPedido ? permitidos.filter((e) => e.scope === escopoPedido) : permitidos).map((e) => e.scopeKey)

      if (alvos.length === 0) {
        return { ok: true, result: JSON.stringify({ total: 0, itens: [], nota: 'não há memória acessível neste escopo' }) }
      }

      const limite = Math.min(typeof args.limite === 'number' && args.limite > 0 ? args.limite : LIMITE_PADRAO, LIMITE_MAXIMO)
      const { items, total } = await searchMemory({
        tenantId: ownerId,
        scopeKeys: alvos,
        query: typeof args.query === 'string' ? args.query : null,
        key: typeof args.key === 'string' ? args.key : null,
        limit: limite,
      })

      return {
        ok: true,
        result: JSON.stringify({
          total,
          mostrando: items.length,
          itens: items.map((i) => ({
            chave: i.key,
            conteudo: i.payload,
            origem: i.sourceType,
            escopo: i.scope,
            em: i.createdAt,
          })),
          // O modelo precisa saber que viu uma parte, senão responde "não existe"
          // sobre algo que só não coube na página.
          ...(total > items.length ? { nota: `há ${total} registros; refine a busca para ver os demais` } : {}),
        }),
      }
    },
  }
}
