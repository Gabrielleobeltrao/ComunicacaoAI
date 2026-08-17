// Executar uma ação de App a partir de uma etapa, sem passar por modelo nenhum.
//
// O ponto central: **não existe executor paralelo aqui**. A etapa resolve o grant do
// agente pelo mesmo `resolveGrant` que monta as ferramentas do modelo, e chama o
// mesmo `run`. Com isso vêm de graça, e sem cópia, a instalação resolvida por
// `{ownerId, _id}`, a credencial descriptografada fora do alcance de qualquer
// argumento, a autorização de escrita, a validação de schema, os limites, a proteção
// de SSRF e a telemetria.
//
// Um segundo executor "só para automações" seria a forma mais rápida de perder uma
// dessas garantias sem ninguém notar.
import { ObjectId } from 'mongodb'
import { getAgentById } from '../agents.js'
import { readPath } from '../automations/conditions.js'
import { resolveGrant } from './grants.js'

export class AppStepError extends Error {}

/**
 * Resolve `{{campo}}` nos argumentos contra o que a etapa anterior produziu.
 *
 * Só substitui quando o valor é EXATAMENTE um template (`"{{candles}}"`), e aí
 * devolve o valor original — não a serialização dele. É o que permite passar uma
 * lista de quinhentos candles adiante sem transformá-la em string.
 */
export function resolveArgs(args: Record<string, unknown>, valor: unknown): Record<string, unknown> {
  const fora: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (typeof v !== 'string') {
      fora[k] = v
      continue
    }
    const inteiro = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(v)
    if (inteiro) {
      const lido = readPath(valor, inteiro[1])
      if (lido !== undefined) fora[k] = lido
      continue
    }
    // Template no meio de um texto: aí a interpolação é textual mesmo.
    fora[k] = v.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, caminho: string) => {
      const lido = readPath(valor, caminho)
      return lido === null || lido === undefined ? '' : typeof lido === 'string' ? lido : JSON.stringify(lido)
    })
  }
  return fora
}

export interface AppStepContext {
  ownerId: string
}

/**
 * Roda a ação e devolve o resultado como objeto, pronto para ser lido por uma
 * condição, gravado na memória, entregue ou entregue a um agente.
 *
 * Uma RECUSA da camada de Apps — conexão revogada, ação não concedida, escrita não
 * autorizada — falha a etapa. Deixar passar como se fosse resultado faria o fluxo
 * seguir gravando e entregando algo que nunca aconteceu.
 */
export async function executeAppStep(cfg: Record<string, unknown>, valor: unknown, ctx: AppStepContext): Promise<unknown> {
  const appKey = typeof cfg.appKey === 'string' ? cfg.appKey.trim() : ''
  const actionKey = typeof cfg.actionKey === 'string' ? cfg.actionKey.trim() : ''
  const donoBruto = typeof cfg.ownerAgentId === 'string' ? cfg.ownerAgentId.trim() : ''
  if (!appKey || !actionKey) throw new AppStepError('a etapa de App precisa do App e da ação')
  if (!ObjectId.isValid(donoBruto)) throw new AppStepError('a etapa de App não declara o agente responsável')

  // A permissão é do AGENTE, sempre. Um gatilho não ganha acesso a um App por estar
  // na mesma conta: ele age com o que foi concedido ao agente dele.
  const agent = await getAgentById(ctx.ownerId, new ObjectId(donoBruto))
  if (!agent) throw new AppStepError('o agente responsável por esta etapa não existe mais')

  const grant = (agent.appGrants ?? []).find((g) => g.appKey === appKey)
  if (!grant) throw new AppStepError(`o agente não tem permissão para o App ${appKey}`)
  if (!(grant.actionKeys ?? []).includes(actionKey)) {
    throw new AppStepError(`a ação ${actionKey} não está concedida a este agente`)
  }

  // Restringir o grant a UMA ação faz `resolveGrant` devolver exatamente a ferramenta
  // pedida — sem precisar adivinhar o nome dela, que depende do adapter.
  const tools = await resolveGrant(ctx.ownerId, { ...grant, actionKeys: [actionKey] }, { agentId: agent._id })
  const tool = tools[0]
  if (!tool) throw new AppStepError(`a ação ${actionKey} não está disponível nesta instalação`)

  const args = resolveArgs((typeof cfg.args === 'object' && cfg.args !== null ? cfg.args : {}) as Record<string, unknown>, valor)
  const outcome = await tool.run(args)

  let dados: unknown
  try {
    dados = JSON.parse(outcome.result)
  } catch {
    // Ação que devolve texto puro: entrega como está, num campo nomeado, para uma
    // condição ainda poder olhar para ele.
    dados = { texto: outcome.result }
  }

  if (!outcome.ok) {
    const motivo =
      typeof dados === 'object' && dados !== null && typeof (dados as Record<string, unknown>).reason === 'string'
        ? String((dados as Record<string, unknown>).reason)
        : 'a ação não pôde ser executada'
    throw new AppStepError(`${appKey}/${actionKey}: ${motivo}`)
  }

  return dados
}
