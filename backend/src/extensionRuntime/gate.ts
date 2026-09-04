import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { profileIsAcceptable, sandboxProvider, providerIsTestOnly } from './provider.js'
import type { SandboxRuntime } from './provider.js'
import { scanSource } from './scanner.js'
import type { ScanResult } from './scanner.js'

// O PORTÃO — todas as travas, numa ordem que não depende de ninguém lembrar.
//
// Publicar código e executar código passam por aqui, e por mais lugar nenhum. A ordem
// importa: a mais barata primeiro (a flag), a mais cara por último (a sandbox). E o
// resultado é sempre a mesma forma — "pode" ou "não pode, e por quê" —, porque quem
// chama não pode ter espaço para interpretar.

export interface KillSwitchEntry {
  _id: ObjectId
  /** Pelo menos um: pacote, versão ou hash. O mais específico que der. */
  packageId?: ObjectId | null
  version?: string | null
  sha256?: string | null
  reason: string
  createdBy: string
  createdAt: Date
}

const killSwitches = db.collection<KillSwitchEntry>('sandbox_kill_switches')

export async function ensureKillSwitchIndexes(): Promise<void> {
  await killSwitches.createIndex({ sha256: 1 })
  await killSwitches.createIndex({ packageId: 1, version: 1 })
}

/**
 * Desligar na marra — por pacote, versão ou hash.
 *
 * Existe porque descobrir um problema às três da manhã não pode depender de encontrar o
 * autor, publicar uma correção e esperar todo mundo atualizar. O hash é o alvo mais
 * preciso: ele desliga exatamente o artefato conhecido, em todas as contas.
 */
export async function killSwitch(input: { packageId?: ObjectId; version?: string; sha256?: string; reason: string; createdBy: string }): Promise<KillSwitchEntry> {
  if (!input.packageId && !input.sha256) throw new Error('diga o que está sendo desligado')
  if (!input.reason?.trim()) throw new Error('diga por que está desligando')
  const doc: KillSwitchEntry = {
    _id: new ObjectId(),
    packageId: input.packageId ?? null,
    version: input.version ?? null,
    sha256: input.sha256 ?? null,
    reason: input.reason.slice(0, 400),
    createdBy: input.createdBy,
    createdAt: new Date(),
  }
  await killSwitches.insertOne(doc)
  return doc
}

export async function isKilled(alvo: { packageId?: ObjectId | null; version?: string | null; sha256?: string | null }): Promise<KillSwitchEntry | null> {
  const ou: Record<string, unknown>[] = []
  if (alvo.sha256) ou.push({ sha256: alvo.sha256 })
  if (alvo.packageId) {
    // Sem versão no registro = o pacote inteiro está desligado.
    ou.push({ packageId: alvo.packageId, version: null })
    if (alvo.version) ou.push({ packageId: alvo.packageId, version: alvo.version })
  }
  if (ou.length === 0) return null
  return killSwitches.findOne({ $or: ou })
}

export interface GateRefusal {
  ok: false
  code:
    | 'flag_off'
    | 'provider_unavailable'
    | 'provider_test_only'
    | 'profile_incomplete'
    | 'scan_failed'
    | 'killed'
    | 'review_required'
  message: string
  detail?: unknown
}
export type GateResult<T = undefined> = ({ ok: true } & (T extends undefined ? Record<string, never> : { value: T })) | GateRefusal

const recusa = (code: GateRefusal['code'], message: string, detail?: unknown): GateRefusal => ({ ok: false, code, message, ...(detail ? { detail } : {}) })

/**
 * O runtime está SAUDÁVEL e é o de verdade?
 *
 * `CODE_TOOLS_ENABLED=1` sozinho não basta, e essa é a diferença entre uma flag e uma
 * garantia: a flag diz o que alguém quer; a conferência diz o que existe. Em produção,
 * um runner que se declara "test-only" é recusado aqui, e não no lugar onde ele rodaria.
 */
export async function runtimeIsUsable(): Promise<GateResult> {
  if (process.env.CODE_TOOLS_ENABLED !== '1') return recusa('flag_off', 'as ferramentas de código não estão habilitadas')
  if (providerIsTestOnly() && process.env.NODE_ENV === 'production') {
    return recusa('provider_test_only', 'o runner configurado é de teste e não roda em produção')
  }
  const health = await sandboxProvider().health()
  const perfil = profileIsAcceptable(health)
  if (!health.ok) return recusa('provider_unavailable', 'o runtime isolado não está saudável', health.detail)
  if (!perfil.ok) return recusa('profile_incomplete', 'o runtime isolado não cumpre o perfil exigido', perfil.missing)
  return { ok: true } as GateResult
}

export interface CodePublishRequest {
  packageId?: ObjectId | null
  version?: string
  runtime: SandboxRuntime
  source: string
  /**
   * O QUE está sendo publicado, para achar a revisão dele.
   *
   * `humanReview` não existe mais como entrada: ele vinha do manifesto, e o manifesto é
   * escrito pelo autor — era o autor assinando o próprio atestado. A aprovação agora é
   * procurada no registro do servidor, pelo hash do código.
   */
  subject?: { type: 'extension' | 'tool'; id: ObjectId } | null
}

/**
 * Pode publicar esta versão de código?
 *
 * Cada trava responde a uma pergunta diferente, e nenhuma cobre a outra: a flag e o
 * provider dizem se existe onde rodar; o scanner recusa o que nem vale a execução; o kill
 * switch impede o retorno de algo já desligado; e a revisão humana é a única que olha
 * INTENÇÃO — nenhuma regra automática distingue "lê um dado" de "lê o dado errado".
 */
export async function canPublishCode(req: CodePublishRequest): Promise<GateResult<ScanResult>> {
  const runtime = await runtimeIsUsable()
  if (!runtime.ok) return runtime

  const scan = scanSource(req.source, req.runtime)
  const morto = await isKilled({ packageId: req.packageId ?? null, version: req.version ?? null, sha256: scan.sha256 })
  if (morto) return recusa('killed', `este código está desligado: ${morto.reason}`)
  if (!scan.ok) return recusa('scan_failed', 'o código usa construções que não são permitidas', scan.findings.filter((f) => f.severity === 'block'))

  /**
   * A REVISÃO, procurada no registro do servidor e amarrada ao hash DESTE código.
   *
   * Amarrar ao hash é o que faz "já foi revisado" significar alguma coisa: aprovar a
   * versão 1.0.0 não aprova outro código publicado depois com o mesmo número, e mudar uma
   * linha invalida a aprovação sozinho, sem ninguém precisar reparar nisso.
   */
  if (!req.subject) return recusa('review_required', 'a publicação de código precisa dizer o que está sendo publicado')
  const { findApproval } = await import('./review.js')
  const aprovacao = await findApproval(req.subject.type, req.subject.id, scan.sha256)
  if (!aprovacao) return recusa('review_required', 'este código ainda não foi aprovado por um revisor da plataforma')

  return { ok: true, value: scan }
}

/** Pode EXECUTAR? As mesmas travas, mais o kill switch pelo hash do que vai rodar. */
export async function canExecuteCode(alvo: { packageId?: ObjectId | null; version?: string | null; sha256: string }): Promise<GateResult> {
  const runtime = await runtimeIsUsable()
  if (!runtime.ok) return runtime
  const morto = await isKilled(alvo)
  if (morto) return recusa('killed', `este código está desligado: ${morto.reason}`)
  return { ok: true } as GateResult
}

export const killSwitchCollection = killSwitches
