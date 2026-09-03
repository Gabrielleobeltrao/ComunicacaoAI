import { ObjectId } from 'mongodb'
import { clarifyingQuestion, noCurrentSource, policyFor } from './intent.js'
import { classifyIntent } from './classifyIntent.js'
import type { ClassifyIntentInput } from './classifyIntent.js'
import { capabilityFor, inventoryFor, resolveByName } from './assistantCapabilities.js'
import type { CapabilityOutcome } from './assistantCapabilities.js'
import type { ArchitectIntent } from './intent.js'
import { loadOfficeInventory, summarizeInventory } from './inventory.js'
import type { OfficeInventorySummary } from './inventory.js'
import { maskSecretsDeep } from './secrets.js'

// O ASSISTENTE GLOBAL — uma rodada de conversa que pode NÃO virar projeto.
//
// O Arquiteto V1 tem uma entrada só: toda mensagem entra num projeto e produz desenho. Quem
// pergunta "qual o valor do dólar hoje?" recebe uma proposta de operação, e um projeto que
// ninguém pediu fica no histórico da conta para sempre.
//
// Aqui a mensagem passa antes pelo roteador de intenção, e o MODO decide o que acontece:
//
//   answer   → responde. Não cria nada. Se a pergunta é sobre o agora, exige fonte real.
//   explain  → explica o que existe, lendo o inventário. Não cria nada.
//   propose  → é o único que cria ou reabre projeto.
//   operate  → leitura autorizada executa; escrita exige confirmação.
//
// O que atravessa o arquivo: o CONTEXTO da tela é uma referência, não conteúdo. O cliente
// manda "estou no andar X"; o servidor reconfirma que X é desta conta antes de usar. Um id
// que chega do cliente é um pedido, e aceitá-lo faria a resposta descrever o escritório de
// outra pessoa.

export interface ArchitectUiContext {
  pathname?: string
  buildingId?: string
  floorId?: string
  sectorId?: string
  agentId?: string
  resource?: { kind: string; id: string }
}

/** O contexto DEPOIS de conferido: só o que é mesmo desta conta sobrevive. */
export interface ResolvedUiContext {
  pathname: string
  floor?: { id: string; name: string }
  sector?: { id: string; name: string }
  agent?: { id: string; name: string }
  /** O que o cliente mandou e não é desta conta. Some do contexto e fica registrado. */
  rejected: string[]
}

/**
 * Confere o contexto da tela contra a conta.
 *
 * A rota NÃO pode confiar em id do cliente. A conferência é feita pelos getters canônicos,
 * que já filtram por dono — e o que não passa é descartado em silêncio para a resposta, mas
 * fica em `rejected` para quem for depurar.
 */
export async function resolveUiContext(ownerId: string, bruto: ArchitectUiContext | null | undefined): Promise<ResolvedUiContext> {
  const ctx = bruto ?? {}
  const out: ResolvedUiContext = { pathname: String(ctx.pathname ?? '').slice(0, 200), rejected: [] }

  const conferir = async <T>(campo: string, id: unknown, buscar: (i: ObjectId) => Promise<T | null>): Promise<T | null> => {
    const texto = String(id ?? '').trim()
    if (!texto) return null
    if (!ObjectId.isValid(texto)) {
      out.rejected.push(campo)
      return null
    }
    const achado = await buscar(new ObjectId(texto)).catch(() => null)
    if (!achado) out.rejected.push(campo)
    return achado
  }

  const { getFloor } = await import('../floors.js')
  const { getSectorById } = await import('../sectors.js')
  const { getAgentById } = await import('../agents.js')

  const andar = await conferir('floorId', ctx.floorId, (i) => getFloor(ownerId, i))
  if (andar) out.floor = { id: andar._id.toString(), name: String(andar.name) }

  const setor = await conferir('sectorId', ctx.sectorId, (i) => getSectorById(ownerId, i))
  if (setor) out.sector = { id: setor._id.toString(), name: String(setor.name) }

  const agente = await conferir('agentId', ctx.agentId, (i) => getAgentById(ownerId, i))
  if (agente) out.agent = { id: agente._id.toString(), name: String(agente.name) }

  return out
}

// --- a rodada -------------------------------------------------------------------------------

export type AssistantPhase =
  | 'answering'
  | 'consulting'
  | 'preparing_proposal'
  | 'awaiting_approval'
  | 'applying'
  | 'testing'
  | 'done'
  | 'failed'

export interface AssistantTurnResult {
  intent: ArchitectIntent
  phase: AssistantPhase
  /** O texto que a pessoa lê. Nunca contém segredo: passa pela máscara antes de sair. */
  text: string
  /** Uma pergunta curta, quando os dois caminhos são plausíveis. */
  question: string | null
  /** O projeto criado ou reaberto — só em `propose`. */
  projectId: string | null
  /** De onde veio o dado, quando a resposta é sobre o agora. */
  provenance?: { source: string; at: string; transformation?: string }
  context: ResolvedUiContext
  /** O que a conta tem, resumido. É o que a tela usa para explicar sem outra chamada. */
  inventory?: OfficeInventorySummary
  /** A escrita esperando confirmação. Só em `operate` de escrita. */
  pendingOperation?: { id: string; operationHash: string; summary: string; impact: string[]; expiresAt: string; requiresName?: string }
}

export interface AssistantTurnInput {
  ownerId: string
  message: string
  uiContext?: ArchitectUiContext | null
  /** Qual provedor classifica. O padrão é o mesmo que o Arquiteto usa nos projetos. */
  provider?: 'anthropic' | 'openai'
  model?: string | null
  /** A chamada ao provedor, injetável — é o que permite exercitar prazo e queda num teste. */
  ask?: ClassifyIntentInput['ask']
  /** Quanto esperar pela classificação antes de seguir com a heurística. */
  classifyTimeoutMs?: number
}

/** Teto do que entra: uma mensagem é um pedido, não um upload. */
export const ASSISTANT_LIMITS = { message: 4000 }

/**
 * Uma rodada do assistente global.
 *
 * O que ela NÃO faz é o ponto: `answer` e `explain` não criam projeto, não escrevem no
 * escritório e não acionam nada. É o roteador que decide, e a política é código.
 */
export async function runAssistantTurn(input: AssistantTurnInput): Promise<AssistantTurnResult> {
  const mensagem = String(input.message ?? '').slice(0, ASSISTANT_LIMITS.message)
  const context = await resolveUiContext(input.ownerId, input.uiContext)

  /**
   * A intenção é classificada NO SERVIDOR, com a chave da conta.
   *
   * Antes ela vinha no corpo da requisição: quem manda o corpo é o navegador, e bastava
   * mandar `{ mode: 'operate', risk: 'read' }` para escolher o caminho que executa. A
   * heurística continua existindo como rede — ela produz só modos que não mudam nada.
   */
  const onde = context.agent
    ? `o agente ${context.agent.name}`
    : context.sector
      ? `o setor ${context.sector.name}`
      : context.floor
        ? `o andar ${context.floor.name}`
        : ''
  const classificada = await classifyIntent({
    ownerId: input.ownerId,
    message: mensagem,
    provider: input.provider ?? 'anthropic',
    model: input.model ?? null,
    ...(onde ? { contextLine: onde } : {}),
    chargeKey: `assistant:${input.ownerId}:${Date.now()}`,
    ...(input.ask ? { ask: input.ask } : {}),
    ...(input.classifyTimeoutMs !== undefined ? { timeoutMs: input.classifyTimeoutMs } : {}),
  })
  const intent = classificada.intent
  const policy = policyFor(intent)
  const question = clarifyingQuestion(mensagem, intent)

  if (intent.mode === 'explain') {
    /**
     * "O que este agente faz?" pede a FUNÇÃO dele, não a contagem de andares.
     *
     * Quando a pergunta é sobre um recurso específico — porque a tela diz onde a pessoa está,
     * ou porque ela citou o nome — a resposta vem do recurso real, lido pelo getter canônico.
     * Só quando não há alvo é que a resposta é o panorama.
     */
    const sobreUm = await explicarRecurso(input.ownerId, intent, context)
    const resumo = summarizeInventory(await loadOfficeInventory(input.ownerId))
    return {
      intent,
      phase: 'done',
      text: sobreUm || explicar(resumo, context),
      question,
      projectId: null,
      context,
      inventory: resumo,
    }
  }

  if (intent.mode === 'answer') {
    if (policy.requiresProvenance) {
      /**
       * A resposta sobre o AGORA vem de uma fonte da conta — ou não vem.
       *
       * A capacidade procura entre as fontes ao vivo owner-scoped, reconfere a posse na hora
       * e devolve valor, origem e instante. Sem fonte compatível, a saída é uma recusa que
       * diz o que conectar: um valor lembrado apresentado como "hoje" não é uma resposta
       * pior, é uma resposta errada, e quem lê não tem como saber.
       */
      const r = await executarCapacidade(input.ownerId, 'answer', intent.query, undefined)
      if (r && r.ok) {
        return {
          intent,
          phase: 'done',
          text: `${r.text} — fonte: ${r.provenance?.source ?? 'desconhecida'}, lido em ${formatarInstante(r.provenance?.at)}.`,
          question,
          projectId: null,
          context,
          ...(r.provenance ? { provenance: r.provenance } : {}),
        }
      }
      const recusa = r && !r.ok ? r.reason : noCurrentSource(intent.query).reason
      return { intent, phase: 'failed', text: `${recusa}`, question, projectId: null, context }
    }

    /**
     * Pergunta ESTÁTICA: responde o provedor, e a rodada termina de qualquer jeito.
     *
     * O que ela não pode é devolver texto vazio numa fase intermediária: o campo do chat
     * ficava bloqueado esperando uma continuação que nunca vinha.
     */
    const texto = await responderEstatico(input, mensagem)
    return {
      intent,
      phase: texto ? 'done' : 'failed',
      text: texto || 'Não consegui responder agora. Tente de novo, ou me diga o que você quer montar.',
      question,
      projectId: null,
      context,
    }
  }

  if (intent.mode === 'operate') {
    if (policy.writesWithoutConfirmation) {
      // LEITURA autorizada executa de verdade e responde. Antes ela devolvia texto vazio.
      const r = await executarCapacidade(input.ownerId, 'operate', intent.action, intent.targetRef)
      if (r && r.ok) return { intent, phase: 'done', text: r.text, question, projectId: null, context }
      return {
        intent,
        phase: 'failed',
        text: r && !r.ok ? r.reason : 'não sei fazer essa consulta ainda — diga o que você quer ver',
        question,
        projectId: null,
        context,
      }
    }

    /**
     * ESCRITA nunca sai da conversa. Ela vira uma proposta de operação com prévia, impacto,
     * hash e prazo — confirmada num endpoint próprio.
     */
    const { prepararOperacao } = await import('./assistantOperate.js')
    const preparo = await prepararOperacao(input.ownerId, intent)
    return {
      intent,
      phase: preparo.ok ? 'awaiting_approval' : 'failed',
      text: preparo.ok ? preparo.text : preparo.reason,
      question,
      projectId: null,
      context,
      ...(preparo.ok ? { pendingOperation: preparo.pending } : {}),
    }
  }

  // `propose` é o ÚNICO modo que cria projeto.
  const { appendMessage, createProject } = await import('./repository.js')
  const projeto = await createProject(input.ownerId, {
    title: tituloDe(intent.objective),
    objective: intent.objective,
  })
  /**
   * A FRASE ORIGINAL entra no projeto como a primeira mensagem.
   *
   * Sem isto, quem pedia "observe CXSE3 e me avise quando o RSI cair abaixo de 30" no chat
   * abria um projeto vazio e tinha que digitar tudo de novo — e a segunda versão nunca é
   * igual à primeira. É ela que o entendimento do projeto lê para montar o Brief.
   */
  await appendMessage(input.ownerId, projeto._id, 'user', mensagem).catch(() => undefined)
  /**
   * A rodada TERMINA aqui — o projeto foi aberto.
   *
   * `preparing_proposal` como fase final deixava a tela num "preparando…" que nunca resolvia,
   * e o campo bloqueado: a pessoa não conseguia nem continuar a conversa nem abrir o projeto.
   * Montar a proposta é o próximo passo, dentro do projeto, e ele tem estado próprio.
   */
  return {
    intent,
    phase: 'done',
    text: maskSecretsDeep(`Vou montar isso. Comecei um projeto para "${tituloDe(intent.objective)}" — nada é aplicado sem a sua aprovação.`) as string,
    question,
    projectId: projeto._id.toString(),
    context,
  }
}

/** Um título curto a partir do objetivo. Sem isto, todo projeto se chamaria a frase inteira. */
const tituloDe = (objetivo: string): string => {
  const limpo = String(objetivo ?? '').replace(/\s+/g, ' ').trim()
  const primeira = limpo.split(/[.!?]/)[0] ?? limpo
  return (primeira.length > 60 ? `${primeira.slice(0, 57)}…` : primeira) || 'Nova operação'
}

/**
 * O que a conta tem, em português.
 *
 * O resumo é montado do inventário real — não de um texto do modelo. É a diferença entre
 * "você tem 3 andares" e "acho que você tem alguns andares".
 */
function explicar(resumo: OfficeInventorySummary, ctx: ResolvedUiContext): string {
  const partes: string[] = []
  const onde = ctx.agent ? `o agente ${ctx.agent.name}` : ctx.sector ? `o setor ${ctx.sector.name}` : ctx.floor ? `o andar ${ctx.floor.name}` : null
  if (onde) partes.push(`Você está olhando ${onde}.`)

  const contagem = (kind: string, singular: string, plural: string) => {
    const n = resumo.counts[kind] ?? 0
    if (!n) return null
    return `${n} ${n === 1 ? singular : plural}`
  }
  const organizacao = [contagem('floor', 'andar', 'andares'), contagem('sector', 'setor', 'setores'), contagem('agent', 'agente', 'agentes')].filter(Boolean)
  if (organizacao.length) partes.push(`O escritório tem ${organizacao.join(', ')}.`)

  const operacao = [
    contagem('source', 'fonte', 'fontes'),
    contagem('monitor', 'monitor', 'monitores'),
    contagem('flow', 'Flow', 'Flows'),
    contagem('database', 'Database', 'Databases'),
  ].filter(Boolean)
  if (operacao.length) partes.push(`Em operação: ${operacao.join(', ')}.`)

  if (resumo.attention.length) {
    partes.push(`Precisa de atenção: ${resumo.attention.slice(0, 3).join('; ')}.`)
  }
  return partes.join(' ') || 'Seu escritório ainda está vazio. Me diga o que você quer que ele faça.'
}

// --- os auxiliares da rodada ---------------------------------------------------------------

/**
 * Executa uma capacidade REGISTRADA — ou devolve `null` quando nenhuma atende.
 *
 * O modelo não escolhe a chave da capacidade. Ele descreve o pedido; o mapeamento para
 * handler é do código, e o risco declarado no registro é o que vale.
 */
async function executarCapacidade(
  ownerId: string,
  mode: 'answer' | 'operate',
  texto: string,
  targetRef: string | undefined,
): Promise<CapabilityOutcome | null> {
  const capacidade = capabilityFor(mode, texto)
  if (!capacidade) return null
  /**
   * Uma capacidade de ESCRITA não roda por este caminho, nunca.
   *
   * Este é o caminho da conversa. Se um dia o mapeamento devolvesse aqui uma capacidade de
   * escrita, ela sairia executada direto do texto — que é exatamente o que a prévia e a
   * confirmação existem para impedir.
   */
  if (capacidade.risk !== 'read') return { ok: false, reason: 'essa ação muda o escritório: preciso te mostrar a prévia antes' }
  try {
    return await capacidade.run({ ownerId, inventory: await inventoryFor(ownerId), query: texto, ...(targetRef ? { targetRef } : {}) })
  } catch (erro) {
    console.error('[architect] capacidade do assistente falhou:', (erro as Error)?.message)
    return { ok: false, reason: 'não consegui consultar agora' }
  }
}

/** "há 2 min", "agora mesmo" — o instante em português, para a resposta não virar ISO cru. */
function formatarInstante(iso: string | undefined): string {
  if (!iso) return 'agora'
  const quando = new Date(iso)
  if (Number.isNaN(quando.getTime())) return 'agora'
  const min = Math.round((Date.now() - quando.getTime()) / 60_000)
  if (min <= 0) return 'agora mesmo'
  if (min === 1) return 'há 1 minuto'
  if (min < 60) return `há ${min} minutos`
  const h = Math.round(min / 60)
  return h === 1 ? 'há 1 hora' : `há ${h} horas`
}

/**
 * A resposta de uma pergunta ESTÁTICA — a que não depende de agora.
 *
 * Ela vem do provedor, e o pior caso é uma string vazia, que a rodada trata como falha. O que
 * ela não pode fazer é deixar a conversa pendurada: antes daqui, `answer` devolvia texto vazio
 * numa fase intermediária, e o campo do chat ficava bloqueado esperando uma continuação que
 * nunca vinha.
 */
async function responderEstatico(input: AssistantTurnInput, mensagem: string): Promise<string> {
  try {
    const { askAuxWithUsage } = await import('../llm.js')
    const { getMonthlyTokenCap, getProviderApiKey } = await import('../userSettings.js')
    const { getMonthlyTokens, recordReplyUsageOnce } = await import('../tokenUsage.js')

    const provider = input.provider ?? 'anthropic'
    const apiKey = await getProviderApiKey(input.ownerId, provider)
    if (!apiKey) return ''
    const teto = await getMonthlyTokenCap(input.ownerId)
    if (teto > 0 && (await getMonthlyTokens(input.ownerId)) >= teto) return ''

    const prompt = [
      'Você é o assistente de um produto que monta escritórios de agentes de IA.',
      'Responda a pergunta abaixo em português, de forma direta e curta (no máximo 4 frases).',
      'Se a resposta depender de um dado de agora (cotação, saldo, clima), diga que precisa de uma fonte conectada em vez de estimar.',
      'Não invente números, datas nem nomes de recursos da conta.',
      '',
      `Pergunta: ${mensagem}`,
    ].join('\n')

    const chamada = (input.ask ?? askAuxWithUsage)(provider, prompt, input.model ?? null, apiKey, 600)
      .then(async (r) => {
        await recordReplyUsageOnce(input.ownerId, r.usage, `assistant:${input.ownerId}:${Date.now()}:answer`)
        return r
      })
      .catch(() => null)

    let expirou: NodeJS.Timeout | undefined
    const prazo = new Promise<null>((resolve) => {
      expirou = setTimeout(() => resolve(null), input.classifyTimeoutMs ?? 15_000)
      expirou.unref?.()
    })
    const r = await Promise.race([chamada, prazo])
    if (expirou) clearTimeout(expirou)
    return maskSecretsDeep(String(r?.text ?? '').trim().slice(0, 2000)) as string
  } catch (erro) {
    console.error('[architect] resposta estática falhou:', (erro as Error)?.message)
    return ''
  }
}

/**
 * O que UM recurso faz — lido dele, não inferido.
 *
 * Devolve `''` quando não há alvo: aí a resposta certa é o panorama. O que ela nunca faz é
 * inventar a função de um agente que não tem função escrita — nesse caso ela diz que está
 * vazia, que é o que a pessoa precisa saber para consertar.
 */
async function explicarRecurso(ownerId: string, intent: Extract<ArchitectIntent, { mode: 'explain' }>, ctx: ResolvedUiContext): Promise<string> {
  const { ObjectId: OID } = await import('mongodb')

  // O contexto da tela ganha da citação: quem está olhando um agente e pergunta "o que ele
  // faz?" está falando daquele, mesmo que o nome de outro apareça na frase.
  if (ctx.agent) return descreverAgente(await (await import('../agents.js')).getAgentById(ownerId, new OID(ctx.agent.id)))
  if (ctx.sector) {
    const setor = await (await import('../sectors.js')).getSectorById(ownerId, new OID(ctx.sector.id))
    if (setor) {
      const { SECTOR_MODE_LABEL } = await import('../sectors.js')
      const rotulo = SECTOR_MODE_LABEL[setor.mode as keyof typeof SECTOR_MODE_LABEL] ?? SECTOR_MODE_LABEL.organization
      return `O setor "${setor.name}" trabalha assim: ${rotulo.title.toLowerCase()} — ${rotulo.help} Ele tem ${setor.members?.length ?? 0} agente(s).`
    }
  }
  if (ctx.floor) {
    const andar = await (await import('../floors.js')).getFloor(ownerId, new OID(ctx.floor.id))
    if (andar) {
      const { listAgents } = await import('../agents.js')
      const equipe = (await listAgents(ownerId).catch(() => [])).filter((a) => String(a.officeId) === ctx.floor!.id)
      const missao = String(andar.mission ?? '').trim()
      return `O andar "${andar.name}" ${missao ? `existe para ${missao.toLowerCase()}` : 'ainda não tem missão escrita'}. Nele trabalham ${equipe.length} agente(s)${equipe.length ? `: ${equipe.slice(0, 5).map((a) => a.name).join(', ')}` : ''}.`
    }
  }

  // Sem contexto de tela: o nome citado, resolvido contra o inventário.
  if (intent.targetRef) {
    const inv = await inventoryFor(ownerId)
    const achado = resolveByName(inv, ['agent', 'sector', 'floor'], intent.targetRef)
    if (achado?.kind === 'agent') return descreverAgente(await (await import('../agents.js')).getAgentById(ownerId, new OID(achado.item.id)))
  }
  return ''
}

/** A ficha do agente, em português — e a pendência quando ela está vazia. */
function descreverAgente(agente: { name?: unknown; role?: unknown; objective?: unknown; instructions?: unknown } | null): string {
  if (!agente) return ''
  const nome = String(agente.name ?? 'Este agente')
  const funcao = String(agente.role ?? '').trim()
  const objetivo = String(agente.objective ?? '').trim()
  if (!funcao && !objetivo) {
    /**
     * A resposta honesta para um agente sem função escrita é dizer isso.
     *
     * Inventar uma descrição plausível a partir do nome é o erro mais fácil de cometer aqui —
     * e o mais difícil de perceber, porque a frase soa certa.
     */
    return `${nome} está sem função escrita. Abra o agente e diga o que ele faz: sem isso, ninguém — nem outro agente que fosse delegar para ele — consegue saber.`
  }
  const partes = [`${nome} ${funcao ? `faz: ${funcao}` : `existe para ${objetivo}`}.`]
  if (funcao && objetivo) partes.push(`O objetivo dele é ${objetivo}.`)
  return partes.join(' ')
}
