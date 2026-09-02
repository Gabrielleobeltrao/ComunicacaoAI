import type { FieldMapping, FieldRule, TransformOp } from './types.js'

// O EXTRATOR — dado descrevendo dado, e nenhuma linha de código do usuário.
//
// A tentação óbvia aqui é aceitar uma expressão: "só um JSONPath completo", "só uma
// function de mapeamento". As duas viram execução de código de terceiro dentro do processo
// que tem o banco — e é a mesma porta que a sandbox existe para fechar, aberta de novo por
// conveniência.
//
// O que existe é um caminho (`dados.itens[0].preco`) e uma lista fechada de transformações.
// Não há curinga, não há filtro, não há recursão. Quando isso não bastar, a resposta é uma
// ferramenta de código na sandbox — não uma expressão aqui.

export class MappingError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message)
  }
}

/** Profundidade e tamanho: um caminho de cem níveis não é um caminho, é um ataque. */
const MAX_DEPTH = 12
const MAX_FIELDS = 60
const MAX_ITEMS = 500

const SEGMENTO = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
/** Nomes que alcançam o protótipo. Recusados como origem E como destino. */
const RESERVADOS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * O caminho é conferido pela FORMA, antes de qualquer travessia.
 *
 * Conferir durante a travessia não basta: um caminho como `a.prototype` sai cedo quando
 * `a` não existe no documento de exemplo, e o trecho perigoso nunca chega a ser olhado —
 * a fonte nasceria com um caminho que só é recusado quando o dado certo aparecer.
 */
export function assertSafePath(caminho: string): void {
  if (!caminho) return
  const partes = caminho.split('.')
  if (partes.length > MAX_DEPTH) throw new MappingError(`o caminho "${caminho}" tem fundo demais`)
  for (const parte of partes) {
    const m = /^([^[]*)((\[\d+\])*)$/.exec(parte)
    if (!m) throw new MappingError(`trecho inválido em "${caminho}"`)
    const nome = m[1]
    if (nome && (!SEGMENTO.test(nome) || RESERVADOS.has(nome))) throw new MappingError(`trecho inválido em "${caminho}"`)
  }
}

/**
 * Lê um caminho. `a.b[0].c` — e nada além disso.
 *
 * Um segmento que não é identificador simples nem índice é recusado, e não interpretado:
 * aceitar `__proto__` ou `constructor` aqui seria deixar o mapeamento alcançar o
 * protótipo do objeto, que é como se transforma leitura de dado em execução.
 */
export function readPath(fonte: unknown, caminho: string): unknown {
  if (!caminho) return fonte
  assertSafePath(caminho)
  const partes = caminho.split('.')

  let atual: unknown = fonte
  for (const parte of partes) {
    if (atual === null || atual === undefined) return undefined
    const m = /^([^[]*)((\[\d+\])*)$/.exec(parte)!
    const nome = m[1]
    if (nome) {
      if (typeof atual !== 'object') return undefined
      atual = (atual as Record<string, unknown>)[nome]
    }
    for (const indice of m[2].matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(atual)) return undefined
      atual = atual[Number(indice[1])]
    }
  }
  return atual
}

const aplicar = (valor: unknown, t: TransformOp): unknown => {
  switch (t.op) {
    case 'number': {
      // Ausente NÃO é zero. `Number(null)` é 0, e um campo que sumiu viraria um número
      // que dispara alarme — é o mesmo defeito que o monitor já corrigiu uma vez.
      if (valor === null || valor === undefined || valor === '') return null
      const n = Number(String(valor).replace(/[^\d,.\-+eE]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))
      return Number.isFinite(n) ? n : null
    }
    case 'trim':
      return typeof valor === 'string' ? valor.trim() : valor
    case 'lower':
      return typeof valor === 'string' ? valor.toLowerCase() : valor
    case 'upper':
      return typeof valor === 'string' ? valor.toUpperCase() : valor
    case 'boolean':
      if (typeof valor === 'boolean') return valor
      if (valor === null || valor === undefined) return null
      return ['true', '1', 'sim', 'yes', 'on'].includes(String(valor).toLowerCase())
    case 'date': {
      if (valor === null || valor === undefined || valor === '') return null
      const d = new Date(typeof valor === 'number' ? valor : String(valor))
      return Number.isNaN(d.getTime()) ? null : d.toISOString()
    }
    case 'first':
      return Array.isArray(valor) ? (valor.length ? valor[0] : null) : valor
    case 'join':
      return Array.isArray(valor) ? valor.map((v) => String(v)).join(String(t.separator).slice(0, 8)) : valor
    case 'replace':
      // Texto literal, nunca expressão regular: uma regex vinda de fora é um travamento
      // esperando acontecer.
      return typeof valor === 'string' ? valor.split(String(t.find)).join(String(t.with)) : valor
    case 'default':
      return valor === null || valor === undefined || valor === '' ? t.value : valor
    default:
      return valor
  }
}

export function applyTransforms(valor: unknown, transforms: TransformOp[] = []): unknown {
  let atual = valor
  for (const t of transforms.slice(0, 8)) atual = aplicar(atual, t)
  return atual
}

/** Confere que o mapeamento é aceitável ANTES de ele virar configuração gravada. */
export function validateMapping(bruto: unknown): FieldMapping {
  const m = (bruto ?? {}) as Partial<FieldMapping>
  const fields = Array.isArray(m.fields) ? m.fields : []
  if (fields.length === 0) throw new MappingError('mapeie ao menos um campo')
  if (fields.length > MAX_FIELDS) throw new MappingError(`o mapeamento passou de ${MAX_FIELDS} campos`)

  const vistos = new Set<string>()
  const limpos: FieldRule[] = fields.map((f) => {
    const to = String(f?.to ?? '').trim()
    // O DESTINO também: escrever `__proto__` como chave da linha envenenaria o objeto que
    // o monitor vai ler depois.
    if (!SEGMENTO.test(to) || RESERVADOS.has(to)) throw new MappingError(`"${to}" não é um nome de campo válido`, to)
    if (vistos.has(to)) throw new MappingError(`o campo "${to}" está mapeado duas vezes`, to)
    vistos.add(to)
    const from = String(f?.from ?? '')
    // Valida o caminho agora: um caminho inválido descoberto na primeira leitura seria
    // uma fonte que nasce quebrada e só avisa quando ninguém está olhando.
    assertSafePath(from)
    return { to, from, ...(f.transforms ? { transforms: f.transforms.slice(0, 8) } : {}), ...(f.required ? { required: true } : {}) }
  })

  const itemsPath = m.itemsPath ? String(m.itemsPath) : null
  if (itemsPath) assertSafePath(itemsPath)

  return {
    // A versão é do mapeamento, e sobe quando ele muda: é ela que explica por que uma
    // série antiga tem a forma que tem.
    version: Number.isFinite(m.version) ? Number(m.version) : 1,
    itemsPath,
    fields: limpos,
  }
}

export interface MappedResult {
  rows: Record<string, unknown>[]
  /** Campos obrigatórios que não vieram. Fonte com falta não vira leitura boa. */
  missing: string[]
  mappingVersion: number
}

/**
 * Aplica o mapeamento a uma resposta bruta.
 *
 * O que sai daqui é o dado NORMALIZADO — e é só ele que o monitor observa. É essa
 * separação que faz um monitor não consultar serviço externo a cada condição: quando ele
 * roda, o trabalho de ir buscar já aconteceu.
 */
export function applyMapping(bruto: unknown, mapping: FieldMapping): MappedResult {
  const base = mapping.itemsPath ? readPath(bruto, mapping.itemsPath) : bruto
  const entradas = Array.isArray(base) ? base.slice(0, MAX_ITEMS) : [base]
  const missing = new Set<string>()

  const rows = entradas.map((entrada) => {
    const linha: Record<string, unknown> = {}
    for (const regra of mapping.fields) {
      const valor = applyTransforms(readPath(entrada, regra.from), regra.transforms)
      if (regra.required && (valor === null || valor === undefined || valor === '')) missing.add(regra.to)
      linha[regra.to] = valor === undefined ? null : valor
    }
    return linha
  })

  return { rows, missing: [...missing], mappingVersion: mapping.version }
}

/**
 * A AMOSTRA que a tela mostra — redigida.
 *
 * A amostra existe para a pessoa conferir que mapeou o campo certo, e para isso ela
 * precisa ver o formato, não o conteúdo. Um token no corpo da resposta apareceria inteiro
 * na tela, no log do navegador e no print que alguém cola num chamado.
 */
const CHAVE_DE_SEGREDO = /(authorization|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|bearer|token|secret|password|senha|credential|cookie|private[-_]?key|email|cpf|cnpj)/i

export function redactSample(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 6) return '…'
  if (Array.isArray(valor)) return valor.slice(0, 3).map((v) => redactSample(v, profundidade + 1))
  if (valor && typeof valor === 'object') {
    const saida: Record<string, unknown> = {}
    for (const [chave, v] of Object.entries(valor as Record<string, unknown>).slice(0, 40)) {
      saida[chave] = CHAVE_DE_SEGREDO.test(chave) ? '«oculto»' : redactSample(v, profundidade + 1)
    }
    return saida
  }
  if (typeof valor === 'string') {
    // Texto longo é cortado: a amostra mostra a forma, e um documento inteiro não é forma.
    const limpo = valor.length > 200 ? `${valor.slice(0, 200)}…` : valor
    // E o que PARECE credencial no valor também some, mesmo com nome de campo inocente.
    return /^(bearer\s+|ey[A-Za-z0-9_-]{10,}|sk-|pk_|ghp_)/i.test(limpo) ? '«oculto»' : limpo
  }
  return valor
}
