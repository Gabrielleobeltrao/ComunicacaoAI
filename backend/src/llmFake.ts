// Um provedor de LLM que não chama ninguém, para o smoke de MVP.
//
// Existe por um motivo só: o smoke precisa de uma execução REAL ponta a ponta —
// rotina disparada, raiz criada, evento gravado, log visível — sem depender de
// chave, rede ou de o que um modelo resolveu responder naquele dia. Ele devolve
// texto determinístico e contabiliza tokens como qualquer provedor.
//
// O portão que impede isto de existir em produção está no `llm.ts` e é avaliado
// UMA vez, no carregamento do módulo, a partir de `NODE_ENV`. Não há caminho de
// runtime que ligue este adaptador num processo que subiu como `production`:
// nenhuma rota, nenhuma configuração de usuário, nenhuma variável lida depois do
// boot. `llmFakeGate.test.mjs` afirma isso.
import type { ResolvedTool, ToolCallRecord } from './agentTools.js'
import type { ChatTurn, RouterOption, StageTransitionOption, SectorPlan } from './systemPrompt.js'

export const AUXILIARY_MODEL = 'fake-aux'
// O dublê também precisa dizer qual é o padrão dele: quem pergunta é a mesma função.
export const DEFAULT_MODEL = 'fake-model'

// Contagem estável: o mesmo texto sempre "custa" o mesmo, então uma asserção de
// métrica no smoke não fica dependendo de tokenizador de ninguém.
const countTokens = (s: string): number => Math.max(1, Math.ceil(s.length / 4))

const reply = (input: string): string => `[fake] ${input.trim().slice(0, 160)}`

export async function generateAgentReply(
  objective: string,
  knowledge: string[],
  memory: string,
  history: ChatTurn[],
  _model: string | null | undefined,
  _apiKey: string | null | undefined,
  _identityInstruction = '',
  _guardrailInstruction = '',
  _responseStyleInstruction = '',
  _enableCaching = true,
  _tools: ResolvedTool[] = [],

  // Assinatura idêntica à dos provedores reais: o dublê existe para trocar de lugar
  // com eles, e um parâmetro a menos aqui esconderia um erro de chamada.
  opts: { runConfig?: unknown } = {},
): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number }; toolCalls: ToolCallRecord[] }> {
  const last = history[history.length - 1]?.content ?? objective
  const text = reply(last)
  return {
    text,
    usage: { inputTokens: countTokens(objective + knowledge.join('') + memory + last), outputTokens: countTokens(text) },
    // Sem chamada de ferramenta: o smoke exercita o CAMINHO da execução, não a
    // decisão de um modelo sobre qual ferramenta usar.
    toolCalls: [],
  }
}

// Guardrail sempre libera: o smoke não testa moderação, e um "bloqueado"
// aleatório transformaria o teste numa moeda.
export async function checkGuardrail(): Promise<boolean> {
  return true
}

// O dublê não planeja: devolver vazio faz o planejador cair no determinístico, que é o
// comportamento que o teste quer observar.
export async function askAux(): Promise<string> {
  return ''
}

/**
 * O dublê da chamada estruturada.
 *
 * Devolve uma resposta DETERMINÍSTICA e válida para o Arquiteto quando o prompt é
 * dele, e vazio para o resto — o mesmo contrato de `askAux`. É isto que permite a
 * jornada inteira (perguntar, propor, aplicar) rodar no teste sem chave, sem rede e
 * sem depender do que um modelo resolveu responder naquele dia.
 *
 * O portão que impede este arquivo de existir em produção está no `llm.ts`.
 */
export async function askAuxWithUsage(prompt: string): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
  const text = respostaDoDuble(prompt)
  return { text, usage: { inputTokens: countTokens(prompt), outputTokens: countTokens(text) } }
}

function respostaDoDuble(prompt: string): string {
  // O REPARO é conferido antes da rodada: os dois prompts carregam a mesma marca, e
  // tratar um pedido de reparo como rodada nova faria o dublê "consertar" respondendo
  // outra coisa — e o caminho da resposta ilegível deixaria de existir.
  const reparo = /<resposta-anterior>([\s\S]*)<\/resposta-anterior>/.exec(prompt)
  if (reparo) {
    // Um modelo de verdade consegue reemitir o que já era objeto; do que veio vazio ou
    // truncado ele não tira JSON nenhum — e é assim aqui também.
    const inicio = reparo[1].indexOf('{')
    const fim = reparo[1].lastIndexOf('}')
    if (inicio < 0 || fim <= inicio) return ''
    try {
      return JSON.stringify(JSON.parse(reparo[1].slice(inicio, fim + 1)))
    } catch {
      return ''
    }
  }
  if (prompt.includes(INTENT_MARKER)) return architectIntent(prompt)
  if (prompt.includes(CRITIQUE_MARKER)) return architectCritique()
  return prompt.includes(ARCHITECT_MARKER) ? architectTurn(prompt) : ''
}

/**
 * A VIGILÂNCIA — o Brief que "observe X e me avise quando Y" tem que produzir.
 *
 * Determinístico como o resto do dublê: mesma entrada, mesmo Brief. O que ele carrega e o
 * outro não é o que faz a cadeia existir — um dado que chega continuamente, uma condição
 * sobre esse dado, e um limiar.
 */
function architectTurnVigilancia(prompt: string): string {
  const jaPerguntou = prompt.includes('cadencia-da-vigilancia')
  if (!jaPerguntou) {
    return JSON.stringify({
      assistantText: 'Para vigiar isso, de quanto em quanto tempo eu olho?',
      phase: 'discovery',
      question: {
        key: 'cadencia-da-vigilancia',
        text: 'De quanto em quanto tempo eu olho o dado?',
        why: 'A cadência decide o custo e a rapidez do aviso.',
        choices: [
          { value: 'candle', label: 'A cada fechamento de candle' },
          { value: 'minuto', label: 'A cada minuto' },
        ],
        allowUnknown: true,
      },
      answerPatch: {},
      blueprintPatch: null,
      assumptions: [],
      warnings: [],
    })
  }
  /**
   * O canal PEDIDO é preservado.
   *
   * O dublê devolvia `channels: ['web']` sempre. Quem escrevia "me avise pelo WhatsApp" recebia
   * um Brief que dizia "web": a proposta ficava correta sobre tudo menos sobre a única coisa
   * que a pessoa pediu por escrito, e o teste em cima disso mediria o dublê.
   */
  const canal = /whats\s?app|zap\b/i.test(prompt) ? 'WhatsApp' : /telegram/i.test(prompt) ? 'Telegram' : /\be-?mail\b/i.test(prompt) ? 'E-mail' : 'web'
  return JSON.stringify({
    assistantText: 'Montei a vigilância. Confira antes de aplicar.',
    phase: 'proposal',
    question: null,
    answerPatch: {},
    briefPatch: {
      businessGoal: `acompanhar CXSE3 e avisar${canal === 'web' ? '' : ` pelo ${canal}`} quando o RSI ficar abaixo de 30`,
      channels: [canal],
      // O dado que chega continuamente: sem ele não há série, e sem série não há borda.
      liveDataNeeds: [{ source: 'cotação CXSE3', freshness: 'até 1 minuto', required: true }],
      recordsToKeep: [{ subject: 'Candles CXSE3', fields: ['fechamento', 'rsi'], retentionDays: 365 }],
      jobs: [
        {
          id: 'avisar-rsi',
          name: 'Avisar sobre o RSI de CXSE3',
          trigger: 'quando o RSI ficar abaixo de 30',
          input: 'as cotações de CXSE3',
          decision: '',
          action: 'avisar',
          output: `o aviso${canal === 'web' ? '' : ` pelo ${canal}`} de que o RSI caiu abaixo de 30`,
          frequency: 'a cada fechamento de candle',
        },
      ],
    },
    // O sinal de "já dá para propor". O desenho quem faz é o compilador.
    blueprintPatch: {
      title: 'Vigilância de CXSE3',
      objective: 'avisar quando o RSI ficar abaixo de 30',
      floors: [{ key: 'operacao', action: 'create', name: 'Operação', workMode: 'organization', rationale: 'onde a vigilância mora' }],
      agents: [],
      sectors: [],
      routines: [],
      appRequirements: [],
      knowledgeRequirements: [],
      assumptions: [],
      warnings: [],
      checklist: [],
      version: 1,
    },
    assumptions: [],
    warnings: [],
  })
}

/** A marca que o prompt do Arquiteto carrega. Ver `architect/prompt.ts`. */
export const ARCHITECT_MARKER = '[[ARQUITETO_V1]]'

/** A do crítico auxiliar. Ver `architect/criticLlm.ts`. */
export const CRITIQUE_MARKER = '[[ARQUITETO_CRITICA_V1]]'

/** A do roteador de intenção. Ver `architect/classifyIntent.ts`. */
export const INTENT_MARKER = '[[ARQUITETO_INTENCAO_V1]]'

/**
 * A classificação do dublê — por forma da frase, sempre igual.
 *
 * Ele não é um modelo: é um substituto determinístico que devolve o MESMO formato que o
 * roteador espera, para o caminho da classificação ser exercitável sem chave nem rede. As
 * regras aqui são grosseiras de propósito — quem precisa acertar de verdade é o modelo, e
 * quem protege contra o erro dele é `parseIntent`.
 */
function architectIntent(prompt: string): string {
  const msg = (/Mensagem: "([\s\S]*)"\s*$/.exec(prompt)?.[1] ?? '').toLowerCase()
  if (/\b(observe|monitore|acompanhe|me avise|vigie|automatize|crie|monte|adicione)\b/.test(msg)) {
    return JSON.stringify({ mode: 'propose', changeKind: /\b(adicione|expanda|também)\b/.test(msg) ? 'expand' : 'create', objective: msg.slice(0, 200) })
  }
  if (/\b(liste|listar|mostre|pause|pausar|ative|ativar)\b/.test(msg)) {
    const escreve = /\b(pause|pausar|ative|ativar)\b/.test(msg)
    return JSON.stringify({ mode: 'operate', action: msg.slice(0, 120), risk: escreve ? 'write' : 'read' })
  }
  if (/\b(meu|minha|este|esta|aqui)\b/.test(msg) && /\?/.test(msg)) {
    return JSON.stringify({ mode: 'explain', question: msg.slice(0, 120) })
  }
  const agora = /\b(hoje|agora|atual|cotação|valor do|preço do)\b/.test(msg)
  return JSON.stringify({ mode: 'answer', query: msg.slice(0, 120), freshness: agora ? 'current' : 'static' })
}

/**
 * A leitura auxiliar do dublê: um achado, sem agente, sempre igual.
 *
 * Sem `agentKey` de propósito — o desenho é compilado, e um dublê que fixasse uma
 * chave passaria a testar o compilador em vez do caminho do crítico.
 */
function architectCritique(): string {
  return JSON.stringify({
    findings: [
      {
        code: 'limite_vago',
        message: 'Nenhum agente diz o que NÃO faz; sem isso os dois se sobrepõem na primeira dúvida difícil.',
        fix: 'Escreva uma linha de "não faz" em cada agente.',
        evidence: ['não faz: (não declarado)'],
      },
    ],
  })
}

/**
 * Duas rodadas, e nada mais: a primeira pergunta, a segunda propõe.
 *
 * A escolha é feita pelo que já está na conversa — se a pergunta dos canais já foi
 * feita, é hora de propor. Nada de contador escondido: o teste consegue reproduzir a
 * jornada mandando as mensagens na ordem.
 */
function architectTurn(prompt: string): string {
  /**
   * O dublê responde ao QUE FOI PEDIDO — e não a um roteiro fixo.
   *
   * Ele devolvia o restaurante para qualquer mensagem. Um teste de "observe CXSE3 e me avise
   * quando o RSI cair abaixo de 30" recebia um Brief de atendimento, zero fontes e zero
   * monitores — e passava, porque nada afirmava que a cadeia tinha nascido. Um dublê que
   * ignora a entrada faz o teste medir o dublê.
   */
  /**
   * O gatilho é o PAPEL, e não a palavra "RSI".
   *
   * O prompt carrega o catálogo de capacidades, e o catálogo descreve `calculate_rsi` como
   * "Calcula o RSI (Wilder)...". Rotear por `\brsi\b` fazia a conversa do restaurante cair
   * na vigilância assim que a função entrou no manifesto: o dublê passava a responder ao
   * texto do sistema em vez de responder à pessoa.
   */
  if (/cxse3/i.test(prompt)) return architectTurnVigilancia(prompt)
  const jaPerguntou = prompt.includes('canais-de-atendimento')
  if (!jaPerguntou) {
    return JSON.stringify({
      assistantText: 'Para montar o atendimento, primeiro: por onde as pessoas falam com você hoje?',
      phase: 'discovery',
      question: {
        key: 'canais-de-atendimento',
        text: 'Por onde as pessoas falam com você hoje?',
        why: 'O canal decide quem recebe a conversa.',
        choices: [
          { value: 'web', label: 'Site' },
          { value: 'whatsapp', label: 'WhatsApp' },
        ],
        allowUnknown: true,
      },
      answerPatch: {},
      blueprintPatch: null,
      assumptions: [],
      warnings: [],
    })
  }
  return JSON.stringify({
    assistantText: 'Montei uma primeira proposta. Confira antes de aplicar.',
    phase: 'proposal',
    question: null,
    answerPatch: {},
    /**
     * O ENTENDIMENTO é o que o dublê preenche — o desenho quem faz é o compilador.
     *
     * O `blueprintPatch` abaixo continua vindo porque é o sinal de "já dá para propor",
     * e porque projeto sem Brief ainda usa o caminho antigo. Mas num projeto com Brief
     * quem manda é isto aqui: mudar um `job` daqui muda a proposta inteira, que é
     * exatamente o que a jornada de verdade faz.
     */
    briefPatch: {
      businessGoal: 'atender quem chega pelo site do restaurante',
      channels: ['web'],
      jobs: [
        {
          id: 'duvidas',
          name: 'Responder dúvidas de horário, endereço e cardápio',
          trigger: 'alguém manda mensagem no site',
          input: 'a pergunta da pessoa',
          decision: 'qual resposta cabe, e o que precisa ser confirmado',
          action: 'responder',
          output: 'a resposta para a pessoa',
        },
        {
          id: 'reclamacoes',
          name: 'Avaliar reclamações e recomendar o que fazer',
          trigger: 'a conversa vira reclamação',
          input: 'o que a pessoa relatou',
          decision: 'a gravidade e o que priorizar',
          action: 'recomendar o encaminhamento',
          output: 'a recomendação para o dono',
        },
      ],
      knowledgeNeeds: [{ subject: 'Cardápio com preços', required: true }],
    },
    blueprintPatch: {
      title: 'Atendimento do Restaurante',
      objective: 'atender dúvidas e registrar pedidos',
      floors: [{ key: 'atendimento', action: 'create', name: 'Atendimento do Restaurante', workMode: 'organization', rationale: 'Onde a operação de atendimento mora.' }],
      agents: [
        { key: 'gerente', action: 'create', floorKey: 'atendimento', name: 'Gerente de atendimento', preset: 'manager', objective: 'Distribuir a conversa para quem sabe responder.', rationale: 'Recebe a conversa e decide quem responde.' },
        { key: 'duvidas', action: 'create', floorKey: 'atendimento', name: 'Atendente de dúvidas', preset: 'communicator', objective: 'Responder horários, endereço e cardápio.', rationale: 'Responde o que mais perguntam.' },
      ],
      sectors: [
        {
          key: 'setor-atendimento',
          action: 'create',
          floorKey: 'atendimento',
          name: 'Atendimento',
          mode: 'orchestrated',
          memberAgentKeys: ['gerente', 'duvidas'],
          coordinatorAgentKey: 'gerente',
          rationale: 'Uma porta de entrada só, com o gerente distribuindo.',
        },
      ],
      knowledgeRequirements: [
        {
          key: 'cardapio',
          scope: 'agent',
          targetKey: 'duvidas',
          title: 'Enviar o cardápio com preços',
          description: 'Sem ele, o agente não responde preço nenhum.',
          required: true,
          expectedSource: 'upload',
          state: 'missing',
        },
      ],
      appRequirements: [{ key: 'canal-web', appKey: 'web_chat', reason: 'Receber as conversas do site.', required: true, actionKeys: [], agentKeys: ['gerente'] }],
      assumptions: [{ key: 'horario', text: 'Assumi atendimento em horário comercial.', questionKey: 'horarios' }],
      warnings: [],
      checklist: [],
    },
    assumptions: [{ key: 'horario', text: 'Assumi atendimento em horário comercial.', questionKey: 'horarios' }],
    warnings: [],
  })
}

export async function planSectorResponse(
  options: RouterOption[],
  _currentIndices: number[],
  defaultIndex: number,
): Promise<SectorPlan> {
  return { specialists: [Math.min(defaultIndex, Math.max(0, options.length - 1))], clarify: false }
}

export async function planStageTransition(): Promise<number> {
  return 0
}

export async function extractStructuredOutput(
  _fields: string[],
  currentData: Record<string, string>,
): Promise<Record<string, string>> {
  return currentData
}

export async function updateMemory(currentMemory: string): Promise<string> {
  return currentMemory
}

export async function updateStructuredMemory(currentMemory: Record<string, string>): Promise<Record<string, string>> {
  return currentMemory
}

export async function extractIdentity(): Promise<Record<string, string> | null> {
  return null
}

export async function transcribeImage(): Promise<string> {
  return '[fake] imagem'
}

export async function listAvailableModels(): Promise<{ id: string; label: string }[]> {
  return [{ id: 'fake-model', label: 'Fake (smoke)' }]
}
