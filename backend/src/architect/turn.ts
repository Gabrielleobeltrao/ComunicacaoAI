import { askAuxWithUsage } from '../llm.js'
import type { TokenUsage } from '../llm.js'
import { getMonthlyTokenCap, getProviderApiKey } from '../userSettings.js'
import { getMonthlyTokens, recordReplyUsageOnce } from '../tokenUsage.js'
import { maskSecretsDeep } from './secrets.js'
import { buildRepairPrompt } from './prompt.js'
import * as L from './limits.js'

// UMA rodada de conversa com o modelo.
//
// Três coisas acontecem aqui, nesta ordem, e a ordem é o ponto: confere o limite ANTES
// de gastar, chama, e contabiliza o que gastou — inclusive quando a resposta veio
// impossível de ler. Um erro de formato não devolve os tokens que já foram cobrados
// pelo provedor; deixar de registrar aí seria consumo invisível.
//
// A saída é um objeto ou uma recusa tipada. Texto do modelo nunca vira comando: quem
// lê é o parser abaixo, e o que não couber no formato é recusado.

export interface ArchitectQuestion {
  key: string
  text: string
  why: string
  choices?: { value: string; label: string }[]
  allowUnknown: boolean
}

export interface ArchitectTurnResult {
  assistantText: string
  phase: 'discovery' | 'proposal' | 'revision'
  question: ArchitectQuestion | null
  answerPatch: Record<string, unknown>
  blueprintPatch: Record<string, unknown> | null
  assumptions: { key: string; text: string; questionKey?: string }[]
  warnings: { path: string; message: string }[]
}

export type TurnFailure =
  | { code: 'no_provider_key'; message: string }
  | { code: 'budget_exceeded'; message: string }
  | { code: 'unreadable_response'; message: string }
  | { code: 'provider_error'; message: string }

export type TurnOutcome = { ok: true; result: ArchitectTurnResult; usage: TokenUsage } | { ok: false; failure: TurnFailure; usage: TokenUsage }

const semUso = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0 })
const somar = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens })

/**
 * Tira o JSON de uma resposta que pode ter vindo com cerca de código ou conversa em
 * volta. Não é leniência: o formato continua sendo objeto único: isto só remove o
 * embrulho que os modelos insistem em pôr.
 */
export function extractJson(bruto: string): unknown {
  const texto = bruto.trim()
  const semCerca = texto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const tentativas = [semCerca]
  const inicio = semCerca.indexOf('{')
  const fim = semCerca.lastIndexOf('}')
  if (inicio >= 0 && fim > inicio) tentativas.push(semCerca.slice(inicio, fim + 1))
  for (const t of tentativas) {
    try {
      const v = JSON.parse(t)
      if (v && typeof v === 'object' && !Array.isArray(v)) return v
    } catch {
      // tenta a próxima
    }
  }
  return null
}

const texto = (v: unknown, teto: number): string => (typeof v === 'string' ? v.slice(0, teto) : '')

/**
 * Dá forma ao que o modelo devolveu — campo a campo, e nada mais.
 *
 * Um espalhamento (`...resposta`) deixaria qualquer campo extra entrar e seguir até o
 * banco. Aqui, o que não está escrito não existe.
 */
export function normalizeTurn(bruto: unknown): ArchitectTurnResult | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  const r = bruto as Record<string, unknown>
  const assistantText = texto(r.assistantText, L.MAX_MESSAGE_CHARS)
  if (!assistantText.trim()) return null

  const fase = texto(r.phase, 20)
  const phase = fase === 'proposal' || fase === 'revision' ? fase : 'discovery'

  let question: ArchitectQuestion | null = null
  const q = r.question
  if (q && typeof q === 'object' && !Array.isArray(q)) {
    const qq = q as Record<string, unknown>
    const key = texto(qq.key, L.MAX_KEY_CHARS).trim()
    const text = texto(qq.text, L.MAX_SHORT_TEXT_CHARS).trim()
    if (key && text) {
      question = {
        key,
        text,
        why: texto(qq.why, L.MAX_SHORT_TEXT_CHARS),
        allowUnknown: qq.allowUnknown !== false,
        ...(Array.isArray(qq.choices)
          ? {
              choices: qq.choices
                .slice(0, 8)
                .map((c) => {
                  const cc = (c ?? {}) as Record<string, unknown>
                  return { value: texto(cc.value, 80), label: texto(cc.label, 120) }
                })
                .filter((c) => c.value && c.label),
            }
          : {}),
      }
    }
  }

  const answerPatch: Record<string, unknown> = {}
  if (r.answerPatch && typeof r.answerPatch === 'object' && !Array.isArray(r.answerPatch)) {
    for (const [k, v] of Object.entries(r.answerPatch as Record<string, unknown>).slice(0, L.MAX_ANSWERS)) {
      answerPatch[k.slice(0, L.MAX_KEY_CHARS)] = typeof v === 'string' ? v.slice(0, L.MAX_ANSWER_CHARS) : v
    }
  }

  const blueprintPatch = r.blueprintPatch && typeof r.blueprintPatch === 'object' && !Array.isArray(r.blueprintPatch) ? (r.blueprintPatch as Record<string, unknown>) : null

  const lista = <T>(v: unknown, fn: (o: Record<string, unknown>) => T | null, teto: number): T[] =>
    Array.isArray(v)
      ? (v
          .slice(0, teto)
          .map((o) => (o && typeof o === 'object' ? fn(o as Record<string, unknown>) : null))
          .filter(Boolean) as T[])
      : []

  const resultado: ArchitectTurnResult = {
    assistantText,
    phase,
    question,
    answerPatch,
    blueprintPatch,
    assumptions: lista(
      r.assumptions,
      (o) => {
        const t = texto(o.text, L.MAX_SHORT_TEXT_CHARS).trim()
        return t ? { key: texto(o.key, L.MAX_KEY_CHARS) || t.slice(0, 40), text: t, ...(o.questionKey ? { questionKey: texto(o.questionKey, L.MAX_KEY_CHARS) } : {}) } : null
      },
      L.MAX_ASSUMPTIONS,
    ),
    warnings: lista(
      r.warnings,
      (o) => {
        const m = texto(o.message, L.MAX_SHORT_TEXT_CHARS).trim()
        return m ? { path: texto(o.path, L.MAX_KEY_CHARS), message: m } : null
      },
      L.MAX_WARNINGS,
    ),
  }

  // O modelo pode ecoar uma credencial que a pessoa colou. Mascarar aqui, antes de
  // qualquer gravação, é a última chance de o segredo não entrar no banco.
  return maskSecretsDeep(resultado)
}

export interface RunTurnInput {
  ownerId: string
  provider: 'anthropic' | 'openai'
  model: string | null
  prompt: string
  /** Chave de cobrança estável: a mesma rodada, repetida, não cobra duas vezes. */
  chargeKey: string
  maxTokens?: number
}

/**
 * Confere o limite, chama, contabiliza e devolve o objeto — ou uma recusa tipada.
 *
 * Exatamente UMA tentativa de reparo. Depois disso, a rodada falha de forma segura e a
 * pessoa tenta de novo: insistir em ciclo transformaria uma resposta ruim numa conta
 * alta, e é justamente quando o modelo está confuso que ele erra de novo.
 */
export async function runArchitectTurn(input: RunTurnInput): Promise<TurnOutcome> {
  const apiKey = await getProviderApiKey(input.ownerId, input.provider)
  if (!apiKey) {
    return { ok: false, failure: { code: 'no_provider_key', message: 'Configure a chave do provedor em Configurações para o Arquiteto poder trabalhar.' }, usage: semUso() }
  }

  // O limite é conferido ANTES de gastar. Depois da chamada, o gasto já aconteceu.
  const teto = await getMonthlyTokenCap(input.ownerId)
  if (teto > 0 && (await getMonthlyTokens(input.ownerId)) >= teto) {
    return { ok: false, failure: { code: 'budget_exceeded', message: 'O limite mensal de tokens desta conta foi atingido.' }, usage: semUso() }
  }

  const maxTokens = input.maxTokens ?? 8000
  let usoTotal = semUso()

  const chamar = async (prompt: string, sufixoDaChave: string): Promise<{ text: string } | { erro: TurnFailure }> => {
    try {
      const { text, usage } = await askAuxWithUsage(input.provider, prompt, input.model, apiKey, maxTokens)
      usoTotal = somar(usoTotal, usage)
      // Cobrado mesmo quando a resposta é ilegível: o provedor já cobrou.
      await recordReplyUsageOnce(input.ownerId, usage, `${input.chargeKey}${sufixoDaChave}`)
      return { text }
    } catch (error) {
      // Nada da mensagem do provedor vai adiante: ela pode conter a URL com a chave.
      console.error('[architect] falha na chamada ao provedor:', (error as Error).message)
      return { erro: { code: 'provider_error', message: 'O provedor não respondeu. Tente novamente em instantes.' } }
    }
  }

  const primeira = await chamar(input.prompt, '')
  if ('erro' in primeira) return { ok: false, failure: primeira.erro, usage: usoTotal }

  const normalizada = normalizeTurn(extractJson(primeira.text))
  if (normalizada) return { ok: true, result: normalizada, usage: usoTotal }

  const reparo = await chamar(buildRepairPrompt(primeira.text, 'não veio um objeto JSON com os campos esperados'), ':repair')
  if ('erro' in reparo) return { ok: false, failure: reparo.erro, usage: usoTotal }

  const segunda = normalizeTurn(extractJson(reparo.text))
  if (segunda) return { ok: true, result: segunda, usage: usoTotal }

  return {
    ok: false,
    failure: { code: 'unreadable_response', message: 'A resposta do modelo não pôde ser lida. Tente enviar a mensagem novamente.' },
    usage: usoTotal,
  }
}
