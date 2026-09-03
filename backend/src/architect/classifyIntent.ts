import { askAuxWithUsage } from '../llm.js'
import { getMonthlyTokenCap, getProviderApiKey } from '../userSettings.js'
import { getMonthlyTokens, recordReplyUsageOnce } from '../tokenUsage.js'
import { extractJson } from './turn.js'
import { parseIntent, suggestIntent } from './intent.js'
import type { ArchitectIntent } from './intent.js'

// QUEM DECIDE O MODO — e por que a decisão não pode vir do cliente.
//
// A rodada do assistente aceitava um `classified` no corpo da requisição. Quem manda o corpo
// é o navegador: bastava mandar `{ mode: 'operate', risk: 'read' }` para escolher o caminho
// que executa. A intenção passou a ser classificada AQUI, com a chave da conta, e o que vem
// do cliente é ignorado.
//
// Duas garantias que este arquivo carrega:
//
//   O MODELO CLASSIFICA, O CÓDIGO DECIDE. A saída dele é normalizada por `parseIntent`, que
//   arranca ObjectId de todo campo e escala o risco na dúvida. Um modo que não existe vira
//   `answer`, que é o modo que não faz nada.
//
//   FALHAR NÃO PODE CALAR. Sem chave, sem orçamento, provedor fora, resposta ilegível ou
//   demora demais caem todos na heurística — que responde pior, mas responde. Uma conversa
//   que fica muda porque o provedor piscou é pior que uma classificação imperfeita.

/** Quanto tempo esperar pela classificação antes de seguir com a heurística. */
export const INTENT_CLASSIFY_TIMEOUT_MS = 8000

export interface ClassifyIntentInput {
  ownerId: string
  message: string
  provider: 'anthropic' | 'openai'
  model?: string | null
  /** Uma linha sobre onde a pessoa está. Ajuda a separar "o que é isto?" de "o que eu tenho?". */
  contextLine?: string
  chargeKey: string
  timeoutMs?: number
  /** A chamada ao provedor, injetável — é o único jeito de exercitar o prazo num teste. */
  ask?: typeof askAuxWithUsage
}

export interface ClassifiedIntent {
  intent: ArchitectIntent
  /** `model` quando o provedor decidiu; `heuristic` quando ele não pôde. */
  by: 'model' | 'heuristic'
  /** Por que caiu na heurística. Só para diagnóstico — nunca vai para a tela. */
  fallbackReason?: string
}

export const INTENT_MARKER = '[[ARQUITETO_INTENCAO_V1]]'

const PROMPT = `${INTENT_MARKER}
Você classifica a INTENÇÃO de uma mensagem para um assistente que monta e opera escritórios de agentes.

Responda SOMENTE com um objeto JSON, sem texto antes ou depois, com um destes formatos:

{"mode":"answer","query":"<o que a pessoa quer saber>","freshness":"current"|"static"}
{"mode":"explain","question":"<o que ela quer entender>","targetRef":"<nome do recurso, ou omita>"}
{"mode":"operate","action":"<a ação em uma frase>","risk":"read"|"write"|"high_risk","targetRef":"<nome do recurso, ou omita>"}
{"mode":"propose","changeKind":"create"|"expand"|"repair"|"reorganize","objective":"<o que construir>"}

Como escolher:
- "answer": pergunta sobre o MUNDO ou sobre um dado. "freshness":"current" quando a resposta depende de agora (cotação, saldo, estoque, clima); "static" quando não depende.
- "explain": pergunta sobre o ESCRITÓRIO DELA — o que um agente faz, como o atendimento funciona, o que ela já tem.
- "operate": pedido para AGIR sobre algo que já existe — listar, pausar, ativar, apagar, reprocessar. "read" só quando nada muda; "write" quando muda; "high_risk" quando apaga, revoga ou é irreversível.
- "propose": pedido para CONSTRUIR ou MUDAR a estrutura — criar agente, automatizar, montar operação, vigiar um dado.

Na dúvida entre "operate" e "propose", escolha "propose". Na dúvida sobre o risco, escolha o maior.
Nunca invente identificadores. Em "targetRef" use o NOME que a pessoa escreveu, nunca um código.`

/**
 * Classifica a intenção com o provedor, e cai na heurística quando ele não pode responder.
 *
 * Nada aqui lança: o pior caso é `by: 'heuristic'`.
 */
export async function classifyIntent(input: ClassifyIntentInput): Promise<ClassifiedIntent> {
  const mensagem = String(input.message ?? '').trim()
  const daHeuristica = (motivo: string): ClassifiedIntent => ({ intent: suggestIntent(mensagem), by: 'heuristic', fallbackReason: motivo })
  if (!mensagem) return daHeuristica('mensagem vazia')

  try {
    const apiKey = await getProviderApiKey(input.ownerId, input.provider)
    if (!apiKey) return daHeuristica('sem chave do provedor')

    const teto = await getMonthlyTokenCap(input.ownerId)
    if (teto > 0 && (await getMonthlyTokens(input.ownerId)) >= teto) return daHeuristica('teto de tokens atingido')

    const prompt = `${PROMPT}\n\n${input.contextLine ? `Onde a pessoa está: ${input.contextLine}\n\n` : ''}Mensagem: ${JSON.stringify(mensagem)}`

    /**
     * A cobrança é registrada quando a chamada VOLTA, mesmo depois do prazo.
     *
     * O provedor cobrou de qualquer jeito; não registrar seria consumo invisível na conta de
     * quem pagou. É a mesma regra do crítico auxiliar.
     */
    const chamada = (input.ask ?? askAuxWithUsage)(input.provider, prompt, input.model ?? null, apiKey, 300)
      .then(async (r) => {
        await recordReplyUsageOnce(input.ownerId, r.usage, `${input.chargeKey}:intent`)
        return r
      })
      .catch((erro: unknown) => {
        // O texto do provedor não sai daqui: ele pode trazer a URL com a chave.
        console.error('[architect] classificação de intenção falhou:', (erro as Error)?.message)
        return null
      })

    let expirou: NodeJS.Timeout | undefined
    const prazo = new Promise<null>((resolve) => {
      expirou = setTimeout(() => resolve(null), input.timeoutMs ?? INTENT_CLASSIFY_TIMEOUT_MS)
      expirou.unref?.()
    })
    const resposta = await Promise.race([chamada, prazo])
    if (expirou) clearTimeout(expirou)
    if (!resposta) return daHeuristica('provedor não respondeu a tempo')

    const bruto = extractJson(resposta.text)
    if (!bruto || typeof bruto !== 'object') return daHeuristica('resposta ilegível')

    /**
     * `parseIntent` é o portão, não uma formalidade.
     *
     * Ele arranca ObjectId de todo campo, corta no teto e escala o risco quando o modelo
     * omite ou inventa um valor. Um `mode` desconhecido vira `answer` — o modo que não faz
     * nada — em vez de virar erro ou, pior, `operate`.
     */
    return { intent: parseIntent(bruto, mensagem), by: 'model' }
  } catch (erro) {
    console.error('[architect] classificação de intenção falhou:', (erro as Error)?.message)
    return daHeuristica('erro inesperado')
  }
}
