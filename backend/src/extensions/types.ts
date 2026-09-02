import type { ObjectId } from 'mongodb'

// O PACOTE COMPARTILHÁVEL — e as três coisas que ele NÃO é.
//
// Ele não é a instalação: quem instala traz a própria conexão, os próprios grants e a
// própria configuração. Ele não é o conteúdo do autor: memória, conversas, execuções,
// dados de database e credencial ficam de fora por construção, e o que sai daqui é
// manifesto. E ele não é código executável: um App comunitário continua sendo declarativo
// — a plataforma não roda HTML, script nem bundle de UI vindo de terceiro.
//
// Pacote, versão e instalação são separados porque respondem a perguntas diferentes:
// "o que existe", "o que foi congelado" e "o que esta conta está usando". Juntá-los faria
// editar um rascunho mudar o que já está instalado na conta de outra pessoa.

export type ExtensionKind = 'app' | 'tool' | 'template'
export const EXTENSION_KINDS: readonly ExtensionKind[] = ['app', 'tool', 'template']

export type ExtensionVisibility = 'private' | 'organization' | 'community'
export const EXTENSION_VISIBILITIES: readonly ExtensionVisibility[] = ['private', 'organization', 'community']

export type ExtensionStatus =
  | 'draft'
  | 'testing'
  | 'submitted'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'published'
  | 'suspended'
  | 'deprecated'

/**
 * O ciclo, escrito como GRAFO e não como lista.
 *
 * Uma transição que não está aqui não acontece: sem isso, "aprovado" vira um campo que
 * qualquer caminho pode escrever, e a revisão deixa de significar alguma coisa.
 */
export const STATUS_FLOW: Record<ExtensionStatus, readonly ExtensionStatus[]> = {
  draft: ['testing', 'submitted'],
  testing: ['draft', 'submitted'],
  submitted: ['in_review', 'draft'],
  in_review: ['approved', 'changes_requested'],
  changes_requested: ['draft', 'submitted'],
  approved: ['published', 'changes_requested'],
  // Publicado pode ser suspenso (incidente) ou aposentado (o autor seguiu em frente).
  published: ['suspended', 'deprecated'],
  // Suspensão não é fim de linha: revisada, ela volta. O que ela nunca faz é apagar
  // instalação ou histórico.
  suspended: ['published', 'deprecated'],
  deprecated: [],
}

/** O que a extensão PEDE — em linguagem de permissão, antes de qualquer efeito. */
export interface PermissionRequest {
  /** Sobre o quê: um App, um domínio de rede, um database, uma base de conhecimento. */
  kind: 'app' | 'network' | 'database' | 'knowledge'
  /** A chave do alvo: `google_calendar`, `api.exemplo.com`, `vendas`. */
  key: string
  /** O que ela quer fazer. Vocabulário do domínio, nunca texto livre do autor. */
  capabilities: string[]
  /** Por que ela precisa. Texto do autor — mostrado, nunca interpretado. */
  reason: string
}

export interface PlatformCompatibility {
  /** A menor versão de plataforma em que esta versão funciona. */
  minPlatform: string
  /** A maior, quando o autor sabe que ela quebra depois. Ausente = sem teto. */
  maxPlatform?: string | null
}

export interface ReviewResult {
  decision: 'approved' | 'changes_requested'
  /** Quem revisou. Uma conta, nunca um nome digitado. */
  reviewerId: string
  notes: string
  at: Date
}

export interface ExtensionPackage {
  _id: ObjectId
  authorAccountId: string
  kind: ExtensionKind
  /** Único por autor: dois pacotes com a mesma chave tornariam "qual?" ambíguo. */
  slug: string
  name: string
  summary: string
  categories: string[]
  visibility: ExtensionVisibility
  status: ExtensionStatus
  latestVersion: string | null
  /** O motivo da suspensão, visível para quem instalou. Nunca escondido. */
  suspendedReason?: string | null
  /** Quantas instalações ATIVAS. Contado do banco, nunca incrementado à mão. */
  createdAt: Date
  updatedAt: Date
}

export interface ExtensionVersion {
  _id: ObjectId
  packageId: ObjectId
  version: string
  /** O corpo congelado: manifesto de App, definição de Tool ou plano de Template. */
  manifest: Record<string, unknown>
  permissionManifest: PermissionRequest[]
  /** Referência a um artefato externo, quando houver. Nunca o artefato em si. */
  artifactRef?: string | null
  sha256: string
  changelog: string
  compatibility: PlatformCompatibility
  review: ReviewResult | null
  immutable: boolean
  createdAt: Date
}

export type InstallationStatus = 'active' | 'paused' | 'blocked'

export interface ExtensionInstallation {
  _id: ObjectId
  ownerId: string
  packageId: ObjectId
  /** A versão FIXADA. Atualizar é um ato, nunca um efeito colateral do autor publicar. */
  version: string
  status: InstallationStatus
  /** Configuração local — dados de quem instalou. Segredo continua na conexão cifrada. */
  config: Record<string, unknown>
  /** O que esta conta concedeu, aqui. O pacote não traz permissão de ninguém. */
  grants: PermissionRequest[]
  /**
   * O que a instalação CRIOU no escritório — e o que ainda falta para cada coisa.
   *
   * É por esta lista que a desinstalação sabe o que desligar, e é ela que diz a quem
   * instalou o que precisa ser preenchido: a credencial nunca veio no pacote.
   */
  createdRefs: { kind: string; id: string; pending?: string; baselineAt?: Date }[]
  installedAt: Date
  updatedAt: Date
}
