import { computeBlueprintHash } from './blueprint.js'
import { deriveChecklist, applyChecklistState, computeReadiness } from './checklist.js'
import { validateOfficeBlueprint } from './validate.js'
import type { BlueprintOwnershipContext, BlueprintIssue } from './validate.js'
import type { ArchitectChecklistItem, ArchitectReadiness, OfficeBlueprintV1 } from './types.js'
import type { OfficeBlueprintV2 } from './typesV2.js'

// A PRÉVIA: o que vai acontecer, item a item, antes de qualquer escrita.
//
// É determinística e não toca no banco além do contexto que já veio pronto. Duas
// prévias do mesmo blueprint são idênticas — inclusive o hash, que é o que a
// confirmação carrega.

export interface PreviewItem {
  kind: 'building' | 'floor' | 'agent' | 'sector' | 'routine' | 'app' | 'knowledge'
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

export interface ArchitectPreview {
  blueprintHash: string
  valid: boolean
  issues: BlueprintIssue[]
  items: PreviewItem[]
  checklist: ArchitectChecklistItem[]
  readiness: ArchitectReadiness
  /** Quantos recursos serão criados de fato. */
  counts: { create: number; reuse: number; update: number; waitUser: number }
}

const doIssue = (issues: BlueprintIssue[], prefixo: string): BlueprintIssue[] => issues.filter((i) => i.path === prefixo || i.path.startsWith(`${prefixo}.`) || i.path.startsWith(`${prefixo}[`))

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
      detail: `Setor no modo ${s.mode}.`,
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

  const checklist = applyChecklistState(deriveChecklist(bp), new Set(), marcados)
  const bloqueios = issues.filter((i) => i.severity === 'error').map((i) => i.message)

  return {
    blueprintHash: computeBlueprintHash(bp, v2),
    valid,
    issues,
    items,
    checklist,
    readiness: computeReadiness(checklist, bloqueios),
    counts: {
      create: items.filter((i) => i.action === 'create').length,
      reuse: items.filter((i) => i.action === 'reuse').length,
      update: items.filter((i) => i.action === 'update').length,
      waitUser: items.filter((i) => i.action === 'wait_user').length,
    },
  }
}
