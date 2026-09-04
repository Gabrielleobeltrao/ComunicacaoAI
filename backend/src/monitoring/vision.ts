import { applyTransforms } from './mapping.js'
import type { TransformOp } from './types.js'

// VISÃO E OCR — e a única pergunta que importa: isto pode disparar uma ação?
//
// Ler um número de uma imagem é palpite com boa aparência. `1.234` vira `1234`, `l` vira
// `1`, e um gráfico com sombra vira qualquer coisa. Um palpite desses acionando um Flow
// que manda dinheiro é o pior tipo de defeito: ele é raro, é silencioso, e quando aparece
// já aconteceu.
//
// Por isso a visão aqui não devolve um valor. Ela devolve valor + CONFIANÇA + EVIDÊNCIA, e
// existe um portão que decide se aquilo é bom o bastante. Dado crítico que não passa no
// portão não vira leitura: ele vira "não consegui ler", que é a verdade.
//
// Este arquivo não chama modelo nenhum. Ele é o CONTRATO e o portão — a parte que precisa
// existir antes de qualquer provedor, porque é ela que impede o provedor de decidir sozinho.

export interface VisionEvidence {
  /** Onde o valor foi lido, na imagem. É o que permite conferir depois. */
  boundingBox?: { x: number; y: number; width: number; height: number }
  /** O texto cru que o reconhecedor viu — antes de virar número. */
  rawText: string
  /** Quem leu. Um provedor trocado muda o que se pode esperar da confiança. */
  provider: string
  /** A referência da imagem guardada, quando houver. Nunca a imagem inteira aqui. */
  screenshotRef?: string | null
}

export interface VisionReading {
  field: string
  value: unknown
  /** De 0 a 1. Vem do reconhecedor; o portão é quem decide o que fazer com ela. */
  confidence: number
  evidence: VisionEvidence
}

export type VisionRefusalReason = 'low_confidence' | 'schema_mismatch' | 'no_evidence' | 'needs_confirmation' | 'not_a_number'

export interface VisionDecision {
  accepted: boolean
  value: unknown
  confidence: number
  reason: VisionRefusalReason | 'accepted'
  /** Em português, para a tela e para o log dizerem a mesma coisa. */
  explanation: string
  evidence: VisionEvidence
}

/**
 * O piso de confiança para dado CRÍTICO.
 *
 * Alto de propósito. Um reconhecedor que se diz 80% seguro erra um em cinco, e um em cinco
 * é muito quando cada erro é uma ação tomada no mundo.
 */
export const CONFIANCA_MINIMA_CRITICA = 0.95
/** Para dado não crítico, o piso é o de qualquer leitura útil. */
export const CONFIANCA_MINIMA = 0.7

export interface GateOptions {
  /** Número, dinheiro, quantidade — o que aciona decisão. Piso mais alto e schema exigido. */
  critical?: boolean
  /** O tipo que o schema da fonte declarou para este campo. */
  expectedType?: 'number' | 'string' | 'boolean'
  /** Transformações do mapeamento, aplicadas antes de conferir o tipo. */
  transforms?: TransformOp[]
  /** Uma segunda leitura, de outra passada ou de outro provedor. */
  confirmation?: VisionReading | null
}

/**
 * O PORTÃO. Ele é o produto deste arquivo — o resto é forma.
 *
 * A ordem das recusas importa: sem evidência não há o que conferir, então isso vem antes
 * de olhar confiança; e a confiança vem antes do schema porque um valor mal lido pode até
 * parecer um número válido.
 */
export function gateVisionReading(leitura: VisionReading, opcoes: GateOptions = {}): VisionDecision {
  const base = { value: null as unknown, confidence: leitura.confidence, evidence: leitura.evidence }

  if (!leitura.evidence?.rawText || !leitura.evidence.provider) {
    return { ...base, accepted: false, reason: 'no_evidence', explanation: 'a leitura veio sem evidência: não há como conferir o que foi lido' }
  }

  const piso = opcoes.critical ? CONFIANCA_MINIMA_CRITICA : CONFIANCA_MINIMA
  if (!(leitura.confidence >= piso)) {
    return {
      ...base,
      accepted: false,
      reason: 'low_confidence',
      explanation: `confiança ${(leitura.confidence * 100).toFixed(0)}% abaixo do mínimo de ${(piso * 100).toFixed(0)}% para este tipo de dado`,
    }
  }

  const valor = applyTransforms(leitura.value, opcoes.transforms ?? [])

  if (opcoes.expectedType === 'number') {
    // `applyTransforms` com `number` já devolve `null` para o que não é número — e ausente
    // não é zero, que é a armadilha que este produto já pagou uma vez.
    const n = typeof valor === 'number' ? valor : null
    if (n === null || !Number.isFinite(n)) {
      return { ...base, accepted: false, reason: 'not_a_number', explanation: 'o que foi lido não é um número, e um número é o que este campo espera' }
    }
    base.value = n
  } else if (opcoes.expectedType && typeof valor !== opcoes.expectedType) {
    return { ...base, accepted: false, reason: 'schema_mismatch', explanation: `o valor lido não é ${opcoes.expectedType}` }
  } else {
    base.value = valor
  }

  /**
   * Dado crítico exige CONFIRMAÇÃO — duas leituras que concordam.
   *
   * Uma leitura muito confiante e errada é indistinguível de uma leitura muito confiante e
   * certa. Duas leituras independentes que concordam são outra coisa: o erro teria que se
   * repetir igual.
   */
  if (opcoes.critical) {
    /**
     * Toda recusa daqui para baixo devolve valor NULO.
     *
     * O valor já tinha sido calculado para poder ser comparado — e sair junto de uma recusa
     * é como ele acaba gravado por quem não olha `accepted`. Um teste pegou exatamente
     * isso: a recusa por falta de confirmação ainda carregava o número.
     */
    const recusa = (reason: VisionRefusalReason, explanation: string): VisionDecision => ({
      ...base,
      value: null,
      accepted: false,
      reason,
      explanation,
    })

    if (!opcoes.confirmation) return recusa('needs_confirmation', 'dado crítico precisa de uma segunda leitura que concorde')

    const confirmado = applyTransforms(opcoes.confirmation.value, opcoes.transforms ?? [])
    if (JSON.stringify(confirmado) !== JSON.stringify(base.value)) {
      return recusa('needs_confirmation', 'as duas leituras discordam: uma diz uma coisa, a outra diz outra')
    }
    if (!(opcoes.confirmation.confidence >= piso)) {
      return recusa('low_confidence', 'a segunda leitura concorda, mas não tem confiança suficiente')
    }
  }

  return { ...base, accepted: true, reason: 'accepted', explanation: 'leitura aceita' }
}

/**
 * O provedor de visão — contrato, e um padrão que RECUSA.
 *
 * Fail-closed pela mesma razão de sempre: o que não foi configurado não existe. E enquanto
 * não existe, uma fonte que dependeria de visão não lê nada em vez de ler um palpite.
 */
export interface VisionProvider {
  read(input: { imageRef: string; fields: { name: string; hint?: string }[] }): Promise<VisionReading[]>
  health(): Promise<{ ok: boolean; provider: string }>
}

const recusaTudo: VisionProvider = {
  read: async () => [],
  health: async () => ({ ok: false, provider: 'nenhum' }),
}

let provider: VisionProvider = recusaTudo
export const visionProvider = (): VisionProvider => provider
export const registerVisionProvider = (p: VisionProvider): void => {
  provider = p
}
export const resetVisionProvider = (): void => {
  provider = recusaTudo
}
