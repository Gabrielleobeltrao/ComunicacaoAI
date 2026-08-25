// Uma CONEXÃO reaproveitada por várias ferramentas.
//
// A ferramenta do dono guardava a URL inteira e a própria credencial. Duas ferramentas
// contra a mesma API guardavam o mesmo segredo duas vezes, e trocar a chave significava
// editar as duas — quando alguém lembrava da segunda.
//
// Aqui a conexão é a instalação de um App que já existe: `encryptedConfig` guarda a
// credencial, `publicMetadata` a seleção não secreta, e o manifesto declara o endereço
// base e os cabeçalhos comuns. A ferramenta passa a guardar só o CAMINHO.
//
// Nenhuma coleção nova: `Apps + AppInstallation` continuam sendo a fonte única de
// credencial e conexão. O que muda é quem pode ler o perfil.
import { getInstallation, decryptInstallationConfig, isInstallationUsable } from './installations.js'
import { isUsableManifest, resolveAppForOwner } from './privateApps.js'
import { isUsableApp } from './types.js'
import type { AppEnvironment, AppInstallation } from './types.js'
import { ObjectId } from 'mongodb'

/** Por que a conexão não pôde ser usada. Categoria, nunca o conteúdo dela. */
export type ConnectionProblem =
  | 'connection_not_found'
  | 'connection_revoked'
  | 'connection_expired'
  | 'app_unavailable'
  | 'app_not_connectable'
  | 'environment_blocked'

export interface ResolvedConnection {
  ok: true
  appKey: string
  appName: string
  environment: AppEnvironment
  /** Já interpolado com a configuração cifrada — nunca sai desta camada. */
  baseUrl: string
  headers: { key: string; value: string }[]
  allowedDomains: string[]
  installationName: string
}

export interface ConnectionRefusal {
  ok: false
  problem: ConnectionProblem
  /** Uma frase para quem administra. Nunca credencial, nunca corpo de terceiro. */
  message: string
}

/**
 * Ambientes que este ciclo NÃO executa.
 *
 * `live` fica preparado no tipo e bloqueado na execução: um ambiente que envia ordem de
 * verdade não pode passar a existir por uma linha de configuração. Ligar exige uma
 * decisão explícita de produto, e ela não foi tomada.
 */
const AMBIENTES_BLOQUEADOS: readonly AppEnvironment[] = ['live']

export const environmentOf = (i: Pick<AppInstallation, 'environment'>): AppEnvironment => i.environment ?? 'default'

/**
 * O perfil de conexão pronto para executar — ou a recusa, com o motivo.
 *
 * O escopo de dono está na consulta: um id de outra conta simplesmente não resolve. E a
 * ordem confere tudo ANTES de qualquer chamada sair: App utilizável, conexão viva,
 * ambiente liberado.
 */
export async function resolveConnection(
  ownerId: string,
  installationId: string,
  opts: { requireConnectable?: boolean } = {},
): Promise<ResolvedConnection | ConnectionRefusal> {
  const id = ObjectId.isValid(installationId) ? new ObjectId(installationId) : null
  const installation = id ? await getInstallation(ownerId, id) : null
  if (!installation) {
    return { ok: false, problem: 'connection_not_found', message: 'A conexão não existe nesta conta.' }
  }
  if (!isInstallationUsable(installation)) {
    const expirada = installation.status === 'needs_reauth'
    return {
      ok: false,
      problem: expirada ? 'connection_expired' : 'connection_revoked',
      message: expirada
        ? `A conexão "${installation.name}" precisa ser reconectada em Apps.`
        : `A conexão "${installation.name}" está ${installation.status === 'revoked' ? 'revogada' : 'com erro'} e não executa.`,
    }
  }

  const app = await resolveAppForOwner(ownerId, installation.appKey)
  if (!app || !isUsableManifest(app) || !isUsableApp(app)) {
    return { ok: false, problem: 'app_unavailable', message: `O App "${installation.appKey}" não está disponível para execução.` }
  }
  if (opts.requireConnectable !== false && !app.connection) {
    // Nem todo App é uma conexão reaproveitável: a maioria só executa as próprias ações.
    return { ok: false, problem: 'app_not_connectable', message: `O App "${app.name}" não pode ser usado como conexão de ferramenta.` }
  }

  const environment = environmentOf(installation)
  if (AMBIENTES_BLOQUEADOS.includes(environment)) {
    return {
      ok: false,
      problem: 'environment_blocked',
      message: `O ambiente "${environment}" não está liberado neste sistema. Use uma conexão de simulação (paper).`,
    }
  }

  const auth = decryptInstallationConfig(installation)
  const resource = installation.publicMetadata ?? {}
  const perfil = app.connection!
  const base = perfil.baseUrlByEnvironment?.[environment] ?? perfil.baseUrl

  return {
    ok: true,
    appKey: app.key,
    appName: app.name,
    environment,
    baseUrl: interpolar(base, auth, resource),
    headers: (perfil.headers ?? []).map((h: { key: string; value: string }) => ({ key: h.key, value: interpolar(h.value, auth, resource) })),
    allowedDomains: app.allowedDomains,
    installationName: installation.name,
  }
}

/** O MESMO interpolador das ações declarativas — duas versões divergiriam na primeira mudança. */
const interpolar = (template: string, auth: Record<string, string>, resource: Record<string, string>): string =>
  template
    .replace(/\{\{\s*auth\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => auth[key] ?? '')
    .replace(/\{\{\s*resource\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => resource[key] ?? '')

/**
 * Junta o endereço base ao caminho da ferramenta.
 *
 * Um caminho ABSOLUTO seria a ferramenta escapando da conexão: ela apontaria para onde
 * quisesse, com a credencial da conexão junto. O `allowedDomains` do App barraria depois,
 * mas a intenção já estaria errada — e é mais claro recusar aqui.
 */
export function joinPath(baseUrl: string, path: string): string | null {
  const limpo = String(path ?? '').trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(limpo)) return null
  const base = baseUrl.replace(/\/+$/, '')
  if (!limpo) return base
  return `${base}/${limpo.replace(/^\/+/, '')}`
}
