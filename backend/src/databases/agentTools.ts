import { ObjectId } from 'mongodb'
import { resolveDatabaseAccess } from './access.js'
import { runQuery, AdapterError } from './adapters.js'
import { listDatasets, listDataStores } from './store.js'
import { QueryDslError } from './queryDsl.js'
import type { Agent } from '../agents.js'

// AS FERRAMENTAS que um agente usa para falar com um Database.
//
// Tipadas e fechadas de propósito. A alternativa — dar ao modelo um console de banco —
// falha de três jeitos ao mesmo tempo: ele escreve um filtro que não é válido, escreve um
// que é válido e devolve a tabela inteira, ou escreve um que apaga. Nenhum desses erros
// aparece como erro; os três aparecem como resposta.
//
// Aqui o modelo escolhe DATASET e FILTRO dentro de uma DSL que o servidor valida contra o
// schema. E a permissão é reconferida imediatamente antes de cada leitura — não na hora de
// montar a lista de ferramentas, porque entre montar e chamar cabe uma revogação.

export interface DatabaseToolContext {
  accountId: string
  agent: Pick<Agent, '_id' | 'ownerId'>
}

interface ResolvedDatabaseTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /**
   * O resultado é TEXTO, como o de toda ferramenta do runtime.
   *
   * JSON serializado, e não um objeto: o dispatcher entrega o retorno ao modelo, e um
   * formato diferente por família de ferramenta obrigaria cada caminho a saber de qual
   * família veio o que está devolvendo.
   */
  run: (args: Record<string, unknown>) => Promise<{ ok: boolean; result: string }>
}

const responder = (ok: boolean, corpo: unknown) => ({ ok, result: JSON.stringify(corpo) })
const recusa = (motivo: string) => responder(false, { error: 'sem_permissao', message: motivo })

/**
 * As ferramentas de database deste agente.
 *
 * A lista é montada com os stores em que ele tem PELO MENOS `discover` — mas cada chamada
 * confere de novo, com a capacidade exata. Listar não concede.
 */
export async function databaseToolsFor(ctx: DatabaseToolContext): Promise<ResolvedDatabaseTool[]> {
  const stores = await listDataStores(ctx.accountId)
  const alcancaveis: { id: string; name: string }[] = []
  for (const store of stores) {
    const d = await resolveDatabaseAccess({ accountId: ctx.accountId, dataStoreId: store._id, agentId: ctx.agent._id, capability: 'discover' })
    if (d.allowed) alcancaveis.push({ id: store._id.toString(), name: store.name })
  }
  if (alcancaveis.length === 0) return []

  const listar: ResolvedDatabaseTool = {
    name: 'database_list_datasets',
    description: `Lista os conjuntos de dados disponíveis em um database. Databases: ${alcancaveis.map((s) => `${s.name} (${s.id})`).join(', ')}`,
    inputSchema: {
      type: 'object',
      properties: { databaseId: { type: 'string', description: 'o id do database' } },
      required: ['databaseId'],
    },
    run: async (args) => {
      const id = String(args.databaseId ?? '')
      if (!ObjectId.isValid(id)) return recusa('database não encontrado')
      const dataStoreId = new ObjectId(id)
      const d = await resolveDatabaseAccess({ accountId: ctx.accountId, dataStoreId, agentId: ctx.agent._id, capability: 'discover' })
      if (!d.allowed) return recusa(d.reason)
      const datasets = await listDatasets(ctx.accountId, dataStoreId)
      return responder(true, {
        datasets: datasets.map((ds) => ({
          key: ds.key,
          name: ds.name,
          mutability: ds.mutability,
          // Os campos consultáveis: sem eles o modelo tenta adivinhar nome de coluna.
          fields: Object.keys((ds.schema.properties ?? {}) as Record<string, unknown>),
        })),
      })
    },
  }

  const consultar: ResolvedDatabaseTool = {
    name: 'database_query',
    description:
      'Consulta registros de um dataset. O filtro usa apenas os campos declarados e os operadores eq, ne, gt, gte, lt, lte, in e contains.',
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'string' },
        datasetKey: { type: 'string' },
        filter: {
          type: 'object',
          description: 'Ex.: {"field":"status","op":"eq","value":"aberto"} ou {"and":[…]}',
        },
        fields: { type: 'array', items: { type: 'string' } },
        sort: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] } } } },
        limit: { type: 'number' },
      },
      required: ['databaseId', 'datasetKey'],
    },
    run: async (args) => {
      const id = String(args.databaseId ?? '')
      if (!ObjectId.isValid(id)) return recusa('database não encontrado')
      const dataStoreId = new ObjectId(id)
      const datasetKey = String(args.datasetKey ?? '')

      /**
       * A permissão é conferida AGORA, com a capacidade exata e o dataset na mão.
       *
       * Entre montar a lista de ferramentas e o modelo decidir chamar cabe uma revogação
       * — e é justamente nesse intervalo que uma permissão retirada precisa valer.
       */
      const d = await resolveDatabaseAccess({ accountId: ctx.accountId, dataStoreId, datasetKey, agentId: ctx.agent._id, capability: 'query' })
      if (!d.allowed) return recusa(d.reason)

      try {
        const r = await runQuery({
          accountId: ctx.accountId,
          dataStoreId,
          datasetKey,
          agentId: ctx.agent._id,
          query: { filter: args.filter ?? null, fields: args.fields ?? null, sort: args.sort ?? null, limit: args.limit },
        })
        return responder(true, {
          rows: r.rows,
          total: r.total,
          // "Quantos existem" e "quantos vieram" são coisas diferentes: sem isto o
          // modelo conclui sobre um recorte achando que viu tudo.
          returned: r.rows.length,
          truncated: r.truncated,
          freshness: r.freshness,
        })
      } catch (erro) {
        // O motivo VOLTA para o modelo: um filtro recusado em silêncio faria ele repetir
        // a mesma consulta errada até acabar o orçamento.
        if (erro instanceof QueryDslError) return responder(false, { error: erro.code, message: erro.message })
        if (erro instanceof AdapterError) return responder(false, { error: erro.code, message: erro.message })
        return responder(false, { error: 'erro', message: 'não foi possível consultar agora' })
      }
    },
  }

  return [listar, consultar]
}
