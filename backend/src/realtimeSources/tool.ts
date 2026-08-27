import { ObjectId } from 'mongodb'
import { esperarFonte, lerFonte, resolverPorAlias } from './reader.js'
import { fontesDoAgente } from './repository.js'
import type { ResolvedTool } from '../agentTools.js'

/**
 * A ferramenta EMBUTIDA — a mesma leitura, agora na mão de um agente de LLM.
 *
 * Ela existe ao lado da função registrada (que os agentes de código usam) e as duas
 * chamam o MESMO leitor: o que o modelo vê é exatamente o que o código veria. Duas
 * implementações divergiriam na primeira mudança.
 *
 * O que ela não faz, e é o ponto: não despeja tique nenhum no contexto. O modelo
 * consulta quando precisa, uma resposta por vez. Mandar cada atualização de preço para
 * dentro do prompt custaria uma fortuna e afogaria a conversa.
 */
export const REALTIME_TOOL_NAME = 'consultar_tempo_real'

export function realtimeSourceTool(ownerId: string, agentId: ObjectId): ResolvedTool {
  return {
    name: REALTIME_TOOL_NAME,
    // Leitura: pode ir em paralelo com outras leituras.
    risk: 'read',
    description:
      'Consulta o valor de AGORA de uma fonte de dados em tempo real que você recebeu. ' +
      'Informe o nome da fonte (ex.: btc_price). Sem nome, lista as fontes disponíveis. ' +
      'A resposta diz há quanto tempo o dado chegou e se ele está velho — não trate um valor velho como atual.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'O nome da fonte, ex.: btc_price. Em branco, lista as que existem.' },
      },
      required: [],
    },
    run: async (args) => {
      const alias = String(args.source ?? '').trim()

      if (!alias) {
        const lista = await fontesDoAgente(ownerId, agentId)
        if (!lista.length) return { ok: true, result: JSON.stringify({ sources: [], aviso: 'nenhuma fonte em tempo real foi concedida a este agente.' }) }
        return { ok: true, result: JSON.stringify({ sources: lista.map((f) => ({ source: f.alias, descricao: f.name, chave: f.key })) }) }
      }

      const fonte = await resolverPorAlias(ownerId, agentId, alias)
      // Recusa explícita, e não uma resposta vazia: "não existe" e "existe e está sem
      // dado" são coisas diferentes, e o modelo precisa distinguir as duas.
      if (!fonte) {
        const lista = await fontesDoAgente(ownerId, agentId)
        return {
          ok: false,
          result: JSON.stringify({
            executed: false,
            motivo: `a fonte "${alias}" não está disponível para este agente.`,
            disponiveis: lista.map((f) => f.alias),
          }),
        }
      }
      return { ok: true, result: JSON.stringify(await lerFonte(fonte)) }
    },
  }
}

/** A espera, para quem precisa reagir a uma condição em vez de perguntar em laço. */
export function realtimeWaitTool(ownerId: string, agentId: ObjectId): ResolvedTool {
  return {
    name: 'esperar_tempo_real',
    risk: 'read',
    description:
      'Espera até que uma fonte em tempo real satisfaça uma condição, ou até o tempo acabar. ' +
      'Use quando precisar reagir a uma mudança — não fique consultando em laço.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'O nome da fonte, ex.: btc_price.' },
        path: { type: 'string', description: 'O campo a observar, ex.: price.' },
        operator: { type: 'string', enum: ['exists', 'equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'contains', 'changed'] },
        value: { description: 'O valor a comparar. Não usado com "exists" e "changed".' },
        timeoutSeconds: { type: 'number', description: 'Quanto esperar, no máximo.' },
      },
      required: ['source', 'path', 'operator'],
    },
    run: async (args) => {
      const fonte = await resolverPorAlias(ownerId, agentId, String(args.source ?? ''))
      if (!fonte) return { ok: false, result: JSON.stringify({ executed: false, motivo: `a fonte "${String(args.source ?? '')}" não está disponível para este agente.` }) }
      const segundos = Math.min(Math.max(1, Number(args.timeoutSeconds ?? 8)), 8)
      const r = await esperarFonte(
        fonte,
        { path: String(args.path ?? ''), operator: String(args.operator ?? 'exists'), value: args.value },
        segundos * 1000,
      )
      return { ok: true, result: JSON.stringify(r) }
    },
  }
}
