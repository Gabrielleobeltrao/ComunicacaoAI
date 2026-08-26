import { ValidationError } from '../../building.js'
import { readPath } from '../../automations/conditions.js'

/**
 * O MAPEAMENTO de payload: `$.data.ticker → symbol`.
 *
 * Serve para uma coisa só — dois provedores mandando o mesmo fato com nomes diferentes
 * virarem o mesmo objeto aqui dentro. É o que permite o código de um agente escrever
 * `preco.symbol` sem saber de qual serviço o dado veio.
 *
 * O que ele NÃO é: uma linguagem. Não há expressão, condicional, função nem template
 * executável. Cada regra é um par (caminho de leitura, nome de destino), a leitura é a
 * mesma `readPath` que o resto do produto usa, e a escrita é feita num objeto sem
 * protótipo. Um mapeamento que aceitasse expressão seria código escrito por quem
 * configura e executado pelo servidor.
 */

export interface PayloadMappingRule {
  /** `$.data.ticker` ou `data.ticker` — as duas formas, o mesmo caminho. */
  from: string
  /** O nome do campo no objeto normalizado. Simples, sem ponto. */
  to: string
}

export const MAX_MAPPING_RULES = 20

/** Nomes que, escritos num objeto comum, mexem no protótipo em vez de no dado. */
const PROIBIDOS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Normaliza um caminho `$.a.b[0]` para `a.b[0]`.
 *
 * O `$.` inicial é a convenção que as pessoas escrevem; o resto do produto lê caminhos
 * sem ele. Aceitar as duas formas e guardar uma só evita duas leituras diferentes para
 * o que quem configurou entende como a mesma coisa.
 */
export function normalizeMappingPath(bruto: unknown, campo: string): string {
  const p = String(bruto ?? '').trim().replace(/^\$\.?/, '')
  if (!p) throw new ValidationError(`${campo}: informe o campo de origem.`)
  if (p.length > 200) throw new ValidationError(`${campo}: caminho longo demais.`)
  if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+|\[\d+\])*$/.test(p)) {
    throw new ValidationError(`${campo}: use um caminho simples, como "data.ticker" — sem expressão nem código.`)
  }
  if (p.split(/[.[\]]/).some((parte) => PROIBIDOS.has(parte))) throw new ValidationError(`${campo}: caminho não permitido.`)
  return p
}

/** O nome de destino: um identificador simples, e nunca um que mexa no protótipo. */
export function normalizeMappingTarget(bruto: unknown, campo: string): string {
  const t = String(bruto ?? '').trim()
  if (!t) throw new ValidationError(`${campo}: informe o nome do campo de destino.`)
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,59}$/.test(t)) {
    throw new ValidationError(`${campo}: o nome de destino usa letras, números e sublinhado, começando por letra.`)
  }
  if (PROIBIDOS.has(t)) throw new ValidationError(`${campo}: nome de destino não permitido.`)
  return t
}

export function normalizeMapping(bruto: unknown): PayloadMappingRule[] {
  const lista = Array.isArray(bruto) ? bruto : []
  if (lista.length > MAX_MAPPING_RULES) throw new ValidationError(`No máximo ${MAX_MAPPING_RULES} mapeamentos.`)
  const destinos = new Set<string>()
  return lista.map((r, i) => {
    const raw = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>
    const from = normalizeMappingPath(raw.from, `Mapeamento ${i + 1}`)
    const to = normalizeMappingTarget(raw.to, `Mapeamento ${i + 1}`)
    if (destinos.has(to)) throw new ValidationError(`Mapeamento ${i + 1}: o campo "${to}" aparece duas vezes.`)
    destinos.add(to)
    return { from, to }
  })
}

/**
 * Aplica as regras e devolve o objeto normalizado — ou `null` quando não há regra.
 *
 * `Object.create(null)` e não `{}`: um objeto comum já nasce com `__proto__`, e mesmo
 * com o nome de destino validado, um objeto sem protótipo torna a classe inteira de
 * problema impossível em vez de improvável. O resultado é convertido para objeto comum
 * na saída, já com as chaves conferidas.
 *
 * Um caminho que não existe na mensagem é OMITIDO, não preenchido com nulo: o agente
 * distingue "não veio" de "veio vazio", e essa diferença importa numa cotação.
 */
export function applyMapping(valor: unknown, regras: readonly PayloadMappingRule[]): Record<string, unknown> | null {
  if (!regras.length) return null
  const fora = Object.create(null) as Record<string, unknown>
  let algum = false
  for (const regra of regras) {
    const lido = readPath(valor, regra.from)
    if (lido === undefined) continue
    fora[regra.to] = lido
    algum = true
  }
  return algum ? { ...fora } : null
}
