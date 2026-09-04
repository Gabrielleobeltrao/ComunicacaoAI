import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { STATUS_FLOW, EXTENSION_KINDS, EXTENSION_VISIBILITIES } from './types.js'
import type {
  ExtensionInstallation,
  ExtensionKind,
  ExtensionPackage,
  ExtensionStatus,
  ExtensionVersion,
  ExtensionVisibility,
  PermissionRequest,
  PlatformCompatibility,
  ReviewResult,
} from './types.js'

// O PACOTE e suas versões: rascunho editável, versão publicada imutável.
//
// A regra que sustenta tudo: "instalei a extensão X" só significa alguma coisa se X não
// puder mudar por baixo. Se o autor puder editar o que já foi instalado, cada instalação
// vira alvo móvel — e a permissão que alguém revisou ontem pode estar valendo para outro
// comportamento hoje.
//
// O hash não é enfeite: é ele que permite conferir, na instalação e na execução, que o
// que está rodando é o que passou pela revisão.

const packages = db.collection<ExtensionPackage>('extension_packages')
const versions = db.collection<ExtensionVersion>('extension_versions')
const installations = db.collection<ExtensionInstallation>('extension_installations')

export async function ensureExtensionIndexes(): Promise<void> {
  await packages.createIndex({ authorAccountId: 1, slug: 1 }, { unique: true })
  await packages.createIndex({ visibility: 1, status: 1, updatedAt: -1 })
  await packages.createIndex({ kind: 1, categories: 1 })
  await versions.createIndex({ packageId: 1, version: 1 }, { unique: true })
  await versions.createIndex({ packageId: 1, createdAt: -1 })
  await installations.createIndex({ ownerId: 1, packageId: 1 }, { unique: true })
  await installations.createIndex({ packageId: 1, status: 1 })
}

export class ExtensionError extends Error {
  constructor(
    message: string,
    readonly code = 'invalid',
  ) {
    super(message)
  }
}

const SEMVER = /^\d+\.\d+\.\d+$/
const SLUG = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/

/** O hash do que a versão é — com as chaves ORDENADAS, para reescrita cosmética não contar. */
export function hashManifest(manifest: Record<string, unknown>): string {
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

/**
 * A peneira de SEGREDO — aplicada ao manifesto antes de ele virar versão imutável.
 *
 * Um pacote publicado é lido por estranhos. Uma chave que escapou para dentro dele não
 * volta: já foi baixada. A recusa é por NOME de campo, a mesma peneira que o resto do
 * sistema usa, e ela acontece na publicação, e não na instalação.
 */
const CHAVE_DE_SEGREDO = /(authorization|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|bearer|token|secret|password|senha|credential|cookie|private[-_]?key)/i

export function findSecretPaths(valor: unknown, caminho = '', achados: string[] = []): string[] {
  if (!valor || typeof valor !== 'object') return achados
  if (Array.isArray(valor)) {
    valor.forEach((v, i) => findSecretPaths(v, `${caminho}[${i}]`, achados))
    return achados
  }
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    const onde = caminho ? `${caminho}.${chave}` : chave
    /**
     * Campo com nome de segredo E com VALOR preenchido.
     *
     * A definição de um campo de autenticação (`{ key: 'apiKey', label: 'Chave' }`) é
     * legítima e precisa viajar: é ela que diz a quem instala o que fornecer. O que não
     * pode viajar é o valor — e é por isso que a peneira olha o conteúdo, não só o nome.
     */
    if (CHAVE_DE_SEGREDO.test(chave) && typeof v === 'string' && v.trim() !== '') achados.push(onde)
    findSecretPaths(v, onde, achados)
  }
  return achados
}

export interface CreatePackageInput {
  kind: ExtensionKind
  slug: string
  name: string
  summary?: string
  categories?: string[]
  visibility?: ExtensionVisibility
}

export async function createPackage(authorAccountId: string, input: CreatePackageInput): Promise<ExtensionPackage> {
  if (!EXTENSION_KINDS.includes(input.kind)) throw new ExtensionError('tipo de extensão desconhecido')
  const slug = String(input.slug ?? '').trim().toLowerCase()
  if (!SLUG.test(slug)) throw new ExtensionError('a chave usa letras minúsculas, números e hífen')
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 160) throw new ExtensionError('dê um nome ao pacote')
  const visibility = input.visibility ?? 'private'
  if (!EXTENSION_VISIBILITIES.includes(visibility)) throw new ExtensionError('visibilidade desconhecida')

  const agora = new Date()
  const doc: ExtensionPackage = {
    _id: new ObjectId(),
    authorAccountId,
    kind: input.kind,
    slug,
    name,
    summary: String(input.summary ?? '').slice(0, 400),
    categories: (input.categories ?? []).map((c) => String(c).slice(0, 40)).slice(0, 8),
    visibility,
    // Todo pacote nasce rascunho. Publicar é um ato, e ele passa pelo ciclo.
    status: 'draft',
    latestVersion: null,
    createdAt: agora,
    updatedAt: agora,
  }
  try {
    await packages.insertOne(doc)
  } catch (erro) {
    if ((erro as { code?: number }).code === 11000) throw new ExtensionError(`você já tem um pacote com a chave "${slug}"`, 'duplicate')
    throw erro
  }
  return doc
}

export const getPackage = (authorAccountId: string, id: ObjectId) => packages.findOne({ _id: id, authorAccountId })
export const listPackagesOf = (authorAccountId: string) => packages.find({ authorAccountId }).sort({ updatedAt: -1 }).toArray()

export interface PublishVersionInput {
  version: string
  manifest: Record<string, unknown>
  permissionManifest?: PermissionRequest[]
  compatibility?: PlatformCompatibility
  changelog?: string
  artifactRef?: string | null
}

/**
 * Congela uma versão. Ela nasce imutável, com hash, e não pode ser republicada.
 *
 * A conferência do número acontece nos dois lugares: aqui, para a pessoa ler a razão, e
 * no índice único, porque é o banco que garante contra duas publicações simultâneas.
 */
export async function publishPackageVersion(authorAccountId: string, packageId: ObjectId, input: PublishVersionInput): Promise<ExtensionVersion> {
  const pacote = await getPackage(authorAccountId, packageId)
  if (!pacote) throw new ExtensionError('pacote não encontrado', 'not_found')
  if (!SEMVER.test(String(input.version ?? ''))) throw new ExtensionError('a versão usa o formato 1.0.0')
  if (!input.manifest || typeof input.manifest !== 'object') throw new ExtensionError('o pacote precisa de um manifesto')

  /**
   * TEMPLATE é conferido como template: ele precisa ser um blueprint válido e não pode
   * carregar conteúdo do autor. Conferir na publicação, e não na instalação, é o que
   * impede o pacote errado de ser baixado antes de alguém perceber.
   */
  if (pacote.kind === 'template') {
    const { validateTemplateManifest } = await import('./templates.js')
    const conferido = validateTemplateManifest(input.manifest)
    if (!conferido.valid) throw new ExtensionError(conferido.errors[0] ?? 'template inválido', 'invalid_template')
  }

  const segredos = findSecretPaths(input.manifest)
  if (segredos.length) {
    // Os CAMINHOS, nunca os valores: dizer onde está resolve o problema de quem publica
    // sem repetir o segredo em log, resposta e tela.
    throw new ExtensionError(`o manifesto carrega credencial em: ${segredos.slice(0, 5).join(', ')}`, 'secret_in_manifest')
  }

  const doc: ExtensionVersion = {
    _id: new ObjectId(),
    packageId,
    version: input.version,
    manifest: input.manifest,
    permissionManifest: normalizarPermissoes(input.permissionManifest),
    artifactRef: input.artifactRef ?? null,
    sha256: hashManifest(input.manifest),
    changelog: String(input.changelog ?? '').slice(0, 2000),
    compatibility: {
      minPlatform: String(input.compatibility?.minPlatform ?? '1.0.0'),
      maxPlatform: input.compatibility?.maxPlatform ?? null,
    },
    review: null,
    immutable: true,
    createdAt: new Date(),
  }
  try {
    await versions.insertOne(doc)
  } catch (erro) {
    if ((erro as { code?: number }).code === 11000) {
      throw new ExtensionError(`a versão ${input.version} já foi publicada e não pode ser alterada`, 'immutable')
    }
    throw erro
  }
  await packages.updateOne({ _id: packageId }, { $set: { latestVersion: input.version, updatedAt: new Date() } })
  return doc
}

function normalizarPermissoes(bruto: PermissionRequest[] | undefined): PermissionRequest[] {
  return (bruto ?? []).slice(0, 50).map((p) => ({
    kind: p.kind,
    key: String(p.key ?? '').slice(0, 120),
    capabilities: (p.capabilities ?? []).map((c) => String(c).slice(0, 40)).slice(0, 20),
    reason: String(p.reason ?? '').slice(0, 300),
  }))
}

export const listVersions = (packageId: ObjectId) => versions.find({ packageId }).sort({ createdAt: -1 }).toArray()
export const getVersion = (packageId: ObjectId, version: string) => versions.findOne({ packageId, version })

/**
 * A transição de estado — e só as que o grafo permite.
 *
 * `approved` e `published` exigem revisão registrada: sem isso, publicar seria um campo
 * que qualquer caminho escreve, e a revisão viraria enfeite. A suspensão exige motivo,
 * porque quem instalou tem direito de saber por que aquilo parou.
 */
export async function transition(
  packageId: ObjectId,
  para: ExtensionStatus,
  contexto: { actorId: string; isReviewer?: boolean; reason?: string; review?: Omit<ReviewResult, 'at'> } = { actorId: '' },
): Promise<ExtensionPackage> {
  const pacote = await packages.findOne({ _id: packageId })
  if (!pacote) throw new ExtensionError('pacote não encontrado', 'not_found')
  if (!(STATUS_FLOW[pacote.status] ?? []).includes(para)) {
    throw new ExtensionError(`não dá para ir de "${pacote.status}" para "${para}"`, 'invalid_transition')
  }

  // O AUTOR conduz até a submissão; daí em diante quem decide é a revisão.
  const doAutor = pacote.authorAccountId === contexto.actorId
  const precisaDeRevisor = ['in_review', 'approved', 'changes_requested', 'published', 'suspended'].includes(para)
  if (precisaDeRevisor && !contexto.isReviewer) throw new ExtensionError('esta mudança é da revisão', 'forbidden')
  if (!precisaDeRevisor && !doAutor) throw new ExtensionError('este pacote não é seu', 'forbidden')

  if (para === 'published' && pacote.status !== 'approved') throw new ExtensionError('publique só o que foi aprovado', 'not_approved')
  if (para === 'published' && !pacote.latestVersion) throw new ExtensionError('publique uma versão antes', 'no_version')
  if (para === 'suspended' && !contexto.reason) throw new ExtensionError('diga por que está suspendendo', 'missing_reason')

  const set: Partial<ExtensionPackage> = { status: para, updatedAt: new Date() }
  if (para === 'suspended') set.suspendedReason = String(contexto.reason).slice(0, 400)
  if (para === 'published') set.suspendedReason = null

  const atualizado = await packages.findOneAndUpdate(
    // O estado ANTERIOR no filtro: duas revisões simultâneas não se sobrescrevem.
    { _id: packageId, status: pacote.status },
    { $set: set },
    { returnDocument: 'after' },
  )
  if (!atualizado) throw new ExtensionError('o pacote mudou de estado enquanto isto acontecia', 'conflict')

  if (contexto.review && pacote.latestVersion) {
    await versions.updateOne(
      { packageId, version: pacote.latestVersion },
      { $set: { review: { ...contexto.review, at: new Date() } } },
    )
  }
  return atualizado
}

/**
 * O que o catálogo mostra: publicado, aprovado e visível — e nada mais.
 *
 * `community` no tipo não significa que existe conteúdo confiável: só resolve o que
 * passou pela revisão e está publicado. Suspenso some do catálogo na mesma consulta.
 */
export async function searchCatalog(q: { term?: string; kind?: ExtensionKind; category?: string; limit?: number } = {}) {
  const filtro: Record<string, unknown> = { visibility: 'community', status: 'published' }
  if (q.kind) filtro.kind = q.kind
  if (q.category) filtro.categories = q.category
  if (q.term) {
    const termo = String(q.term).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filtro.$or = [{ name: { $regex: termo, $options: 'i' } }, { summary: { $regex: termo, $options: 'i' } }]
  }
  const achados = await packages.find(filtro).sort({ updatedAt: -1 }).limit(Math.min(50, q.limit ?? 20)).toArray()
  // A CONTAGEM vem do banco, sempre. Um contador incrementado à mão diverge no primeiro
  // erro e ninguém descobre — e "3 mil instalações" é exatamente o número que convence.
  const contagens = await installations
    .aggregate<{ _id: ObjectId; total: number }>([
      { $match: { packageId: { $in: achados.map((p) => p._id) }, status: { $ne: 'blocked' } } },
      { $group: { _id: '$packageId', total: { $sum: 1 } } },
    ])
    .toArray()
  const porPacote = new Map(contagens.map((c) => [c._id.toString(), c.total]))
  return achados.map((p) => ({ ...p, installs: porPacote.get(p._id.toString()) ?? 0 }))
}

export const packagesCollection = packages
export const versionsCollection = versions
export const installationsCollection = installations
