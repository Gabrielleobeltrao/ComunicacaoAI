import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { db } from './db.js'
import type { Tool } from './tools.js'

// VERSÃO DE FERRAMENTA — o que torna uma ferramenta compartilhável sem ser perigosa.
//
// Rascunho é editável. Versão publicada é IMUTÁVEL e tem hash. A regra existe porque
// "instalei a ferramenta X" precisa significar algo: se o autor puder editar o que já foi
// instalado, cada instalação vira um alvo móvel — e a permissão que alguém revisou ontem
// pode estar valendo para outro código hoje.
//
// O hash não é enfeite: ele é o que permite conferir, na hora de executar, que o que está
// rodando é o que foi revisado. Sem ele, "aprovado" é uma etiqueta colada num objeto que
// pode ter mudado.

export type ToolRuntimeKind = 'http' | 'app_action' | 'registered_function' | 'code'
export const RUNTIME_KINDS: readonly ToolRuntimeKind[] = ['http', 'app_action', 'registered_function', 'code']

export type ToolRisk = 'read' | 'write' | 'high_risk'
export type ToolStatus = 'draft' | 'testing' | 'active' | 'archived'

export interface ToolVersion {
  _id: ObjectId
  ownerId: string
  toolId: ObjectId
  /** Semântica: `1.0.0`. Duas publicações nunca compartilham número. */
  version: string
  runtimeKind: ToolRuntimeKind
  /** O corpo da versão — a definição congelada, sem segredo. */
  manifest: Record<string, unknown>
  inputSchema: Record<string, unknown>
  /**
   * O que ela DEVOLVE.
   *
   * Exigido no publicável: sem contrato de saída, quem instala descobre a forma do
   * retorno testando em produção — e o modelo do outro lado recebe um formato diferente
   * a cada versão sem que nada avise.
   */
  outputSchema: Record<string, unknown> | null
  risk: ToolRisk
  sha256: string
  changelog: string
  /** Publicada = imutável. A trava é conferida na escrita, não só documentada. */
  immutable: boolean
  createdAt: Date
}

const versions = db.collection<ToolVersion>('tool_versions')

export async function ensureToolVersionIndexes(): Promise<void> {
  await versions.createIndex({ ownerId: 1, toolId: 1, version: 1 }, { unique: true })
  await versions.createIndex({ ownerId: 1, toolId: 1, createdAt: -1 })
}

export class ToolVersionError extends Error {
  constructor(
    message: string,
    readonly code = 'invalid',
  ) {
    super(message)
  }
}

/**
 * O HASH do que a versão é.
 *
 * Calculado sobre o manifesto com as chaves ORDENADAS: um objeto igual escrito em outra
 * ordem é a mesma versão, e um hash que mudasse com a ordem transformaria uma reescrita
 * cosmética em "versão diferente" no momento da conferência.
 */
export function hashOf(manifest: Record<string, unknown>): string {
  const ordenar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordenar)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, ordenar(val)]),
      )
    }
    return v
  }
  return createHash('sha256').update(JSON.stringify(ordenar(manifest))).digest('hex')
}

const SEMVER = /^\d+\.\d+\.\d+$/

/** O RISCO derivado do que a ferramenta faz — não do que alguém digitou. */
export function riskOf(runtimeKind: ToolRuntimeKind, manifest: Record<string, unknown>): ToolRisk {
  if (runtimeKind === 'http') {
    const metodo = String(manifest.method ?? 'GET').toUpperCase()
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo) ? 'write' : 'read'
  }
  if (runtimeKind === 'app_action') return (manifest.risk as ToolRisk) ?? 'write'
  // Código roda em sandbox e ainda não é executável; declarar `read` seria otimismo.
  if (runtimeKind === 'code') return 'high_risk'
  return 'read'
}

export interface PublishInput {
  version: string
  runtimeKind: ToolRuntimeKind
  manifest: Record<string, unknown>
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown> | null
  changelog?: string
}

/**
 * Publica uma versão — e ela nasce imutável.
 *
 * Republicar o mesmo número é recusado pelo índice único E pela conferência aqui: as duas
 * porque a primeira é a garantia do banco e a segunda é a mensagem que a pessoa lê.
 */
export async function publishVersion(ownerId: string, toolId: ObjectId, input: PublishInput): Promise<ToolVersion> {
  if (!SEMVER.test(input.version)) throw new ToolVersionError('a versão usa o formato 1.0.0')
  if (!RUNTIME_KINDS.includes(input.runtimeKind)) throw new ToolVersionError('runtime desconhecido')
  if (input.runtimeKind === 'code') {
    /**
     * CÓDIGO passa pelo portão inteiro — e ele é o mesmo do resto da plataforma.
     *
     * Fail-closed: sem runtime isolado saudável, código não é publicável. Editar e
     * validar estaticamente pode; publicar não. A flag continua respondendo com o
     * código de erro de sempre, porque é ela que a tela sabe explicar.
     */
    const { canPublishCode } = await import('./extensionRuntime/gate.js')
    const m = input.manifest as { runtime?: string; source?: string }
    const portao = await canPublishCode({
      version: input.version,
      runtime: (m.runtime === 'javascript' ? 'javascript' : 'python') as 'python' | 'javascript',
      source: String(m.source ?? ''),
      // A aprovação é procurada no registro do servidor, por ferramenta e por hash — e
      // não num campo que veio junto com o código.
      subject: { type: 'tool', id: toolId },
    })
    if (!portao.ok) {
      const codigo = portao.code === 'flag_off' ? 'code_runtime_disabled' : portao.code
      throw new ToolVersionError(portao.message, codigo)
    }
  }
  if (!input.outputSchema) {
    throw new ToolVersionError('declare o que a ferramenta devolve antes de publicar', 'missing_output_schema')
  }

  /**
   * O MANIFESTO precisa dizer o que a versão executa — na publicação, não na primeira chamada.
   *
   * Uma versão de `app_action` sem `appKey`/`actionKey` e uma de `registered_function` sem
   * `functionName` são imutáveis assim que nascem: descobrir o defeito no momento em que o
   * modelo chama significa publicar algo que nunca poderá funcionar e não poderá ser
   * corrigido, só sucedido. A EXISTÊNCIA da função fica para a execução, de propósito —
   * ela depende do que este servidor tem registrado, e isso muda entre deploys.
   */
  if (input.runtimeKind === 'app_action') {
    const { appKey, actionKey } = input.manifest as { appKey?: unknown; actionKey?: unknown }
    if (!appKey || typeof appKey !== 'string' || !actionKey || typeof actionKey !== 'string') {
      throw new ToolVersionError('diga qual App e qual ação esta versão executa', 'invalid_manifest')
    }
  }
  if (input.runtimeKind === 'registered_function') {
    const { functionName } = input.manifest as { functionName?: unknown }
    if (!functionName || typeof functionName !== 'string') {
      throw new ToolVersionError('diga qual função esta versão executa', 'invalid_manifest')
    }
  }

  const existente = await versions.findOne({ ownerId, toolId, version: input.version })
  if (existente) throw new ToolVersionError(`a versão ${input.version} já foi publicada e não pode ser alterada`, 'immutable')

  const doc: ToolVersion = {
    _id: new ObjectId(),
    ownerId,
    toolId,
    version: input.version,
    runtimeKind: input.runtimeKind,
    manifest: input.manifest,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    risk: riskOf(input.runtimeKind, input.manifest),
    sha256: hashOf(input.manifest),
    changelog: String(input.changelog ?? '').slice(0, 1000),
    immutable: true,
    createdAt: new Date(),
  }
  try {
    await versions.insertOne(doc)
  } catch (erro) {
    if ((erro as { code?: number }).code === 11000) throw new ToolVersionError(`a versão ${input.version} já existe`, 'immutable')
    throw erro
  }
  return doc
}

export const listVersions = (ownerId: string, toolId: ObjectId) =>
  versions.find({ ownerId, toolId }, { projection: { manifest: 0 } }).sort({ createdAt: -1 }).toArray()

export const getVersion = (ownerId: string, toolId: ObjectId, version: string) => versions.findOne({ ownerId, toolId, version })

export const latestVersion = (ownerId: string, toolId: ObjectId) => versions.find({ ownerId, toolId }).sort({ createdAt: -1 }).limit(1).next()

/**
 * A ferramenta HTTP que já existe, lida como versão zero.
 *
 * Sem migração e sem tocar no documento: `runtimeKind` e `version` são DERIVADOS na
 * leitura. Toda ferramenta antiga continua com o mesmo `_id`, o mesmo nome e a mesma
 * atribuição — e é isso que faz nenhuma delas parar de funcionar.
 */
export function describeLegacyTool(tool: Tool): { runtimeKind: ToolRuntimeKind; version: string; risk: ToolRisk; status: ToolStatus } {
  return {
    runtimeKind: 'http',
    version: '0.0.0',
    risk: riskOf('http', { method: tool.method }),
    status: tool.enabled ? 'active' : 'draft',
  }
}

/**
 * A versão que MANDA no runtime de uma ferramenta — a última publicada.
 *
 * Ferramenta sem versão nenhuma devolve `null`, e é isso que mantém toda ferramenta HTTP
 * antiga rodando pelo caminho de sempre: o dispatcher só desvia quando existe uma versão
 * publicada dizendo que aquele runtime é outro.
 *
 * Fixar versão por instalação é da fase do Marketplace; aqui a conta é dona do que
 * publica, e o que vale é o que ela publicou por último.
 */
export const activeRuntimeVersion = (ownerId: string, toolId: ObjectId) =>
  versions.find({ ownerId, toolId }).sort({ createdAt: -1 }).limit(1).next()

/** As versões ativas de várias ferramentas de uma vez — uma consulta, não uma por ferramenta. */
export async function activeRuntimeVersions(ownerId: string, toolIds: ObjectId[]): Promise<Map<string, ToolVersion>> {
  const mapa = new Map<string, ToolVersion>()
  if (toolIds.length === 0) return mapa
  const todas = await versions.find({ ownerId, toolId: { $in: toolIds } }).sort({ createdAt: -1 }).toArray()
  for (const v of todas) {
    const chave = v.toolId.toString()
    // Ordenado do mais novo para o mais velho: a primeira de cada ferramenta é a ativa.
    if (!mapa.has(chave)) mapa.set(chave, v)
  }
  return mapa
}

// O REGISTRO de que uma versão executou — telemetria segura, no mesmo formato do resto.
//
// Nunca argumento, nunca resposta, nunca credencial: o que rodou, se deu certo e quanto
// tempo levou. Ação de App também grava em `app_action_events` pelo caminho do grant; as
// duas linhas respondem perguntas diferentes ("o que este App fez" e "o que esta versão
// fez"), e é por isso que nenhuma das duas substitui a outra.
export interface ToolVersionCall {
  _id: ObjectId
  ownerId: string
  agentId: ObjectId | null
  toolId: ObjectId
  toolName: string
  version: string
  runtimeKind: ToolRuntimeKind
  risk: ToolRisk
  /** O hash do que rodou. É por ele que se confere que foi o que passou pela revisão. */
  sha256: string
  ok: boolean
  status: 'executed' | 'refused'
  durationMs: number
  createdAt: Date
}

const versionCalls = db.collection<ToolVersionCall>('tool_version_calls')

export async function ensureToolVersionCallIndexes(): Promise<void> {
  await versionCalls.createIndex({ ownerId: 1, createdAt: -1 })
  await versionCalls.createIndex({ ownerId: 1, toolId: 1, createdAt: -1 })
}

export async function recordVersionCall(call: Omit<ToolVersionCall, '_id' | 'createdAt'>): Promise<void> {
  try {
    await versionCalls.insertOne({ ...call, _id: new ObjectId(), createdAt: new Date() })
  } catch (erro) {
    // Auditoria que falha não derruba a execução que já aconteceu — mas também não some.
    console.error('[toolVersions] falha ao registrar chamada:', erro)
  }
}

export const listVersionCalls = (ownerId: string, toolId: ObjectId, limit = 50) =>
  versionCalls.find({ ownerId, toolId }).sort({ createdAt: -1 }).limit(limit).toArray()
