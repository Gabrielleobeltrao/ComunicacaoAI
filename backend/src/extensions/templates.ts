import { ObjectId } from 'mongodb'
import { computeBlueprintHash } from '../architect/blueprint.js'
import { asV2 } from '../architect/blueprintV2.js'
import { architectV2Enabled } from '../architect/flags.js'
import { loadOwnershipContext } from '../architect/context.js'
import { createProject, patchProject } from '../architect/repository.js'
import type { ArchitectProject } from '../architect/repository.js'
import { validateOfficeBlueprint } from '../architect/validate.js'
import type { OfficeBlueprintV1 } from '../architect/types.js'
import { ExtensionError, getVersion, packagesCollection } from './packages.js'
import { install } from './installs.js'
import type { ExtensionInstallation } from './types.js'

// INSTALAR UM TEMPLATE — pelo Arquiteto, e não por um segundo aplicador.
//
// Um template é um BLUEPRINT congelado. Aplicar um blueprint já é um caminho inteiro
// pronto: prévia do que será criado e do que será reutilizado, diff, aplicação idempotente
// com saga retomável e rollback do que a operação criou. Escrever um segundo aplicador
// aqui significaria manter duas regras de "o que acontece quando isto entra no
// escritório" — e a que estivesse errada só apareceria depois de estragar a conta de
// alguém.
//
// Por isso instalar um template faz uma coisa só: cria um PROJETO do Arquiteto com o
// blueprint do template. Daí em diante é o fluxo de sempre, incluindo a aprovação humana
// antes de qualquer efeito.

/**
 * O que um template NUNCA carrega, mesmo que o autor tenha colocado.
 *
 * A peneira é por CAMPO, aplicada na entrada. Um template com conteúdo do autor não é um
 * template — é uma cópia do escritório dele, com dado que a plataforma não tem direito de
 * distribuir. Recusar na instalação seria tarde: ele já teria sido publicado e baixado.
 */
const CAMPOS_PROIBIDOS = [
  'memories',
  'memory',
  'conversations',
  'messages',
  'executions',
  'runs',
  'documents',
  'knowledgeContent',
  'rows',
  'records',
  'installations',
  'connections',
  'grants',
  'credentials',
  'secrets',
]

export function findForbiddenPaths(valor: unknown, caminho = '', achados: string[] = []): string[] {
  if (!valor || typeof valor !== 'object') return achados
  if (Array.isArray(valor)) {
    valor.forEach((v, i) => findForbiddenPaths(v, `${caminho}[${i}]`, achados))
    return achados
  }
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    const onde = caminho ? `${caminho}.${chave}` : chave
    // Campo proibido COM conteúdo. Uma lista vazia é ruído de serialização, não dado.
    const temConteudo = Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== ''
    if (CAMPOS_PROIBIDOS.includes(chave) && temConteudo) achados.push(onde)
    findForbiddenPaths(v, onde, achados)
  }
  return achados
}

/**
 * O blueprint de um template, conferido antes de virar versão publicável.
 *
 * Duas perguntas: ele é um blueprint de verdade, e ele carrega só o que pode viajar. A
 * validação de posse fica de fora aqui de propósito — o template não conhece os ids da
 * conta que vai instalá-lo, e é a instalação que resolve isso.
 */
export function validateTemplateManifest(manifest: unknown): { valid: boolean; errors: string[] } {
  const proibidos = findForbiddenPaths(manifest)
  if (proibidos.length) {
    return { valid: false, errors: [`o template carrega conteúdo que não pode viajar em: ${proibidos.slice(0, 5).join(', ')}`] }
  }
  const r = validateOfficeBlueprint(manifest)
  return { valid: r.valid, errors: r.valid ? [] : r.issues.map((i) => i.message) }
}

export interface TemplateInstallResult {
  installation: ExtensionInstallation
  project: ArchitectProject
  blueprintHash: string
}

/**
 * Instala um template: registra a instalação e abre o projeto do Arquiteto.
 *
 * Nada é criado no escritório aqui. A prévia, o diff e a aplicação são os do Arquiteto —
 * e é lá que uma pessoa aprova antes de qualquer efeito externo.
 */
export async function installTemplate(ownerId: string, packageId: ObjectId, opcoes: { version?: string } = {}): Promise<TemplateInstallResult> {
  const pacote = await packagesCollection.findOne({ _id: packageId })
  if (!pacote) throw new ExtensionError('pacote não encontrado', 'not_found')
  if (pacote.kind !== 'template') throw new ExtensionError('este pacote não é um template', 'wrong_kind')

  // A instalação passa pelas MESMAS regras das outras: suspensão, publicação, pin.
  const instalacao = await install(ownerId, packageId, opcoes.version ? { version: opcoes.version } : {})
  const versao = await getVersion(packageId, instalacao.version)
  if (!versao) throw new ExtensionError('a versão instalada não está disponível', 'not_found')

  const conferido = validateTemplateManifest(versao.manifest)
  if (!conferido.valid) throw new ExtensionError(`este template não pode ser aplicado: ${conferido.errors[0]}`, 'invalid_template')

  const blueprint = versao.manifest as unknown as OfficeBlueprintV1
  // A posse é lida AGORA, na conta de quem instala: o que o template chama de "andar
  // existente" precisa ser resolvido contra este escritório, e não contra o do autor.
  await loadOwnershipContext(ownerId)

  const projeto = await createProject(ownerId, {
    title: blueprint.title || pacote.name,
    objective: blueprint.objective || pacote.summary,
  })
  /**
   * Com a flag do V2 ligada, o template chega como proposta V2 — convertida, nunca
   * reescrita.
   *
   * A conversão preserva `key` e `resourceId`, e o que o V1 não diz ela NÃO inventa: um
   * agente sem função vira um agente com a função vazia e uma pendência declarada. Um
   * template instalado como V2 tem que passar pelas mesmas pendências que qualquer
   * proposta — inventar a responsabilidade que falta pareceria mais amigável e seria
   * mentira na ficha do agente.
   */
  const v2 = architectV2Enabled() ? asV2(blueprint, 'create') : null
  const hash = computeBlueprintHash(blueprint, v2?.blueprint)
  const comBlueprint = await patchProject(ownerId, projeto._id, {
    blueprint,
    ...(v2 ? { blueprintVersion: 2 as const, blueprintV2: v2.blueprint } : {}),
    blueprintHash: hash,
    /**
     * Fica em RASCUNHO, nunca aplicado.
     *
     * O efeito no escritório continua dependendo de alguém abrir a prévia e aprovar —
     * que é exatamente o passo que separa "instalei um template" de "um estranho criou
     * agentes na minha conta".
     */
    status: 'draft',
  })

  return { installation: instalacao, project: comBlueprint ?? projeto, blueprintHash: hash }
}
