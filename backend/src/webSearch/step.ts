// PROCURAR na web — o passo, num lugar só.
//
// Ele existia dentro de `runAgentTask`, e `runAgentTask` é alcançado por dois caminhos:
// a execução de setor e a delegação entre agentes. Os outros três — o teste do agente, o
// canal (widget, WhatsApp) e a rotina do worker — montam o próprio contexto e nunca
// passavam por ali.
//
// O efeito era o pior possível de diagnosticar: o interruptor ficava marcado, a tela
// mostrava a busca ligada, o provedor estava configurado, e o agente respondia só com o
// que já estava guardado. Nada falhava; a busca simplesmente não era chamada. Quem
// configurou não tinha como saber a diferença entre "procurei e não achei" e "ninguém
// procurou".
//
// Aqui está o passo inteiro — decisão, execução, memória, contabilidade e trilha — para
// que os cinco caminhos façam a MESMA coisa. Um sexto caminho que apareça amanhã chama
// esta função ou não busca; o que não pode voltar a existir é uma cópia parcial.
import { normalizeWebSearch, shouldSearch, wantsCurrentInfo } from './policy.js'
import { activeSearchProvider, configuredProviderName } from './provider.js'
import { runWebSearch } from './run.js'
import { recordSearchEvent } from './budget.js'
import { traceEvent } from '../executionTrace.js'
import type { WebSearchSettings } from './policy.js'
import type { ObjectId } from 'mongodb'

/** O que o chamador sabe sobre o estado da base ANTES de procurar fora. */
export interface EstadoDaBase {
  grounding: string
  passages: number
  /** As origens do que a base devolveu: `search` quer dizer "veio de uma busca anterior". */
  sourceOrigins?: (string | undefined)[]
}

export interface PassoDeBuscaDeps {
  /** Guarda as páginas lidas como conhecimento do agente. Ausente = não guarda. */
  rememberSearchPages?: (
    ownerId: string,
    agentId: ObjectId,
    query: string,
    pages: unknown[],
    rememberDays: number,
  ) => Promise<{ saved: number; updated: number } | null>
  /** A trilha ao vivo, quando alguém está olhando. */
  traceId?: string | null
  /** O balão do mapa. Ausente = nada é reportado. */
  report?: (estado: 'reading_knowledge') => void
}

export interface ResultadoDoPasso {
  /** As evidências, já com a data de captura. Vazio quando não houve busca ou nada veio. */
  evidence: string[]
  /** `true` quando a busca trouxe algo — o chamador promove o `grounding` para 'ok'. */
  found: boolean
  /** Por que não procurou, quando não procurou. Para o log de quem administra. */
  skipped?: string
}

/**
 * Procura, quando vale procurar.
 *
 * A ordem é a que economiza: a base já respondeu (ou não) antes de chegar aqui, e é essa
 * resposta que decide se vale ir para fora. Buscar antes seria pagar por uma pergunta que
 * o próprio agente já sabia responder.
 *
 * Nunca lança: uma busca que falha não pode derrubar a resposta que o agente já tinha.
 */
export async function gatherWebEvidence(
  agent: { _id: ObjectId; name: string; webSearch?: Partial<WebSearchSettings> | null },
  ownerId: string,
  query: string,
  base: EstadoDaBase,
  deps: PassoDeBuscaDeps = {},
): Promise<ResultadoDoPasso> {
  const cfg = normalizeWebSearch(agent.webSearch)
  if (!query.trim()) return { evidence: [], found: false, skipped: 'sem pergunta' }

  const provedor = activeSearchProvider()
  // O que a base respondeu veio SÓ de páginas que um buscador trouxe? A distinção decide
  // se uma pergunta sobre "agora" pode ser respondida com o que está guardado.
  const origens = base.sourceOrigins ?? []
  const soMemoriaDeBusca = origens.length > 0 && origens.every((o) => o === 'search')
  const decisao = shouldSearch(cfg, {
    grounding: base.grounding,
    passages: base.passages,
    canSearch: Boolean(provedor),
    wantsCurrent: wantsCurrentInfo(query),
    onlySearchMemory: soMemoriaDeBusca,
  })

  const trilha = (entrada: Parameters<typeof traceEvent>[0]) => {
    if (deps.traceId) traceEvent(entrada)
  }

  if (!decisao.search || !provedor) {
    if (cfg.enabled) {
      // A busca EVITADA também é registrada: é ela que mostra a economia de ter memória.
      await recordSearchEvent({
        agentId: agent._id.toString(),
        ownerId,
        // O provedor em jogo, e não um nome fixo: uma instalação no adaptador genérico
        // apareceria como "brave" no painel sem nunca ter falado com o Brave.
        provider: configuredProviderName(),
        query,
        outcome: 'avoided',
        performed: false,
        skipReason: decisao.reason,
        found: 0,
        pagesRead: 0,
        evidence: 0,
        saved: 0,
        ok: true,
        durationMs: 0,
      }).catch(() => undefined)
      // Não procurou — e o motivo importa tanto quanto a busca. Sem isto, "não procurou" e
      // "procurou e não achou" ficam iguais no painel.
      trilha({
        ownerId,
        executionId: deps.traceId!,
        type: 'web_search',
        status: 'info',
        agentId: agent._id.toString(),
        title: `${agent.name}: busca na web não foi necessária`,
        metadata: { policy: cfg.policy, reason: decisao.reason },
      })
    }
    return { evidence: [], found: false, skipped: decisao.reason }
  }

  deps.report?.('reading_knowledge')
  const r = await runWebSearch(provedor, query, cfg)
  // A data de captura vai JUNTO da evidência: sem ela, um trecho que diz "hoje" é lido
  // como se fosse de hoje, qualquer que seja o dia em que foi escrito.
  const lidoEm = new Date().toISOString().slice(0, 10)
  const evidence = r.evidence.map((e) => `[${e.title}] · lido em ${lidoEm}\nFonte: ${e.url}\n\n${e.text}`)

  // O que foi lido vira memória do agente: a próxima pergunta parecida encontra isto na
  // base, e a requisição ao buscador nem sai.
  const guardado =
    deps.rememberSearchPages && r.pages.length > 0
      ? await deps.rememberSearchPages(ownerId, agent._id, query, r.pages, cfg.rememberDays).catch(() => null)
      : null

  await recordSearchEvent({
    agentId: agent._id.toString(),
    ownerId,
    provider: r.provider,
    query,
    // A franquia barrou = a requisição NÃO saiu e não gastou. Gravar isso como busca feita
    // mostrava consumo que não existiu, e um agente parado por falta de cota parecia um
    // agente gastando.
    outcome: r.code === 'monthly_limit_reached' ? 'blocked' : 'sent',
    performed: r.code !== 'monthly_limit_reached',
    found: r.found,
    pagesRead: r.read.length,
    evidence: r.evidence.length,
    saved: (guardado?.saved ?? 0) + (guardado?.updated ?? 0),
    ok: r.ok,
    code: r.code ?? null,
    durationMs: r.durationMs,
  }).catch(() => undefined)

  trilha({
    ownerId,
    executionId: deps.traceId!,
    type: 'web_search',
    status: r.ok ? (r.evidence.length > 0 ? 'success' : 'info') : 'error',
    agentId: agent._id.toString(),
    title: r.ok
      ? `${agent.name}: busca na web — ${r.found} resultado(s), ${r.read.length} página(s) lida(s), ${r.evidence.length} evidência(s)`
      : r.code === 'monthly_limit_reached'
        ? `${agent.name}: a franquia mensal de busca acabou — respondendo com a base`
        : `${agent.name}: a busca na web falhou — respondendo com o que já tinha`,
    input: query.slice(0, 200),
    durationMs: r.durationMs,
    metadata: {
      provider: r.provider,
      policy: cfg.policy,
      reason: decisao.reason,
      found: r.found,
      // Só endereço e título: o conteúdo lido não é assunto de painel, e nenhuma
      // credencial passa por aqui.
      selected: r.selected.map((s) => ({ url: s.url, title: s.title, score: s.score })),
      read: r.read,
      evidence: r.evidence.map((e) => ({ url: e.url, title: e.title })),
      error: r.error ?? null,
      code: r.code ?? null,
    },
  })

  return { evidence, found: r.evidence.length > 0 }
}
