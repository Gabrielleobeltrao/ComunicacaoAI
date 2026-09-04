import { detectArchitecture, mergeSplitRationale, scoreArchitecture, DEFAULT_BUDGET } from './architecture.js'
import type { ArchitectureFinding, ArchitectureScore, ComplexityBudget, MergeSplitDecision } from './architecture.js'
import { validateExecutors } from './executorContract.js'
import type { ExecutorFinding } from './executorContract.js'
import { validateResponsibility } from './responsibility.js'
import type { ResponsibilityFinding } from './responsibility.js'
import type { ArchitectCapabilityManifest } from './capabilities.js'
import type { OfficeBlueprintV1 } from './types.js'

// O CRÍTICO — o que separa "a proposta é válida" de "a proposta é boa".
//
// A validação estrutural já dizia que as referências fecham e os campos existem. Ela
// não diz nada sobre o gerente sem equipe, o operador sem ferramenta, o agente que
// ninguém aciona ou o cálculo entregue a um modelo de linguagem. Todos passam pelo
// `apply` e falham depois, na conta de quem aprovou.
//
// Três camadas determinísticas, todas explicáveis: responsabilidade (a função como
// contrato), executor (o meio, sem queda silenciosa) e arquitetura (a forma). Nenhuma
// delas chama modelo — o crítico precisa dar a mesma resposta para a mesma proposta.

export type CriticSource = 'responsibility' | 'executor' | 'architecture' | 'llm'

export interface CriticFinding {
  source: CriticSource
  code: string
  agentKey?: string
  message: string
  fix: string
  severity: 'error' | 'warning'
  evidence: string[]
}

export interface CriticReport {
  findings: CriticFinding[]
  score: ArchitectureScore
  mergeSplit: MergeSplitDecision[]
  /** `false` quando há erro: o preview mostra, e a aplicação continua exigindo revisão. */
  clean: boolean
}

const comEvidencia = (f: ResponsibilityFinding | ExecutorFinding, source: CriticSource): CriticFinding => ({
  source,
  code: f.code,
  agentKey: f.agentKey,
  message: f.message,
  fix: f.fix,
  severity: f.severity,
  evidence: [`agente "${f.agentName}"`],
})

export function runCritic(
  bp: OfficeBlueprintV1,
  manifest: ArchitectCapabilityManifest | null,
  budget: ComplexityBudget = DEFAULT_BUDGET,
): CriticReport {
  const findings: CriticFinding[] = [
    ...validateResponsibility(bp, manifest).map((f) => comEvidencia(f, 'responsibility')),
    ...validateExecutors(bp, manifest).map((f) => comEvidencia(f, 'executor')),
    ...detectArchitecture(bp, budget).map((f: ArchitectureFinding) => ({
      source: 'architecture' as const,
      code: f.code,
      ...(f.agentKey ? { agentKey: f.agentKey } : {}),
      message: f.message,
      fix: f.fix,
      severity: f.severity,
      evidence: f.evidence,
    })),
  ]

  // Erro antes de aviso: quem lê resolve na ordem em que as coisas travam.
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))

  return {
    findings,
    score: scoreArchitecture(bp, budget),
    mergeSplit: mergeSplitRationale(bp),
    clean: !findings.some((f) => f.severity === 'error'),
  }
}

/**
 * Os achados que o modelo pode acrescentar — e o que ele NÃO pode fazer com eles.
 *
 * A camada de LLM é auxiliar: ela procura sobreposição, responsabilidade vaga e
 * alternativa mais simples — coisas que regra nenhuma pega. O que ela devolve é
 * FINDING, nunca patch: um crítico que edita o desenho é um segundo arquiteto, e aí
 * ninguém sabe qual dos dois propôs o que a pessoa está aprovando.
 *
 * Cada achado passa por aqui antes de existir: sem código, sem mensagem ou sem
 * agente conhecido, ele é descartado.
 */
export function normalizeLlmFindings(bruto: unknown, bp: OfficeBlueprintV1): CriticFinding[] {
  if (!Array.isArray(bruto)) return []
  const chaves = new Set((bp.agents ?? []).map((a) => a.key))
  const fora: CriticFinding[] = []
  for (const item of bruto.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue
    const f = item as Record<string, unknown>
    const code = String(f.code ?? '').trim().slice(0, 60)
    const message = String(f.message ?? '').trim().slice(0, 400)
    const fix = String(f.fix ?? '').trim().slice(0, 400)
    if (!code || !message || !fix) continue
    const agentKey = String(f.agentKey ?? '').trim()
    // Achado sobre um agente que não existe é ruído — ou invenção.
    if (agentKey && !chaves.has(agentKey)) continue
    fora.push({
      source: 'llm',
      code,
      ...(agentKey ? { agentKey } : {}),
      message,
      fix,
      // O crítico auxiliar não declara erro: ele levanta suspeita. Bloquear a aplicação
      // com base em opinião de modelo seria dar a ele a palavra final.
      severity: 'warning',
      evidence: Array.isArray(f.evidence) ? f.evidence.slice(0, 5).map((e) => String(e).slice(0, 200)) : [],
    })
  }
  return fora
}
