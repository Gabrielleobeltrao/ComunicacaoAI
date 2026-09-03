import { computeBlueprintHash } from './blueprint.js'
import { deriveChecklist, applyChecklistState, computeReadiness } from './checklist.js'
import { validateOfficeBlueprint } from './validate.js'
import type { BlueprintOwnershipContext, BlueprintIssue } from './validate.js'
import type { ArchitectChecklistItem, ArchitectReadiness, OfficeBlueprintV1 } from './types.js'
import type { OfficeBlueprintV2 } from './typesV2.js'
import { SECTOR_MODE_LABEL } from '../sectors.js'
import type { SectorMode } from '../sectors.js'

// A PRÉVIA: o que vai acontecer, item a item, antes de qualquer escrita.
//
// É determinística e não toca no banco além do contexto que já veio pronto. Duas
// prévias do mesmo blueprint são idênticas — inclusive o hash, que é o que a
// confirmação carrega.

export interface PreviewItem {
  kind:
    | 'building'
    | 'floor'
    | 'agent'
    | 'sector'
    | 'routine'
    | 'app'
    | 'knowledge'
    // Os do plano V2. Sem eles, quem lê a proposta não vê o Database, a fonte nem o monitor
    // que vão ser criados — e acaba autorizando a ativação de algo que nunca viu proposto.
    | 'database'
    | 'dataset'
    | 'source'
    | 'history'
    | 'live'
    | 'monitor'
    | 'flow'
    | 'channel'
    | 'delivery'
    | 'tool'
  key: string
  label: string
  /** `wait_user` é o item que depende de algo que só a pessoa pode fazer. */
  action: 'create' | 'reuse' | 'update' | 'wait_user'
  detail: string
  /** O PORQUÊ deste item, nas palavras do plano. Custou token; é para ser lido. */
  rationale?: string
  dependsOn: string[]
  /** Esta etapa gasta LLM quando rodar? A pessoa merece saber antes de aprovar. */
  usesLlm: boolean
  /** Mudança em recurso EXISTENTE: vem desmarcada e exige aprovação individual. */
  requiresApproval: boolean
  issues: BlueprintIssue[]
}

/**
 * O que pode ENTRAR NO AR nesta aplicação — e nada além.
 *
 * Só entra aqui o item do plano V2 que declara um teste de aceitação: o servidor não ativa
 * nada sem prova, então oferecer na tela algo que ele vai recusar seria um checkbox que
 * mente. A lista nasce vazia na tela, e é isso que faz aplicar uma proposta não colocar a
 * operação para rodar sozinha no mesmo instante.
 */
export interface ActivatableItem {
  kind: 'source' | 'monitor' | 'flow'
  key: string
  label: string
  /** O que o teste vai observar, nas palavras do plano. */
  expectation: string
}

export interface ArchitectPreview {
  blueprintHash: string
  valid: boolean
  issues: BlueprintIssue[]
  items: PreviewItem[]
  checklist: ArchitectChecklistItem[]
  readiness: ArchitectReadiness
  /** Quantos recursos serão criados de fato. */
  counts: { create: number; reuse: number; update: number; waitUser: number }
  /** O que a pessoa pode autorizar a entrar no ar. Vazio quando não há plano V2. */
  activatable: ActivatableItem[]
}

/** Um item de prévia para cada recurso e operação do plano V2, na ordem em que aparecem. */
function itensDoV2(v2: OfficeBlueprintV2 | null | undefined): PreviewItem[] {
  if (!v2) return []
  const blocos: [PreviewItem['kind'], { key: string; name?: string; alias?: string; action: string; rationale?: string; dependsOn?: string[] }[], string][] = [
    ['database', v2.resources.databases, 'Onde este dado fica guardado.'],
    ['dataset', v2.resources.datasets, 'O conjunto com os campos declarados.'],
    ['tool', v2.resources.tools, 'Uma ferramenta própria. Endpoint e schema ficam pendentes.'],
    ['source', v2.operations.sources, 'De onde o dado chega. Nasce parada: ativa só depois de testar.'],
    ['history', v2.operations.histories, 'A série que dá o "antes" — sem ela, uma borda não existe.'],
    ['live', v2.operations.liveDestinations, 'O valor de agora, consultável por quem receber acesso.'],
    ['monitor', v2.operations.monitors, 'A regra que reconhece a transição. Nasce rascunho.'],
    ['flow', v2.operations.flows, 'O que acontece quando a regra bate. Nasce rascunho.'],
    ['channel', v2.operations.channels, 'Por onde a mensagem entra, e quem recebe.'],
    ['delivery', v2.operations.deliveries, 'Para onde a resposta sai. O endereço é escolhido na tela.'],
  ]
  const saida: PreviewItem[] = []
  for (const [kind, lista, detalhe] of blocos) {
    for (const item of lista ?? []) {
      saida.push({
        kind,
        key: item.key,
        label: item.name ?? item.alias ?? item.key,
        action: (item.action === 'reuse' || item.action === 'update' ? item.action : 'create') as PreviewItem['action'],
        detail: detalhe,
        ...(item.rationale?.trim() ? { rationale: item.rationale } : {}),
        dependsOn: item.dependsOn ?? [],
        usesLlm: false,
        // A aprovação individual do V2 é a de ATIVAÇÃO, que tem lista própria no diálogo.
        requiresApproval: false,
        issues: [],
      })
    }
  }
  return saida
}

/** Os itens do V2 que têm teste declarado, com o nome que a pessoa reconhece. */
function activatableFrom(v2: OfficeBlueprintV2 | null | undefined): ActivatableItem[] {
  if (!v2) return []
  const DE_TESTE: Record<string, ActivatableItem['kind']> = { source: 'source', monitor_simulation: 'monitor', flow: 'flow' }
  const nomeDe = (kind: ActivatableItem['kind'], key: string): string => {
    const lista =
      kind === 'source' ? v2.operations.sources : kind === 'monitor' ? v2.operations.monitors : v2.operations.flows
    return (lista as { key: string; name?: string }[]).find((i) => i.key === key)?.name ?? key
  }
  const vistos = new Set<string>()
  const saida: ActivatableItem[] = []
  for (const teste of v2.acceptanceTests ?? []) {
    const kind = DE_TESTE[teste.kind]
    if (!kind) continue
    const id = `${kind}:${teste.targetKey}`
    if (vistos.has(id)) continue
    vistos.add(id)
    saida.push({ kind, key: teste.targetKey, label: nomeDe(kind, teste.targetKey), expectation: teste.expectation })
  }
  return saida
}

const doIssue = (issues: BlueprintIssue[], prefixo: string): BlueprintIssue[] => issues.filter((i) => i.path === prefixo || i.path.startsWith(`${prefixo}.`) || i.path.startsWith(`${prefixo}[`))

/**
 * O que o modo do setor SIGNIFICA, em português.
 *
 * "Setor no modo parallel" não é uma frase: é o valor do enum vazando para a tela de quem
 * aprova. E os três modos decidem coisas diferentes — um só agrupa no mapa e não executa
 * nada, os outros dois executam de formas opostas. Aprovar "coordenado" achando que é
 * "etapas" é aprovar outra operação.
 *
 * O texto vem de `SECTOR_MODE_LABEL`, que é de onde a tela de setores já tira o dela: duas
 * frases para a mesma coisa é como a prévia e o produto passam a discordar.
 */
function detalheDoSetor(s: { mode: SectorMode; memberAgentKeys?: string[]; stages?: unknown[] }): string {
  const rotulo = SECTOR_MODE_LABEL[s.mode] ?? SECTOR_MODE_LABEL.organization
  const equipe = s.memberAgentKeys?.length ?? 0
  const quantos = equipe === 1 ? '1 agente' : `${equipe} agentes`
  const etapas = s.stages?.length ?? 0
  const extra = s.mode === 'pipeline' && etapas ? ` ${etapas} etapa${etapas > 1 ? 's' : ''}.` : equipe ? ` ${quantos}.` : ''
  return `${rotulo.title}: ${rotulo.help}${extra}`
}

export function buildPreview(bp: OfficeBlueprintV1, ctx: BlueprintOwnershipContext, marcados: Set<string> = new Set(), v2?: OfficeBlueprintV2 | null): ArchitectPreview {
  const { valid, issues } = validateOfficeBlueprint(bp, ctx)
  const items: PreviewItem[] = []

  // O prédio, quando a proposta mexe nele. Ele não está em lista nenhuma — antes era
  // ignorado em silêncio, e renomear o prédio não acontecia sem ninguém avisar.
  if (bp.buildingPatch && (bp.buildingPatch.name?.trim() || bp.buildingPatch.description !== undefined)) {
    items.push({
      kind: 'building',
      key: 'building',
      label: bp.buildingPatch.name?.trim() || 'Prédio',
      action: 'update',
      detail: 'Muda o nome ou a descrição do prédio desta conta.',
      dependsOn: [],
      usesLlm: false,
      requiresApproval: true,
      issues: doIssue(issues, 'buildingPatch'),
    })
  }

  ;(bp.floors ?? []).forEach((f, i) => {
    items.push({
      kind: 'floor',
      key: f.key,
      label: f.name,
      action: f.action,
      detail: f.action === 'create' ? 'Andar novo.' : 'Andar existente, reaproveitado.',
      rationale: f.rationale?.trim() || undefined,
      dependsOn: [],
      usesLlm: false,
      requiresApproval: f.action === 'update',
      issues: doIssue(issues, `floors[${i}]`),
    })
  })
  ;(bp.agents ?? []).forEach((a, i) => {
    items.push({
      kind: 'agent',
      key: a.key,
      label: a.name,
      action: a.action,
      detail: a.action === 'create' ? 'Agente novo.' : a.action === 'reuse' ? 'Agente existente, reaproveitado.' : 'Altera um agente que já existe.',
      rationale: a.rationale?.trim() || undefined,
      dependsOn: [`floor:${a.floorKey}`],
      // Criar um agente não chama modelo nenhum; ele passa a chamar quando alguém falar
      // com ele. Dizer o contrário aqui assustaria à toa.
      usesLlm: false,
      requiresApproval: a.action === 'update',
      issues: doIssue(issues, `agents[${i}]`),
    })
  })
  ;(bp.sectors ?? []).forEach((s, i) => {
    items.push({
      kind: 'sector',
      key: s.key,
      label: s.name,
      action: s.action,
      detail: detalheDoSetor(s),
      rationale: s.rationale?.trim() || undefined,
      dependsOn: (s.memberAgentKeys ?? []).map((k) => `agent:${k}`),
      usesLlm: false,
      requiresApproval: s.action === 'update',
      issues: doIssue(issues, `sectors[${i}]`),
    })
  })
  ;(bp.routines ?? []).forEach((r, i) => {
    items.push({
      kind: 'routine',
      key: r.key,
      label: r.name,
      action: r.action,
      detail: 'Criada como rascunho: não roda até você publicar.',
      rationale: r.rationale?.trim() || undefined,
      dependsOn: [`agent:${r.ownerAgentKey}`],
      // Uma rotina com etapa de agente chama o modelo toda vez que rodar.
      usesLlm: (r.steps ?? []).some((s) => String((s as { type?: unknown }).type ?? '').startsWith('agent.')),
      requiresApproval: r.action === 'update',
      issues: doIssue(issues, `routines[${i}]`),
    })
  })
  ;(bp.appRequirements ?? []).forEach((req, i) => {
    const conectado = ctx.installedAppKeys.has(req.appKey)
    items.push({
      kind: 'app',
      key: req.key,
      label: req.appKey,
      // Sem conexão não há permissão a conceder: o item espera a pessoa, e a aplicação
      // segue sem ele em vez de falhar inteira.
      action: conectado ? 'reuse' : 'wait_user',
      detail: conectado ? req.reason : `${req.reason} Conecte o App para os agentes poderem usá-lo.`,
      dependsOn: (req.agentKeys ?? []).map((k) => `agent:${k}`),
      usesLlm: false,
      requiresApproval: false,
      issues: doIssue(issues, `appRequirements[${i}]`),
    })
  })
  ;(bp.knowledgeRequirements ?? []).forEach((req, i) => {
    const temConteudo = Boolean(req.content?.trim())
    items.push({
      kind: 'knowledge',
      key: req.key,
      label: req.title,
      action: temConteudo ? 'create' : 'wait_user',
      detail: temConteudo ? 'Vira um documento na base do destino.' : 'Fica pendente até você enviar o conteúdo. Nada é inventado.',
      rationale: req.description?.trim() || undefined,
      dependsOn: req.targetKey ? [`${req.scope}:${req.targetKey}`] : [],
      // A indexação usa embeddings, e isso tem custo. Vale dizer.
      usesLlm: temConteudo,
      requiresApproval: false,
      issues: doIssue(issues, `knowledgeRequirements[${i}]`),
    })
  })

  /**
   * Os itens do plano V2 — os recursos e as operações que o V1 não sabe descrever.
   *
   * Sem eles, a prévia mostra andares e agentes e cala sobre o Database, a fonte e o
   * monitor. A pessoa aprova uma proposta que não viu inteira, e depois autoriza a ativação
   * de algo que nunca apareceu na tela.
   *
   * São de LEITURA: `requiresApproval` fica falso porque a aprovação individual do V2 é a
   * de ativação, que é outra pergunta e tem a lista própria.
   */
  for (const v2Item of itensDoV2(v2)) items.push(v2Item)

  const checklist = applyChecklistState(deriveChecklist(bp), new Set(), marcados)
  const bloqueios = issues.filter((i) => i.severity === 'error').map((i) => i.message)

  return {
    blueprintHash: computeBlueprintHash(bp, v2),
    valid,
    issues,
    items,
    checklist,
    readiness: computeReadiness(checklist, bloqueios),
    activatable: activatableFrom(v2),
    counts: {
      create: items.filter((i) => i.action === 'create').length,
      reuse: items.filter((i) => i.action === 'reuse').length,
      update: items.filter((i) => i.action === 'update').length,
      waitUser: items.filter((i) => i.action === 'wait_user').length,
    },
  }
}
