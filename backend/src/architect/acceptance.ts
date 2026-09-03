import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { finishExecutionRoot, manualExecutionKey, openRunningRoot } from '../executionRoots.js'
import type { TriggerMode } from '../monitors/condition.js'
import type { AcceptanceTestKind, BlueprintAcceptanceTestV2, OfficeBlueprintV2 } from './typesV2.js'
import type { ArchitectChecklistItem } from './types.js'

// OS TESTES DE ACEITAÇÃO — a diferença entre "criado" e "funciona".
//
// No V1, "pronto" queria dizer "o documento existe". Um checklist que fica verde porque
// alguém criou um recurso é um checklist decorativo: ele confirma que a aplicação rodou, não
// que a operação funciona. A fonte pode ter nascido apontando para uma URL que responde 404;
// o monitor pode observar um campo que o mapeamento nunca produz; o Flow pode ter um passo
// que depende de outro que não existe. Nada disso aparece em "criado com sucesso".
//
// Por isso aqui cada teste OBSERVA o recurso real, criado nesta operação, e devolve o que
// viu em português. E o que não dá para observar de verdade fica `pending` com o motivo —
// nunca `passed` por falta de evidência contrária.
//
// Cada rodada abre uma raiz de execução em ambiente `test`: é assim que o resultado aparece
// na Activity, pela projeção que já existe, sem uma segunda coleção contando a mesma coisa.

export type AcceptanceStatus = 'passed' | 'failed' | 'pending' | 'skipped'

export interface AcceptanceResult {
  key: string
  kind: AcceptanceTestKind
  targetKey: string
  required: boolean
  status: AcceptanceStatus
  /** O que foi observado, em português. É o que a pessoa lê no checklist. */
  observed: string
  at: Date
}

export interface AcceptanceContext {
  ownerId: string
  blueprint: OfficeBlueprintV2
  /** `kind:key` → id real, o mesmo mapa da saga. */
  resourceMap: Map<string, string>
  operationId: ObjectId
}

const idDe = (ctx: AcceptanceContext, kind: string, key: string): string | null => ctx.resourceMap.get(`${kind}:${key}`) ?? null

/**
 * Roda os testes declarados no Blueprint, um por um.
 *
 * Nunca lança: um teste que estoura vira `failed` com o motivo. Uma exceção aqui derrubaria
 * a aplicação DEPOIS de tudo estar criado, e o dono ficaria com um escritório montado e uma
 * mensagem de erro sem relação com ele.
 */
export async function runAcceptanceTests(ctx: AcceptanceContext): Promise<AcceptanceResult[]> {
  const resultados: AcceptanceResult[] = []
  for (const teste of ctx.blueprint.acceptanceTests ?? []) {
    const chave = manualExecutionKey(`acceptance:${ctx.operationId.toString()}:${teste.key}`)
    await openRunningRoot({ executionKey: chave, ownerId: ctx.ownerId, source: 'manual', environment: 'test' })
    let r: AcceptanceResult
    try {
      r = await rodarUm(ctx, teste)
    } catch (erro) {
      r = resultado(teste, 'failed', `o teste não pôde rodar: ${String((erro as Error).message).slice(0, 200)}`)
    }
    await finishExecutionRoot(chave, {
      status: r.status === 'passed' ? 'succeeded' : r.status === 'failed' ? 'failed' : 'canceled',
      errorKind: r.status === 'failed' ? 'acceptance_failed' : null,
    })
    resultados.push(r)
  }
  return resultados
}

const resultado = (t: BlueprintAcceptanceTestV2, status: AcceptanceStatus, observed: string): AcceptanceResult => ({
  key: t.key,
  kind: t.kind,
  targetKey: t.targetKey,
  required: t.required,
  status,
  observed,
  at: new Date(),
})

async function rodarUm(ctx: AcceptanceContext, t: BlueprintAcceptanceTestV2): Promise<AcceptanceResult> {
  if (t.kind === 'source') return testarFonte(ctx, t)
  if (t.kind === 'monitor_simulation') return simularMonitor(ctx, t)
  if (t.kind === 'flow') return testarFlow(ctx, t)
  if (t.kind === 'agent_contract') return testarContratoDoAgente(ctx, t)
  if (t.kind === 'database_permission') return testarPermissaoDeDatabase(ctx, t)

  /**
   * Os três que ainda não têm caminho observável, cada um por um motivo diferente — e todos
   * `pending`, jamais `passed`.
   *
   * O canal depende de uma mensagem real chegar de fora; o dry-run depende de o App declarar
   * um, e a maioria não declara; a entrega depende de um destino concreto que só a pessoa
   * pode confirmar. Marcar qualquer um deles como aprovado seria dizer que a operação foi
   * provada quando ninguém observou nada.
   */
  const motivo: Record<string, string> = {
    channel: 'depende de uma mensagem real chegar pelo canal: mande uma e confira que ela chega ao agente certo',
    app_dry_run: 'este App não oferece execução de teste: confirme a ação uma vez com você olhando',
    delivery: 'depende de um destino real: mande uma entrega de teste e confirme que ela chegou',
  }
  return resultado(t, 'pending', motivo[t.kind] ?? 'este tipo de teste ainda não roda sozinho')
}

// --- fonte: conexão, schema, mapeamento e frescor -------------------------------------------

async function testarFonte(ctx: AcceptanceContext, t: BlueprintAcceptanceTestV2): Promise<AcceptanceResult> {
  const id = idDe(ctx, 'source', t.targetKey)
  if (!id) return resultado(t, 'skipped', 'a fonte não foi criada nesta aplicação')

  const { getSource, testSource } = await import('../monitoring/service.js')
  const fonte = await getSource(ctx.ownerId, new ObjectId(id))
  if (!fonte) return resultado(t, 'failed', 'a fonte não existe mais nesta conta')

  // O teste REAL: bate na origem, aplica o mapeamento e devolve as linhas. É o único jeito
  // de saber que a URL responde, que o formato é o esperado e que os campos chegam.
  const r = await testSource(ctx.ownerId, fonte)
  if (!r.ok) return resultado(t, 'failed', `a fonte não respondeu: ${r.error?.message ?? 'falhou'}`)

  const obrigatorios = fonte.mapping.fields.filter((f) => f.required).map((f) => f.to)
  const faltando = obrigatorios.filter((nome) => !r.fields.some((f) => f.name === nome && f.present))
  if (faltando.length) {
    // Uma fonte que responde mas não traz o campo é pior que uma que falha: ela parece viva
    // e o monitor em cima dela nunca dispara.
    return resultado(t, 'failed', `a fonte respondeu, mas não trouxe ${faltando.join(', ')}`)
  }
  return resultado(t, 'passed', `a fonte respondeu e trouxe ${r.fields.filter((f) => f.present).length} campo(s)`)
}

// --- monitor: a regra, com anterior e agora --------------------------------------------------

async function simularMonitor(ctx: AcceptanceContext, t: BlueprintAcceptanceTestV2): Promise<AcceptanceResult> {
  const id = idDe(ctx, 'monitor', t.targetKey)
  if (!id || !ObjectId.isValid(id)) return resultado(t, 'skipped', 'o monitor não foi criado nesta aplicação')

  const monitor = await db.collection('monitors').findOne({ _id: new ObjectId(id), ownerId: ctx.ownerId })
  if (!monitor) return resultado(t, 'failed', 'o monitor não existe mais nesta conta')

  const { simulateMonitor } = await import('../monitors/condition.js')
  /**
   * A simulação usa dois valores construídos a partir do próprio limite da regra, e não uma
   * leitura real: quem simula quer entender a REGRA, e simular com a memória de plantão faria
   * o resultado depender do que o monitor viu ontem.
   */
  const campo = (monitor.thresholdField as string | null) ?? campoDaCondicao(monitor.condition)
  const limite = typeof monitor.threshold === 'number' ? monitor.threshold : 0
  if (!campo) return resultado(t, 'pending', 'a regra não cita um campo numérico: simule na tela do monitor')

  const antes = { [campo]: limite + 1 }
  const agora = { [campo]: limite - 1 }
  const r = simulateMonitor({
    condition: monitor.condition,
    triggerMode: (monitor.triggerMode as TriggerMode) ?? 'enter',
    threshold: typeof monitor.threshold === 'number' ? monitor.threshold : null,
    thresholdField: campo,
    value: agora,
    previous: antes,
  })
  if (!r.wouldTrigger) {
    // A regra não reconhece a própria transição que ela descreve: publicar isso entregaria um
    // monitor que nunca fala.
    return resultado(t, 'failed', `a regra não disparou na transição que ela mesma descreve (${campo}: ${limite + 1} → ${limite - 1})`)
  }
  return resultado(t, 'passed', `${r.explanation}`.slice(0, 200))
}

/** O primeiro campo citado na condição, quando a regra não declara um limite próprio. */
function campoDaCondicao(condition: unknown): string | null {
  const c = condition as { field?: unknown; left?: unknown; clauses?: unknown[] } | null
  if (!c || typeof c !== 'object') return null
  if (typeof c.field === 'string') return c.field
  if (typeof c.left === 'string') return c.left
  for (const filha of Array.isArray(c.clauses) ? c.clauses : []) {
    const achado = campoDaCondicao(filha)
    if (achado) return achado
  }
  return null
}

// --- Flow: rota, dependências e handoff ------------------------------------------------------

async function testarFlow(ctx: AcceptanceContext, t: BlueprintAcceptanceTestV2): Promise<AcceptanceResult> {
  const id = idDe(ctx, 'flow', t.targetKey)
  if (!id || !ObjectId.isValid(id)) return resultado(t, 'skipped', 'o Flow não foi criado nesta aplicação')

  const flow = await db.collection('automations').findOne({ _id: new ObjectId(id), ownerId: ctx.ownerId })
  if (!flow) return resultado(t, 'failed', 'o Flow não existe mais nesta conta')

  /**
   * A definição de um Flow mora em `draftDefinition` — e é a PUBLICADA que roda.
   *
   * Ler `definition` (que não existe) fazia todo Flow reprovar com "não tem nenhum passo":
   * um teste que sempre falha é tão inútil quanto um que sempre passa, e este mentia sobre
   * o motivo. Quando há versão publicada, é ela que vale: o rascunho pode estar adiante do
   * que realmente vai rodar.
   */
  const publicada =
    flow.lastPublishedVersion == null
      ? null
      : await db.collection('automation_versions').findOne({ ownerId: ctx.ownerId, automationId: flow._id, version: flow.lastPublishedVersion })
  const definicao = (publicada?.definition ?? flow.draftDefinition ?? {}) as { steps?: unknown[] }
  const passos = (definicao.steps ?? []) as { id?: string; dependsOn?: string[]; name?: string }[]
  if (!passos.length) return resultado(t, 'failed', 'o Flow não tem nenhum passo: ele não faria nada')

  // Cada dependência tem que apontar para um passo que existe. Um `dependsOn` órfão faz o
  // motor pular o passo em silêncio, e a operação entrega metade do que foi combinado.
  const ids = new Set(passos.map((p) => String(p.id ?? '')))
  const orfas = passos.flatMap((p) => (p.dependsOn ?? []).filter((d) => !ids.has(String(d))).map((d) => `${p.name ?? p.id} → ${d}`))
  if (orfas.length) return resultado(t, 'failed', `passo dependendo do que não existe: ${orfas.slice(0, 3).join('; ')}`)

  return resultado(t, 'passed', `o Flow tem ${passos.length} passo(s) e todas as dependências resolvem`)
}

// --- agente: o contrato de entrada e saída -----------------------------------------------------

async function testarContratoDoAgente(ctx: AcceptanceContext, t: BlueprintAcceptanceTestV2): Promise<AcceptanceResult> {
  const id = idDe(ctx, 'agent', t.targetKey)
  if (!id || !ObjectId.isValid(id)) return resultado(t, 'skipped', 'o agente não foi criado nesta aplicação')

  const agente = await db.collection('agents').findOne({ _id: new ObjectId(id), ownerId: ctx.ownerId })
  if (!agente) return resultado(t, 'failed', 'o agente não existe mais nesta conta')

  /**
   * A responsabilidade NUNCA pode ficar vazia.
   *
   * Um agente sem função escrita aparece no organograma como uma caixa muda, e ninguém —
   * nem o dono, nem outro agente que fosse delegar para ele — consegue dizer o que ele faz.
   */
  const funcao = String(agente.role ?? '').trim() || String(agente.jobDescription ?? '').trim()
  if (!funcao) return resultado(t, 'failed', 'o agente está sem função escrita: abra o agente e diga o que ele faz')

  const declarado = (ctx.blueprint.organization.agents ?? []).find((a) => a.key === t.targetKey)
  if (declarado?.outputContract && !String(agente.instructions ?? '').trim()) {
    return resultado(t, 'failed', 'o agente promete uma saída no plano e não tem instrução nenhuma para produzi-la')
  }
  return resultado(t, 'passed', `o agente tem função escrita: "${funcao.slice(0, 60)}"`)
}

// --- Database: a permissão que foi concedida ----------------------------------------------------

async function testarPermissaoDeDatabase(ctx: AcceptanceContext, t: BlueprintAcceptanceTestV2): Promise<AcceptanceResult> {
  const id = idDe(ctx, 'database', t.targetKey)
  if (!id || !ObjectId.isValid(id)) return resultado(t, 'skipped', 'o Database não foi criado nesta aplicação')

  const { getDataStore, listDatasets } = await import('../databases/store.js')
  // A leitura passa pelo caminho canônico, que filtra por dono: se ele devolvesse algo aqui
  // para um id de outra conta, o teste é justamente o que mostraria isso.
  const store = await getDataStore(ctx.ownerId, new ObjectId(id))
  if (!store) return resultado(t, 'failed', 'o Database não existe mais nesta conta')

  const conjuntos = await listDatasets(ctx.ownerId, store._id)
  if (!conjuntos.length) return resultado(t, 'failed', 'o Database não tem nenhum conjunto: não há o que ler nem gravar')

  const semCampos = conjuntos.filter((d) => !d.schema || !(d.schema as { properties?: unknown }).properties)
  if (semCampos.length) return resultado(t, 'failed', `conjunto sem campos declarados: ${semCampos.map((d) => d.key).join(', ')}`)

  return resultado(t, 'passed', `o Database responde com ${conjuntos.length} conjunto(s) legível(is)`)
}

// --- do resultado para o checklist e para a prontidão ---------------------------------------------

const TITULO: Record<AcceptanceTestKind, string> = {
  source: 'A fonte responde',
  channel: 'A mensagem chega ao agente certo',
  agent_contract: 'O agente entrega o que promete',
  flow: 'O Flow percorre a rota inteira',
  app_dry_run: 'A ação do App foi provada',
  database_permission: 'O Database responde a quem tem acesso',
  monitor_simulation: 'A regra dispara na transição certa',
  delivery: 'A entrega chega ao destino',
}

/**
 * Um item de checklist por teste, com `completionMode: 'test_result'`.
 *
 * É o que separa "pronto" de "criado": estes itens não podem ser marcados à mão, e só ficam
 * `done` quando o teste passou de verdade.
 */
export function acceptanceChecklist(resultados: AcceptanceResult[]): ArchitectChecklistItem[] {
  return resultados.map((r) => ({
    id: `test:${r.key}`,
    category: 'test' as const,
    title: TITULO[r.kind] ?? 'Teste da operação',
    description: r.observed,
    required: r.required,
    status: r.status === 'passed' ? ('done' as const) : r.status === 'failed' ? ('blocked' as const) : ('pending' as const),
    completionMode: 'test_result' as const,
    target: { kind: r.kind, key: r.targetKey },
    dependsOn: [],
  }))
}

/** O que impede a operação de ser dada como pronta. Só o que é obrigatório e não passou. */
export const acceptanceBlockers = (resultados: AcceptanceResult[]): string[] =>
  resultados.filter((r) => r.required && r.status !== 'passed').map((r) => `${TITULO[r.kind] ?? r.kind}: ${r.observed}`)

/**
 * O que pode ser ATIVADO, e nada além.
 *
 * A regra do passo 10: publicar/ativar somente o que passou e foi aprovado. Um recurso sem
 * teste declarado não entra — ausência de teste não é prova de nada, e ativar por falta de
 * evidência contrária é exatamente o que o V1 fazia.
 */
export function activatableKeys(resultados: AcceptanceResult[], kind: 'source' | 'monitor' | 'flow'): Set<string> {
  const doTipo = kind === 'source' ? 'source' : kind === 'monitor' ? 'monitor_simulation' : 'flow'
  const provados = new Set<string>()
  const reprovados = new Set<string>()
  for (const r of resultados) {
    if (r.kind !== doTipo) continue
    if (r.status === 'passed') provados.add(r.targetKey)
    else reprovados.add(r.targetKey)
  }
  // Um alvo com dois testes, um passando e outro não, NÃO é ativável: o que reprova manda.
  for (const k of reprovados) provados.delete(k)
  return provados
}
