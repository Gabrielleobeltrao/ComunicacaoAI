import { ObjectId } from 'mongodb'
import { ExtensionError, getVersion, installationsCollection, packagesCollection, versionsCollection } from './packages.js'
import type { ExtensionInstallation, ExtensionPackage, ExtensionVersion, PermissionRequest } from './types.js'

// INSTALAR — e o que a instalação nunca traz junto.
//
// O pacote é do autor; a instalação é de quem instala. Por isso ela guarda a versão
// FIXADA, a configuração local e os grants locais: a conexão é da conta que instalou, e a
// permissão foi concedida por ela. Copiar credencial, grant, dado, memória ou conversa do
// autor transformaria "instalar" em "receber acesso ao escritório de outra pessoa".
//
// Atualizar é um ATO. O autor publicar uma versão nova não muda o que já está rodando —
// senão a permissão revisada ontem valeria para outro comportamento hoje.

/** A versão instalada é PINADA: só muda quando alguém aprova o diff. */
export interface InstallInput {
  version?: string
  config?: Record<string, unknown>
  grants?: PermissionRequest[]
}

const compativel = (instalada: string, atual: string): boolean => instalada.split('.')[0] === atual.split('.')[0]

async function resolverPublicado(packageId: ObjectId): Promise<ExtensionPackage> {
  const pacote = await packagesCollection.findOne({ _id: packageId })
  if (!pacote) throw new ExtensionError('pacote não encontrado', 'not_found')
  if (pacote.status === 'suspended') {
    // A suspensão bloqueia instalação NOVA na hora, e diz por quê. O que já está
    // instalado não é apagado: histórico não se reescreve por incidente.
    throw new ExtensionError(pacote.suspendedReason ?? 'este pacote está suspenso', 'suspended')
  }
  if (pacote.visibility === 'community' && pacote.status !== 'published') {
    throw new ExtensionError('este pacote ainda não foi publicado', 'not_published')
  }
  return pacote
}

export async function install(ownerId: string, packageId: ObjectId, input: InstallInput = {}): Promise<ExtensionInstallation> {
  const pacote = await resolverPublicado(packageId)
  // O pacote privado só instala na conta do autor: visibilidade não é enfeite de catálogo.
  if (pacote.visibility === 'private' && pacote.authorAccountId !== ownerId) throw new ExtensionError('pacote não encontrado', 'not_found')

  const versao = input.version ?? pacote.latestVersion
  if (!versao) throw new ExtensionError('este pacote não tem versão publicada', 'no_version')
  const congelada = await getVersion(packageId, versao)
  if (!congelada) throw new ExtensionError(`a versão ${versao} não existe`, 'not_found')

  const agora = new Date()
  const doc: ExtensionInstallation = {
    _id: new ObjectId(),
    ownerId,
    packageId,
    version: versao,
    status: 'active',
    // Dados de quem instala. Segredo continua na conexão cifrada, nunca aqui.
    config: input.config ?? {},
    // O que ESTA conta concedeu. O pacote pede; quem instala é que concede.
    grants: input.grants ?? [],
    createdRefs: [],
    installedAt: agora,
    updatedAt: agora,
  }
  try {
    await installationsCollection.insertOne(doc)
  } catch (erro) {
    if ((erro as { code?: number }).code === 11000) throw new ExtensionError('este pacote já está instalado nesta conta', 'duplicate')
    throw erro
  }
  return doc
}

export const getInstallation = (ownerId: string, packageId: ObjectId) => installationsCollection.findOne({ ownerId, packageId })
export const listInstallations = (ownerId: string) => installationsCollection.find({ ownerId }).sort({ installedAt: -1 }).toArray()

export interface PermissionDiff {
  added: PermissionRequest[]
  removed: PermissionRequest[]
  /** Mudou o que ela pode fazer sobre o mesmo alvo. */
  changed: { key: string; kind: string; before: string[]; after: string[] }[]
  /** `true` quando a atualização PEDE mais do que a instalada tinha. */
  needsApproval: boolean
}

const chaveDe = (p: PermissionRequest) => `${p.kind}:${p.key}`

/**
 * O DIFF de permissões entre a versão instalada e a candidata.
 *
 * É a pergunta que a tela de atualização precisa responder antes de qualquer clique:
 * "o que esta versão passa a poder fazer?". Uma atualização que pede mais NÃO se aplica
 * sozinha — é assim que "atualizar" deixa de ser um caminho para ampliar permissão sem
 * ninguém olhar.
 */
export function permissionDiff(instalada: PermissionRequest[], candidata: PermissionRequest[]): PermissionDiff {
  const antes = new Map(instalada.map((p) => [chaveDe(p), p]))
  const depois = new Map(candidata.map((p) => [chaveDe(p), p]))

  const added = candidata.filter((p) => !antes.has(chaveDe(p)))
  const removed = instalada.filter((p) => !depois.has(chaveDe(p)))
  const changed: PermissionDiff['changed'] = []
  for (const [chave, nova] of depois) {
    const velha = antes.get(chave)
    if (!velha) continue
    const ganhou = nova.capabilities.filter((c) => !velha.capabilities.includes(c))
    const perdeu = velha.capabilities.filter((c) => !nova.capabilities.includes(c))
    if (ganhou.length || perdeu.length) changed.push({ key: nova.key, kind: nova.kind, before: velha.capabilities, after: nova.capabilities })
  }

  const ampliou = added.length > 0 || changed.some((c) => c.after.some((cap) => !c.before.includes(cap)))
  return { added, removed, changed, needsApproval: ampliou }
}

export interface UpdatePreview {
  from: string
  to: string
  changelog: string
  compatible: boolean
  permissions: PermissionDiff
}

/** O que MUDA se esta instalação for atualizada — sem mudar nada. */
export async function previewUpdate(ownerId: string, packageId: ObjectId, para?: string): Promise<UpdatePreview | null> {
  const instalacao = await getInstallation(ownerId, packageId)
  if (!instalacao) throw new ExtensionError('esta extensão não está instalada', 'not_found')
  const pacote = await packagesCollection.findOne({ _id: packageId })
  if (!pacote) throw new ExtensionError('pacote não encontrado', 'not_found')

  const alvo = para ?? pacote.latestVersion
  if (!alvo || alvo === instalacao.version) return null

  const [atual, candidata] = await Promise.all([getVersion(packageId, instalacao.version), getVersion(packageId, alvo)])
  if (!candidata) throw new ExtensionError(`a versão ${alvo} não existe`, 'not_found')

  return {
    from: instalacao.version,
    to: alvo,
    changelog: candidata.changelog,
    // MAIOR diferente é mudança de significado das ações e das permissões: ela precisa
    // de revisão de gente, e não de uma atualização silenciosa.
    compatible: compativel(instalacao.version, alvo),
    permissions: permissionDiff(atual?.permissionManifest ?? [], candidata.permissionManifest),
  }
}

/**
 * Aplica a atualização — e recusa quando ela pede mais sem aprovação explícita.
 *
 * `approvePermissions` não é cerimônia: é o registro de que uma pessoa viu o diff. Sem
 * ele, uma versão nova que passa a pedir escrita entraria por uma atualização de rotina.
 */
export async function applyUpdate(
  ownerId: string,
  packageId: ObjectId,
  opcoes: { to?: string; approvePermissions?: boolean } = {},
): Promise<ExtensionInstallation> {
  const previa = await previewUpdate(ownerId, packageId, opcoes.to)
  if (!previa) throw new ExtensionError('esta instalação já está na versão mais nova', 'up_to_date')

  const pacote = await packagesCollection.findOne({ _id: packageId })
  if (pacote?.status === 'suspended') throw new ExtensionError(pacote.suspendedReason ?? 'este pacote está suspenso', 'suspended')
  if (previa.permissions.needsApproval && !opcoes.approvePermissions) {
    throw new ExtensionError('esta versão pede permissões novas: revise o que muda antes de atualizar', 'needs_approval')
  }

  const atualizado = await installationsCollection.findOneAndUpdate(
    { ownerId, packageId, version: previa.from },
    { $set: { version: previa.to, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  if (!atualizado) throw new ExtensionError('a instalação mudou enquanto isto acontecia', 'conflict')
  return atualizado
}

/**
 * Desinstalar PAUSA e guarda — nunca apaga.
 *
 * O histórico de execução aponta para esta instalação. Apagá-la deixaria linhas do painel
 * apontando para o nada, e é justamente quando algo deu errado que alguém vai olhar.
 */
export async function uninstall(ownerId: string, packageId: ObjectId): Promise<ExtensionInstallation | null> {
  return (
    (await installationsCollection.findOneAndUpdate(
      { ownerId, packageId },
      { $set: { status: 'paused', updatedAt: new Date() } },
      { returnDocument: 'after' },
    )) ?? null
  )
}

/**
 * O que a EXECUÇÃO pergunta antes de usar uma extensão instalada.
 *
 * Fail-closed: pacote suspenso, instalação pausada ou versão incompatível respondem
 * "não", com o motivo. Quem chama não decide nada — só obedece.
 */
export async function resolveInstalled(
  ownerId: string,
  packageId: ObjectId,
): Promise<{ ok: true; installation: ExtensionInstallation; version: ExtensionVersion } | { ok: false; reason: string; detail: string }> {
  const instalacao = await getInstallation(ownerId, packageId)
  if (!instalacao) return { ok: false, reason: 'nao_instalado', detail: 'Esta extensão não está instalada nesta conta.' }
  if (instalacao.status !== 'active') return { ok: false, reason: 'instalacao_pausada', detail: 'Esta extensão está pausada.' }

  const pacote = await packagesCollection.findOne({ _id: packageId })
  if (!pacote) return { ok: false, reason: 'pacote_removido', detail: 'O pacote desta extensão não existe mais.' }
  if (pacote.status === 'suspended') {
    return { ok: false, reason: 'pacote_suspenso', detail: pacote.suspendedReason ?? 'Este pacote está suspenso.' }
  }

  const versao = await versionsCollection.findOne({ packageId, version: instalacao.version })
  if (!versao) return { ok: false, reason: 'versao_removida', detail: 'A versão instalada não está mais disponível.' }
  return { ok: true, installation: instalacao, version: versao }
}
