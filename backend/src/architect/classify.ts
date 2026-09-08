import type { BriefJob, OperationBrief } from './brief.js'
import type { ArchitectCapabilityManifest } from './capabilities.js'

// AGENTE, FUNÇÃO ou FERRAMENTA — a decisão que evita as duas patologias.
//
// De um lado o superagente: um agente responsável por atendimento, marketing, finanças
// e relatórios, que erra sem que ninguém saiba em qual etapa. Do outro o enxame: um
// agente por microetapa, cada um esperando o anterior, nenhum com decisão própria.
//
// As duas nascem da mesma ausência: ninguém classificou o TRABALHO antes de criar
// gente. Um trabalho que só transforma dado não precisa de julgamento — precisa de
// função. Um trabalho que só chama um sistema externo precisa de ferramenta. Agente é
// para quem interpreta, decide ou conversa.
//
// A classificação é determinística e explicável: cada decisão carrega a alternativa
// recusada e o porquê. Sem isso, "por que isto virou agente?" não tem resposta.

export type ResourceKind = 'agent' | 'function' | 'tool' | 'routine' | 'sector'

export interface ResourceDecision {
  jobId: string
  jobName: string
  kind: ResourceKind
  /** O que foi recusado, e por quê. É o que torna a decisão discutível. */
  rejected: { kind: ResourceKind; because: string }[]
  because: string
  /** Quando `kind` é agente, o perfil sugerido — sempre um do manifesto. */
  suggestedPreset?: string
  /** Quando é função ou ferramenta, o nome real; ausente = pendência declarada. */
  resourceRef?: string
  /** Confirmado contra o catálogo do servidor. Falso = o recurso não existe (ainda). */
  resolved: boolean
}

/** Verbos que denunciam cálculo puro: não há julgamento, há fórmula. */
const CALCULO = /(calcul|somar|média|media|percentu|converter|formatar|ordenar|filtrar|contar|agrupar|diferença|variação|indicador|rsi|média móvel)/i

/** Verbos de ação em sistema de fora: alguém precisa executar, não interpretar. */
const ACAO_EXTERNA = /(consultar|buscar no|registrar|cadastrar|criar pedido|atualizar|enviar|publicar|agendar|cobrar|reembols|cancelar|emitir|integrar)/i

/**
 * Falar COM alguém — é o que separa quem conversa de quem só pensa.
 *
 * "Decidir" não entra aqui: quase todo trabalho de agente decide alguma coisa, e tratar
 * decisão como conversa fazia um analista virar comunicador.
 */
const CONVERSA = /(responder|atender|explicar|conversar|negociar|orientar|acolher|redigir|escrever para|avisar o cliente|triar)/i

/** Pensar sobre o que chegou: interpretar, comparar, concluir. */
const JULGAMENTO = /(decidir|escolher|classificar|interpretar|analisar|avaliar|comparar|resumir|priorizar|recomendar)/i

/**
 * Uma CADÊNCIA é um horário. "Sempre", "sob demanda" e "a cada pedido" não são.
 *
 * `frequency` sozinho empurrava qualquer trabalho para rotina — e um trabalho disparado por
 * uma PESSOA ("quando o cliente pede mesa") virava uma automação agendada. É a mesma
 * patologia de "quando o RSI ficar abaixo de 30" virando um cron das oito da manhã: o texto
 * tem a palavra da frequência, e ninguém perguntou se ela nomeia um horário.
 */
const CADENCIA =
  /(\bdiári|\bdiario|\bsemanal|\bmensal|\banual|\bhora\b|\bhoras\b|\bminuto|\bsegundo|\bdia\b|\bdias\b|\bsemana|\bmês\b|\bmes\b|\bmeses|\btoda\s|\btodo\s|\btodos\s|\bcada\s+\d|\bmanhã|\bmanha|\btarde|\bnoite|\bmadrugada|\bútil|\butil|\bsegunda|\bterça|\bterca|\bquarta|\bquinta|\bsexta|\bsábado|\bsabado|\bdomingo|\bcron|\d\s*(h|:)\d?)/i

/** Vigiar: acontece sozinho, no tempo, e avisa quando uma condição bate. */
const VIGILANCIA = /(monitorar|acompanhar|vigiar|avisar quando|alertar|observar)/i

const texto = (j: BriefJob): string => `${j.name} ${j.action} ${j.decision} ${j.output}`.toLowerCase()

/** A função do registro que resolve este trabalho, se existir. */
function funcaoQueServe(job: BriefJob, manifest: ArchitectCapabilityManifest | null): string | undefined {
  if (!manifest) return undefined
  const alvo = texto(job)
  /**
   * Só casa pelo NOME da função.
   *
   * Casar por capacidade ("calcular") resolvia "calcular o frete por faixa de CEP" para
   * `math.serie` — uma função que não faz nada disso. Uma resolução errada é pior que
   * nenhuma: ela vira proposta aprovada em cima de um recurso que não serve, e o
   * defeito só aparece quando alguém usa.
   */
  const nomeDe = (f: { functionName: string }) => (f.functionName.split('.').pop() ?? f.functionName).toLowerCase()
  const porNome = manifest.functions.find((f) => {
    const nome = nomeDe(f)
    return nome.length >= 4 && alvo.includes(nome)
  })
  if (porNome) return porNome.functionName

  /**
   * SEGUNDA PASSADA: o termo distintivo do nome, como palavra inteira.
   *
   * `calculate_rsi` nunca casava — nenhum Brief em português escreve "calculate_rsi", e o
   * compilador declarava "nenhuma função registrada faz este cálculo" para a única conta que
   * ele sabe fazer com exatidão. O RSI voltava a ser palpite do modelo.
   *
   * Ela só roda quando a primeira não achou NADA, então nenhuma resolução de hoje muda; e
   * casa só palavra inteira, fora da lista de termos genéricos — "get" ou "series" dentro de
   * uma frase qualquer resolveria para uma função que não faz o que o trabalho pede.
   */
  const GENERICOS = new Set(['calculate', 'calcular', 'get', 'list', 'latest', 'range', 'series', 'serie', 'summary', 'data', 'dados', 'lista', 'texto', 'json', 'regra', 'somar', 'idade', 'aggregate'])
  return manifest.functions.find((f) =>
    nomeDe(f)
      .split(/[_\-.]/)
      .some((seg) => seg.length >= 3 && !GENERICOS.has(seg) && new RegExp(`(^|[^a-z0-9])${seg}([^a-z0-9]|$)`).test(alvo)),
  )?.functionName
}

/** O App conectado que executa este trabalho, se existir. */
function appQueServe(job: BriefJob, manifest: ArchitectCapabilityManifest | null): string | undefined {
  if (!manifest) return undefined
  const alvo = texto(job)
  const app = manifest.apps.find((a) => alvo.includes(a.key.replace(/_/g, ' ')) || alvo.includes(a.name.toLowerCase()))
  return app ? app.key : undefined
}

/**
 * O recurso certo para UM trabalho.
 *
 * A ordem das perguntas é a ordem do custo: função é o recurso mais barato e mais
 * confiável (é determinístico, testável, não alucina), ferramenta vem depois, e agente
 * é o mais caro — ele pensa, e pensar custa token e erra. Só chega em agente o
 * trabalho que precisa de julgamento.
 */
/**
 * A FORMA QUE A PESSOA PEDIU, quando ela pediu uma.
 *
 * Lida da frase dela, e só quando é explícita: "quero um AGENTE que…" é um pedido de
 * agente. Sem a palavra, não há divergência a resolver — quem decide é a regra, que é o
 * comportamento certo na maioria esmagadora dos casos.
 *
 * Isto não decide nada sozinho. Serve para o servidor NOTAR que discorda de quem pediu, e
 * perguntar em vez de trocar em silêncio.
 */
export function formaPedida(job: BriefJob): ResourceKind | null {
  const t = texto(job)
  // A ordem importa: "um agente com uma ferramenta" é um pedido de agente.
  if (/\bagentes?\b/.test(t)) return 'agent'
  if (/\bferramentas?\b/.test(t)) return 'tool'
  if (/\brotinas?\b|\bautomaç(ão|ao)\b|\bagendament/.test(t)) return 'routine'
  if (/\bfunç(ão|ao)\b|\bfunctions?\b/.test(t)) return 'function'
  return null
}

/**
 * HÁ DÚVIDA REAL entre o que a regra recomenda e o que a pessoa pediu?
 *
 * Perguntar em toda divergência é quase tão ruim quanto trocar em silêncio: "agente" é
 * como muita gente diz "quero que o sistema faça isso", e virar uma escolha de arquitetura
 * a cada uso da palavra enche a conversa de degraus que não mudam nada.
 *
 * Duas coisas, e as duas são medíveis:
 *
 *   1. A RECOMENDAÇÃO NÃO SE SUSTENTA. A regra pede função e não existe função registrada
 *      que faça aquilo; pede ferramenta e nenhum App serve. Recomendar o que não dá para
 *      construir é justamente o caso em que a alternativa merece ser considerada.
 *   2. A DESCRIÇÃO APOIA O PEDIDO. A pessoa escreveu "agente" e o trabalho tem julgamento
 *      no texto; escreveu "ferramenta" e há ação em sistema. Aí a palavra foi escolha, e
 *      não modo de falar.
 *
 * Fora disso a regra decide e segue. Não perguntar não é o mesmo que não contar: o que foi
 * recusado e por quê continua em `rejected`, e a proposta mostra.
 */
export function haDuvidaDeForma(job: BriefJob, decisao: ResourceDecision, pedida: ResourceKind): boolean {
  if (decisao.kind === pedida) return false
  if (!decisao.resolved) return true
  const alvo = texto(job)
  const temDecisao = Boolean(job.decision && job.decision.trim())
  if (pedida === 'agent') return JULGAMENTO.test(alvo) || CONVERSA.test(alvo) || temDecisao
  if (pedida === 'tool') return ACAO_EXTERNA.test(alvo)
  if (pedida === 'routine') return VIGILANCIA.test(alvo) || Boolean(job.frequency && CADENCIA.test(job.frequency))
  if (pedida === 'function') return CALCULO.test(alvo)
  return false
}

/** As formas que uma pessoa escolhe para um trabalho. `sector` não é uma delas. */
const FORMAS_ESCOLHIVEIS: readonly ResourceKind[] = ['agent', 'function', 'tool', 'routine']

/**
 * A escolha da pessoa, se ela for uma das oferecidas.
 *
 * A resposta chega pelo mesmo caminho de todas as outras — e esse caminho passa pelo
 * modelo. Aceitar qualquer texto seria deixar o modelo escolher a forma por escrito, que é
 * exatamente o que a classificação existe para impedir. Só vale o conjunto fechado.
 */
export function formaEscolhida(valor: unknown): ResourceKind | null {
  const v = String(valor ?? '').trim().toLowerCase()
  return (FORMAS_ESCOLHIVEIS as readonly string[]).includes(v) ? (v as ResourceKind) : null
}

export function classifyJob(job: BriefJob, manifest: ArchitectCapabilityManifest | null, escolhida: ResourceKind | null = null): ResourceDecision {
  const alvo = texto(job)
  const temDecisao = Boolean(job.decision && job.decision.trim())
  const rejected: ResourceDecision['rejected'] = []

  // 1. Cálculo sem julgamento é FUNÇÃO. Um agente de linguagem fingindo que calculou é
  //    o erro mais caro do catálogo: ele acerta na maioria das vezes e erra em silêncio.
  if (CALCULO.test(alvo) && !temDecisao) {
    const fn = funcaoQueServe(job, manifest)
    rejected.push({ kind: 'agent', because: 'não há julgamento: o resultado é o mesmo toda vez, e um modelo de linguagem só acrescentaria risco de erro' })
    return comEscolhaDaPessoa({
      jobId: job.id,
      jobName: job.name,
      kind: 'function',
      because: 'transformação determinística — mesma entrada, mesma saída',
      rejected,
      ...(fn ? { resourceRef: fn } : {}),
      resolved: Boolean(fn),
    }, escolhida, job, manifest)
  }

  // 2. Ação em sistema externo é FERRAMENTA — do agente que conduz a conversa, não um
  //    agente separado. "Consultar pedido" não é um cargo.
  if (ACAO_EXTERNA.test(alvo) && !temDecisao) {
    const app = appQueServe(job, manifest)
    rejected.push({ kind: 'agent', because: 'é uma chamada a um sistema, não uma responsabilidade: vira ferramenta de quem já conversa' })
    return comEscolhaDaPessoa({
      jobId: job.id,
      jobName: job.name,
      kind: 'tool',
      because: 'ação em sistema externo, com contrato definido',
      rejected,
      ...(app ? { resourceRef: app } : {}),
      resolved: Boolean(app),
    }, escolhida, job, manifest)
  }

  // 3. Vigiar uma fonte no tempo é ROTINA (com monitor quando há interpretação).
  if (VIGILANCIA.test(alvo) || (job.frequency && CADENCIA.test(job.frequency) && !CONVERSA.test(alvo))) {
    rejected.push({ kind: 'agent', because: 'quem dispara é o tempo ou a condição, não uma pessoa falando' })
    return comEscolhaDaPessoa({
      jobId: job.id,
      jobName: job.name,
      kind: 'routine',
      because: 'acontece sozinho, por horário ou condição',
      rejected,
      ...(temDecisao ? { suggestedPreset: 'monitor' } : {}),
      resolved: true,
    }, escolhida, job, manifest)
  }

  // 4. Sobrou julgamento: é AGENTE. O perfil vem do que o trabalho faz.
  /**
   * O perfil sai do que o trabalho FAZ, nesta ordem:
   * quem conversa e ainda age no sistema é operador; quem só conversa é comunicador;
   * quem pensa sobre dado que recebeu é analista; quem sai atrás de informação é
   * pesquisador.
   */
  const preset = CONVERSA.test(alvo)
    ? ACAO_EXTERNA.test(alvo)
      ? 'operator'
      : 'communicator'
    : JULGAMENTO.test(alvo) || temDecisao
      ? 'analyst'
      : 'researcher'

  if (CALCULO.test(alvo)) {
    rejected.push({ kind: 'function', because: 'há cálculo, mas ele acompanha um julgamento — a conta vira função chamada pelo agente' })
  }
  return comEscolhaDaPessoa({
    jobId: job.id,
    jobName: job.name,
    kind: 'agent',
    because: temDecisao ? `exige julgamento: ${job.decision}` : 'exige interpretar linguagem e decidir o que responder',
    rejected,
    suggestedPreset: preset,
    resolved: true,
  }, escolhida, job, manifest)
}

/**
 * A ESCOLHA DA PESSOA, aplicada sobre a recomendação da regra.
 *
 * A regra roda inteira antes: é dela que sai a recomendação, e é ela que continua sendo
 * mostrada. O que a escolha faz é trocar a SAÍDA, registrando a recomendação em `rejected`
 * — quem ler a proposta depois vê que houve uma troca e qual era o conselho. Apagar isso
 * transformaria uma decisão informada numa decisão sem rastro.
 */
function comEscolhaDaPessoa(decisao: ResourceDecision, escolhida: ResourceKind | null, job: BriefJob, manifest: ArchitectCapabilityManifest | null): ResourceDecision {
  if (!escolhida || escolhida === decisao.kind) return decisao
  const recomendado = { kind: decisao.kind, because: `esta era a recomendação: ${decisao.because}` }
  const base: ResourceDecision = {
    jobId: decisao.jobId,
    jobName: decisao.jobName,
    kind: escolhida,
    because: `você escolheu ${NOME_DA_FORMA[escolhida]} — ${decisao.because.startsWith('esta era') ? decisao.because : `a recomendação era ${NOME_DA_FORMA[decisao.kind]}`}`,
    rejected: [...decisao.rejected.filter((r) => r.kind !== escolhida), recomendado],
    resolved: true,
  }
  // Cada forma precisa do que ela precisa para ficar de pé: agente tem perfil, função
  // precisa de uma função registrada, ferramenta precisa de um App que a sirva.
  if (escolhida === 'agent') return { ...base, suggestedPreset: decisao.suggestedPreset ?? 'analyst' }
  if (escolhida === 'function') {
    const fn = funcaoQueServe(job, manifest)
    return { ...base, ...(fn ? { resourceRef: fn } : {}), resolved: Boolean(fn) }
  }
  if (escolhida === 'tool') {
    const app = appQueServe(job, manifest)
    return { ...base, ...(app ? { resourceRef: app } : {}), resolved: Boolean(app) }
  }
  return base
}

/** Como cada forma se chama para quem lê. */
const NOME_DA_FORMA: Record<ResourceKind, string> = {
  agent: 'um agente',
  function: 'uma função',
  tool: 'uma ferramenta',
  routine: 'uma rotina',
  sector: 'um setor',
}

export interface Classification {
  decisions: ResourceDecision[]
  /** Quantos agentes o desenho pede — a base do orçamento de complexidade. */
  agentCount: number
  /** Recurso citado que não existe no catálogo: vira pendência, nunca invenção. */
  unresolved: ResourceDecision[]
}

export function classifyBrief(
  brief: OperationBrief,
  manifest: ArchitectCapabilityManifest | null,
  /** O que a pessoa respondeu, por chave de pergunta. `forma:<jobId>` é a escolha de forma. */
  answers: Record<string, unknown> = {},
): Classification {
  const decisions = brief.jobs.map((j) => classifyJob(j, manifest, formaEscolhida(answers[`forma:${j.id}`])))
  return {
    decisions,
    agentCount: decisions.filter((d) => d.kind === 'agent').length,
    unresolved: decisions.filter((d) => !d.resolved),
  }
}

/** A classificação em texto, para o prompt: o modelo desenha DEPOIS de ela existir. */
export function classificationForPrompt(c: Classification): string {
  if (c.decisions.length === 0) return ''
  return `COMO CADA TRABALHO DEVE SER RESOLVIDO (decidido pelo servidor — respeite):
${c.decisions
  .map((d) => {
    const alvo =
      d.kind === 'agent'
        ? `AGENTE com perfil "${d.suggestedPreset}"`
        : d.kind === 'function'
          ? `FUNÇÃO determinística${d.resourceRef ? ` (${d.resourceRef})` : ' (ainda não existe: declare como pendência)'}`
          : d.kind === 'tool'
            ? `FERRAMENTA de um agente${d.resourceRef ? ` (App ${d.resourceRef})` : ' (App não conectado: declare como pendência)'}`
            : d.kind === 'routine'
              ? 'ROTINA'
              : 'SETOR'
    return `- "${d.jobName}" → ${alvo}. Porque ${d.because}.${d.rejected.length ? ` Não é agente separado: ${d.rejected[0].because}.` : ''}`
  })
  .join('\n')}

Isto é o núcleo: ${c.agentCount} ${c.agentCount === 1 ? 'agente' : 'agentes'}. Não crie agente para trabalho que já foi classificado como função, ferramenta ou rotina.`
}
