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
