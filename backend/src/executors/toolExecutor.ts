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
import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { describeErrors, validateAgainstSchema } from '../jsonSchema.js'
import { resolveGrant } from '../apps/grants.js'
import { getToolsByIds } from '../tools.js'
import { getAgentById } from '../agents.js'
import type { Tool } from '../tools.js'
import { executeToolCall } from '../toolExecution.js'
import { activeRuntimeVersion, recordVersionCall } from '../toolVersions.js'
import type { ToolVersion } from '../toolVersions.js'
import { executeRegisteredFunction } from './functionExecutor.js'
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

    /**
     * A VERSÃO publicada decide o runtime — e é aqui que ela entra em vigor.
     *
     * Ferramenta sem versão nenhuma cai direto no caminho HTTP de sempre: é isso que
     * mantém toda ferramenta legada rodando sem migração e sem reconfiguração. Publicar
     * uma versão `http` também não muda nada; o desvio existe só para os runtimes que
     * este arquivo passou a saber executar.
     */
    const versao = await activeRuntimeVersion(ownerId, ferramenta._id)
    if (versao && versao.runtimeKind !== 'http') {
      return executarVersao(agent, ownerId, ferramenta, versao, args, comecou)
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
  return executarAcaoDeApp(agent, ownerId, config.appKey, config.actionKey, args, comecou)
}

/**
 * A ação de um App — o único caminho, venha ela do executor do agente ou de uma versão
 * de ferramenta publicada como `app_action`.
 *
 * Um segundo caminho aqui seria um segundo lugar onde a permissão é decidida, e no dia
 * em que os dois divergissem um estaria autorizando o que o outro recusa.
 */
async function executarAcaoDeApp(
  agent: Agent,
  ownerId: string,
  appKey: string,
  actionKey: string,
  args: Record<string, unknown>,
  comecou: number,
  /** O contrato da versão, quando existe: ele substitui o da ação. */
  inputSchema?: Record<string, unknown> | null,
): Promise<ExecutorResult> {
  const config = { appKey, actionKey }
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

  const v = validateAgainstSchema(inputSchema ?? alvo.inputSchema, args)
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
/**
 * A ação EXATA, e nenhuma outra.
 *
 * O `?? ferramentas[0]` que havia aqui era um estrago esperando acontecer: um agente
 * configurado para `criar_evento` cujo grant mudasse de forma executaria a primeira ação
 * da lista — que pode ser `apagar_evento`. "Quase certo" não existe em execução de ação;
 * ou é a que o dono autorizou, ou é nenhuma.
 *
 * A comparação continua tolerante ao PREFIXO de namespace (`agenda__criar_evento`), porque
 * é assim que o nome chega ao modelo — mas o sufixo tem que bater inteiro.
 */
function escolherAcao(ferramentas: ResolvedTool[], actionKey: string): ResolvedTool | null {
  const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const alvo = normal(actionKey)
  return (
    ferramentas.find((f) => normal(f.name) === alvo) ??
    // O nome namespaced do App: `agenda__criar_evento` para a ação `criar_evento`.
    ferramentas.find((f) => {
      const nome = normal(f.name)
      return nome.endsWith(`__${alvo}`) || nome.endsWith(`_${alvo}`)
    }) ??
    null
  )
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

/**
 * A ferramenta rodando pelo que a VERSÃO diz que ela é.
 *
 * Este é o ponto onde `app_action` e `registered_function` deixam de ser um campo aceito
 * pelo modelo de dados e passam a executar. Nenhum dos dois ganha um mecanismo novo: a
 * ação de App vai pelo mesmo `executarAcaoDeApp` do executor do agente, com grant,
 * instalação e autorização de escrita conferidos onde sempre foram; a função vai pelo
 * mesmo `executeRegisteredFunction`, com o registro do servidor decidindo o que existe.
 *
 * A conferência de permissão acontece AQUI, dentro da chamada — e não na montagem da
 * lista de ferramentas. Entre montar a lista e o modelo decidir chamar cabe uma revogação,
 * e uma permissão conferida cedo demais autoriza um efeito que já não devia acontecer.
 */
async function executarVersao(
  agent: Agent,
  ownerId: string,
  tool: Tool,
  versao: ToolVersion,
  args: Record<string, unknown>,
  comecou: number,
): Promise<ExecutorResult> {
  const base = { tool: tool.name, version: versao.version, runtimeKind: versao.runtimeKind, sha256: versao.sha256 }
  const registrar = (r: ExecutorResult) =>
    recordVersionCall({
      ownerId,
      agentId: agent._id ?? null,
      toolId: tool._id,
      toolName: tool.name,
      version: versao.version,
      runtimeKind: versao.runtimeKind,
      risk: versao.risk,
      sha256: versao.sha256,
      ok: r.ok,
      // Recusada é diferente de falhada: nada saiu daqui, e a auditoria precisa dizer isso.
      status: !r.ok && (r.error?.kind === 'not_configured' || r.error?.kind === 'invalid_input') ? 'refused' : 'executed',
      durationMs: r.telemetry?.durationMs ?? Date.now() - comecou,
    }).catch(() => {})

  const resultado = await (async (): Promise<ExecutorResult> => {
    /**
     * O agente é RELIDO — e a autorização vale a do banco, não a da memória.
     *
     * O documento que chegou até aqui foi carregado no começo da execução. Entre aquele
     * momento e este cabe uma revogação: a ferramenta tirada do agente, o grant do App
     * removido, o próprio agente apagado. Conferir a permissão na montagem da lista
     * autoriza um efeito que já não devia acontecer; por isso a conferência é aqui,
     * imediatamente antes de executar.
     */
    const atual = await getAgentById(ownerId, agent._id)
    if (!atual) return falha('not_configured', 'Este agente não existe mais nesta conta.', comecou, base)
    if (!(atual.toolIds ?? []).includes(tool._id.toString())) {
      return falha('not_configured', `A ferramenta "${tool.name}" não está autorizada para este agente.`, comecou, base)
    }

    const v = validateAgainstSchema(versao.inputSchema, args)
    if (!v.valid) return falha('invalid_input', `Entrada fora do contrato: ${describeErrors(v.errors)}`, comecou, base)

    if (versao.runtimeKind === 'app_action') {
      const { appKey, actionKey } = versao.manifest as { appKey?: string; actionKey?: string }
      if (!appKey || !actionKey) return falha('not_configured', 'Esta versão não diz qual ação de App ela executa.', comecou, base)
      const r = await executarAcaoDeApp(atual, ownerId, appKey, actionKey, args, comecou, versao.inputSchema)
      return { ...r, metadata: { ...r.metadata, ...base } }
    }

    if (versao.runtimeKind === 'registered_function') {
      const m = versao.manifest as { functionName?: string; version?: string; config?: Record<string, unknown> }
      if (!m.functionName) return falha('not_configured', 'Esta versão não diz qual função ela executa.', comecou, base)
      const r = await executeRegisteredFunction(
        { kind: 'function', functionName: m.functionName, ...(m.version ? { version: m.version } : {}), ...(m.config ? { config: m.config } : {}) },
        args,
        { ownerId, agentId: agent._id?.toString() },
      )
      return { ...r, metadata: { ...r.metadata, ...base } }
    }

    /**
     * `code`: passa pelo MESMO portão da publicação, agora com o kill switch pelo hash.
     *
     * Uma versão publicada ontem pode ter sido desligada hoje — e o desligamento vale na
     * execução, não na próxima publicação. Sem provider isolado saudável, isto recusa.
     */
    const { canExecuteCode } = await import('../extensionRuntime/gate.js')
    const portao = await canExecuteCode({ sha256: versao.sha256, version: versao.version })
    if (!portao.ok) return falha('not_configured', portao.message, comecou, base)

    const m = versao.manifest as { runtime?: string; source?: string; capabilities?: { kind: 'app_action' | 'database_query'; target: string }[] }
    if (!m.source) return falha('not_configured', 'Esta versão não tem código para executar.', comecou, base)

    /**
     * As CAPACIDADES declaradas viram bilhetes de curta duração, presos a esta execução.
     *
     * Nenhum segredo atravessa a fronteira: o que vai é um identificador que o broker
     * reconfere no resolvedor canônico antes de qualquer efeito. E o que é emitido aqui é
     * revogado no fim, aconteça o que acontecer — bilhete que sobrevive à execução é
     * chave esquecida na fechadura.
     */
    const { issueHandle, revokeForExecution } = await import('../extensionRuntime/broker.js')
    const chaveDaExecucao = `tool:${tool._id.toString()}:${comecou}`
    const handles: string[] = []
    for (const cap of (m.capabilities ?? []).slice(0, 10)) {
      const { token } = await issueHandle({ ownerId, agentId: agent._id, executionKey: chaveDaExecucao, capability: cap })
      handles.push(token)
    }

    try {
      const { sandboxProvider } = await import('../extensionRuntime/provider.js')
      const r = await sandboxProvider().execute({
        runtime: m.runtime === 'python' ? 'python' : 'javascript',
        artifactRef: `${tool._id.toString()}@${versao.version}`,
        source: m.source,
        /**
         * O hash do CÓDIGO, conferido do outro lado.
         *
         * Não é o mesmo `sha256` da versão: aquele é do manifesto inteiro e amarra a
         * versão à revisão; este amarra o que chegou ao runner ao que saiu daqui. Sem
         * ele, um proxy no meio trocaria o corpo e o runner rodaria outra coisa.
         */
        sha256: createHash('sha256').update(m.source).digest('hex'),
        input: args,
        limits: {
          cpuMs: Number((versao.manifest as { cpuMs?: number }).cpuMs ?? 2_000),
          memoryMb: Number((versao.manifest as { memoryMb?: number }).memoryMb ?? 128),
          pids: 32,
          wallMs: Number((versao.manifest as { wallMs?: number }).wallMs ?? 5_000),
          outputBytes: 64 * 1024,
        },
        capabilityHandles: handles,
        correlationId: chaveDaExecucao,
      })

      if (!r.ok) {
        const tipo = r.error?.kind === 'timeout' ? 'timeout' : r.error?.kind === 'unavailable' ? 'not_configured' : 'tool'
        return {
          ok: false,
          metadata: { ...base, ...(r.metrics ? { metrics: r.metrics } : {}) },
          telemetry: { durationMs: Date.now() - comecou, externalCalls: 1 },
          error: { kind: tipo, message: r.error?.message ?? 'a execução falhou' },
        }
      }
      return {
        ok: true,
        ...(r.output !== undefined && r.output !== null ? { structured: { data: r.output, valid: true, repaired: false } } : {}),
        text: typeof r.output === 'string' ? r.output : JSON.stringify(r.output ?? null),
        metadata: { ...base, ...(r.metrics ? { metrics: r.metrics } : {}) },
        telemetry: { durationMs: Date.now() - comecou, externalCalls: 1 },
      }
    } finally {
      await revokeForExecution(chaveDaExecucao).catch(() => undefined)
    }
  })()

  /**
   * A SAÍDA conferida contra o contrato publicado.
   *
   * Sem isto, `outputSchema` é enfeite: quem instala a versão encadeia o resultado dela
   * confiando numa forma que ninguém verifica, e descobre a diferença quando o passo
   * seguinte lê `undefined`. Recusa não é conferida — ela tem o formato do motivo.
   */
  const verificado = conferirSaida(versao.outputSchema, resultado, comecou, base)
  await registrar(verificado)
  return verificado
}

function conferirSaida(
  schema: Record<string, unknown> | null,
  r: ExecutorResult,
  comecou: number,
  metadata: Record<string, unknown>,
): ExecutorResult {
  if (!schema || !r.ok) return r
  const dados = r.structured?.data ?? (r.text !== undefined ? seguroJson(r.text) : undefined)
  if (dados === undefined) {
    return falha('tool', 'A ferramenta devolveu algo fora do contrato publicado.', comecou, metadata)
  }
  const v = validateAgainstSchema(schema, dados)
  if (!v.valid) {
    return falha('tool', `A saída não bate com o contrato publicado: ${describeErrors(v.errors)}`, comecou, metadata)
  }
  return r
}

function seguroJson(texto: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    return undefined
  }
}
