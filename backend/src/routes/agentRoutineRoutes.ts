import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { config } from '../config.js'
import { getAgentById, updateAgent, MAX_WATCHED_SOURCES, WATCHED_SOURCE_WHEN, sanitizeToolName, sourceSettingsOf } from '../agents.js'
import type { WatchedSource } from '../agents.js'
import { SOURCE_TOOL_NAME } from '../automations/sourceTool.js'
import {
  createRoutine,
  getRoutineForAgent,
  listAgentAutomations,
  listRoutines,
  readRoutineExecution,
  readSourceFromDefinition,
  RoutineError,
  STEP_SOURCE,
  updateRoutine,
} from '../automations/routine.js'
import type { RoutineSource, RoutineSpec } from '../automations/routine.js'
import { isInitialWindow, normalizeSourceUrl } from '../automations/sourceChange.js'
import { fontesDoAgente } from '../automations/sourceTool.js'
import { isExecutionMode } from '../automations/types.js'
import { normalizeWebSource } from '../webSourcePolicy.js'
import { readWebPage } from '../adaptiveWebReader.js'
import { agentSearchStats } from '../webSearch/budget.js'
import { rendererAtivo } from '../browserRenderer.js'
import { countDocumentsFromSource } from '../knowledge.js'
import { ensureAgentWebKnowledgeFresh } from '../webKnowledge.js'
import type { ExecutionMode } from '../automations/types.js'
import { aiStepPlanned, normalizeAppActionPlan, normalizeMemoryPlan } from '../automations/executionPlan.js'
import type { AppActionPlan, MemoryPlan } from '../automations/executionPlan.js'
import type { StepCondition } from '../automations/conditions.js'
import { previewSource } from '../automations/sourcePreview.js'
import { getCheckpoint } from '../automations/sourceCheckpoint.js'
import { createRun } from '../automations/runService.js'
import {
  createEventTrigger,
  EventTriggerError,
  normalizeCondition,
  readEventTriggerConfig,
  getEventTriggerForAgent,
  listEventTriggers,
  updateEventTrigger,
} from '../automations/eventTrigger.js'
import { webhookEndpoint } from '../automations/executionCenter.js'
import { cronToRecurrence, describeRecurrence, isValidRecurrence } from '../automations/schedule.js'
import { rotateWebhookSecret, setStatus } from '../automations/service.js'
import { listRuns } from '../automations/runRepository.js'
import type { Automation } from '../automations/types.js'
import { listDelegationsForAgent } from '../delegationLog.js'
import { publicDelegationError, publicError } from '../safeError.js'
import { oid } from './http.js'
import { auditEntity } from './auditMiddleware.js'

// Agent ROUTINES + HISTORY. Mounted at /api/agents/:agentId behind requireAuth
// (mergeParams so :agentId is visible). A routine is an agent-owned scheduled
// automation; the history is the runs of that agent's routines. The standalone
// "Automações" surface is gone — everything here lives inside the agent.
export const agentRoutineRouter = Router({ mergeParams: true })

function serializeRoutine(a: Automation) {
  // WHEN it fires is read from the published trigger — the draft is only a fallback
  // for a routine created before that field existed. The rest of the shape comes
  // from the draft, which a routine keeps identical to its published version:
  // createRoutine and updateRoutine always publish immediately.
  const trigger = a.publishedTrigger ?? a.draftDefinition.trigger
  const cron = trigger?.type === 'schedule' ? trigger.cron : ''
  const timezone = trigger?.type === 'schedule' ? trigger.timezone : ''
  const recurrence = cron ? cronToRecurrence(cron) : null
  const definition = a.draftDefinition
  const agentStep = (definition?.steps ?? []).find((s) => s.type === 'agent.execute')
  const config = (agentStep?.config ?? {}) as { input?: unknown; instruction?: unknown; objective?: unknown }
  // Routines written before `input` was stored on its own carry it inside the
  // composed instruction; recover it so the editor never loses what the user typed.
  const legacyInput = typeof config.instruction === 'string' ? config.instruction.split('\n\nEntrada: ')[1] : undefined
  const delivery = (definition?.deliveries ?? [])[0]
  // A fonte de entrada. Rotina antiga não tem etapa de fonte e volta como `fixed`,
  // que é exatamente o que ela sempre foi.
  const source = readSourceFromDefinition(definition)
  // Modo, destino de memória e condição, também lidos da definição.
  const execucao = readRoutineExecution(definition)
  return {
    id: a._id.toString(),
    source,
    executionMode: execucao.executionMode,
    memory: execucao.memory,
    aiCondition: execucao.aiCondition,
    action: execucao.action,
    name: a.name,
    objective: a.description,
    status: a.status,
    timezone,
    cron,
    recurrence,
    scheduleLabel: recurrence ? describeRecurrence(recurrence) : cron,
    // Everything the edit form needs to open already filled in.
    input: typeof config.input === 'string' ? config.input : (legacyInput ?? ''),
    outputFormat: definition?.resultFormat ?? 'markdown',
    delivery: delivery ? { provider: delivery.provider, connectionId: delivery.connectionId.toString() } : null,
    lastPublishedVersion: a.lastPublishedVersion,
    nextRunAt: a.nextRunAt ?? null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

function parseRoutineSpec(body: Record<string, unknown>): { spec?: RoutineSpec; error?: string } {
  const objective = typeof body.objective === 'string' ? body.objective.trim() : ''
  if (!objective) return { error: 'objective is required' }
  if (!isValidRecurrence(body.recurrence)) return { error: 'invalid recurrence' }
  // ABSENT vs null is a real distinction here: an absent `delivery` means "leave the
  // destination as it is" (the editor could not load the connections, so it must not
  // silently drop one), while an explicit null means the user chose "Nenhum".
  const d = body.delivery as { provider?: unknown; connectionId?: unknown } | null | undefined
  const provider = d?.provider
  const delivery = !('delivery' in body)
    ? undefined
    : d && (provider === 'email' || provider === 'telegram') && typeof d.connectionId === 'string' && d.connectionId
      ? { provider: provider as 'email' | 'telegram', connectionId: d.connectionId }
      : null
  const fmt = body.outputFormat
  return {
    spec: {
      name: typeof body.name === 'string' ? body.name.trim() : '',
      objective,
      recurrence: body.recurrence as RoutineSpec['recurrence'],
      timezone: typeof body.timezone === 'string' && body.timezone ? body.timezone : 'America/Sao_Paulo',
      input: typeof body.input === 'string' ? body.input : undefined,
      outputFormat: fmt === 'text' || fmt === 'markdown' || fmt === 'json' ? fmt : undefined,
      delivery,
      retryMaxAttempts: typeof body.retryMaxAttempts === 'number' ? body.retryMaxAttempts : undefined,
      // Ausente = mantém a fonte atual (mesma regra da entrega: um formulário salvo
      // antes de carregar não pode apagar o monitoramento).
      ...('source' in body ? { source: parseSource(body.source) } : {}),
      // Modo, memória e condição seguem a MESMA regra: ausentes, o update preserva o
      // que a rotina já tinha (resolvido em `updateRoutine`).
      ...parseTriggerExtras(body),
    },
  }
}

// A fonte vinda do corpo da requisição. Uma URL que não seja http/https é recusada
// aqui, antes de virar definição — e o safeFetch recusa de novo na hora de buscar.
// As duas checagens existem de propósito: esta dá erro de formulário, aquela impede
// a requisição.
function parseSource(raw: unknown): RoutineSource {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const kind = s.kind
  if (kind !== 'rss' && kind !== 'http') return { kind: 'fixed' }
  const url = typeof s.url === 'string' ? s.url.trim() : ''
  const focus = typeof s.focus === 'string' ? s.focus : undefined
  if (kind === 'rss') {
    return { kind: 'rss', url, initialWindow: isInitialWindow(s.initialWindow) ? s.initialWindow : '24h', ...(focus ? { focus } : {}) }
  }
  return { kind: 'http', url, ...(focus ? { focus } : {}) }
}

/**
 * Modo, destino de memória e condição, vindos do corpo da requisição.
 *
 * Ausentes = o comportamento de sempre: modo `ai`, sem memória, sem condição. É isto
 * que faz um cliente antigo — ou um `PATCH` que só muda o nome — continuar
 * funcionando exatamente como antes.
 */
function parseTriggerExtras(body: Record<string, unknown>): {
  executionMode?: ExecutionMode
  memory?: MemoryPlan
  aiCondition?: StepCondition | null
  action?: AppActionPlan
} {
  return {
    ...(isExecutionMode(body.executionMode) ? { executionMode: body.executionMode } : {}),
    ...('memory' in body ? { memory: normalizeMemoryPlan(body.memory) } : {}),
    ...('aiCondition' in body ? { aiCondition: normalizeCondition(body.aiCondition) } : {}),
    ...('action' in body ? { action: normalizeAppActionPlan(body.action) } : {}),
  }
}

// http(s) e nada mais. `file:`, `gopher:` e afins nem chegam ao safeFetch.
function urlAceitavel(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// Mensagem de formulário para uma fonte mal preenchida, ou null se estiver ok.
function fonteComUrlInvalida(spec: RoutineSpec): string | null {
  const fonte = spec.source
  if (!fonte || fonte.kind === 'fixed') return null
  if (!fonte.url) return 'a URL da fonte é obrigatória'
  if (!urlAceitavel(fonte.url)) return 'a URL precisa começar com http:// ou https://'
  return null
}

async function requireAgent(ownerId: string, raw: string): Promise<ObjectId | null> {
  const id = oid(raw)
  if (!id) return null
  const agent = await getAgentById(ownerId, id)
  return agent ? id : null
}

/**
 * As fontes que este agente consulta — feeds e páginas monitoradas.
 *
 * Existe para a aba "Como trabalha" poder DIZER que o agente sabe olhar um site. A
 * capacidade estava só na rotina, escondida atrás de um horário: quem abria o agente
 * para entender o que ele consegue fazer não via nada sobre isso.
 */
agentRoutineRouter.get('/sources', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const fontes = await fontesDoAgente(res.locals.userId, agentId)
  const documentosDaFonte = (id: ObjectId, sourceId: string) => countDocumentsFromSource({ ownerType: 'agent', ownerId: id }, sourceId)
  const agente = await getAgentById(res.locals.userId, agentId)
  const porId = new Map((agente?.watchedSources ?? []).map((w) => [w.name, w]))
  res.json({
    settings: sourceSettingsOf(agente ?? {}),
    sources: await Promise.all(fontes.map(async (f) => {
      const propria = f.origem === 'agente' ? porId.get(f.nome) : undefined
      return {
      // Sem rotina quando o site é do próprio agente: ele não tem horário.
      routineId: f.automationId ? f.automationId.toString() : null,
      origem: f.origem,
      // O id do endereço: é por ele que a tela devolve a configuração sem criar outro.
      id: propria?.id,
      name: f.nome,
      kind: f.source.kind,
      url: f.origem === 'agente' ? f.source.url : undefined,
      // Quando consultar e a janela do feed são escolha do dono, por endereço.
      when: f.origem === 'agente' ? (propria?.when ?? 'on_demand') : undefined,
      initialWindow: f.origem === 'agente' ? propria?.initialWindow : undefined,
      // Como o endereço vira conhecimento — e o que aconteceu na última leitura. O
      // estado é só de leitura: quem escreve é o gerente de fontes.
      ...(propria
        ? {
            refreshMode: propria.refreshMode ?? 'manual',
            intervalMinutes: propria.intervalMinutes ?? null,
            maxStalenessMinutes: propria.maxStalenessMinutes ?? null,
            discoveryMode: propria.discoveryMode ?? 'auto',
            readMode: propria.readMode ?? 'auto',
            crawlArticles: propria.crawlArticles === true,
            maxArticlesPerRun: propria.maxArticlesPerRun ?? null,
            sameDomainOnly: propria.sameDomainOnly !== false,
            status: propria.status ?? 'never_run',
            lastSuccessfulFetchAt: propria.lastSuccessfulFetchAt ?? null,
            nextScheduledAt: propria.nextScheduledAt ?? null,
            lastError: propria.lastError ?? null,
            newDocuments: propria.newDocuments ?? 0,
            ignoredUrls: propria.ignoredUrls?.length ?? 0,
            // Quantos documentos ESTA fonte produziu — a resposta de "o que ela me deu".
            knowledgeCount: await documentosDaFonte(agentId, propria.id),
          }
        : {}),
      // O host, e não a URL inteira: uma query string pode carregar token.
      host: (() => {
        try {
          return new URL(f.source.url).host
        } catch {
          return null
        }
      })(),
      }
    })),
  })
})

/**
 * Grava os sites que este agente consulta sob demanda.
 *
 * Substitui a lista inteira: é o que a tela edita, e um PATCH parcial aqui obrigaria a
 * inventar identidade para linhas que o dono acabou de digitar.
 */
/**
 * "Atualizar agora" — a leitura que o dono pede com um clique.
 *
 * Existe porque `manual` é um modo de verdade, e porque em qualquer outro modo alguém
 * pode querer ver o efeito antes de esperar o relógio. Devolve o que aconteceu com cada
 * endereço: quantas páginas foram descobertas, quantas viraram documento novo, quantas
 * mudaram e quantas estavam iguais.
 */
agentRoutineRouter.post('/sources/refresh', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const resultados = await ensureAgentWebKnowledgeFresh(res.locals.userId, agentId, 'manual')
  res.json({
    sources: resultados.map((r) => ({
      sourceId: r.sourceId,
      name: r.name,
      refreshed: r.refreshed,
      reason: r.reason,
      discovered: r.discovered,
      created: r.created,
      updated: r.updated,
      unchanged: r.unchanged,
      durationMs: r.durationMs,
      // A categoria do problema, nunca o corpo da resposta de terceiro.
      error: r.error ?? null,
    })),
  })
})

/**
 * "Testar leitura": o que este endereço devolve, agora, sem gravar nada.
 *
 * Existe porque cadastrar um site e descobrir só depois que ele exige login — ou que o
 * conteúdo só aparece com JavaScript — é descobrir tarde. Aqui o dono vê o método usado,
 * a classificação, quantos caracteres úteis vieram, o que foi capturado como dado
 * estruturado e, quando falha, o motivo COM NOME.
 */
agentRoutineRouter.post('/sources/test-read', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const url = typeof (req.body ?? {}).url === 'string' ? String(req.body.url).trim() : ''
  if (!/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'O endereço precisa começar com http:// ou https://', code: 'INVALID_URL' })
    return
  }
  const mode = req.body?.mode === 'http' || req.body?.mode === 'browser' ? req.body.mode : 'auto'
  // O MESMO leitor do runtime e do "Atualizar agora": testar com regra mais frouxa que a
  // execução seria pior que não testar.
  const r = await readWebPage(url, { mode, renderer: rendererAtivo() })
  res.json({
    ok: r.ok,
    readMethod: r.readMethod,
    // O que foi TENTADO, em ordem. Sem isto, "não deu" não diz se o navegador chegou a
    // ser tentado — nem por que não foi.
    strategies: r.strategies,
    contentType: r.contentType,
    capturedAt: r.capturedAt,
    links: r.links.length,
    ...(r.retryAfterSeconds !== undefined ? { retryAfterSeconds: r.retryAfterSeconds } : {}),
    status: r.metadata.status,
    code: r.code ?? null,
    reason: r.reason,
    fallbackReason: r.fallbackReason ?? null,
    kind: r.kind,
    title: r.metadata.title,
    usefulChars: r.metadata.usefulChars,
    durationMs: r.durationMs,
    structured: {
      tables: r.structuredData?.tables?.length ?? 0,
      jsonLd: r.structuredData?.jsonLd?.length ?? 0,
      pairs: Object.keys(r.structuredData?.pairs ?? {}).length,
      capturedAt: r.structuredData?.capturedAt ?? null,
    },
    // Um trecho, para reconhecer a página. Nunca o corpo inteiro.
    preview: r.text.slice(0, 400),
  })
})

/**
 * Quanto ESTE pesquisador buscou — e quanto ele deixou de buscar.
 *
 * O painel de Configurações mostra o gasto da instalação, que é o que protege a fatura.
 * Isto responde outra pergunta: este agente está valendo a busca? Um número global não
 * diz de quem foi o gasto, e um agente que busca demais sem achar nada é um problema de
 * configuração dele, não do servidor.
 *
 * "Buscas evitadas" é o retorno da memória: pergunta que a base já respondia e não virou
 * requisição ao buscador.
 */
agentRoutineRouter.get('/search-stats', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  res.json(await agentSearchStats(agentId.toString()))
})

agentRoutineRouter.put('/sources', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const bruto = (req.body ?? {}).sources
  if (!Array.isArray(bruto)) {
    res.status(400).json({ error: 'sources must be a list' })
    return
  }
  if (bruto.length > MAX_WATCHED_SOURCES) {
    res.status(400).json({ error: `no máximo ${MAX_WATCHED_SOURCES} endereços`, code: 'SOURCE_LIMIT' })
    return
  }
  const sources: WatchedSource[] = []
  // O que já estava gravado, para preservar o estado de leitura de cada endereço: salvar
  // a configuração não pode fazer o sistema esquecer que já leu.
  const agenteAtual = await getAgentById(res.locals.userId, agentId)
  const existentes = new Map((agenteAtual?.watchedSources ?? []).map((s) => [s.id, s]))
  for (const item of bruto as Record<string, unknown>[]) {
    const url = typeof item?.url === 'string' ? item.url.trim() : ''
    const kind = item?.kind === 'rss' ? 'rss' : 'http'
    // Ausente = o padrão de antes: só quando o agente julgar. Uma escolha desconhecida
    // vira o mesmo padrão em vez de virar "sempre", que é a cara.
    const when = WATCHED_SOURCE_WHEN.includes(item?.when as never) ? (item.when as WatchedSource['when']) : 'on_demand'
    const janela = item?.initialWindow
    const initialWindow = janela === '24h' || janela === '3d' || janela === '7d' ? janela : '7d'
    // A mesma exigência da fonte de rotina: público e http(s). O bloqueio de endereço
    // privado acontece de novo na hora de consultar (safeFetch) — aqui é para o erro
    // aparecer enquanto o dono ainda está na tela.
    if (!/^https?:\/\//i.test(url)) {
      res.status(400).json({ error: 'O endereço precisa começar com http:// ou https://', code: 'INVALID_URL' })
      return
    }
    const name = typeof item?.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : new URL(url).host
    // A configuração de atualização vem do mesmo formulário. `normalizeWebSource` aplica
    // os limites seguros (piso de 5 min, teto de páginas por rodada) e o padrão `manual`,
    // que é o que mantém uma fonte antiga sem consumir banda sozinha.
    const web = normalizeWebSource(item as Record<string, unknown>)
    // O estado da última leitura é do SERVIDOR: o cliente não escreve o que aconteceu.
    const anterior = existentes.get(typeof item?.id === 'string' ? item.id : '')
    sources.push({
      id: typeof item?.id === 'string' && item.id ? item.id : new ObjectId().toHexString(),
      name,
      kind,
      url: normalizeSourceUrl(url),
      when,
      initialWindow,
      ...web,
      ...(anterior
        ? {
            lastFetchedAt: anterior.lastFetchedAt ?? null,
            lastSuccessfulFetchAt: anterior.lastSuccessfulFetchAt ?? null,
            nextScheduledAt: anterior.nextScheduledAt ?? null,
            lastError: anterior.lastError ?? null,
            status: anterior.status ?? 'never_run',
            // A lista de endereços ignorados é do servidor: salvar a configuração não
            // pode fazer o crawler esquecer o que o dono mandou não trazer de volta.
            ...(anterior.ignoredUrls?.length ? { ignoredUrls: anterior.ignoredUrls } : {}),
          }
        : { status: 'never_run' as const }),
    })
  }
  // Os limites e os nomes vêm no mesmo pedido: são a mesma tela, e salvar em dois passos
  // deixaria um estado meio gravado se o segundo falhasse.
  const cfg = (req.body ?? {}).settings as Record<string, unknown> | undefined
  const settings = cfg
    ? sourceSettingsOf({
        sourceSettings: {
          maxItems: Number(cfg.maxItems),
          charBudget: Number(cfg.charBudget),
          maxSources: Number(cfg.maxSources),
          ...(typeof cfg.toolName === 'string' && cfg.toolName.trim()
            ? { toolName: sanitizeToolName(cfg.toolName, SOURCE_TOOL_NAME) }
            : {}),
          ...(typeof cfg.toolDescription === 'string' && cfg.toolDescription.trim()
            ? { toolDescription: cfg.toolDescription.trim().slice(0, 400) }
            : {}),
        },
      })
    : undefined
  // O teto de endereços é do dono, dentro do teto de sistema.
  const teto = settings?.maxSources ?? sourceSettingsOf(await getAgentById(res.locals.userId, agentId) ?? {}).maxSources
  if (sources.length > teto) {
    res.status(400).json({ error: `no máximo ${teto} endereços`, code: 'SOURCE_LIMIT' })
    return
  }

  const atualizado = await updateAgent(res.locals.userId, agentId, {
    watchedSources: sources,
    ...(settings ? { sourceSettings: settings } : {}),
  })
  if (!atualizado) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  res.json({ sources, settings: settings ?? sourceSettingsOf(atualizado) })
})

agentRoutineRouter.get('/routines', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const routines = await listRoutines(res.locals.userId, agentId)

  // O estado do monitoramento vem do checkpoint e do último run, e só para as
  // rotinas que de fato monitoram algo. Uma rotina de entrada fixa não paga essa
  // consulta e não ganha campos que não fazem sentido para ela.
  const enriquecidas = await Promise.all(
    routines.map(async (r) => {
      const base = serializeRoutine(r)
      if (base.source.kind === 'fixed') return base

      const [checkpoint, ultimos] = await Promise.all([
        getCheckpoint(res.locals.userId, r._id, STEP_SOURCE),
        listRuns(res.locals.userId, { automationIds: [r._id], limit: 1, skip: 0 }),
      ])
      const ultimo = ultimos.items[0]
      return {
        ...base,
        monitoring: {
          lastCheckedAt: checkpoint?.lastCheckedAt ?? null,
          lastChangedAt: checkpoint?.lastChangedAt ?? null,
          // O desfecho da última verificação, em três estados que o usuário
          // entende: encontrou algo, verificou e não havia nada, ou falhou.
          // `noChange` é o campo anterior; ler os dois mantém os runs já gravados
          // aparecendo certo na lista.
          lastResult: !ultimo
            ? null
            : ultimo.status === 'failed'
              ? 'failed'
              : (ultimo.sourceOutcome ?? (ultimo.noChange ? 'no_change' : 'changed')),
          lastRunAt: ultimo?.finishedAt ?? ultimo?.startedAt ?? null,
          lastError: publicError(ultimo?.error ?? null),
        },
      }
    }),
  )
  res.json(enriquecidas)
})

agentRoutineRouter.post('/routines', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const { spec, error } = parseRoutineSpec(req.body ?? {})
  if (error) {
    res.status(400).json({ error })
    return
  }
  // Só o que dá para julgar pelo corpo da requisição. A regra de frequência depende
  // da fonte EFETIVA — que num PATCH pode vir da rotina salva — e por isso mora em
  // `createRoutine`/`updateRoutine`, que a resolvem antes de decidir.
  const urlInvalida = fonteComUrlInvalida(spec!)
  if (urlInvalida) {
    res.status(400).json({ error: urlInvalida })
    return
  }
  try {
    const routine = await createRoutine(res.locals.userId, agentId, spec!)
    auditEntity(res, { id: routine._id.toString(), label: routine.name, floorId: routine.floorId.toString() })
    res.status(201).json(serializeRoutine(routine))
  } catch (e) {
    res.status(e instanceof RoutineError ? 400 : 500).json({ error: e instanceof Error ? e.message : 'failed' })
  }
})

agentRoutineRouter.patch('/routines/:routineId', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  const routineId = oid(String((req.params as Record<string, string>).routineId))
  if (!agentId || !routineId) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const { spec, error } = parseRoutineSpec(req.body ?? {})
  if (error) {
    res.status(400).json({ error })
    return
  }
  // Só o que dá para julgar pelo corpo da requisição. A regra de frequência depende
  // da fonte EFETIVA — que num PATCH pode vir da rotina salva — e por isso mora em
  // `createRoutine`/`updateRoutine`, que a resolvem antes de decidir.
  const urlInvalida = fonteComUrlInvalida(spec!)
  if (urlInvalida) {
    res.status(400).json({ error: urlInvalida })
    return
  }
  try {
    const routine = await updateRoutine(res.locals.userId, agentId, routineId, spec!)
    if (!routine) {
      res.status(404).json({ error: 'routine not found' })
      return
    }
    res.json(serializeRoutine(routine))
  } catch (e) {
    res.status(e instanceof RoutineError ? 400 : 500).json({ error: e instanceof Error ? e.message : 'failed' })
  }
})

// Testar a fonte: consulta a URL e mostra o que ela devolve. NENHUMA LLM é
// chamada, nenhum token é gasto e nenhum checkpoint é tocado — o usuário está
// conferindo se o endereço funciona, não pedindo uma execução.
agentRoutineRouter.post('/routines/test-source', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const kind = body.kind === 'rss' || body.kind === 'http' ? body.kind : null
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!kind) {
    res.status(400).json({ error: 'informe se a fonte é rss ou http' })
    return
  }
  if (!url || !urlAceitavel(url)) {
    res.status(400).json({ ok: false, kind, message: 'A URL precisa começar com http:// ou https://.' })
    return
  }
  const preview = await previewSource(kind, url, {
    initialWindow: isInitialWindow(body.initialWindow) ? body.initialWindow : undefined,
  })
  res.json(preview)
})

// "Verificar agora": enfileira uma execução da rotina fora do horário dela. É a
// MESMA execução que o agendador dispararia — inclusive o checkpoint —, então se
// não houver novidade ela termina como sucesso sem alteração. É diferente de
// "testar fonte", que não executa nada.
agentRoutineRouter.post('/routines/:routineId/check-now', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  const routineId = oid(String((req.params as Record<string, string>).routineId))
  if (!agentId || !routineId) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const owned = await getRoutineForAgent(res.locals.userId, agentId, routineId)
  if (!owned) {
    res.status(404).json({ error: 'routine not found' })
    return
  }
  const { run, created } = await createRun(res.locals.userId, routineId, {
    triggerType: 'manual',
    requestId: typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined,
  })
  auditEntity(res, { id: owned._id.toString(), label: owned.name, floorId: owned.floorId.toString() })
  res.status(created ? 201 : 200).json({ runId: run._id.toString(), status: run.status })
})

// Activate / pause / archive a routine. archive is also the "delete" (soft).
//
// Fica DEPOIS de `test-source` e `check-now` de propósito: `:action` é um pega-tudo
// e engoliria os dois, entregando "check-now" como se fosse um verbo de status.
agentRoutineRouter.post('/routines/:routineId/:action', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  const routineId = oid(String((req.params as Record<string, string>).routineId))
  const action = String((req.params as Record<string, string>).action)
  const status = action === 'activate' ? 'active' : action === 'pause' ? 'paused' : action === 'archive' ? 'archived' : null
  if (!agentId || !routineId || !status) {
    res.status(400).json({ error: 'invalid request' })
    return
  }
  const owned = await getRoutineForAgent(res.locals.userId, agentId, routineId)
  if (!owned) {
    res.status(404).json({ error: 'routine not found' })
    return
  }
  const updated = await setStatus(res.locals.userId, routineId, status)
  if (!updated) {
    res.status(409).json({ error: 'could not change status' })
    return
  }
  res.json(serializeRoutine(updated))
})

// --- Event triggers (webhooks that belong to THIS agent) ------------------------
// Agent-native on purpose: the user creates "um gatilho por evento", not an
// automation with a webhook trigger and an agent.execute step. The secret is never
// part of this shape — it is returned once, by create and by rotate, and nowhere else.
function serializeTrigger(a: Automation) {
  const trigger = (a.publishedTrigger ?? a.trigger) as { type?: string; requireSignature?: boolean }
  // Modo, destino da memória e condição vêm da definição — não há cópia da spec em
  // lugar nenhum, e é por isso que a interface reabre o gatilho do jeito que ele foi
  // salvo.
  const cfg = readEventTriggerConfig(a.draftDefinition)
  return {
    executionMode: cfg.executionMode,
    memory: cfg.memory,
    aiCondition: cfg.aiCondition,
    action: cfg.action,
    id: a._id.toString(),
    name: a.name,
    objective: a.description,
    status: a.status,
    endpoint: a.webhookPublicKey ? webhookEndpoint(config.publicUrl, a.webhookPublicKey) : null,
    requireSignature: trigger?.requireSignature !== false,
    hasSecret: Boolean(a.webhookSecretEncrypted),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

agentRoutineRouter.get('/event-triggers', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const triggers = await listEventTriggers(res.locals.userId, agentId)
  res.json(triggers.map(serializeTrigger))
})

agentRoutineRouter.post('/event-triggers', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const objective = typeof body.objective === 'string' ? body.objective.trim() : ''
  const extras = parseTriggerExtras(body)
  // Sem etapa de IA não há a quem instruir: exigir objetivo obrigaria a escrever um
  // texto que ninguém vai ler.
  if (!objective && aiStepPlanned(extras.executionMode ?? 'ai', extras.aiCondition ?? null)) {
    res.status(400).json({ error: 'objective is required' })
    return
  }
  try {
    const { trigger, secret } = await createEventTrigger(res.locals.userId, agentId, {
      name: typeof body.name === 'string' ? body.name : '',
      objective,
      ...extras,
    })
    auditEntity(res, { id: trigger._id.toString(), label: trigger.name, floorId: trigger.floorId.toString() })
    // The ONLY moment the plaintext secret exists outside the database.
    res.status(201).json({ ...serializeTrigger(trigger), secret })
  } catch (e) {
    res.status(e instanceof EventTriggerError ? 400 : 500).json({ error: e instanceof Error ? e.message : 'failed' })
  }
})

agentRoutineRouter.patch('/event-triggers/:triggerId', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  const triggerId = oid(String((req.params as Record<string, string>).triggerId))
  if (!agentId || !triggerId) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const objective = typeof body.objective === 'string' ? body.objective.trim() : ''
  const extras = parseTriggerExtras(body)
  if (!objective && aiStepPlanned(extras.executionMode ?? 'ai', extras.aiCondition ?? null)) {
    res.status(400).json({ error: 'objective is required' })
    return
  }
  try {
    const updated = await updateEventTrigger(res.locals.userId, agentId, triggerId, {
      name: typeof body.name === 'string' ? body.name : '',
      objective,
      ...extras,
    })
    if (!updated) {
      res.status(404).json({ error: 'trigger not found' })
      return
    }
    res.json(serializeTrigger(updated))
  } catch (e) {
    res.status(e instanceof EventTriggerError ? 400 : 500).json({ error: e instanceof Error ? e.message : 'failed' })
  }
})

// A new credential, shown once. The old one stops working immediately — which is
// the whole point of a rotation.
agentRoutineRouter.post('/event-triggers/:triggerId/rotate', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  const triggerId = oid(String((req.params as Record<string, string>).triggerId))
  if (!agentId || !triggerId) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const owned = await getEventTriggerForAgent(res.locals.userId, agentId, triggerId)
  if (!owned) {
    res.status(404).json({ error: 'trigger not found' })
    return
  }
  const rotated = await rotateWebhookSecret(res.locals.userId, triggerId)
  if (!rotated) {
    res.status(409).json({ error: 'could not rotate' })
    return
  }
  const fresh = await getEventTriggerForAgent(res.locals.userId, agentId, triggerId)
  res.json({ ...serializeTrigger(fresh ?? owned), secret: rotated.secret })
})

agentRoutineRouter.post('/event-triggers/:triggerId/:action', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  const triggerId = oid(String((req.params as Record<string, string>).triggerId))
  const action = String((req.params as Record<string, string>).action)
  const status = action === 'activate' ? 'active' : action === 'pause' ? 'paused' : action === 'archive' ? 'archived' : null
  if (!agentId || !triggerId || !status) {
    res.status(400).json({ error: 'invalid request' })
    return
  }
  const owned = await getEventTriggerForAgent(res.locals.userId, agentId, triggerId)
  if (!owned) {
    res.status(404).json({ error: 'trigger not found' })
    return
  }
  const updated = await setStatus(res.locals.userId, triggerId, status)
  if (!updated) {
    res.status(409).json({ error: 'could not change status' })
    return
  }
  res.json(serializeTrigger(updated))
})

// Run history for the agent: the runs of all its routines, newest first.
agentRoutineRouter.get('/history', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  // The agent's WHOLE automatic history: scheduled routines and event triggers alike.
  const owned = await listAgentAutomations(res.locals.userId, agentId)
  const ids = owned.map((r) => r._id)
  const limit = Math.min(Number(req.query.limit) || 25, 100)
  const nameById = new Map(owned.map((r) => [r._id.toString(), r.name]))
  // Two strands of history: scheduled routine runs, and delegations this agent took
  // part in (as caller OR as target — so a delegated task shows on both agents).
  const [runsResult, delegations] = await Promise.all([
    ids.length ? listRuns(res.locals.userId, { automationIds: ids, limit, skip: 0 }) : Promise.resolve({ items: [], total: 0 }),
    listDelegationsForAgent(res.locals.userId, agentId, limit),
  ])
  res.json({
    total: runsResult.total,
    items: runsResult.items.map((run) => ({
      id: run._id.toString(),
      routineId: run.automationId.toString(),
      routineName: nameById.get(run.automationId.toString()) ?? 'Rotina',
      status: run.status,
      triggerType: run.triggerType,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      // Categorised: an engine message can quote the very input that failed.
      error: publicError(run.error),
    })),
    delegations: delegations.map((d) => ({
      id: d._id.toString(),
      direction: d.callerAgentId.equals(agentId) ? 'outgoing' : 'incoming',
      targetType: d.targetType,
      targetAgentId: d.targetAgentId?.toString() ?? null,
      targetSectorId: d.targetSectorId?.toString() ?? null,
      objective: d.objective,
      status: d.status,
      denyCode: d.denyCode,
      // Kept: the agent's own history offers it for "salvar no conhecimento". It is
      // the one place it appears — the Central de logs never carries it.
      outputPreview: d.outputPreview,
      // The stored message is a target agent's raw failure; what leaves is the
      // reason, derived from the status and the deny code the gate chose.
      error: publicDelegationError(d.status, d.denyCode),
      createdAt: d.createdAt,
      finishedAt: d.finishedAt,
    })),
  })
})
