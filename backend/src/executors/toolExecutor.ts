// Executar uma ação de App ou uma ferramenta da conta — pelo caminho que já existe.
//
// Nada de HTTP aqui. `resolveGrant` já faz a parte difícil e delicada: resolve o App,
// confere que a instalação é DESTE dono, checa status e compatibilidade de versão,
// decifra a credencial e devolve uma ferramenta pronta com `run`. Reimplementar isso
// seria manter dois caminhos com regras de permissão diferentes — e o dia em que eles
// divergissem, um dos dois estaria autorizando o que o outro recusa.
//
// O que este arquivo acrescenta é a tradução: do formato de ferramenta para o
// `ExecutorResult`, com teto de tempo e erro tipado.
import { ObjectId } from 'mongodb'
import { describeErrors, validateAgainstSchema } from '../jsonSchema.js'
import { resolveGrant } from '../apps/grants.js'
import { getToolsByIds } from '../tools.js'
import { executeToolCall } from '../toolExecution.js'
import type { Agent } from '../agents.js'
import type { ResolvedTool } from '../agentTools.js'
import type { ExecutorError, ExecutorResult, ToolExecutorConfig } from './types.js'

/** O teto vale mesmo para o caminho que já tem o seu: dois tetos, o menor manda. */
const TIMEOUT_PADRAO_MS = Number(process.env.EXECUTOR_TOOL_TIMEOUT_MS ?? 30_000)

const falha = (kind: ExecutorError['kind'], message: string, comecou: number, metadata: Record<string, unknown> = {}): ExecutorResult => ({
  ok: false,
  metadata,
  telemetry: { durationMs: Date.now() - comecou, externalCalls: 0 },
  error: { kind, message },
})

function comLimite<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const relogio = setTimeout(() => reject(new Error('__timeout__')), ms)
    promessa.then(
      (v) => {
        clearTimeout(relogio)
        resolve(v)
      },
      (e) => {
        clearTimeout(relogio)
        reject(e)
      },
    )
  })
}

export async function executeAgentTool(
  agent: Agent,
  ownerId: string,
  config: ToolExecutorConfig,
  input: unknown,
): Promise<ExecutorResult> {
  const comecou = Date.now()
  const args = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>

  // --- a ferramenta reutilizável da conta ---------------------------------------------------
  if (config.toolId) {
    // `getToolsByIds` já é escopado por dono: um id de outra conta resolve para nada.
    const [ferramenta] = await getToolsByIds(ownerId, [config.toolId])
    if (!ferramenta) {
      return falha('not_configured', 'A ferramenta configurada não existe mais nesta conta.', comecou, { toolId: config.toolId })
    }
    if (!ferramenta.enabled) {
      return falha('not_configured', `A ferramenta "${ferramenta.name}" está desativada.`, comecou, { tool: ferramenta.name })
    }
    // ATRIBUIR é a permissão: uma ferramenta que não está na lista do agente não é dele.
    if (!(agent.toolIds ?? []).includes(config.toolId)) {
      return falha('not_configured', `A ferramenta "${ferramenta.name}" não está autorizada para este agente.`, comecou, {
        tool: ferramenta.name,
      })
    }

    const v = validateAgainstSchema(ferramenta.inputSchema, args)
    if (!v.valid) return falha('invalid_input', `Entrada fora do contrato: ${describeErrors(v.errors)}`, comecou, { tool: ferramenta.name })

    try {
      // O mecanismo existente: ele já mascara cabeçalho, limita corpo e conta duração.
      const r = await comLimite(executeToolCall(ferramenta, args, { autonomous: true }), TIMEOUT_PADRAO_MS)
      return normalizar(r.ok, r.result, comecou, {
        tool: ferramenta.name,
        // `detail` já vem com segredo mascarado pelo próprio mecanismo.
        status: r.detail.status ?? null,
        request: r.detail.request,
      })
    } catch (erro) {
      return traduzirExcecao(erro, comecou, { tool: ferramenta.name })
    }
  }

  // --- a ação de um App -----------------------------------------------------------------------
  if (!config.appKey || !config.actionKey) {
    return falha('not_configured', 'Este agente não tem uma ferramenta ou ação configurada.', comecou)
  }

  const grant = (agent.appGrants ?? []).find((g) => g.appKey === config.appKey)
  if (!grant) {
    // Sem grant não há execução — e a mensagem não conta o que existe na conta.
    return falha('not_configured', 'Este agente não tem autorização para o App configurado.', comecou, { appKey: config.appKey })
  }
  if (!(grant.actionKeys ?? []).includes(config.actionKey)) {
    return falha('not_configured', 'Esta ação não está autorizada para este agente.', comecou, {
      appKey: config.appKey,
      actionKey: config.actionKey,
    })
  }

  // Aqui mora tudo o que importa: posse da instalação, status, versão e credencial.
  const ferramentas = await resolveGrant(ownerId, grant, { agentId: agent._id })
  const alvo = escolherAcao(ferramentas, config.actionKey)
  if (!alvo) {
    return falha('not_configured', 'A conexão deste App precisa ser revista em Apps.', comecou, {
      appKey: config.appKey,
      actionKey: config.actionKey,
    })
  }

  const v = validateAgainstSchema(alvo.inputSchema, args)
  if (!v.valid) {
    return falha('invalid_input', `Entrada fora do contrato: ${describeErrors(v.errors)}`, comecou, { tool: alvo.name })
  }

  try {
    const r = await comLimite(Promise.resolve(alvo.run(args)), TIMEOUT_PADRAO_MS)
    return normalizar(r.ok, r.result, comecou, { tool: alvo.name, appKey: config.appKey, actionKey: config.actionKey })
  } catch (erro) {
    return traduzirExcecao(erro, comecou, { tool: alvo.name, appKey: config.appKey })
  }
}

/**
 * A ferramenta que corresponde à ação pedida.
 *
 * `resolveGrant` devolve nomes já compostos (o App e a ação), e uma recusa também vem
 * como ferramenta — de propósito, para o modelo saber que a ação não aconteceu. Quando o
 * que volta é uma recusa, ela é executada e a mensagem dela vira o erro.
 */
function escolherAcao(ferramentas: ResolvedTool[], actionKey: string): ResolvedTool | null {
  const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const alvo = normal(actionKey)
  return ferramentas.find((f) => normal(f.name).includes(alvo)) ?? ferramentas[0] ?? null
}

function normalizar(ok: boolean, resultado: string, comecou: number, metadata: Record<string, unknown>): ExecutorResult {
  /**
   * O resultado vem como TEXTO do mecanismo existente. Quando ele é JSON, vira dado; se
   * não for, fica só como texto — em vez de virar um `data` com uma string dentro, que
   * daria a quem consome a impressão de estrutura onde não há.
   */
  let structured: unknown
  try {
    const parsed = JSON.parse(resultado)
    if (parsed && typeof parsed === 'object') structured = parsed
  } catch {
    // Texto puro é uma resposta legítima.
  }

  if (!ok) {
    return {
      ok: false,
      metadata,
      telemetry: { durationMs: Date.now() - comecou, externalCalls: 1 },
      // O mecanismo já mascarou segredo no que devolve; a mensagem vem dele.
      error: { kind: 'tool', message: resultado.slice(0, 300) },
    }
  }

  return {
    ok: true,
    ...(structured !== undefined ? { structured: { data: structured, valid: true, repaired: false } } : {}),
    text: resultado,
    metadata,
    telemetry: { durationMs: Date.now() - comecou, externalCalls: 1 },
  }
}

function traduzirExcecao(erro: unknown, comecou: number, metadata: Record<string, unknown>): ExecutorResult {
  if (erro instanceof Error && erro.message === '__timeout__') {
    return falha('timeout', `A ferramenta passou de ${TIMEOUT_PADRAO_MS}ms e foi interrompida.`, comecou, metadata)
  }
  // Nem stack nem mensagem crua: as duas contam caminho de arquivo e, às vezes, valor.
  console.error('[tool] execução falhou:', erro)
  return falha('tool', 'A ferramenta falhou durante a execução.', comecou, metadata)
}
