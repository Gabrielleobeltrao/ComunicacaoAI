import { computeDefinitionHash } from '../automations/validate.js'
import type { BlueprintIssue } from './validate.js'
import type { OfficeBlueprintV1 } from './types.js'
import {
  BLUEPRINT_ACTIONS_V2,
  BLUEPRINT_CHANGE_KINDS,
  V2_ITEM_PATHS,
  V2_LIMITS,
  allItems,
  emptyBlueprintV2,
  isV2,
  itemsAt,
} from './typesV2.js'
import type { BlueprintChangeKindV2, OfficeBlueprint, OfficeBlueprintV2, V2ItemPath } from './typesV2.js'

// VALIDAR, PESAR E COMPARAR o Blueprint V2.
//
// A validação aqui é a ESTRUTURAL: keys únicas, referências que existem, dependências sem
// ciclo, tetos e ausência de segredo. O que é específico de um domínio continua sendo
// validado por ele — a condição de um monitor por `monitors/condition.ts`, a config de uma
// fonte por `monitoring/config.ts`, os passos de um Flow por `automations/validate.ts`.
//
// Uma segunda opinião sobre a forma de uma fonte divergiria da primeira no campo seguinte,
// e a que estivesse errada só apareceria na hora de aplicar — depois de alguém ter aprovado.

export interface BlueprintV2ValidationResult {
  valid: boolean
  issues: BlueprintIssue[]
}

/**
 * Um problema, com CÓDIGO estável.
 *
 * O código é o que a tela usa para decidir o que oferecer — "conecte o App", "escreva a
 * responsabilidade" — sem casar a mensagem por texto. Casar por texto quebra na primeira
 * vez que alguém melhora a frase.
 */
const erro = (path: string, code: string, message: string): BlueprintIssue => ({ path, code, message, severity: 'error' })

/** O formato de uma `key`: estável, sem espaço, referenciável. */
const KEY = /^[a-z0-9][a-z0-9-]{0,59}$/

/**
 * Nomes de campo que denunciam segredo.
 *
 * A lista é de FORMA, não de conteúdo: procurar por "parece uma chave de API" no valor daria
 * falso positivo em qualquer texto longo. Um campo chamado `token` num Blueprint é sempre
 * um erro, porque credencial mora no cofre e é injetada na execução.
 */
const CAMPOS_DE_SEGREDO = /^(secret|token|password|senha|api[_-]?key|credential|authorization|private[_-]?key|access[_-]?token)$/i

function procurarSegredo(valor: unknown, caminho: string, achados: BlueprintIssue[], profundidade = 0): void {
  if (profundidade > 8 || !valor || typeof valor !== 'object') return
  if (Array.isArray(valor)) {
    valor.forEach((v, i) => procurarSegredo(v, `${caminho}[${i}]`, achados, profundidade + 1))
    return
  }
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (CAMPOS_DE_SEGREDO.test(k)) {
      achados.push(erro(`${caminho}.${k}`, 'secret_in_blueprint', `"${k}" não entra num plano: credencial mora no cofre e é injetada na execução`))
      continue
    }
    procurarSegredo(v, `${caminho}.${k}`, achados, profundidade + 1)
  }
}

/**
 * A validação estrutural do V2.
 *
 * `ownership` é opcional aqui de propósito: esta função é pura e roda na prévia. A
 * conferência de posse acontece na aplicação, contra o inventário — e acontece de novo,
 * imediatamente antes de cada escrita.
 */
export function validateBlueprintV2(bruto: unknown): BlueprintV2ValidationResult {
  const issues: BlueprintIssue[] = []
  if (!bruto || typeof bruto !== 'object') return { valid: false, issues: [erro('', 'empty_blueprint', 'o plano está vazio')] }

  const bp = bruto as OfficeBlueprintV2
  if (bp.version !== 2) issues.push(erro('version', 'wrong_version', 'este validador é do formato 2'))
  if (!String(bp.title ?? '').trim()) issues.push(erro('title', 'missing_title', 'o plano precisa de um título'))
  if (!BLUEPRINT_CHANGE_KINDS.includes(bp.changeKind)) {
    issues.push(erro('changeKind', 'missing_change_kind', 'diga se isto cria, expande, conserta ou reorganiza'))
  }

  // --- keys: únicas no documento inteiro, e no formato que dá para referenciar ------------
  const porKey = new Map<string, string>()
  let total = 0
  for (const path of V2_ITEM_PATHS) {
    const lista = itemsAt(bp, path)
    total += lista.length
    if (lista.length > V2_LIMITS.itemsPerList) {
      issues.push(erro(path, 'limit_exceeded', `são ${lista.length} itens em ${path}; o teto é ${V2_LIMITS.itemsPerList}`))
    }
    lista.forEach((item, i) => {
      const key = String((item as { key?: unknown }).key ?? '').trim()
      if (!KEY.test(key)) {
        issues.push(erro(`${path}[${i}].key`, 'invalid_key', `"${key}" não é uma chave válida: minúsculas, números e hífen`))
        return
      }
      /**
       * A key é única no DOCUMENTO, não na lista.
       *
       * `dependsOn` e as referências cruzadas apontam por key sem dizer o tipo. Duas listas
       * com a mesma key transformariam uma dependência em ambiguidade — e a aplicação
       * escolheria uma das duas sem ninguém saber qual.
       */
      const antes = porKey.get(key)
      if (antes) issues.push(erro(`${path}[${i}].key`, 'duplicate_key', `a chave "${key}" já existe em ${antes}`))
      else porKey.set(key, path)

      const acao = String((item as { action?: unknown }).action ?? '')
      // `access` e alguns blocos não carregam ação; quando carregam, ela tem que valer.
      if (acao && !BLUEPRINT_ACTIONS_V2.includes(acao as (typeof BLUEPRINT_ACTIONS_V2)[number])) {
        issues.push(erro(`${path}[${i}].action`, 'unknown_action', `ação desconhecida: "${acao}"`))
      }
      if ((acao === 'reuse' || acao === 'update' || acao === 'archive') && !(item as { resourceId?: unknown }).resourceId) {
        issues.push(erro(`${path}[${i}].resourceId`, 'missing_resource_id', `"${key}" diz ${acao} e não aponta para nenhum recurso`))
      }
      const deps = (item as { dependsOn?: unknown }).dependsOn
      if (deps !== undefined && (!Array.isArray(deps) || deps.length > V2_LIMITS.dependsOn)) {
        issues.push(erro(`${path}[${i}].dependsOn`, 'invalid_depends_on', 'dependências demais ou em formato inválido'))
      }
    })
  }
  if (total > V2_LIMITS.totalItems) {
    issues.push(erro('', 'limit_exceeded', `são ${total} itens no plano; o teto é ${V2_LIMITS.totalItems}`))
  }

  // --- referências: toda key citada precisa existir ---------------------------------------
  const existe = (key: unknown): boolean => typeof key === 'string' && porKey.has(key)
  const conferir = (path: string, campo: string, key: unknown, obrigatorio = true) => {
    if (key === undefined || key === null || key === '') {
      if (obrigatorio) issues.push(erro(`${path}.${campo}`, 'missing_field', `${campo} é obrigatório`))
      return
    }
    if (!existe(key)) issues.push(erro(`${path}.${campo}`, 'unknown_reference', `"${String(key)}" não está neste plano`))
  }

  bp.organization?.agents?.forEach((a, i) => {
    const p = `organization.agents[${i}]`
    conferir(p, 'floorKey', a.floorKey)
    // O agente sem responsabilidade é ERRO, e não aviso: ele renderiza uma ficha vazia no
    // Flow, e quem olha não descobre o que ele faz nem onde procurar.
    if (!String(a.role ?? '').trim()) issues.push(erro(`${p}.role`, 'agent_without_role', `o agente "${a.name || a.key}" está sem responsabilidade`))
    if (!String(a.trigger ?? '').trim()) issues.push(erro(`${p}.trigger`, 'agent_without_trigger', `o agente "${a.name || a.key}" não diz quando entra`))
    if (!String(a.inputContract ?? '').trim()) issues.push(erro(`${p}.inputContract`, 'agent_without_input', `o agente "${a.name || a.key}" não diz o que recebe`))
    if (!String(a.outputContract ?? '').trim()) issues.push(erro(`${p}.outputContract`, 'agent_without_output', `o agente "${a.name || a.key}" não diz o que entrega`))
    if (a.fallbackAgentKey) conferir(p, 'fallbackAgentKey', a.fallbackAgentKey)
    for (const k of a.callableAgentKeys ?? []) conferir(p, 'callableAgentKeys', k)
  })

  bp.organization?.sectors?.forEach((s, i) => {
    const p = `organization.sectors[${i}]`
    conferir(p, 'floorKey', s.floorKey)
    for (const k of s.memberAgentKeys ?? []) conferir(p, 'memberAgentKeys', k)
    if (s.coordinatorAgentKey) conferir(p, 'coordinatorAgentKey', s.coordinatorAgentKey)
    // Um setor orquestrado sem coordenador não orquestra nada.
    if (s.mode === 'orchestrated' && !s.coordinatorAgentKey) {
      issues.push(erro(`${p}.coordinatorAgentKey`, 'missing_coordinator', `o setor "${s.name || s.key}" é orquestrado e não tem coordenador`))
    }
    if (s.mode === 'pipeline' && !(s.stages ?? []).length) {
      issues.push(erro(`${p}.stages`, 'pipeline_without_stages', `o setor "${s.name || s.key}" é um pipeline sem etapas`))
    }
    for (const [j, stage] of (s.stages ?? []).entries()) conferir(`${p}.stages[${j}]`, 'agentKey', stage.agentKey)
  })

  bp.organization?.floors?.forEach((f, i) => {
    if (f.workMode === 'coordinated' && !f.coordinatorAgentKey) {
      issues.push(erro(`organization.floors[${i}].coordinatorAgentKey`, 'missing_coordinator', `o andar "${f.name || f.key}" é coordenado e não tem coordenador`))
    }
    if (f.coordinatorAgentKey) conferir(`organization.floors[${i}]`, 'coordinatorAgentKey', f.coordinatorAgentKey)
  })

  bp.resources?.appRequirements?.forEach((r, i) => {
    const p = `resources.appRequirements[${i}]`
    for (const k of r.agentKeys ?? []) conferir(p, 'agentKeys', k)
    // O defeito que este bloco existe para impedir: um App sem ação resolve para zero
    // ferramentas, e o agente fica com a permissão e sem poder usá-la.
    if (r.required && !(r.actionKeys ?? []).length) {
      issues.push(erro(`${p}.actionKeys`, 'app_without_action', `o App "${r.appKey}" é obrigatório e não pede ação nenhuma`))
    }
    for (const escrita of r.autonomousWriteActionKeys ?? []) {
      if (!(r.actionKeys ?? []).includes(escrita)) {
        issues.push(erro(`${p}.autonomousWriteActionKeys`, 'autonomous_write_not_requested', `"${escrita}" é escrita autônoma sem estar entre as ações pedidas`))
      }
    }
  })

  bp.resources?.datasets?.forEach((d, i) => conferir(`resources.datasets[${i}]`, 'databaseKey', d.databaseKey))
  bp.resources?.tools?.forEach((t, i) => {
    for (const k of t.agentKeys ?? []) conferir(`resources.tools[${i}]`, 'agentKeys', k)
  })

  bp.operations?.channels?.forEach((c, i) => {
    const p = `operations.channels[${i}]`
    // Uma porta que não leva a ninguém é uma porta fechada: sem agente de entrada, o que
    // chega pelo canal não é atendido por nada.
    conferir(p, 'entryAgentKey', c.entryAgentKey)
    if (c.entrySectorKey) conferir(p, 'entrySectorKey', c.entrySectorKey)
  })
  bp.operations?.liveDestinations?.forEach((l, i) => {
    conferir(`operations.liveDestinations[${i}]`, 'sourceKey', l.sourceKey)
    for (const k of l.agentKeys ?? []) conferir(`operations.liveDestinations[${i}]`, 'agentKeys', k)
  })
  bp.operations?.histories?.forEach((h, i) => conferir(`operations.histories[${i}]`, 'sourceKey', h.sourceKey))
  bp.operations?.monitors?.forEach((m, i) => {
    const p = `operations.monitors[${i}]`
    if (m.observes?.kind === 'dataset') conferir(p, 'observes.datasetKey', m.observes.datasetKey)
    else if (m.observes?.kind !== 'internal_event') issues.push(erro(`${p}.observes`, 'monitor_without_target', 'o monitor não diz o que observa'))
    if (m.flowKey) conferir(p, 'flowKey', m.flowKey)
  })
  bp.operations?.flows?.forEach((f, i) => {
    const p = `operations.flows[${i}]`
    conferir(p, 'floorKey', f.floorKey)
    if (f.trigger?.type === 'monitor') conferir(p, 'trigger.monitorKey', f.trigger.monitorKey)
  })
  bp.operations?.routines?.forEach((r, i) => {
    conferir(`operations.routines[${i}]`, 'floorKey', r.floorKey)
    conferir(`operations.routines[${i}]`, 'ownerAgentKey', r.ownerAgentKey)
  })
  bp.operations?.deliveries?.forEach((d, i) => {
    conferir(`operations.deliveries[${i}]`, 'fromKey', d.fromKey)
    if (d.channelKey) conferir(`operations.deliveries[${i}]`, 'channelKey', d.channelKey)
  })

  bp.access?.forEach((g, i) => {
    const p = `access[${i}]`
    conferir(p, 'subjectKey', g.subjectKey)
    // `resourceRef` é `tipo:key` — a key precisa existir; o tipo é conferido por quem aplica.
    const [, chave] = String(g.resourceRef ?? '').split(':')
    if (!chave || !existe(chave)) issues.push(erro(`${p}.resourceRef`, 'unknown_reference', `"${String(g.resourceRef)}" não aponta para nada neste plano`))
    if (!(g.capabilities ?? []).length) issues.push(erro(`${p}.capabilities`, 'grant_without_capability', 'um acesso sem capacidade não concede nada'))
  })

  bp.acceptanceTests?.forEach((t, i) => {
    if (!existe(t.targetKey)) issues.push(erro(`acceptanceTests[${i}].targetKey`, 'unknown_reference', `"${t.targetKey}" não está neste plano`))
  })
  if ((bp.acceptanceTests ?? []).length > V2_LIMITS.acceptanceTests) {
    issues.push(erro('acceptanceTests', 'limit_exceeded', 'testes demais'))
  }

  // --- dependências: sem ciclo -------------------------------------------------------------
  const grafo = new Map<string, string[]>()
  for (const { item } of allItems(bp)) {
    const key = String((item as { key?: unknown }).key ?? '')
    if (!key) continue
    grafo.set(key, ((item as { dependsOn?: unknown[] }).dependsOn ?? []).map((d) => String(d)))
  }
  for (const [key, deps] of grafo) {
    for (const d of deps) {
      if (!porKey.has(d)) issues.push(erro('dependsOn', 'unknown_reference', `"${key}" depende de "${d}", que não está neste plano`))
    }
  }
  const ciclo = acharCiclo(grafo)
  if (ciclo) issues.push(erro('dependsOn', 'dependency_cycle', `dependência circular: ${ciclo.join(' → ')}`))

  // --- segredo -----------------------------------------------------------------------------
  procurarSegredo(bp.resources, 'resources', issues)
  procurarSegredo(bp.operations, 'operations', issues)

  return { valid: !issues.some((i) => i.severity === 'error'), issues }
}

/**
 * O primeiro ciclo, se houver — com o caminho, para a mensagem dizer qual é.
 *
 * "Há uma dependência circular" sem o caminho manda quem lê procurar num plano de duzentos
 * itens. Com o caminho, a correção é óbvia.
 */
function acharCiclo(grafo: Map<string, string[]>): string[] | null {
  const ESTADO = { novo: 0, visitando: 1, pronto: 2 }
  const estado = new Map<string, number>()
  const pilha: string[] = []

  const visitar = (no: string): string[] | null => {
    const e = estado.get(no) ?? ESTADO.novo
    if (e === ESTADO.pronto) return null
    if (e === ESTADO.visitando) return [...pilha.slice(pilha.indexOf(no)), no]
    estado.set(no, ESTADO.visitando)
    pilha.push(no)
    for (const d of grafo.get(no) ?? []) {
      const achado = visitar(d)
      if (achado) return achado
    }
    pilha.pop()
    estado.set(no, ESTADO.pronto)
    return null
  }

  for (const no of grafo.keys()) {
    const achado = visitar(no)
    if (achado) return achado
  }
  return null
}

/**
 * A ORDEM de aplicação, derivada de `dependsOn`.
 *
 * Ordenação topológica: um item só entra depois de tudo de que ele depende. Sem isto, a
 * aplicação criaria um monitor antes do dataset que ele observa — e falharia num passo que
 * não tem nada de errado.
 */
export function applyOrder(bp: OfficeBlueprintV2): string[] {
  const grafo = new Map<string, string[]>()
  for (const { item } of allItems(bp)) {
    const key = String((item as { key?: unknown }).key ?? '')
    if (key) grafo.set(key, ((item as { dependsOn?: unknown[] }).dependsOn ?? []).map((d) => String(d)))
  }
  const saida: string[] = []
  const visto = new Set<string>()
  const visitando = new Set<string>()

  const visitar = (no: string) => {
    if (visto.has(no) || visitando.has(no)) return
    visitando.add(no)
    for (const d of grafo.get(no) ?? []) if (grafo.has(d)) visitar(d)
    visitando.delete(no)
    visto.add(no)
    saida.push(no)
  }
  for (const no of grafo.keys()) visitar(no)
  return saida
}

/**
 * O hash que a confirmação carrega — o MESMO do V1.
 *
 * Reutilizar o hash canônico das automações não é economia: é o que garante que "aplicar"
 * recuse um plano que mudou entre a prévia e o clique, com a mesma regra nos dois formatos.
 */
export const computeBlueprintV2Hash = (bp: OfficeBlueprintV2): string => computeDefinitionHash(bp)

/** O hash de qualquer um dos dois formatos. Quem chama não precisa saber qual é. */
export const computeAnyBlueprintHash = (bp: OfficeBlueprint): string => computeDefinitionHash(bp)

// --- diff ----------------------------------------------------------------------------------

export interface BlueprintV2Change {
  path: V2ItemPath
  key: string
  kind: 'added' | 'removed' | 'changed'
  /** Os campos que mudaram, quando `changed`. Vazio para os outros. */
  fields: string[]
  label: string
}

/**
 * O que mudou entre duas versões do plano — por KEY, nunca por posição.
 *
 * Comparar por posição faria uma reordenação parecer que tudo foi trocado. A key é estável
 * de propósito: é ela que liga a proposta ao recurso já aplicado.
 */
export function diffBlueprintsV2(antes: OfficeBlueprintV2 | null | undefined, depois: OfficeBlueprintV2 | null | undefined): BlueprintV2Change[] {
  const mudancas: BlueprintV2Change[] = []
  if (!depois) return mudancas

  for (const path of V2_ITEM_PATHS) {
    const a = new Map(itemsAt(antes ?? emptyBlueprintV2('', ''), path).map((i) => [String((i as { key?: unknown }).key ?? ''), i]))
    const b = new Map(itemsAt(depois, path).map((i) => [String((i as { key?: unknown }).key ?? ''), i]))

    for (const [key, item] of b) {
      const anterior = a.get(key)
      const rotulo = String((item as { name?: unknown; title?: unknown }).name ?? (item as { title?: unknown }).title ?? key)
      if (!anterior) {
        mudancas.push({ path, key, kind: 'added', fields: [], label: rotulo })
        continue
      }
      const campos = camposDiferentes(anterior as Record<string, unknown>, item as Record<string, unknown>)
      if (campos.length) mudancas.push({ path, key, kind: 'changed', fields: campos, label: rotulo })
    }
    for (const [key, item] of a) {
      if (b.has(key)) continue
      mudancas.push({ path, key, kind: 'removed', fields: [], label: String((item as { name?: unknown }).name ?? key) })
    }
  }
  return mudancas
}

const camposDiferentes = (a: Record<string, unknown>, b: Record<string, unknown>): string[] => {
  const campos = new Set([...Object.keys(a), ...Object.keys(b)])
  const saida: string[] = []
  for (const c of campos) {
    if (JSON.stringify(a[c] ?? null) !== JSON.stringify(b[c] ?? null)) saida.push(c)
  }
  return saida.sort()
}

// --- conversão V1 → V2 ----------------------------------------------------------------------

export interface ConversionResult {
  blueprint: OfficeBlueprintV2
  /** O que o V1 não diz e o V2 exige. Marcado, nunca inventado. */
  unresolved: { path: string; key: string; missing: string; note: string }[]
}

/**
 * Converte um V1 em V2 preservando `key` e `resourceId`.
 *
 * O que o V1 não tem, o conversor NÃO inventa: um agente sem `role` vira um agente com
 * `role` vazio e uma pendência declarada. Preencher com o objetivo pareceria mais amigável e
 * seria mentira — o Flow mostraria uma responsabilidade que ninguém escreveu.
 *
 * A conversão nunca produz `action: 'archive'`: ela não existe no V1, e um item convertido
 * não pode ganhar uma intenção que o original não tinha.
 */
export function convertV1ToV2(v1: OfficeBlueprintV1, changeKind: BlueprintChangeKindV2 = 'create'): ConversionResult {
  const bp = emptyBlueprintV2(v1.title, v1.objective, changeKind)
  const unresolved: ConversionResult['unresolved'] = []
  const base = (item: { key: string; action?: string; resourceId?: string | null; layer?: string; rationale?: string }) => ({
    key: item.key,
    action: (item.action ?? 'create') as 'create' | 'reuse' | 'update',
    ...(item.resourceId ? { resourceId: item.resourceId } : {}),
    layer: (item.layer ?? 'essential') as 'essential' | 'recommended' | 'complete',
    rationale: item.rationale ?? '',
    dependsOn: [] as string[],
  })

  if (v1.buildingPatch) bp.organization.buildingPatch = v1.buildingPatch

  bp.organization.floors = (v1.floors ?? []).map((f) => ({
    ...base(f),
    name: f.name,
    ...(f.mission ? { mission: f.mission } : {}),
    ...(f.description ? { description: f.description } : {}),
    ...(f.language ? { language: f.language } : {}),
    ...(f.timezone ? { timezone: f.timezone } : {}),
    workMode: f.workMode,
    ...(f.coordinatorAgentKey ? { coordinatorAgentKey: f.coordinatorAgentKey } : {}),
  }))

  bp.organization.agents = (v1.agents ?? []).map((a) => {
    const faltando: string[] = []
    if (!String(a.role ?? '').trim()) faltando.push('role')
    if (!String(a.inputContract ?? '').trim()) faltando.push('inputContract')
    if (!String(a.outputContract ?? '').trim()) faltando.push('outputContract')
    if (faltando.length) {
      unresolved.push({
        path: 'organization.agents',
        key: a.key,
        missing: faltando.join(', '),
        note: `o agente "${a.name}" veio de um plano V1 que não guardava ${faltando.join(', ')}`,
      })
    }
    return {
      ...base(a),
      floorKey: a.floorKey,
      name: a.name,
      // Vazio é o que o V1 tinha. Preencher com o objetivo pareceria mais amigável e seria
      // mentira: o Flow mostraria uma responsabilidade que ninguém escreveu.
      role: a.role ?? '',
      trigger: a.role ?? '',
      inputContract: a.inputContract ?? '',
      outputContract: a.outputContract ?? '',
      ...(a.objective ? { objective: a.objective } : {}),
      ...(a.preset ? { preset: a.preset } : {}),
      ...(a.instructions ? { instructions: a.instructions } : {}),
      ...(a.constraints ? { constraints: a.constraints } : {}),
      ...(a.capabilities ? { capabilities: a.capabilities } : {}),
      ...(a.routingDescription ? { routingDescription: a.routingDescription } : {}),
      ...(a.executorKind ? { executorKind: a.executorKind } : {}),
      ...(a.responseMode ? { responseMode: a.responseMode } : {}),
      ...(a.provider ? { provider: a.provider } : {}),
      ...(a.model !== undefined ? { model: a.model } : {}),
      ...(a.language ? { language: a.language } : {}),
      ...(a.activationModes ? { activationModes: a.activationModes } : {}),
      ...(a.delegationPolicy ? { delegationPolicy: a.delegationPolicy } : {}),
      ...(a.callerPolicy ? { callerPolicy: a.callerPolicy } : {}),
      ...(a.callableAgentKeys ? { callableAgentKeys: a.callableAgentKeys } : {}),
      ...(a.allowedCallerAgentKeys ? { allowedCallerAgentKeys: a.allowedCallerAgentKeys } : {}),
      ...(a.memoryType ? { memoryType: a.memoryType } : {}),
      ...(a.requireGrounding !== undefined ? { requireGrounding: a.requireGrounding } : {}),
      ...(a.handoffEnabled !== undefined ? { handoffEnabled: a.handoffEnabled } : {}),
    }
  })

  bp.organization.sectors = (v1.sectors ?? []).map((s) => ({
    ...base(s),
    floorKey: s.floorKey,
    name: s.name,
    ...(s.color ? { color: s.color } : {}),
    mode: s.mode,
    memberAgentKeys: s.memberAgentKeys ?? [],
    ...(s.coordinatorAgentKey ? { coordinatorAgentKey: s.coordinatorAgentKey } : {}),
    ...(s.instruction ? { instruction: s.instruction } : {}),
    ...(s.inputContract ? { inputContract: s.inputContract } : {}),
    ...(s.outputContract ? { outputContract: s.outputContract } : {}),
    ...(s.stages ? { stages: s.stages } : {}),
    ...(s.entryPolicy ? { entryPolicy: s.entryPolicy } : {}),
    ...(s.exposedAgentKeys ? { exposedAgentKeys: s.exposedAgentKeys } : {}),
  }))

  bp.operations.routines = (v1.routines ?? []).map((r) => ({
    ...base(r),
    floorKey: r.floorKey,
    ownerAgentKey: r.ownerAgentKey,
    name: r.name,
    ...(r.description ? { description: r.description } : {}),
    triggerType: r.triggerType,
    ...(r.cron ? { cron: r.cron } : {}),
    ...(r.timezone ? { timezone: r.timezone } : {}),
    ...(r.executionMode ? { executionMode: r.executionMode } : {}),
    ...(r.steps ? { steps: r.steps } : {}),
  }))

  bp.resources.appRequirements = (v1.appRequirements ?? []).map((r) => {
    if (!(r.actionKeys ?? []).length) {
      unresolved.push({
        path: 'resources.appRequirements',
        key: r.key,
        missing: 'actionKeys',
        note: `o App "${r.appKey}" veio sem ação: um grant sem ação resolve para zero ferramentas`,
      })
    }
    return {
      key: r.key,
      action: 'create' as const,
      layer: (r.layer ?? 'essential') as 'essential' | 'recommended' | 'complete',
      rationale: r.reason ?? '',
      dependsOn: [],
      appKey: r.appKey,
      agentKeys: r.agentKeys ?? [],
      actionKeys: r.actionKeys ?? [],
      // Escrita autônoma NUNCA é herdada: ela é uma aprovação por ação, e o V1 não tinha
      // onde registrar essa aprovação.
      autonomousWriteActionKeys: [],
      resourceConfig: {},
      required: r.required,
    }
  })

  bp.resources.knowledge = (v1.knowledgeRequirements ?? []).map((k) => ({ ...k, dependsOn: [] }))
  bp.assumptions = v1.assumptions ?? []
  bp.warnings = v1.warnings ?? []
  bp.checklist = v1.checklist ?? []

  return { blueprint: bp, unresolved }
}

/** Aceita os dois formatos e devolve V2. Um V2 passa direto; um V1 é convertido. */
export function asV2(bp: OfficeBlueprint, changeKind: BlueprintChangeKindV2 = 'create'): ConversionResult {
  return isV2(bp) ? { blueprint: bp, unresolved: [] } : convertV1ToV2(bp as OfficeBlueprintV1, changeKind)
}
