import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { ValidationError } from '../building.js'
import { createPrivateApp } from '../apps/privateApps.js'
import { createTool } from '../tools.js'
import type { Tool } from '../tools.js'
import { ExtensionError } from './packages.js'
import type { ExtensionInstallation, ExtensionPackage, ExtensionVersion } from './types.js'

// MATERIALIZAR — instalar precisa criar a coisa, e não uma linha dizendo que ela existe.
//
// Uma instalação que só grava metadado é uma promessa: o catálogo diz "instalado" e o
// escritório continua sem o App. O que este arquivo faz é escrever nos subsistemas
// CANÔNICOS — o mesmo `createPrivateApp` e o mesmo `createTool` das telas —, para que o
// que veio da comunidade seja indistinguível, na hora de usar, do que a conta criou.
//
// E o que ele nunca faz: copiar credencial, conexão, grant ou dado do autor. O manifesto
// traz a FORMA; quem instala fornece o conteúdo. Um cabeçalho de autenticação chega com o
// nome preenchido e o valor vazio, porque é assim que a pessoa sabe o que falta.

export interface CreatedRef {
  kind: 'app_definition' | 'tool' | 'architect_project'
  id: string
  /** O que precisa ser feito por quem instalou antes de a coisa funcionar. */
  pending?: string
  /**
   * Como o recurso estava quando a instalação o criou.
   *
   * "Editado" é `updatedAt > baselineAt`. Comparar com o instante da INSTALAÇÃO não
   * serve: a criação acontece alguns milissegundos depois dela, e tudo pareceria editado
   * desde o primeiro segundo.
   */
  baselineAt?: Date
}

const privateApps = db.collection<{ _id: ObjectId; ownerId: string; key: string; updatedAt: Date }>('app_definitions')
const tools = db.collection<Tool>('tools')

/**
 * Cria o recurso desta versão na conta de quem instalou.
 *
 * Idempotente pelo que já existe: se a chave do App ou o nome da ferramenta já estão lá,
 * a instalação falha dizendo isso em vez de sobrescrever o que a pessoa tinha. Sobrescrever
 * seria a instalação apagando trabalho de quem instalou.
 */
export async function materializeInstall(ownerId: string, pacote: ExtensionPackage, versao: ExtensionVersion): Promise<CreatedRef[]> {
  if (pacote.kind === 'app') return [await criarApp(ownerId, versao)]
  if (pacote.kind === 'tool') return [await criarFerramenta(ownerId, pacote, versao)]
  // Template não materializa aqui: ele vira PROPOSTA do Arquiteto, e o efeito só acontece
  // depois de alguém revisar a prévia. Ver extensions/templates.ts.
  return []
}

async function criarApp(ownerId: string, versao: ExtensionVersion): Promise<CreatedRef> {
  const manifesto = versao.manifest as Record<string, unknown>
  try {
    const app = await createPrivateApp(ownerId, {
      ...manifesto,
      // O App nasce PRIVADO da conta que instalou: ele é dela agora, e o autor não tem
      // mais nada a ver com o que ela conectar nele.
      source: 'private',
    })
    const doc = await privateApps.findOne({ ownerId, key: app.key })
    return {
      kind: 'app_definition',
      id: doc!._id.toString(),
      baselineAt: doc!.updatedAt,
      // A credencial é o que falta, sempre: ela nunca viajou dentro do pacote.
      pending: 'conecte este App em Apps para fornecer suas próprias credenciais',
    }
  } catch (erro) {
    if (erro instanceof ValidationError) throw new ExtensionError(erro.message, 'materialize_failed')
    throw erro
  }
}

async function criarFerramenta(ownerId: string, pacote: ExtensionPackage, versao: ExtensionVersion): Promise<CreatedRef> {
  const m = versao.manifest as {
    name?: string
    description?: string
    method?: string
    url?: string
    headerNames?: string[]
    inputSchema?: Record<string, unknown>
    timeoutMs?: number
    maxResponseChars?: number
    allowedDomains?: string[]
  }
  const nome = String(m.name ?? pacote.slug).slice(0, 60)
  const jaExiste = await tools.findOne({ ownerId, name: nome })
  if (jaExiste) throw new ExtensionError(`já existe uma ferramenta chamada "${nome}" nesta conta`, 'materialize_conflict')

  /**
   * Cabeçalho com NOME de credencial não vira cabeçalho.
   *
   * A ferramenta da conta já recusa isso pelo caminho de sempre — credencial mora na
   * seção de autenticação, cifrada, e não num campo que a tela mostra. Materializar
   * contornando essa regra criaria, pela porta da comunidade, exatamente o documento que
   * o produto recusa criar pela porta da frente.
   */
  const CHAVE_DE_SEGREDO = /(authorization|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|bearer|token|secret|password|senha|credential|cookie|private[-_]?key)/i
  const todos = (m.headerNames ?? []).map(String)
  const deCredencial = todos.filter((k) => CHAVE_DE_SEGREDO.test(k))
  const comuns = todos.filter((k) => !CHAVE_DE_SEGREDO.test(k))

  try {
    const criada = await createTool(ownerId, {
      name: nome,
      description: String(m.description ?? pacote.summary ?? ''),
      method: (m.method as Tool['method']) ?? 'GET',
      url: String(m.url ?? ''),
      // Os NOMES vieram no pacote; os valores são de quem instala, e nascem vazios.
      headers: comuns.map((k) => ({ key: k, value: '' })),
      inputSchema: m.inputSchema ?? { type: 'object', properties: {} },
      ...(m.timeoutMs ? { timeoutMs: Number(m.timeoutMs) } : {}),
      ...(m.maxResponseChars ? { maxResponseChars: Number(m.maxResponseChars) } : {}),
      ...(m.allowedDomains ? { allowedDomains: m.allowedDomains.map(String) } : {}),
      // Desligada ao nascer: ela ainda não tem credencial, e uma ferramenta ligada sem
      // credencial só produz erro na cara de quem usar.
      enabled: false,
    } as Parameters<typeof createTool>[1])
    return {
      kind: 'tool',
      id: criada._id.toString(),
      baselineAt: criada.updatedAt,
      pending: deCredencial.length
        ? `configure a autenticação (${deCredencial.join(', ')}) em Ferramentas e ative`
        : comuns.length
          ? `preencha ${comuns.join(', ')} e ative a ferramenta`
          : 'revise e ative a ferramenta',
    }
  } catch (erro) {
    throw new ExtensionError((erro as Error).message, 'materialize_failed')
  }
}

export interface ImpactItem {
  ref: CreatedRef
  exists: boolean
  /** Foi editado depois de instalado? Editado NUNCA é apagado por desinstalação. */
  edited: boolean
  name: string | null
}

/**
 * O que a desinstalação vai encontrar — antes de ela acontecer.
 *
 * "Editado" é comparado com o instante da instalação. Um recurso que a pessoa ajustou
 * deixou de ser o que veio do pacote; apagá-lo seria a desinstalação jogando fora trabalho
 * que não é dela.
 */
/**
 * Foi editado depois de criado?
 *
 * A referência da comparação é o `baselineAt` da própria criação. Sem ele — instalação
 * feita antes deste campo existir — cai no instante da instalação, que é o melhor palpite
 * disponível e erra para o lado seguro: preservar.
 */
const foiEditado = (updatedAt: Date | undefined, ref: { baselineAt?: Date }, instalacao: ExtensionInstallation): boolean =>
  Boolean(updatedAt && updatedAt.getTime() > (ref.baselineAt ?? instalacao.installedAt).getTime())

export async function installImpact(ownerId: string, instalacao: ExtensionInstallation): Promise<ImpactItem[]> {
  const itens: ImpactItem[] = []
  for (const ref of instalacao.createdRefs ?? []) {
    if (!ObjectId.isValid(ref.id)) {
      itens.push({ ref: ref as CreatedRef, exists: false, edited: false, name: null })
      continue
    }
    const oid = new ObjectId(ref.id)
    if (ref.kind === 'app_definition') {
      const doc = await privateApps.findOne({ _id: oid, ownerId })
      itens.push({ ref: ref as CreatedRef, exists: Boolean(doc), edited: foiEditado(doc?.updatedAt, ref, instalacao), name: doc?.key ?? null })
    } else if (ref.kind === 'tool') {
      const doc = await tools.findOne({ _id: oid, ownerId })
      itens.push({ ref: ref as CreatedRef, exists: Boolean(doc), edited: foiEditado(doc?.updatedAt, ref, instalacao), name: doc?.name ?? null })
    } else {
      const doc = await db.collection('architect_projects').findOne({ _id: oid, ownerId }, { projection: { title: 1 } })
      itens.push({ ref: ref as CreatedRef, exists: Boolean(doc), edited: false, name: (doc?.title as string) ?? null })
    }
  }
  return itens
}

export interface DematerializeResult {
  disabled: CreatedRef[]
  /** Preservados porque foram editados por quem instalou. */
  kept: CreatedRef[]
  missing: CreatedRef[]
}

/**
 * Desinstalar DESLIGA o que veio do pacote e não foi tocado. Nada é apagado.
 *
 * Apagar quebraria o histórico de execução, que aponta para estes recursos — e é
 * justamente quando algo deu errado que alguém vai olhar para trás.
 */
export async function dematerialize(ownerId: string, instalacao: ExtensionInstallation): Promise<DematerializeResult> {
  const impacto = await installImpact(ownerId, instalacao)
  const saida: DematerializeResult = { disabled: [], kept: [], missing: [] }

  for (const item of impacto) {
    if (!item.exists) {
      saida.missing.push(item.ref)
      continue
    }
    if (item.edited) {
      saida.kept.push(item.ref)
      continue
    }
    if (item.ref.kind === 'tool') {
      await tools.updateOne({ _id: new ObjectId(item.ref.id), ownerId }, { $set: { enabled: false, updatedAt: new Date() } })
      saida.disabled.push(item.ref)
    } else {
      // App privado e projeto do Arquiteto não têm "desligado": eles ficam, e a instalação
      // pausada é o que diz que não vêm mais do pacote.
      saida.kept.push(item.ref)
    }
  }
  return saida
}

/**
 * Aplicar a versão nova sobre o que já existe — sem apagar o que a pessoa mudou.
 *
 * O recurso editado é PRESERVADO e reportado: quem instalou decide se quer o novo. A
 * alternativa seria a atualização desfazer o ajuste que alguém fez ontem, em silêncio.
 */
export async function rematerialize(
  ownerId: string,
  instalacao: ExtensionInstallation,
  pacote: ExtensionPackage,
  versao: ExtensionVersion,
): Promise<{ updated: CreatedRef[]; preserved: CreatedRef[]; created: CreatedRef[] }> {
  const impacto = await installImpact(ownerId, instalacao)
  const saida = { updated: [] as CreatedRef[], preserved: [] as CreatedRef[], created: [] as CreatedRef[] }

  if (impacto.length === 0) {
    saida.created.push(...(await materializeInstall(ownerId, pacote, versao)))
    return saida
  }

  for (const item of impacto) {
    if (!item.exists) {
      saida.created.push(...(await materializeInstall(ownerId, pacote, versao)))
      continue
    }
    if (item.edited) {
      saida.preserved.push(item.ref)
      continue
    }
    if (item.ref.kind === 'tool') {
      const m = versao.manifest as { method?: Tool['method']; url?: string; inputSchema?: Record<string, unknown>; description?: string }
      await tools.updateOne(
        { _id: new ObjectId(item.ref.id), ownerId },
        {
          $set: {
            ...(m.method ? { method: m.method } : {}),
            ...(m.url ? { url: m.url } : {}),
            ...(m.inputSchema ? { inputSchema: m.inputSchema } : {}),
            ...(m.description ? { description: m.description } : {}),
            updatedAt: new Date(),
          },
        },
      )
      saida.updated.push(item.ref)
    } else if (item.ref.kind === 'app_definition') {
      await privateApps.updateOne(
        { _id: new ObjectId(item.ref.id), ownerId },
        { $set: { manifest: { ...(versao.manifest as Record<string, unknown>), source: 'private' }, updatedAt: new Date() } },
      )
      saida.updated.push(item.ref)
    } else {
      saida.preserved.push(item.ref)
    }
  }
  return saida
}
