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
  return manifest.functions.find((f) => {
    const nome = (f.functionName.split('.').pop() ?? f.functionName).toLowerCase()
    return nome.length >= 4 && alvo.includes(nome)
  })?.functionName
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
export function classifyJob(job: BriefJob, manifest: ArchitectCapabilityManifest | null): ResourceDecision {
  const alvo = texto(job)
  const temDecisao = Boolean(job.decision && job.decision.trim())
  const rejected: ResourceDecision['rejected'] = []

  // 1. Cálculo sem julgamento é FUNÇÃO. Um agente de linguagem fingindo que calculou é
  //    o erro mais caro do catálogo: ele acerta na maioria das vezes e erra em silêncio.
  if (CALCULO.test(alvo) && !temDecisao) {
    const fn = funcaoQueServe(job, manifest)
    rejected.push({ kind: 'agent', because: 'não há julgamento: o resultado é o mesmo toda vez, e um modelo de linguagem só acrescentaria risco de erro' })
    return {
      jobId: job.id,
      jobName: job.name,
      kind: 'function',
      because: 'transformação determinística — mesma entrada, mesma saída',
      rejected,
      ...(fn ? { resourceRef: fn } : {}),
      resolved: Boolean(fn),
    }
  }

  // 2. Ação em sistema externo é FERRAMENTA — do agente que conduz a conversa, não um
  //    agente separado. "Consultar pedido" não é um cargo.
  if (ACAO_EXTERNA.test(alvo) && !temDecisao) {
    const app = appQueServe(job, manifest)
    rejected.push({ kind: 'agent', because: 'é uma chamada a um sistema, não uma responsabilidade: vira ferramenta de quem já conversa' })
    return {
      jobId: job.id,
      jobName: job.name,
      kind: 'tool',
      because: 'ação em sistema externo, com contrato definido',
      rejected,
      ...(app ? { resourceRef: app } : {}),
      resolved: Boolean(app),
    }
  }

  // 3. Vigiar uma fonte no tempo é ROTINA (com monitor quando há interpretação).
  if (VIGILANCIA.test(alvo) || (job.frequency && CADENCIA.test(job.frequency) && !CONVERSA.test(alvo))) {
    rejected.push({ kind: 'agent', because: 'quem dispara é o tempo ou a condição, não uma pessoa falando' })
    return {
      jobId: job.id,
      jobName: job.name,
      kind: 'routine',
      because: 'acontece sozinho, por horário ou condição',
      rejected,
      ...(temDecisao ? { suggestedPreset: 'monitor' } : {}),
      resolved: true,
    }
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
  return {
    jobId: job.id,
    jobName: job.name,
    kind: 'agent',
    because: temDecisao ? `exige julgamento: ${job.decision}` : 'exige interpretar linguagem e decidir o que responder',
    rejected,
    suggestedPreset: preset,
    resolved: true,
  }
}

export interface Classification {
  decisions: ResourceDecision[]
  /** Quantos agentes o desenho pede — a base do orçamento de complexidade. */
  agentCount: number
  /** Recurso citado que não existe no catálogo: vira pendência, nunca invenção. */
  unresolved: ResourceDecision[]
}

export function classifyBrief(brief: OperationBrief, manifest: ArchitectCapabilityManifest | null): Classification {
  const decisions = brief.jobs.map((j) => classifyJob(j, manifest))
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
