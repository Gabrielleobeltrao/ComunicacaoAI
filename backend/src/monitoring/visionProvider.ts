import Anthropic from '@anthropic-ai/sdk'
import { gateVisionReading } from './vision.js'
import type { VisionProvider, VisionReading } from './vision.js'

// O PROVEDOR de visão — o modelo lê a imagem, e o portão decide se aquilo vale.
//
// A separação é a coisa toda: este arquivo produz LEITURAS com confiança e evidência, e
// nunca decide se elas podem virar dado. Quem decide é `vision.ts`, que não conhece
// provedor nenhum. Juntar os dois faria o provedor arbitrar sobre a própria qualidade —
// e um modelo perguntado sobre a própria certeza responde bem demais.
//
// A imagem entra, o texto sai, e nada além disso: nenhum segredo da conta viaja junto, e o
// que volta é conferido antes de ser acreditado.

const MODELO = process.env.VISION_MODEL ?? 'claude-sonnet-5'
/** Teto do que se manda: uma imagem maior que isso custa muito e lê pior. */
const MAX_IMAGEM_BYTES = 2 * 1024 * 1024

/**
 * O pedido é DELIBERADAMENTE estreito.
 *
 * Nada de "descreva a página": pede-se um campo por vez, com o nome que o mapeamento já
 * usa, e exige-se o texto cru que embasou a resposta. Sem o texto cru não há evidência, e
 * sem evidência o portão recusa — então pedir isso não é enfeite, é o que faz a leitura
 * ser utilizável.
 */
const instrucao = (campos: { name: string; hint?: string }[]) =>
  [
    'Você está lendo valores de uma captura de tela para um sistema de monitoramento.',
    'Para CADA campo pedido, devolva:',
    '- value: o valor exatamente como aparece na imagem, sem interpretar nem converter;',
    '- rawText: o trecho de texto que você leu, literal;',
    '- confidence: de 0 a 1, quão certo você está de ter lido o caractere certo.',
    '',
    'Se um campo não estiver visível, devolva value nulo e confidence 0. NÃO adivinhe:',
    'um valor inventado com confiança alta é pior do que dizer que não conseguiu ler.',
    '',
    `Campos: ${campos.map((c) => (c.hint ? `${c.name} (${c.hint})` : c.name)).join(', ')}`,
    '',
    'Responda SÓ com JSON: {"readings":[{"field":"...","value":...,"rawText":"...","confidence":0.0}]}',
  ].join('\n')

export function anthropicVisionProvider(apiKey: string): VisionProvider {
  const cliente = new Anthropic({ apiKey })

  return {
    async read({ imageRef, fields }) {
      // `imageRef` é o PNG em base64 que o worker produziu. Ele não passa por disco.
      const bytes = Math.floor((imageRef.length * 3) / 4)
      if (!imageRef || bytes > MAX_IMAGEM_BYTES || fields.length === 0) return []

      try {
        const resposta = await cliente.messages.create({
          model: MODELO,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageRef } },
                { type: 'text', text: instrucao(fields) },
              ],
            },
          ],
        })

        const texto = resposta.content.map((b) => (b.type === 'text' ? b.text : '')).join('')

        const bruto = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1)) as {
          readings?: { field?: string; value?: unknown; rawText?: string; confidence?: unknown }[]
        }

        return (bruto.readings ?? [])
          .filter((r) => typeof r.field === 'string' && fields.some((f) => f.name === r.field))
          .map<VisionReading>((r) => ({
            field: String(r.field),
            value: r.value ?? null,
            // A confiança é LIMITADA ao intervalo, e o que não é número vira zero: um
            // modelo que devolvesse `confidence: "alta"` passaria no portão sem isto.
            confidence: Number.isFinite(Number(r.confidence)) ? Math.min(1, Math.max(0, Number(r.confidence))) : 0,
            evidence: { rawText: String(r.rawText ?? '').slice(0, 300), provider: `anthropic:${MODELO}` },
          }))
      } catch {
        // Falha de leitura é ausência de leitura — nunca um palpite com confiança alta.
        return []
      }
    },

    async health() {
      return { ok: Boolean(apiKey), provider: `anthropic:${MODELO}` }
    },
  }
}

/**
 * Monta a partir da configuração do servidor — ou não monta.
 *
 * `VISION_ENABLED=1` é exigido além da chave: ter uma chave de modelo não é o mesmo que
 * querer que páginas sejam lidas por adivinhação. Ligar isso é uma decisão.
 */
export function visionProviderFromEnv(): VisionProvider | null {
  if (process.env.VISION_ENABLED !== '1') return null
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  return anthropicVisionProvider(key)
}

/** Reexportado para quem lê uma leitura já querer o portão junto. */
export { gateVisionReading }
