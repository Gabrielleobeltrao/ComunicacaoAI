// Turning a grant into something the model can call.
//
// The rule the whole file exists to enforce: an agent reaches an App ONLY through a
// grant, the grant names the installation and the exact actions, the installation is
// resolved with `{ ownerId, _id }`, and the credential is injected here — never in an
// argument the model can see, and never read from the agent document.
//
// When anything is missing (installation revoked, action not granted, write not
// authorised) the model gets a STRUCTURED refusal rather than a missing tool, so it
// tells the user instead of inventing an outcome.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import type { Agent } from '../agents.js'
import type { ResolvedTool } from '../agentTools.js'
import { missingCapability } from '../agentTools.js'
import { validateAgainstSchema } from '../jsonSchema.js'
import { executeToolCall } from '../toolExecution.js'
import type { ExecutableTool } from '../toolExecution.js'
import { getApp } from './registry.js'
import { OFFICIAL_ADAPTERS } from './official/index.js'
import { isUsableManifest, resolveAppForOwner } from './privateApps.js'
import { isUsableApp } from './types.js'
import type { AppDefinition, AppActionDefinition, AppInstallation, AgentAppGrant, NativeFactory } from './types.js'
import { decryptInstallationConfig, getInstallation, isInstallationUsable } from './installations.js'
import { ACTION_DETAIL_KEY, ensureAppActionIndexes, recordActionEvent, takeActionDetail } from './actionEvents.js'
import type { AppActionEvent } from './actionEvents.js'

// Reexportados: eram exportados daqui antes da separação, e quem os importa continua
// importando do mesmo lugar.
export { ensureAppActionIndexes, countActionsSince } from './actionEvents.js'
export type { AppActionEvent } from './actionEvents.js'

// An installed version is pinned. A manifest whose MAJOR moved changed the meaning
// of its actions or its permissions, so it needs the owner to review, not a silent
// upgrade (plan §10).
export const isVersionCompatible = (installed: string, current: string): boolean =>
  String(installed).split('.')[0] === String(current).split('.')[0]
import { environmentOf } from './connectionProfile.js'

/**
 * Os adapters que uma ação nativa pode apontar.
 *
 * Antes era um mapa escrito à mão aqui. O problema não era o mapa, era ele ser uma
 * SEGUNDA lista da mesma verdade, em outro arquivo: dava para adicionar um App e
 * esquecer o adapter, e o sintoma aparecia como "configuração incompleta" quando
 * alguém tentava usar a ação. Agora cada módulo de App exporta o que tem, e a
 * incoerência é detectada no arranque — ver apps/official/index.ts.
 *
 * Continua sendo uma lista de permissão: um manifesto não pode acrescentar entrada
 * nenhuma, `execution.adapter` só escolhe entre o que já está compilado.
 */
const NATIVE_FACTORIES: Record<string, NativeFactory[]> = OFFICIAL_ADAPTERS

// A tool that exists only to refuse, and to say why. The model sees the action, so
// it can report the limitation instead of pretending the App is not there.
function refusalTool(action: { key: string; description: string }, reason: string, detail?: string): ResolvedTool {
  return {
    name: action.key,
    description: action.description,
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
    run: async () => missingCapability(action.key, reason, detail),
  }
}

const interpolate = (template: string, auth: Record<string, string>, resource: Record<string, string>): string =>
  template
    .replace(/\{\{\s*auth\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => auth[key] ?? '')
    .replace(/\{\{\s*resource\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => resource[key] ?? '')

// A declarative action becomes an ExecutableTool and runs through the SAME executor
// as a Custom Tool: SSRF guard, domain allow list, timeout, response cap, masking.
function declarativeTool(
  app: AppDefinition,
  action: AppActionDefinition,
  auth: Record<string, string>,
  resource: Record<string, string>,
  autonomousWrite: boolean,
): ResolvedTool {
  const execution = action.execution as Extract<AppActionDefinition['execution'], { kind: 'http' }>
  const executable: ExecutableTool = {
    name: action.key,
    description: action.description,
    method: execution.method,
    url: interpolate(execution.url, auth, resource),
    headers: (execution.headers ?? []).map((h) => ({ key: h.key, value: interpolate(h.value, auth, resource) })),
    inputSchema: action.inputSchema,
    bodyTemplate: execution.bodyTemplate ? interpolate(execution.bodyTemplate, auth, resource) : null,
    auth: { kind: 'none' },
    timeoutMs: action.timeoutMs ?? 8_000,
    maxResponseChars: action.maxResponseChars ?? 4_000,
    allowedDomains: app.allowedDomains,
    maxCallsPerRun: action.maxCallsPerRun ?? 5,
    // The owner authorises a write per ACTION, on the grant — the manifest never
    // grants itself permission to act.
    allowAutonomousExecution: autonomousWrite,
    enabled: true,
  } as ExecutableTool
  let callsSoFar = 0
  return {
    name: action.key,
    description: action.description,
    inputSchema: action.inputSchema,
    run: async (args) => {
      // Every header of an App action may carry a credential, whatever it is called.
      const outcome = await executeToolCall(executable, args, { callsSoFar, autonomous: true, allHeadersAreSecret: true })
      callsSoFar++
      return { ok: outcome.ok, result: outcome.result }
    },
  }
}

// Resolve ONE grant into the tools it authorises.
export async function resolveGrant(
  ownerId: string,
  grant: AgentAppGrant,
  options: {
    agentId?: ObjectId | null
    /**
     * De qual EXECUÇÃO estas ferramentas são.
     *
     * Viaja até o adapter e nunca até o modelo: é dele que sai a chave de idempotência
     * de uma ordem. Com uma chave nova a cada tentativa, um retry manda a segunda ordem;
     * com uma chave derivada da execução, o retry pergunta pela primeira.
     *
     * Ausente é legítimo — playground e chamada direta não têm execução — e aí a chave
     * é aleatória, que é o comportamento de antes.
     */
    executionRef?: string | null
  } = {},
): Promise<ResolvedTool[]> {
  // System first, then the owner's own private Apps. A manifest that no longer
  // validates resolves to nothing rather than to a weaker execution path.
  const app = await resolveAppForOwner(ownerId, grant.appKey)
  if (!app || !isUsableManifest(app)) return []

  // App marcado como "em breve" não executa, nem por um grant que já existia. A recusa
  // é estruturada de propósito: o modelo precisa saber que a ação NÃO aconteceu, em vez
  // de receber uma ferramenta ausente e concluir o que quiser.
  if (!isUsableApp(app)) {
    const granted = app.actions.filter((a) => (grant.actionKeys ?? []).includes(a.key))
    return granted.map((a) => refusalTool(a, 'app_em_breve', `${app.name} ainda não está disponível. Ele aparece no catálogo como "Em breve".`))
  }

  const granted = app.actions.filter((a) => (grant.actionKeys ?? []).includes(a.key))
  if (granted.length === 0) return []

  const id = ObjectId.isValid(grant.installationId) ? new ObjectId(grant.installationId) : null
  // Owner scoping is in the query: an id from another account resolves to nothing.
  const installation = id ? await getInstallation(ownerId, id) : null

  if (!installation) {
    return granted.map((a) => refusalTool(a, 'conexao_ausente', `Conecte o App ${app.name} em Apps e autorize este agente.`))
  }
  if (!isInstallationUsable(installation)) {
    const reason = installation.status === 'needs_reauth' ? 'conexao_expirada' : 'conexao_revogada'
    return granted.map((a) => refusalTool(a, reason, `A conexão "${installation.name}" precisa ser reconectada em Apps.`))
  }
  if (!isVersionCompatible(installation.appVersion, app.version)) {
    return granted.map((a) =>
      refusalTool(a, 'versao_incompativel', `A conexão "${installation.name}" precisa ser revisada em Apps antes de voltar a ser usada.`),
    )
  }

  const auth = decryptInstallationConfig(installation)
  const resource = grant.resourceConfig ?? {}
  const autonomous = new Set(grant.autonomousWriteActionKeys ?? [])

  const tools: ResolvedTool[] = []
  for (const action of granted) {
    const allowedToAct = action.risk === 'read' || autonomous.has(action.key)
    const built = buildAction(app, action, ownerId, auth, resource, allowedToAct, {
      environment: environmentOf(installation),
      installationId: installation._id.toString(),
      // Quem responde pela ação. É por ele que uma política mais apertada pode valer
      // só para um agente.
      agentId: options.agentId?.toString() ?? null,
      executionRef: options.executionRef ?? null,
    })
    if (!built) continue
    // O risco declarado no manifesto viaja com a ferramenta. Ele não amplia nada — o
    // grant continua sendo a permissão — mas é o que permite decidir paralelismo.
    tools.push(
      instrument(
        { ...built, risk: action.risk },
        {
          ownerId,
          agentId: options.agentId ?? null,
          appKey: app.key,
          actionKey: action.key,
          installationId: installation._id,
          environment: environmentOf(installation),
          outputSchema: action.outputSchema,
        },
      ),
    )
  }
  return tools
}

function buildAction(
  app: AppDefinition,
  action: AppActionDefinition,
  ownerId: string,
  auth: Record<string, string>,
  resource: Record<string, string>,
  allowedToAct: boolean,
  // Vem da instalação, nunca de um campo digitado: é o ambiente que decide se a ordem
  // vai para a simulação ou para o mercado.
  ctx?: { environment: string; installationId: string; agentId?: string | null; executionRef?: string | null },
): ResolvedTool | null {
  if (action.execution.kind === 'http') {
    return declarativeTool(app, action, auth, resource, allowedToAct)
  }
  // Native: the credential and the non-secret selection are merged HERE and handed
  // to the compiled adapter. The model never sees either.
  const adapter = action.execution.adapter
  const factories = NATIVE_FACTORIES[app.key] ?? []
  const config = { ...auth, ...resource }
  for (const factory of factories) {
    const tool = factory(ownerId, config, ctx).find((t) => t.name === adapter)
    if (!tool) continue
    if (!allowedToAct) {
      return refusalTool(
        action,
        'autorizacao_necessaria',
        `Esta ação altera dados. Autorize "${action.name}" para uso autônomo nas permissões do agente.`,
      )
    }
    return tool
  }
  // The adapter refused to build (missing resource selection, e.g. no spreadsheet).
  return refusalTool(action, 'configuracao_incompleta', `Complete a configuração de ${app.name} nas permissões deste agente.`)
}

// Wrap a tool so every call leaves a safe trace.
function instrument(
  tool: ResolvedTool,
  meta: {
    ownerId: string
    agentId: ObjectId | null
    appKey: string
    actionKey: string
    installationId: ObjectId
    environment?: string
    outputSchema?: Record<string, unknown>
  },
): ResolvedTool {
  return {
    ...tool,
    run: async (args) => {
      const started = Date.now()
      // A chave por CHAMADA: é por ela que o adapter conta o que aconteceu sem devolver
      // isso ao modelo nem escrever no banco por conta própria.
      const chamada = `${meta.installationId.toString()}:${meta.actionKey}:${started}:${Math.random().toString(36).slice(2, 8)}`
      const outcome = await tool.run({ ...args, [ACTION_DETAIL_KEY]: chamada })
      const detalhe = takeActionDetail(chamada)
      /**
       * A saída é conferida contra o que a ação PROMETEU devolver.
       *
       * Sem isto, `outputSchema` é documentação: um planner encadeia duas ações
       * confiando na forma da primeira, e descobre que ela mudou quando o segundo passo
       * lê `undefined`. Falhar aqui é dizer a verdade — a ação aconteceu, e o contrato
       * dela não bate.
       */
      const verificado = validarSaida(meta.outputSchema, outcome)
      await recordActionEvent({
        ownerId: meta.ownerId,
        agentId: meta.agentId,
        appKey: meta.appKey,
        actionKey: meta.actionKey,
        installationId: meta.installationId,
        ok: outcome.ok,
        // A refusal is not a failed call to somebody's API — it never left here.
        status: outcome.result.includes('"capability_unavailable"') ? 'refused' : 'executed',
        durationMs: Date.now() - started,
        createdAt: new Date(),
        ...(meta.environment ? { environment: meta.environment } : {}),
        // O que a ação produziu, no nível de metadado: o id da ordem e o veredito da
        // política. Nunca argumento, nunca corpo, nunca saldo.
        ...(detalhe?.orderId !== undefined ? { orderId: detalhe.orderId } : {}),
        ...(detalhe?.policy !== undefined ? { policy: detalhe.policy } : {}),
      } as Omit<AppActionEvent, '_id' | 'createdAt'>)
      return verificado
    },
  }
}

/**
 * Confere o resultado contra o schema declarado. Sem schema, passa direto.
 *
 * Uma RECUSA (política, permissão, provider) não é conferida: ela tem o formato do
 * motivo, não o da saída — e recusar a recusa esconderia justamente a explicação.
 */
function validarSaida(schema: Record<string, unknown> | undefined, outcome: { ok: boolean; result: string }): { ok: boolean; result: string } {
  if (!schema || !outcome.ok) return outcome
  let dados: unknown
  try {
    dados = JSON.parse(outcome.result)
  } catch {
    return { ok: false, result: JSON.stringify({ status: 'contract_error', reason: 'a ação devolveu algo que não é JSON' }) }
  }
  const r = validateAgainstSchema(schema, dados)
  if (r.valid) return outcome
  return {
    ok: false,
    result: JSON.stringify({
      status: 'contract_error',
      reason: 'a saída da ação não bate com o contrato declarado',
      // O caminho do campo, e não o valor: o valor pode ser saldo.
      fields: r.errors.slice(0, 5).map((e) => e.path || '(raiz)'),
    }),
  }
}

export async function resolveAppGrantTools(agent: Agent, ownerId: string): Promise<ResolvedTool[]> {
  const grants = agent.appGrants ?? []
  if (grants.length === 0) return []
  const resolved = await Promise.all(grants.map((grant) => resolveGrant(ownerId, grant, { agentId: agent._id })))
  return resolved.flat()
}
