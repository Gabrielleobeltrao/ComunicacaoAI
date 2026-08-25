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
  return prompt.includes(ARCHITECT_MARKER) ? architectTurn(prompt) : ''
}

/** A marca que o prompt do Arquiteto carrega. Ver `architect/prompt.ts`. */
export const ARCHITECT_MARKER = '[[ARQUITETO_V1]]'

/**
 * Duas rodadas, e nada mais: a primeira pergunta, a segunda propõe.
 *
 * A escolha é feita pelo que já está na conversa — se a pergunta dos canais já foi
 * feita, é hora de propor. Nada de contador escondido: o teste consegue reproduzir a
 * jornada mandando as mensagens na ordem.
 */
function architectTurn(prompt: string): string {
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
      appRequirements: [{ key: 'canal-web', appKey: 'web-chat', reason: 'Receber as conversas do site.', required: true, actionKeys: [], agentKeys: ['gerente'] }],
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
