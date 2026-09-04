import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { exportableManifest } from '../apps/manifest.js'
import type { AppDefinition } from '../apps/types.js'
import type { Tool } from '../tools.js'
import { ExtensionError, createPackage, publishPackageVersion, packagesCollection } from './packages.js'
import type { ExtensionPackage, PermissionRequest } from './types.js'

// O BACKFILL — e o que ele deliberadamente não faz.
//
// Cada App privado pode ganhar um pacote privado, e `app_definitions` continua sendo a
// FONTE: nada é apagado, nada é reescrito, e o App continua resolvendo pelo caminho de
// sempre. O pacote é uma projeção compartilhável — enquanto ninguém publicar, ele é só
// um rascunho parado.
//
// Ferramentas NÃO entram por varredura. O plano é explícito: uma Tool só vira pacote
// quando o autor escolhe "preparar para compartilhar". Empacotar a ferramenta de alguém
// por conta própria é decidir por essa pessoa que o trabalho dela é compartilhável.

const privateApps = db.collection<{ _id: ObjectId; ownerId: string; key: string; manifest: AppDefinition }>('app_definitions')
const tools = db.collection<Tool>('tools')

/** A chave do pacote derivada da chave do App: estável, então rodar duas vezes não duplica. */
const slugDoApp = (key: string) => `app-${String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '')}`

/**
 * As permissões que um manifesto de App PEDE, lidas do próprio manifesto.
 *
 * Derivadas, e não digitadas: um autor que escreve a lista à mão descreve o que ele
 * lembra, e o que a plataforma precisa mostrar é o que o manifesto realmente alcança.
 */
export function permissionsOfApp(manifest: AppDefinition): PermissionRequest[] {
  const pedidos: PermissionRequest[] = []
  for (const dominio of manifest.allowedDomains ?? []) {
    const escreve = (manifest.actions ?? []).some((a) => a.risk !== 'read')
    pedidos.push({
      kind: 'network',
      key: dominio,
      capabilities: escreve ? ['read', 'write'] : ['read'],
      reason: `as ações deste App falam com ${dominio}`,
    })
  }
  return pedidos
}

export interface BackfillResult {
  scanned: number
  created: number
  skipped: number
  /** O que aconteceria — quando `dryRun`. Nada é escrito. */
  planned: { appKey: string; slug: string }[]
}

/**
 * Cria um pacote privado por App privado. Idempotente e retomável.
 *
 * Idempotente porque a chave é derivada da chave do App e o índice único de
 * `(authorAccountId, slug)` recusa a segunda tentativa: rodar de novo depois de uma queda
 * continua de onde parou em vez de duplicar o que já passou.
 */
export async function backfillPrivateApps(ownerId: string, opcoes: { dryRun?: boolean } = {}): Promise<BackfillResult> {
  const apps = await privateApps.find({ ownerId }).toArray()
  const resultado: BackfillResult = { scanned: apps.length, created: 0, skipped: 0, planned: [] }

  for (const app of apps) {
    const slug = slugDoApp(app.key)
    const existente = await packagesCollection.findOne({ authorAccountId: ownerId, slug })
    if (existente) {
      resultado.skipped += 1
      continue
    }
    resultado.planned.push({ appKey: app.key, slug })
    if (opcoes.dryRun) continue

    const pacote = await createPackage(ownerId, {
      kind: 'app',
      slug,
      name: app.manifest?.name ?? app.key,
      summary: app.manifest?.description ?? '',
      categories: app.manifest?.categories ?? [],
      // PRIVADO. Backfill não publica nada: quem decide compartilhar é o autor.
      visibility: 'private',
    })
    await publishPackageVersion(ownerId, pacote._id, {
      version: app.manifest?.version && /^\d+\.\d+\.\d+$/.test(app.manifest.version) ? app.manifest.version : '1.0.0',
      // `exportableManifest` é o mesmo caminho da exportação manual: ele já tira o que
      // não pode viajar e mantém as DEFINIÇÕES dos campos de credencial.
      manifest: exportableManifest(app.manifest) as unknown as Record<string, unknown>,
      permissionManifest: permissionsOfApp(app.manifest),
      changelog: 'pacote criado a partir do App privado existente',
    })
    resultado.created += 1
  }
  return resultado
}

/**
 * "Preparar para compartilhar" uma ferramenta — um ato do autor, nunca uma varredura.
 *
 * O que viaja é a FORMA da ferramenta: método, endereço, contrato de entrada e os NOMES
 * dos cabeçalhos. O valor de cada cabeçalho fica onde está — cifrado, na ferramenta desta
 * conta. Quem instalar fornece os próprios.
 */
export async function prepareToolForSharing(ownerId: string, toolId: ObjectId): Promise<ExtensionPackage> {
  const ferramenta = await tools.findOne({ _id: toolId, ownerId })
  if (!ferramenta) throw new ExtensionError('ferramenta não encontrada', 'not_found')

  const slug = `tool-${ferramenta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '')}`
  const pacote = await createPackage(ownerId, {
    kind: 'tool',
    slug,
    name: ferramenta.name,
    summary: ferramenta.description,
    visibility: 'private',
  })

  let dominio = ''
  try {
    dominio = new URL(ferramenta.url).hostname
  } catch {
    // URL relativa (ferramenta com conexão): o domínio vem da conexão de quem instala.
  }

  await publishPackageVersion(ownerId, pacote._id, {
    version: '1.0.0',
    manifest: {
      kind: 'http_tool',
      name: ferramenta.name,
      description: ferramenta.description,
      method: ferramenta.method,
      url: ferramenta.url,
      // Só os NOMES: o valor de cada um é segredo desta conta.
      headerNames: (ferramenta.headers ?? []).map((h) => h.key),
      inputSchema: ferramenta.inputSchema,
      timeoutMs: ferramenta.timeoutMs,
      maxResponseChars: ferramenta.maxResponseChars,
      allowedDomains: ferramenta.allowedDomains ?? [],
    },
    permissionManifest: dominio
      ? [
          {
            kind: 'network',
            key: dominio,
            capabilities: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(ferramenta.method).toUpperCase()) ? ['read', 'write'] : ['read'],
            reason: `esta ferramenta chama ${dominio}`,
          },
        ]
      : [],
    changelog: 'pacote criado a partir da ferramenta desta conta',
  })
  return pacote
}
