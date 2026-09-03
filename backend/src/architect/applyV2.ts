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
  /**
   * A CONEXÃO escolhida para cada entrega — `key` do item → id da conexão.
   *
   * O endereço não mora no Blueprint, e não é por acaso: o plano é lido inteiro pela tela e
   * viaja no histórico do projeto. O que vem daqui é uma REFERÊNCIA a uma conexão que já
   * existe na conta, escolhida na hora de aplicar e conferida contra o dono — o mesmo
   * caminho dos grants de App.
   */
  deliveryConnections?: Map<string, string>
  /**
   * A operação que está aplicando. É ela que vira MARCA no recurso criado.
   *
   * Entre criar o recurso e registrar o passo há um instante em que o recurso existe e a
   * operação não sabe. Uma queda ali deixa o Database de pé e o mapa sem ele — e a retomada
   * cria o segundo. Com a marca, a retomada procura antes de criar e encontra.
   *
   * Opcional: quem aplica sem operação não ganha marca, e o comportamento é o de antes.
   */
  operationId?: string
  projectId?: string
  /** Chamado DEPOIS de criar e ANTES de registrar. É como um teste exercita a janela. */
  afterCreate?: (kind: ApplyV2Kind, key: string) => void | Promise<void>
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

    /**
     * A JANELA: antes de criar, PROCURAR pela marca desta operação.
     *
     * Sem isto, uma queda entre a criação e o registro do passo fazia a retomada criar o
     * segundo recurso. A marca é o que torna a retomada capaz de reconhecer o que ela mesma
     * já tinha feito.
     */
    const recuperado = await recuperarPelaMarca(ctx, alvo.kind, key)
    if (recuperado) {
      ctx.resourceMap.set(chave(alvo.kind, key), recuperado)
      passos.push({ kind: alvo.kind, key, status: 'created', resourceId: recuperado, message: 'recuperado: já tinha sido criado antes da queda' })
      continue
    }

    try {
      const r = await criar(ctx, alvo.kind, alvo.item, key)
      await ctx.afterCreate?.(alvo.kind, key)
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

/** Onde a marca de cada tipo mora. Sem entrada aqui, o tipo não é recuperável — e é dito. */
const COLECAO_DA_MARCA: Partial<Record<ApplyV2Kind, string>> = {
  database: 'data_stores',
  source: 'monitoring_sources',
  monitor: 'monitors',
  flow: 'automations',
}

/** Já existe um recurso DESTA operação para esta `key`? */
async function recuperarPelaMarca(ctx: ApplyV2Context, kind: ApplyV2Kind, key: string): Promise<string | null> {
  if (!ctx.operationId) return null
  const colecao = COLECAO_DA_MARCA[kind]
  if (!colecao) return null
  const { db } = await import('../db.js')
  const doc = await db
    .collection(colecao)
    .findOne({ ownerId: ctx.ownerId, 'architect.operationId': ctx.operationId, 'architect.blueprintKey': key }, { projection: { _id: 1 } })
  return doc ? doc._id.toString() : null
}

/** A marca gravada JUNTO com o recurso, na mesma escrita. */
const marcaDe = (ctx: ApplyV2Context, key: string) =>
  ctx.operationId ? { projectId: ctx.projectId ?? '', operationId: ctx.operationId, blueprintKey: key } : undefined

/** Cria UM item pelo serviço canônico do domínio dele. */
type Criacao = { id: string; message?: string } | { pendency: string } | null

async function criar(ctx: ApplyV2Context, kind: ApplyV2Kind, item: Record<string, unknown>, key: string): Promise<Criacao> {
  const { ownerId, resourceMap } = ctx
  const idDe = (k: string, key: unknown): string | null => resourceMap.get(chave(k, String(key ?? ''))) ?? null

  if (kind === 'database') {
    const { createDataStore } = await import('../databases/store.js')
    const store = await createDataStore(ownerId, {
      ...(marcaDe(ctx, key) ? { architect: marcaDe(ctx, key)! } : {}),
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
      ...(marcaDe(ctx, key) ? { architect: marcaDe(ctx, key)! } : {}),
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
    /**
     * O histórico é um DESTINO da fonte, e não um recurso próprio.
     *
     * Ele é materializado pela Central quando a fonte é ativada — e é só aí que o recorder e o
     * dataset passam a existir. Enquanto isso, ele é uma PENDÊNCIA: devolver o id da fonte
     * como se fosse o conjunto fazia o monitor observar um documento de `monitoring_sources`.
     *
     * Quando o recorder já existe, o que sai daqui é `storeId:datasetKey` — o endereço real do
     * conjunto, que é o que o monitor precisa.
     */
    const fonteId = idDe('source', item.sourceKey)
    if (!fonteId || !ObjectId.isValid(fonteId)) throw new Error(`a fonte "${String(item.sourceKey)}" não foi criada`)
    const { getSource } = await import('../monitoring/service.js')
    const fonte = await getSource(ownerId, new ObjectId(fonteId))
    if (!fonte?.destination.recorderId) {
      return { pendency: 'o histórico é materializado quando a fonte entra no ar: ative a fonte e aplique de novo' }
    }
    const { ensureDatasetForRecorder } = await import('../databases/migration.js')
    const { obterRecorder } = await import('../dataHistory/recorders.js')
    const recorder = await obterRecorder(ownerId, fonte.destination.recorderId)
    if (!recorder) return { pendency: 'o histórico desta fonte não existe mais' }
    const { dataStoreId, datasetKey } = await ensureDatasetForRecorder(ownerId, recorder)
    return { id: `${dataStoreId.toString()}:${datasetKey}`, message: 'histórico materializado: o conjunto existe' }
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
        /**
         * PENDÊNCIA, e nunca o id da fonte.
         *
         * Devolver `{ id: alvo }` aqui marcava o passo como `created` com o id de um
         * documento de `monitoring_sources`: o `resourceMap` passava a apontar `monitor:x`
         * para uma FONTE, e o desfazer removeria a fonte achando que remove o monitor.
         */
        return { pendency: 'o monitor espera o conjunto: ative a fonte para o histórico existir, e aplique de novo' }
      }
      const m = await createMonitor(ownerId, {
        ...(marcaDe(ctx, key) ? { architect: marcaDe(ctx, key)! } : {}),
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
      ...(marcaDe(ctx, key) ? { architect: marcaDe(ctx, key)! } : {}),
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
      ...(marcaDe(ctx, key) ? { architect: marcaDe(ctx, key)! } : {}),
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

  if (kind === 'channel') {
    const agenteId = idDe('agent', item.entryAgentKey)
    const setorId = idDe('sector', item.entrySectorKey)
    if (!agenteId && !setorId) {
      return { pendency: 'este canal não tem quem receba: escolha o agente ou o setor de entrada' }
    }
    /**
     * O canal NATIVO é criado; o de App, não.
     *
     * `web_chat` é porta de entrada do próprio produto: ela não depende de credencial
     * nenhuma, e criar o vínculo é o que faz a mensagem chegar a alguém. Um canal de App —
     * WhatsApp, Telegram — depende do número, do token e da instalação conectada, que o
     * plano não pode inventar e que a pessoa escolhe na tela.
     */
    const appKey = String(item.appKey ?? '')
    if (appKey !== 'web_chat') {
      return { pendency: `conecte ${appKey} e escolha a conta: o vínculo depende da instalação, que este plano não pode escolher por você` }
    }
    const { createWidget } = await import('../widgets.js')
    const canal = await createWidget(ownerId, String(item.name ?? 'Canal do site'), {
      ...(agenteId && ObjectId.isValid(agenteId) ? { agentId: new ObjectId(agenteId) } : {}),
      ...(!agenteId && setorId && ObjectId.isValid(setorId) ? { sectorId: new ObjectId(setorId) } : {}),
    })
    return { id: canal._id.toString(), message: 'canal do site criado e apontado para quem recebe' }
  }

  if (kind === 'tool') {
    const agentes = ((item.agentKeys as string[] | undefined) ?? [])
      .map((k) => idDe('agent', k) ?? '')
      .filter((id) => id !== '' && ObjectId.isValid(id))
    if (!agentes.length) return { pendency: 'nenhum agente desta proposta usaria esta ferramenta' }

    const provider = String(item.provider ?? 'function')

    /**
     * Uma FUNÇÃO a registrar precisa de código — e código não se infere de uma descrição.
     *
     * Os outros dois providers são referências a coisas que já existem na conta, e essas o
     * plano pode ligar: é a diferença entre "escreva este cálculo para mim" e "dê ao agente
     * a ferramenta que eu já tenho".
     */
    if (provider === 'function') {
      return { pendency: `"${String(item.name ?? item.key)}" é um cálculo a registrar: crie a função e depois ligue no agente` }
    }

    if (provider === 'app_action') {
      // Uma ação de App é um GRANT, e o caminho dele é o mesmo dos requisitos de App: ele
      // exige instalação ativa e aprovação, que a saga do V1 já confere.
      return { pendency: `esta ferramenta é a ação "${String(item.actionKey ?? '')}" de ${String(item.appKey ?? '')}: conceda pelo bloco de Apps` }
    }

    const { listTools } = await import('../tools.js')
    /**
     * O nome de uma ferramenta é um IDENTIFICADOR (`cotacao_b3`), e o plano escreve como
     * gente ("Cotação B3"). Comparar as duas strings cruas nunca casaria — e o resultado
     * seria uma pendência dizendo que a ferramenta não existe quando ela está lá.
     */
    const chaveDoNome = (t: string) =>
      t
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
    const alvo = chaveDoNome(String(item.name ?? ''))
    const ferramenta = alvo ? (await listTools(ownerId)).find((t) => chaveDoNome(t.name) === alvo) : undefined
    if (!ferramenta) return { pendency: `não achei uma ferramenta chamada "${String(item.name ?? '')}" nesta conta` }

    const { getAgentById, updateAgent } = await import('../agents.js')
    for (const agentId of agentes) {
      const agente = await getAgentById(ownerId, new ObjectId(agentId))
      if (!agente) continue
      // ACRESCENTA. Uma ferramenta que o agente já tinha não é removida nem duplicada.
      const atuais = agente.toolIds ?? []
      if (atuais.includes(ferramenta._id.toString())) continue
      await updateAgent(ownerId, new ObjectId(agentId), { toolIds: [...atuais, ferramenta._id.toString()] })
    }
    return { id: ferramenta._id.toString(), message: `ferramenta "${ferramenta.name}" ligada em ${agentes.length} agente(s)` }
  }

  if (kind === 'delivery') {
    const conexaoId = ctx.deliveryConnections?.get(String(item.key ?? ''))
    if (!conexaoId) {
      return { pendency: 'escolha por onde esta entrega sai: uma conexão da sua conta, na hora de aplicar' }
    }
    if (!ObjectId.isValid(conexaoId)) return { pendency: 'a conexão escolhida não é válida' }

    // A posse é conferida AQUI, contra o dono da sessão. Um id que veio do cliente é um
    // pedido, e aceitá-lo faria a entrega sair pela conexão de outra pessoa.
    const { getConnection } = await import('../connections/service.js')
    const conexao = await getConnection(ownerId, new ObjectId(conexaoId))
    if (!conexao) return { pendency: 'a conexão escolhida não existe nesta conta' }
    if (conexao.status !== 'connected') return { pendency: `a conexão "${conexao.name}" não está conectada` }

    const flowId = idDe('flow', item.fromKey)
    if (!flowId || !ObjectId.isValid(flowId)) throw new Error(`o Flow "${String(item.fromKey)}" não foi criado`)

    /**
     * A entrega é um PASSO do Flow — não um campo solto.
     *
     * `definition.deliveries` é lido por quase ninguém; quem entrega de verdade é o passo
     * `delivery.send`, e é ele que aparece na Activity quando sai. Gravar só o campo daria
     * um Flow que parece configurado e não entrega nada.
     */
    const { getAutomation, updateDraft } = await import('../automations/service.js')
    const flow = await getAutomation(ownerId, new ObjectId(flowId))
    if (!flow) throw new Error('o Flow desta entrega não existe mais')
    const definicao = flow.draftDefinition
    const ultimo = definicao.steps[definicao.steps.length - 1]
    if (!ultimo) return { pendency: 'o Flow não tem etapa nenhuma: não há resultado para entregar' }

    const stepId = `entrega-${String(item.key ?? 'saida')}`
    if (!definicao.steps.some((p) => p.id === stepId)) {
      definicao.steps.push({
        id: stepId,
        name: 'Entregar resultado',
        type: 'delivery.send',
        enabled: true,
        dependsOn: [ultimo.id],
        inputMapping: {},
        config: { connectionId: conexaoId, fromStepId: ultimo.id },
        timeoutMs: 30_000,
        retryPolicy: { maxAttempts: 2, backoffMs: 2000 },
        continueOnError: false,
      } as never)
      definicao.deliveries = [
        ...(definicao.deliveries ?? []),
        { provider: conexao.provider, connectionId: conexaoId, fromStepId: ultimo.id, required: false },
      ]
      await updateDraft(ownerId, new ObjectId(flowId), { definition: definicao })
    }
    return { id: `${flowId}:${stepId}`, message: `entrega ligada em "${conexao.name}" — sai quando o Flow rodar` }
  }

  /**
   * O que sobra não tem criação automática.
   *
   * Não é esquecimento. Uma ferramenta própria precisa de endpoint e schema que o plano não
   * tem como inventar. E uma entrega precisa de uma CONEXÃO concreta — o próprio contrato do
   * V2 proíbe endereço dentro do Blueprint, porque ele é lido inteiro pela tela e viaja no
   * histórico do projeto. Devolver `null` os deixa como pendência explícita, em vez de criar
   * um recurso incompleto que parece pronto.
   */
  return null
}
