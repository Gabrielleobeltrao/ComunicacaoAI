import { ObjectId } from 'mongodb'
import { applyOrder } from './blueprintV2.js'
import { itemsAt } from './typesV2.js'
import type { OfficeBlueprintV2 } from './typesV2.js'

// A SAGA DO V2 — recursos e operações, pelos serviços canônicos.
//
// A saga do V1 aplica organização: andares, agentes, setores, conhecimento, rotinas e
// grants de App. O V2 acrescenta o resto da cadeia — Databases, datasets, Tools, Sources,
// destinos Live e History, Monitors, Flows, canais e entregas.
//
// Três regras que atravessam o arquivo, e que não são preferências:
//
//   NADA NASCE LIGADO. Uma fonte nasce rascunho; um monitor e um Flow nascem rascunho. A
//   ativação é um passo separado, depois do teste. Criar já ativo é entregar uma operação
//   que ninguém provou que funciona — e que começa a agir sozinha na mesma hora.
//
//   A ORDEM VEM DO PLANO. `dependsOn` gera a ordem topológica: sem ela, a aplicação criaria
//   um monitor antes do dataset que ele observa e falharia num passo que não tem defeito.
//
//   QUEM CRIA É O DOMÍNIO. Nenhuma coleção é escrita direto daqui. `createDataStore`,
//   `createSource`, `createMonitor`, `createAutomation` — cada um com a validação, a cota e
//   os índices que já existem. Um insert direto aqui pularia todos os três.

export type ApplyV2Kind =
  | 'database'
  | 'dataset'
  | 'tool'
  | 'source'
  | 'live'
  | 'history'
  | 'monitor'
  | 'flow'
  | 'delivery'
  | 'channel'

export const APPLY_V2_KINDS: readonly ApplyV2Kind[] = [
  'database',
  'dataset',
  'tool',
  'source',
  'live',
  'history',
  'monitor',
  'flow',
  'delivery',
  'channel',
]

export interface ApplyV2Step {
  kind: ApplyV2Kind
  key: string
  status: 'created' | 'reused' | 'updated' | 'skipped' | 'failed'
  resourceId?: string | null
  message?: string
}

export interface ApplyV2Context {
  ownerId: string
  blueprint: OfficeBlueprintV2
  /** `kind:key` → id real. Vem da saga do V1 já preenchido com andares e agentes. */
  resourceMap: Map<string, string>
  /** As keys que a pessoa aprovou nesta aplicação. Vazio = nada é criado. */
  approvedKeys: Set<string>
}

const chave = (kind: string, key: string): string => `${kind}:${key}`

/**
 * Aplica os blocos de RECURSOS e OPERAÇÕES do V2.
 *
 * Devolve um passo por item, e nunca lança: quem chama decide o que fazer com uma falha
 * parcial. A saga do V1 já tem lease, retomada e compensação; esta função é o corpo de
 * trabalho que ela executa, não uma segunda engine.
 */
export async function applyV2Resources(ctx: ApplyV2Context): Promise<ApplyV2Step[]> {
  const passos: ApplyV2Step[] = []
  /** As `key`s que ficaram como pendência. Quem depende delas fica pendente também. */
  const pendencias = new Set<string>()
  const ordem = applyOrder(ctx.blueprint)
  const porKey = new Map<string, { kind: ApplyV2Kind; item: Record<string, unknown> }>()

  const registrar = (path: string, kind: ApplyV2Kind) => {
    for (const item of itemsAt(ctx.blueprint, path as never)) {
      porKey.set(String((item as { key?: unknown }).key ?? ''), { kind, item: item as Record<string, unknown> })
    }
  }
  registrar('resources.databases', 'database')
  registrar('resources.datasets', 'dataset')
  registrar('resources.tools', 'tool')
  registrar('operations.sources', 'source')
  registrar('operations.liveDestinations', 'live')
  registrar('operations.histories', 'history')
  registrar('operations.monitors', 'monitor')
  registrar('operations.flows', 'flow')
  registrar('operations.deliveries', 'delivery')
  registrar('operations.channels', 'channel')

  for (const key of ordem) {
    const alvo = porKey.get(key)
    if (!alvo) continue

    // Já feito nesta operação: repetir a aplicação não duplica.
    const jaFeito = ctx.resourceMap.get(chave(alvo.kind, key))
    if (jaFeito) {
      passos.push({ kind: alvo.kind, key, status: 'reused', resourceId: jaFeito })
      continue
    }

    const acao = String(alvo.item.action ?? 'create')
    if (acao === 'reuse') {
      const id = String(alvo.item.resourceId ?? '')
      ctx.resourceMap.set(chave(alvo.kind, key), id)
      passos.push({ kind: alvo.kind, key, status: 'reused', resourceId: id })
      continue
    }
    /**
     * O que não foi aprovado NÃO é criado.
     *
     * Aprovação é por item: quem revisou pode ter aceitado o Database e recusado o monitor.
     * Aplicar o que não foi aprovado transformaria a revisão em decoração.
     */
    if (!ctx.approvedKeys.has(key)) {
      passos.push({ kind: alvo.kind, key, status: 'skipped', message: 'não aprovado nesta aplicação' })
      continue
    }

    /**
     * O que depende de uma PENDÊNCIA também é pendência — nunca uma falha.
     *
     * Um destino ao vivo em cima de uma fonte que ficou pendente não tem defeito nenhum: ele
     * está esperando o mesmo dado que ela. Derrubar a aplicação aqui transformaria "falta
     * dizer de onde vem o dado" em "a aplicação quebrou".
     */
    const pendente = (alvo.item.dependsOn as string[] | undefined)?.find((d) => pendencias.has(String(d)))
    if (pendente) {
      pendencias.add(key)
      passos.push({ kind: alvo.kind, key, status: 'skipped', message: `depende de "${pendente}", que ficou pendente` })
      continue
    }

    try {
      const r = await criar(ctx, alvo.kind, alvo.item)
      if (r && 'id' in r) {
        ctx.resourceMap.set(chave(alvo.kind, key), r.id)
        passos.push({ kind: alvo.kind, key, status: 'created', resourceId: r.id, ...(r.message ? { message: r.message } : {}) })
      } else if (r && 'pendency' in r) {
        pendencias.add(key)
        passos.push({ kind: alvo.kind, key, status: 'skipped', message: r.pendency })
      } else {
        pendencias.add(key)
        passos.push({ kind: alvo.kind, key, status: 'skipped', message: 'este tipo ainda não é aplicado automaticamente' })
      }
    } catch (erro) {
      passos.push({ kind: alvo.kind, key, status: 'failed', message: String((erro as Error).message).slice(0, 300) })
      /**
       * Um passo que falha PARA a cadeia dele, e não a aplicação inteira.
       *
       * Continuar depois de uma fonte que não nasceu criaria um monitor observando um
       * conjunto que não existe — e um monitor mudo é pior que um monitor ausente, porque
       * ele parece configurado.
       */
      break
    }
  }

  return passos
}

/** Cria UM item pelo serviço canônico do domínio dele. */
type Criacao = { id: string; message?: string } | { pendency: string } | null

async function criar(ctx: ApplyV2Context, kind: ApplyV2Kind, item: Record<string, unknown>): Promise<Criacao> {
  const { ownerId, resourceMap } = ctx
  const idDe = (k: string, key: unknown): string | null => resourceMap.get(chave(k, String(key ?? ''))) ?? null

  if (kind === 'database') {
    const { createDataStore } = await import('../databases/store.js')
    const store = await createDataStore(ownerId, {
      name: String(item.name ?? 'Database'),
      ...(item.description ? { description: String(item.description) } : {}),
      adapterKind: String(item.adapterKind ?? 'data_history') as never,
      ...(item.retentionDays ? { retention: { mode: 'days', days: Number(item.retentionDays) } as never } : {}),
    })
    return { id: store._id.toString() }
  }

  if (kind === 'dataset') {
    const storeId = idDe('database', item.databaseKey)
    if (!storeId) throw new Error(`o Database "${String(item.databaseKey)}" não foi criado`)
    const { createDataset } = await import('../databases/store.js')
    const d = await createDataset(ownerId, new ObjectId(storeId), {
      key: String(item.datasetKey ?? item.key),
      name: String(item.name ?? item.key),
      // Sem `properties` o domínio recusa, e é o certo: um dataset que não declara campos
      // não pode ser consultado nem observado. Um default aqui só adiaria a recusa.
      schema: (item.schema as Record<string, unknown>) ?? {},
      ...(item.mutability ? { mutability: item.mutability as never } : {}),
      ...(item.timeField ? { timeField: String(item.timeField) } : {}),
    })
    return { id: `${storeId}:${d.key}` }
  }

  if (kind === 'source') {
    /**
     * Sem origem ou sem mapeamento, a fonte é uma PENDÊNCIA declarada — não um passo que
     * falha.
     *
     * O compilador emite a fonte de propósito, para que ela apareça no plano com o motivo:
     * de onde o dado vem é exatamente o que ele não pode inventar. Tentar criá-la assim
     * derrubava a aplicação inteira com "mapeie ao menos um campo", numa etapa que não tem
     * defeito nenhum — só falta uma informação que só a pessoa tem.
     */
    const config = (item.config ?? {}) as Record<string, unknown>
    const campos = ((item.mapping as { fields?: unknown[] } | undefined)?.fields ?? []) as unknown[]
    if (!Object.keys(config).length) return { pendency: 'falta dizer de onde este dado vem: endereço, App ou conjunto existente' }
    if (!campos.length) return { pendency: 'falta dizer quais campos ler desta origem' }

    const { createSource } = await import('../monitoring/service.js')
    /**
     * A fonte nasce RASCUNHO — é o próprio domínio que garante isso.
     *
     * `createSource` cria em `draft` e o portão de ativação exige um teste bem-sucedido.
     * Não há como criar uma fonte ativa por aqui, e é exatamente o que se quer.
     */
    const fonte = await createSource(ownerId, {
      name: String(item.name ?? item.key),
      kind: String(item.kind ?? 'api_polling') as never,
      config: (item.config as never) ?? {},
      mapping: item.mapping ?? { version: 1, fields: [] },
      cadence: (item.cadence as never) ?? { mode: 'interval', intervalMs: 60_000 },
      destination: { history: true },
      ...(item.entityKeyPath ? { entityKeyPath: String(item.entityKeyPath) } : {}),
    })
    return { id: fonte._id.toString(), message: 'criada como rascunho: ativa só depois de testar' }
  }

  if (kind === 'history') {
    // O histórico é um DESTINO da fonte, e não um recurso próprio: ele é materializado pela
    // Central quando a fonte é ativada. Aqui só se registra a intenção.
    const fonteId = idDe('source', item.sourceKey)
    if (!fonteId) throw new Error(`a fonte "${String(item.sourceKey)}" não foi criada`)
    return { id: fonteId, message: 'o histórico é materializado quando a fonte é ativada' }
  }

  if (kind === 'live') {
    const fonteId = idDe('source', item.sourceKey)
    if (!fonteId) throw new Error(`a fonte "${String(item.sourceKey)}" não foi criada`)
    const { updateSource, getSource } = await import('../monitoring/service.js')
    const atual = await getSource(ownerId, new ObjectId(fonteId))
    if (!atual) throw new Error('a fonte não existe mais nesta conta')
    /**
     * Ligar o destino AO VIVO é uma atualização da fonte, não um recurso novo.
     *
     * A Central materializa o par em tempo real na ativação — e ele nasce sem agente
     * nenhum, porque acesso é concessão e não padrão.
     */
    await updateSource(ownerId, new ObjectId(fonteId), {
      name: atual.name,
      kind: atual.kind,
      config: atual.config as never,
      mapping: atual.mapping,
      cadence: atual.cadence,
      destination: { live: true, history: atual.destination.history },
    })
    return { id: fonteId, message: 'destino ao vivo ligado; o alias nasce sem agentes' }
  }

  if (kind === 'monitor') {
    const observa = item.observes as { kind?: string; datasetKey?: string; eventType?: string } | undefined
    const { createMonitor } = await import('../monitors/service.js')
    /**
     * O monitor observa o DATASET real — resolvido pelo mapa da operação.
     *
     * Quando o Blueprint aponta para um histórico, quem tem o dataset é a Central: o
     * `datasetKey` é o id do recorder, e ele só existe depois de a fonte ser ativada. Por
     * isso o monitor de uma fonte recém-criada é uma pendência, e não um monitor mudo.
     */
    if (observa?.kind === 'dataset') {
      const alvo = idDe('dataset', observa.datasetKey) ?? idDe('history', observa.datasetKey)
      if (!alvo) throw new Error(`o conjunto "${String(observa.datasetKey)}" ainda não existe: ative a fonte antes`)
      const [storeId, datasetKey] = alvo.includes(':') ? alvo.split(':') : [null, null]
      if (!storeId || !datasetKey) {
        return { id: alvo, message: 'o monitor fica pendente até a fonte ser ativada e o conjunto existir' }
      }
      const m = await createMonitor(ownerId, {
        name: String(item.name ?? item.key),
        source: { kind: 'database', dataStoreId: new ObjectId(storeId), datasetKey },
        condition: item.condition,
        triggerMode: String(item.triggerMode ?? 'enter') as never,
        threshold: (item.threshold as number) ?? null,
        thresholdField: (item.thresholdField as string) ?? null,
        debounceMs: Number(item.debounceMs ?? 0),
        cooldownMs: Number(item.cooldownMs ?? 0),
        flowId: idDe('flow', item.flowKey),
      })
      // Nasce rascunho: publicar é um ato separado, depois da simulação.
      return { id: m._id.toString(), message: 'criado como rascunho: publique depois de simular' }
    }

    const m = await createMonitor(ownerId, {
      name: String(item.name ?? item.key),
      source: { kind: 'internal_event', eventType: String(observa?.eventType ?? '') } as never,
      condition: item.condition,
      triggerMode: String(item.triggerMode ?? 'enter') as never,
      threshold: (item.threshold as number) ?? null,
      thresholdField: (item.thresholdField as string) ?? null,
      debounceMs: Number(item.debounceMs ?? 0),
      cooldownMs: Number(item.cooldownMs ?? 0),
      flowId: idDe('flow', item.flowKey),
    })
    return { id: m._id.toString(), message: 'criado como rascunho: publique depois de simular' }
  }

  if (kind === 'flow') {
    const andarId = idDe('floor', item.floorKey)
    if (!andarId) throw new Error(`o andar "${String(item.floorKey)}" não foi criado`)
    const { createAutomation } = await import('../automations/service.js')
    const a = await createAutomation(ownerId, {
      floorId: andarId,
      name: String(item.name ?? item.key),
      definition: {
        // O gatilho por monitor é `manual` no Flow: quem dispara é o monitor, chamando a
        // execução. Um `schedule` aqui faria o Flow rodar sozinho ALÉM do monitor.
        trigger: { type: 'manual' },
        steps: (item.steps as Record<string, unknown>[]) ?? [],
        resultFormat: String(item.resultFormat ?? 'markdown'),
        deliveries: [],
        limits: { maxSteps: 20, maxDurationMs: 300_000, maxTokens: 60_000 },
      } as never,
    })
    return { id: a._id.toString(), message: 'criado como rascunho: publique depois de revisar' }
  }

  /**
   * `tool`, `delivery` e `channel` ainda não têm criação automática.
   *
   * Não é esquecimento: uma ferramenta própria precisa de endpoint e schema que o plano não
   * tem como inventar; uma entrega precisa de destino concreto, que é escolhido na tela; e o
   * vínculo de canal depende da instalação estar conectada. Devolver `null` os deixa como
   * pendência explícita, em vez de criar um recurso incompleto que parece pronto.
   */
  return null
}
