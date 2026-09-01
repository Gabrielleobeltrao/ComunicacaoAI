// A validação determinística do blueprint.
//
// É aqui que a proposta do modelo deixa de ser texto e vira algo que o sistema aceita
// ou recusa — e é uma função PURA, sem banco e sem provedor, porque a única forma de
// confiar nela é conseguir exercitá-la inteira num teste unitário.
//
// A posse entra por parâmetro (`ctx`), não por consulta: quem chama já leu do banco o
// que é do dono e passa os conjuntos. Assim o validador não tem como esquecer de
// filtrar por `ownerId`, e o teste consegue construir o caso "id de outra conta" sem
// subir Mongo.
import { validateDefinition } from '../automations/validate.js'
import { DEFAULT_LIMITS } from '../automations/types.js'
import { maskSecrets } from './secrets.js'
import { referencedKeys, withPlaceholderIds } from './routineSteps.js'
import * as L from './limits.js'
import type {
  BlueprintAgent,
  BlueprintFloor,
  BlueprintRoutine,
  BlueprintSector,
  OfficeBlueprintV1,
} from './types.js'

export type IssueSeverity = 'error' | 'warning'

export interface BlueprintIssue {
  path: string
  code: string
  message: string
  severity: IssueSeverity
  suggestedAction?: string
}

export interface BlueprintValidationResult {
  valid: boolean
  issues: BlueprintIssue[]
}

/**
 * O que o dono REALMENTE tem, lido do banco pelo chamador.
 *
 * Conjuntos de id em texto. Um id que não está aqui ou não existe ou é de outra conta —
 * e o validador trata os dois casos igual, de propósito: distinguir confirmaria a
 * existência de um recurso alheio.
 */
export interface BlueprintOwnershipContext {
  floorIds: Set<string>
  agentIds: Set<string>
  sectorIds: Set<string>
  /** Rotinas desta conta — uma rotina reutilizada aponta para uma delas. */
  routineIds: Set<string>
  /** Apps do catálogo que existem de verdade. */
  knownAppKeys: Set<string>
  /** Apps com instalação ATIVA nesta conta — o único caso em que um grant é possível. */
  installedAppKeys: Set<string>
  /** As ações que cada App declara, para um grant não pedir o que não existe. */
  appActionKeys: Map<string, Set<string>>
}

export const emptyOwnershipContext = (): BlueprintOwnershipContext => ({
  floorIds: new Set(),
  agentIds: new Set(),
  sectorIds: new Set(),
  routineIds: new Set(),
  knownAppKeys: new Set(),
  installedAppKeys: new Set(),
  appActionKeys: new Map(),
})

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const texto = (v: unknown): string => (typeof v === 'string' ? v : '')
const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/i

export function validateOfficeBlueprint(bruto: unknown, ctx: BlueprintOwnershipContext = emptyOwnershipContext()): BlueprintValidationResult {
  const issues: BlueprintIssue[] = []
  const erro = (path: string, code: string, message: string, suggestedAction?: string) =>
    issues.push({ path, code, message, severity: 'error', ...(suggestedAction ? { suggestedAction } : {}) })
  const aviso = (path: string, code: string, message: string, suggestedAction?: string) =>
    issues.push({ path, code, message, severity: 'warning', ...(suggestedAction ? { suggestedAction } : {}) })

  if (!isRecord(bruto)) {
    erro('', 'not_an_object', 'a proposta não é um objeto')
    return { valid: false, issues }
  }
  const bp = bruto as unknown as OfficeBlueprintV1
  if (bp.version !== 1) erro('version', 'unsupported_version', 'versão de proposta não suportada')
  if (!texto(bp.title).trim()) erro('title', 'required', 'a proposta precisa de um título')
  if (texto(bp.title).length > L.MAX_TITLE_CHARS) erro('title', 'too_long', `título acima de ${L.MAX_TITLE_CHARS} caracteres`)
  if (texto(bp.objective).length > L.MAX_LONG_TEXT_CHARS) erro('objective', 'too_long', 'objetivo longo demais')

  // --- listas, tetos e keys ----------------------------------------------------------
  const listas: [keyof OfficeBlueprintV1, number][] = [
    ['floors', L.MAX_FLOORS],
    ['agents', L.MAX_AGENTS],
    ['sectors', L.MAX_SECTORS],
    ['routines', L.MAX_ROUTINES],
    ['appRequirements', L.MAX_APP_REQUIREMENTS],
    ['knowledgeRequirements', L.MAX_KNOWLEDGE_REQUIREMENTS],
    ['assumptions', L.MAX_ASSUMPTIONS],
    ['warnings', L.MAX_WARNINGS],
    ['checklist', L.MAX_CHECKLIST_ITEMS],
  ]
  for (const [nome, teto] of listas) {
    const v = bp[nome]
    if (v !== undefined && !Array.isArray(v)) {
      erro(String(nome), 'not_a_list', `${String(nome)} precisa ser uma lista`)
      continue
    }
    if (Array.isArray(v) && v.length > teto) erro(String(nome), 'too_many', `no máximo ${teto} itens em ${String(nome)}`)
  }
  if (issues.some((i) => i.code === 'not_a_list')) return { valid: false, issues }

  const floors = bp.floors ?? []
  const agents = bp.agents ?? []
  const sectors = bp.sectors ?? []
  const routines = bp.routines ?? []

  if (bp.buildingPatch !== undefined) {
    if (!isRecord(bp.buildingPatch)) erro('buildingPatch', 'invalid', 'a mudança no prédio precisa ser um objeto')
    else {
      const p = bp.buildingPatch as Record<string, unknown>
      for (const campo of Object.keys(p)) {
        if (campo !== 'name' && campo !== 'description') erro(`buildingPatch.${campo}`, 'unsupported_field', `o prédio não tem o campo "${campo}"`)
      }
      if (texto(p.name).length > L.MAX_NAME_CHARS) erro('buildingPatch.name', 'too_long', 'nome de prédio longo demais')
      if (texto(p.description).length > L.MAX_LONG_TEXT_CHARS) erro('buildingPatch.description', 'too_long', 'descrição de prédio longa demais')
      // Não é erro: é uma mudança em algo que já existe, e por isso vai exigir
      // aprovação individual na confirmação.
      if (texto(p.name).trim() || p.description !== undefined) {
        aviso('buildingPatch', 'building_change', 'esta proposta muda o nome ou a descrição do prédio', 'aprove a mudança na confirmação para ela acontecer')
      }
    }
  }

  const total = floors.length + agents.length + sectors.length + routines.length
  if (total > L.MAX_TOTAL_RESOURCES) {
    erro('', 'too_many_resources', `a proposta cria ${total} recursos; o limite é ${L.MAX_TOTAL_RESOURCES}`, 'divida a operação em etapas')
  }

  const keysDe = (lista: { key?: unknown }[], caminho: string): Set<string> => {
    const vistas = new Set<string>()
    lista.forEach((item, i) => {
      const k = texto(item?.key).trim()
      if (!k) {
        erro(`${caminho}[${i}].key`, 'required', 'todo item precisa de uma chave')
        return
      }
      if (k.length > L.MAX_KEY_CHARS || !KEY_RE.test(k)) {
        erro(`${caminho}[${i}].key`, 'invalid_key', 'chave inválida (use letras, números, hífen ou sublinhado)')
        return
      }
      if (vistas.has(k)) erro(`${caminho}[${i}].key`, 'duplicate_key', `a chave "${k}" aparece duas vezes`)
      vistas.add(k)
    })
    return vistas
  }

  const floorKeys = keysDe(floors, 'floors')
  const agentKeys = keysDe(agents, 'agents')
  const sectorKeys = keysDe(sectors, 'sectors')
  keysDe(routines, 'routines')
  keysDe(bp.appRequirements ?? [], 'appRequirements')
  keysDe(bp.knowledgeRequirements ?? [], 'knowledgeRequirements')

  // --- ação e posse do recurso reutilizado -------------------------------------------
  const conferirAcao = (item: { action?: unknown; resourceId?: unknown }, caminho: string, permitidos: Set<string>, tipo: string) => {
    const acao = texto(item?.action)
    if (acao !== 'create' && acao !== 'reuse' && acao !== 'update') {
      erro(`${caminho}.action`, 'invalid_action', 'ação precisa ser criar, reutilizar ou atualizar')
      return
    }
    if (acao === 'create') {
      if (item.resourceId) erro(`${caminho}.resourceId`, 'unexpected_resource', 'um item que será criado não aponta para recurso existente')
      return
    }
    const id = texto(item?.resourceId).trim()
    if (!id) {
      erro(`${caminho}.resourceId`, 'required', `${tipo} reutilizado precisa apontar para um recurso existente`, 'escolha o recurso na prévia')
      return
    }
    // Não é desta conta ou não existe — e a mensagem é a mesma nos dois casos.
    if (!permitidos.has(id)) erro(`${caminho}.resourceId`, 'not_owned', `${tipo} indicado não existe nesta conta`)
  }

  // --- andares ------------------------------------------------------------------------
  floors.forEach((floor: BlueprintFloor, i) => {
    const at = `floors[${i}]`
    if (!texto(floor?.name).trim()) erro(`${at}.name`, 'required', 'o andar precisa de um nome')
    if (texto(floor?.name).length > L.MAX_NAME_CHARS) erro(`${at}.name`, 'too_long', 'nome de andar longo demais')
    if (floor?.workMode !== 'organization' && floor?.workMode !== 'coordinated') {
      erro(`${at}.workMode`, 'invalid_mode', 'modo de trabalho do andar inválido')
    }
    conferirAcao(floor, at, ctx.floorIds, 'o andar')
    if (floor?.workMode === 'coordinated') {
      const c = texto(floor.coordinatorAgentKey).trim()
      if (!c) erro(`${at}.coordinatorAgentKey`, 'required', 'um andar coordenado precisa de um agente coordenador')
      else if (!agentKeys.has(c)) erro(`${at}.coordinatorAgentKey`, 'unknown_ref', `o coordenador "${c}" não está na proposta`)
      else if (texto(agents.find((a) => a.key === c)?.floorKey) !== texto(floor.key)) {
        erro(`${at}.coordinatorAgentKey`, 'wrong_floor', 'o coordenador do andar precisa trabalhar nesse mesmo andar')
      }
    }
  })

  // --- agentes ------------------------------------------------------------------------
  agents.forEach((agent: BlueprintAgent, i) => {
    const at = `agents[${i}]`
    if (!texto(agent?.name).trim()) erro(`${at}.name`, 'required', 'o agente precisa de um nome')
    if (texto(agent?.name).length > L.MAX_NAME_CHARS) erro(`${at}.name`, 'too_long', 'nome de agente longo demais')
    const fk = texto(agent?.floorKey).trim()
    if (!fk) erro(`${at}.floorKey`, 'required', 'todo agente pertence a um andar')
    else if (!floorKeys.has(fk)) erro(`${at}.floorKey`, 'unknown_ref', `o andar "${fk}" não está na proposta`)
    conferirAcao(agent, at, ctx.agentIds, 'o agente')

    for (const campo of ['objective', 'role', 'instructions', 'constraints', 'routingDescription'] as const) {
      if (texto(agent?.[campo]).length > L.MAX_LONG_TEXT_CHARS) erro(`${at}.${campo}`, 'too_long', `${campo} longo demais`)
    }
    if ((agent?.capabilities?.length ?? 0) > L.MAX_CAPABILITIES) erro(`${at}.capabilities`, 'too_many', 'competências demais')

    // Contrato e executor precisam concordar: JSON prometido sem schema é um contrato
    // que ninguém consegue conferir, e a execução falha só na primeira rodada.
    if ((agent?.responseMode === 'structured' || agent?.responseMode === 'structured_and_text') && !isRecord(agent?.outputJsonSchema)) {
      erro(`${at}.outputJsonSchema`, 'contract_incomplete', 'um agente que responde em formato estruturado precisa declarar o formato da saída')
    }
    if (agent?.executorKind && !['llm', 'function', 'tool'].includes(agent.executorKind)) {
      erro(`${at}.executorKind`, 'invalid_executor', 'tipo de executor inválido')
    }
    for (const campo of ['inputJsonSchema', 'outputJsonSchema'] as const) {
      const s = agent?.[campo]
      if (s === undefined || s === null) continue
      if (!isRecord(s)) erro(`${at}.${campo}`, 'invalid_schema', 'o formato declarado precisa ser um objeto')
      else if (Buffer.byteLength(JSON.stringify(s)) > L.MAX_SCHEMA_BYTES) erro(`${at}.${campo}`, 'too_long', 'formato declarado grande demais')
    }

    // Políticas de chamada: só é possível apontar para quem está na proposta. Uma
    // referência fora dela seria um id que ninguém validou.
    for (const campo of ['callableAgentKeys', 'allowedCallerAgentKeys'] as const) {
      for (const k of agent?.[campo] ?? []) {
        if (!agentKeys.has(k)) erro(`${at}.${campo}`, 'unknown_ref', `o agente "${k}" não está na proposta`)
      }
    }
    if (agent?.delegationPolicy === 'selected' && !(agent.callableAgentKeys?.length)) {
      erro(`${at}.callableAgentKeys`, 'required', 'delegação para agentes escolhidos precisa listar quais')
    }
  })

  // --- setores ------------------------------------------------------------------------
  sectors.forEach((sector: BlueprintSector, i) => {
    const at = `sectors[${i}]`
    if (!texto(sector?.name).trim()) erro(`${at}.name`, 'required', 'o setor precisa de um nome')
    const fk = texto(sector?.floorKey).trim()
    if (!fk) erro(`${at}.floorKey`, 'required', 'todo setor pertence a um andar')
    else if (!floorKeys.has(fk)) erro(`${at}.floorKey`, 'unknown_ref', `o andar "${fk}" não está na proposta`)
    conferirAcao(sector, at, ctx.sectorIds, 'o setor')

    const modo = sector?.mode
    if (modo !== 'organization' && modo !== 'orchestrated' && modo !== 'pipeline') {
      erro(`${at}.mode`, 'invalid_mode', 'modo de setor inválido')
    }
    const membros = sector?.memberAgentKeys ?? []
    if (membros.length > L.MAX_MEMBERS) erro(`${at}.memberAgentKeys`, 'too_many', `um setor tem no máximo ${L.MAX_MEMBERS} membros`)
    membros.forEach((k, j) => {
      if (!agentKeys.has(k)) erro(`${at}.memberAgentKeys[${j}]`, 'unknown_ref', `o agente "${k}" não está na proposta`)
      else if (texto(agents.find((a) => a.key === k)?.floorKey) !== fk) {
        erro(`${at}.memberAgentKeys[${j}]`, 'wrong_floor', 'todo membro do setor trabalha no mesmo andar dele')
      }
    })

    if (modo === 'orchestrated') {
      const c = texto(sector?.coordinatorAgentKey).trim()
      if (!c) erro(`${at}.coordinatorAgentKey`, 'required', 'um setor orquestrado precisa de um coordenador')
      else if (!agentKeys.has(c)) erro(`${at}.coordinatorAgentKey`, 'unknown_ref', `o coordenador "${c}" não está na proposta`)
      else if (!membros.includes(c)) erro(`${at}.coordinatorAgentKey`, 'coordinator_outside', 'o coordenador precisa ser membro do setor')
      if (membros.length < 2) erro(`${at}.memberAgentKeys`, 'coordinator_alone', 'um setor orquestrado precisa do coordenador e de pelo menos um especialista')
    }

    if (modo === 'pipeline') {
      const stages = sector?.stages ?? []
      if (!stages.length) erro(`${at}.stages`, 'required', 'um pipeline precisa de etapas')
      if (stages.length > L.MAX_STAGES) erro(`${at}.stages`, 'too_many', `no máximo ${L.MAX_STAGES} etapas`)
      const stageKeys = new Set<string>()
      stages.forEach((stage, j) => {
        const sk = texto(stage?.key).trim()
        if (!sk) erro(`${at}.stages[${j}].key`, 'required', 'toda etapa precisa de uma chave')
        else if (stageKeys.has(sk)) erro(`${at}.stages[${j}].key`, 'duplicate_key', 'chave de etapa repetida')
        stageKeys.add(sk)
        if (!agentKeys.has(texto(stage?.agentKey))) erro(`${at}.stages[${j}].agentKey`, 'unknown_ref', 'a etapa aponta para um agente que não está na proposta')
      })
      stages.forEach((stage, j) => {
        for (const dep of stage?.dependsOn ?? []) {
          if (!stageKeys.has(dep)) erro(`${at}.stages[${j}].dependsOn`, 'unknown_ref', `a etapa depende de "${dep}", que não existe`)
        }
      })
      const ciclo = encontrarCiclo(stages.map((s) => ({ key: texto(s?.key), dependsOn: (s?.dependsOn ?? []).map(texto) })))
      if (ciclo) erro(`${at}.stages`, 'cycle', `as etapas se dependem em círculo (${ciclo.join(' → ')})`, 'remova uma das dependências')
    }

    for (const k of sector?.exposedAgentKeys ?? []) {
      if (!agentKeys.has(k)) erro(`${at}.exposedAgentKeys`, 'unknown_ref', `o agente "${k}" não está na proposta`)
    }
  })

  // --- rotinas -------------------------------------------------------------------------
  routines.forEach((routine: BlueprintRoutine, i) => {
    const at = `routines[${i}]`
    if (!texto(routine?.name).trim()) erro(`${at}.name`, 'required', 'a rotina precisa de um nome')
    const fk = texto(routine?.floorKey).trim()
    if (!floorKeys.has(fk)) erro(`${at}.floorKey`, 'unknown_ref', 'a rotina aponta para um andar que não está na proposta')
    if (!agentKeys.has(texto(routine?.ownerAgentKey))) erro(`${at}.ownerAgentKey`, 'unknown_ref', 'a rotina precisa de um agente responsável que esteja na proposta')
    // A rotina tem ação como qualquer outro item: reutilizar ou alterar exige apontar
    // para uma rotina desta conta. Antes, ela era sempre criada.
    conferirAcao(routine, at, ctx.routineIds, 'a rotina')

    const tipo = texto(routine?.triggerType)
    if (tipo !== 'manual' && tipo !== 'schedule') {
      erro(`${at}.triggerType`, 'trigger_not_allowed', 'o Arquiteto só monta rotinas manuais ou agendadas', 'arme webhook e gatilho por evento depois, na página do agente')
    }
    if (tipo === 'schedule' && !texto(routine?.cron).trim()) erro(`${at}.cron`, 'required', 'uma rotina agendada precisa de horário')
    if ((routine?.steps?.length ?? 0) > L.MAX_STEPS) erro(`${at}.steps`, 'too_many', 'etapas demais na rotina')

    // A rotina passa pelo validador que a plataforma já usa. Um segundo conjunto de
    // regras aqui aceitaria uma definição que a tela de rotinas recusa depois.
    if (tipo === 'manual' || tipo === 'schedule') {
      // As etapas falam por `key`; o validador de rotinas fala por id. Marcadores
      // válidos deixam a conferência estrutural rodar sem inventar recurso nenhum — a
      // existência de cada `key` é conferida logo abaixo, contra a própria proposta.
      const definicao = {
        trigger: tipo === 'schedule' ? { type: 'schedule', cron: texto(routine.cron), timezone: texto(routine.timezone) || 'America/Sao_Paulo' } : { type: 'manual' },
        inputs: [],
        steps: withPlaceholderIds(routine?.steps ?? []),
        resultFormat: 'markdown',
        deliveries: [],
        limits: { ...DEFAULT_LIMITS },
        ...(routine?.executionMode ? { executionMode: routine.executionMode } : {}),
      }
      const r = validateDefinition(definicao)
      for (const e of r.errors) erro(`${at}.${e.path}`, 'invalid_routine', e.message)

      for (const ref of referencedKeys(routine?.steps ?? [])) {
        const conjunto = ref.kind === 'agent' ? agentKeys : ref.kind === 'sector' ? sectorKeys : floorKeys
        if (!conjunto.has(ref.key)) {
          erro(`${at}.steps`, 'unknown_ref', `uma etapa aponta para "${ref.key}", que não está na proposta`)
        }
      }
    }
  })

  // --- Apps ----------------------------------------------------------------------------
  ;(bp.appRequirements ?? []).forEach((req, i) => {
    const at = `appRequirements[${i}]`
    const appKey = texto(req?.appKey).trim()
    if (!appKey) erro(`${at}.appKey`, 'required', 'o requisito precisa dizer qual App')
    else if (ctx.knownAppKeys.size && !ctx.knownAppKeys.has(appKey)) {
      erro(`${at}.appKey`, 'unknown_app', `não existe um App "${appKey}" no catálogo`, 'escolha um App da lista')
    }
    const acoes = ctx.appActionKeys.get(appKey)
    for (const acao of req?.actionKeys ?? []) {
      if (acoes && !acoes.has(acao)) erro(`${at}.actionKeys`, 'unknown_action', `o App ${appKey} não tem a ação "${acao}"`)
    }
    for (const k of req?.agentKeys ?? []) {
      if (!agentKeys.has(k)) erro(`${at}.agentKeys`, 'unknown_ref', `o agente "${k}" não está na proposta`)
    }
    // Sem instalação ativa não há permissão a conceder — vira pendência, e a prévia diz
    // isso em vez de prometer um acesso que não existe.
    if (appKey && !ctx.installedAppKeys.has(appKey)) {
      aviso(`${at}`, 'app_not_connected', `${appKey} ainda não está conectado nesta conta`, 'conecte o App para os agentes poderem usá-lo')
    }
  })

  // --- conhecimento ---------------------------------------------------------------------
  ;(bp.knowledgeRequirements ?? []).forEach((req, i) => {
    const at = `knowledgeRequirements[${i}]`
    if (!texto(req?.title).trim()) erro(`${at}.title`, 'required', 'o requisito de conhecimento precisa de um título')
    const escopo = texto(req?.scope)
    if (!['agent', 'sector', 'floor', 'building'].includes(escopo)) erro(`${at}.scope`, 'invalid_scope', 'escopo de conhecimento inválido')
    const alvo = texto(req?.targetKey).trim()
    if (escopo === 'building') {
      // O prédio é um por conta e quem o resolve é o servidor. Um alvo escrito aqui
      // seria uma referência que ninguém consegue conferir.
      if (alvo) erro(`${at}.targetKey`, 'unexpected_target', 'conhecimento do prédio não aponta para um alvo: ele é o prédio da conta')
    } else if (!alvo) {
      erro(`${at}.targetKey`, 'required', 'diga a quem este conhecimento pertence')
    } else {
      const conjunto = escopo === 'agent' ? agentKeys : escopo === 'sector' ? sectorKeys : floorKeys
      if (!conjunto.has(alvo)) erro(`${at}.targetKey`, 'unknown_ref', `"${alvo}" não está na proposta`)
    }
    if (texto(req?.content).length > L.MAX_KNOWLEDGE_CONTENT_CHARS) erro(`${at}.content`, 'too_long', 'conteúdo grande demais para o documento')
    // Conteúdo prometido e ausente é pendência, nunca preenchimento.
    if (req?.state === 'confirmed' && !texto(req?.content).trim()) {
      erro(`${at}.content`, 'no_content', 'este item aparece como confirmado mas não tem conteúdo')
    }
  })

  /**
   * --- a FORMA da operação -------------------------------------------------------------
   *
   * Nada aqui bloqueia: são avisos. O que o modelo entrega pode ser tecnicamente válido e
   * ainda assim ser uma operação capenga — um agente sozinho fazendo três etapas, todo
   * mundo "personalizado", ninguém coordenando. Sem alguém dizendo isso em voz alta, o
   * dono aplica e só descobre usando.
   */
  const agentes = bp.agents ?? []
  const setores = bp.sectors ?? []

  const semPerfil = agentes.filter((a) => !texto(a?.preset).trim() || texto(a?.preset) === 'custom')
  if (semPerfil.length > 0 && semPerfil.length === agentes.length && agentes.length > 0) {
    aviso(
      'agents',
      'all_custom',
      'todos os agentes vão nascer sem perfil (personalizados)',
      'um perfil (gerente, pesquisador, analista, executor…) já traz instrução de papel, contrato e política de chamada prontos',
    )
  } else if (semPerfil.length > 0) {
    aviso('agents', 'custom_agent', `${semPerfil.length} agente(s) sem perfil definido`, 'confira se algum perfil pronto não serviria melhor')
  }

  const emSetor = new Set(setores.flatMap((s) => s?.memberAgentKeys ?? []))
  const soltos = agentes.filter((a) => !emSetor.has(a?.key))
  if (agentes.length > 1 && setores.length === 0) {
    aviso(
      'sectors',
      'no_sector',
      'são vários agentes e nenhum setor: eles não vão conversar entre si',
      'um setor com coordenador é o que faz um acionar o outro; sem ele, cada agente é uma ilha',
    )
  } else if (setores.length > 0 && soltos.length > 0) {
    aviso('agents', 'agent_outside_sector', `${soltos.length} agente(s) fora de qualquer setor`, 'quem fica de fora só é acionado à mão')
  }

  for (const setor of setores) {
    if (texto(setor?.mode) !== 'orchestrated') continue
    const coord = agentes.find((a) => a?.key === texto(setor?.coordinatorAgentKey))
    const politica = texto(coord?.delegationPolicy)
    // Um coordenador sem alcance é um coordenador no papel: ele recebe o pedido e não
    // consegue chamar ninguém.
    if (coord && politica && politica !== 'floor' && politica !== 'all' && politica !== 'selected') {
      aviso(`sectors`, 'coordinator_cannot_delegate', `o coordenador de "${texto(setor?.name)}" não pode acionar os outros`, 'use delegação por andar ou selecionada')
    }
  }

  /**
   * Nome de agente é nome de PESSOA.
   *
   * O modelo tende a escrever "Analista de Swing Trade" — que é o cargo, não o nome. Fica
   * como aviso e não como erro: é preferência de produto, e o dono pode discordar.
   */
  const CARGO = /^(agente|assistente|atendente|analista|gerente|coordenador|especialista|operador|robô|bot|monitor|pesquisador|secret[áa]rio|comunicador)\b/i
  for (const a of agentes) {
    if (CARGO.test(texto(a?.name).trim())) {
      aviso('agents', 'name_is_a_role', `"${texto(a?.name)}" é o cargo, não um nome`, 'dê um nome de pessoa; o que ele faz já está no papel e no objetivo')
    }
  }

  // --- segredo ---------------------------------------------------------------------------
  // Última barreira: nada do que vai virar instrução, documento ou nome pode carregar
  // credencial. Um segredo dentro do blueprint seria copiado para o banco na aplicação.
  const serializado = JSON.stringify(bp)
  if (maskSecrets(serializado) !== serializado) {
    erro('', 'secret_in_blueprint', 'a proposta contém algo que parece uma credencial', 'configure credenciais na página do App, nunca na conversa')
  }

  return { valid: !issues.some((i) => i.severity === 'error'), issues }
}

/** DFS com pilha: devolve o primeiro ciclo encontrado, para a mensagem poder mostrá-lo. */
function encontrarCiclo(nos: { key: string; dependsOn: string[] }[]): string[] | null {
  const porChave = new Map(nos.map((n) => [n.key, n.dependsOn]))
  const estado = new Map<string, 'visitando' | 'pronto'>()
  const caminho: string[] = []

  const visitar = (k: string): string[] | null => {
    if (estado.get(k) === 'pronto') return null
    if (estado.get(k) === 'visitando') return [...caminho.slice(caminho.indexOf(k)), k]
    estado.set(k, 'visitando')
    caminho.push(k)
    for (const dep of porChave.get(k) ?? []) {
      if (!porChave.has(dep)) continue
      const ciclo = visitar(dep)
      if (ciclo) return ciclo
    }
    caminho.pop()
    estado.set(k, 'pronto')
    return null
  }

  for (const no of nos) {
    const ciclo = visitar(no.key)
    if (ciclo) return ciclo
  }
  return null
}
