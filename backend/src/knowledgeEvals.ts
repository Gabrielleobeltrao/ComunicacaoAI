import { ObjectId } from 'mongodb'
import { retrieveForAgent } from './knowledgeRetrieval.js'
import type { Agent } from './agents.js'

// OS EVALS DO CONTEXT ENGINE — medidos, não afirmados.
//
// A pergunta que eles existem para responder é uma só: a expansão pelo grafo ajuda? Sem
// medida, a resposta seria "parece que sim", e uma flag ligada por impressão é uma
// decisão de produto tomada sem dado.
//
// Cada caso declara o que DEVERIA vir e o que NÃO PODE vir. O que não pode vir é a metade
// que mais importa: um retrieval que traz tudo acerta todos os casos de "encontrou" e
// vaza o setor que o agente não podia ler.

export interface EvalCase {
  id: string
  /** O que se pergunta. */
  query: string
  /** Documentos que precisam aparecer. */
  expectDocumentIds: string[]
  /** Documentos que NÃO podem aparecer — permissão, validade ou conflito. */
  forbidDocumentIds?: string[]
  /** O estado de grounding esperado, quando ele é o ponto do caso. */
  expectStatus?: string
}

export interface EvalOutcome {
  caseId: string
  passed: boolean
  found: string[]
  missing: string[]
  leaked: string[]
  status: string
  chunks: number
  chars: number
  latencyMs: number
}

export interface EvalRun {
  label: string
  cases: number
  passed: number
  /** As médias que decidem se uma mudança vale a pena. */
  avgLatencyMs: number
  avgChunks: number
  avgChars: number
  outcomes: EvalOutcome[]
}

/**
 * Roda os casos contra a base REAL da conta.
 *
 * `now` é injetável para o caso de validade poder ser exercitado sem esperar um ano.
 */
export async function runContextEvals(
  accountId: string,
  agent: Pick<Agent, '_id' | 'ownerId' | 'officeId' | 'knowledgeAccess'>,
  casos: EvalCase[],
  opts: { label: string; graphExpansion?: boolean; verifiedSectorId?: ObjectId | null; topK?: number; minScore?: number },
): Promise<EvalRun> {
  const outcomes: EvalOutcome[] = []
  for (const caso of casos) {
    const inicio = Date.now()
    const r = await retrieveForAgent(accountId, agent, caso.query, {
      graphExpansion: opts.graphExpansion,
      verifiedSectorId: opts.verifiedSectorId ?? null,
      topK: opts.topK ?? 6,
      minScore: opts.minScore ?? 0,
    })
    const latencyMs = Date.now() - inicio
    const found = [...new Set(r.sources.map((s) => s.documentId).filter(Boolean))] as string[]
    const missing = caso.expectDocumentIds.filter((id) => !found.includes(id))
    const leaked = (caso.forbidDocumentIds ?? []).filter((id) => found.includes(id))
    outcomes.push({
      caseId: caso.id,
      passed: missing.length === 0 && leaked.length === 0 && (!caso.expectStatus || r.status === caso.expectStatus),
      found,
      missing,
      leaked,
      status: r.status,
      chunks: r.context.length,
      chars: r.context.reduce((n, c) => n + c.length, 0),
      latencyMs,
    })
  }
  const media = (f: (o: EvalOutcome) => number) => (outcomes.length === 0 ? 0 : Math.round(outcomes.reduce((n, o) => n + f(o), 0) / outcomes.length))
  return {
    label: opts.label,
    cases: outcomes.length,
    passed: outcomes.filter((o) => o.passed).length,
    avgLatencyMs: media((o) => o.latencyMs),
    avgChunks: media((o) => o.chunks),
    avgChars: media((o) => o.chars),
    outcomes,
  }
}

/**
 * A comparação antes/depois — e a decisão de ligar a expansão.
 *
 * O critério é explícito e conservador: a expansão só se justifica se ACERTAR MAIS sem
 * vazar nada. Empatar em acertos e gastar mais orçamento não é ganho — é o mesmo
 * resultado por mais dinheiro, e é exatamente o caso em que a flag deve continuar
 * desligada.
 */
export function compareRuns(baseline: EvalRun, expandido: EvalRun): {
  recommendExpansion: boolean
  reason: string
  deltaPassed: number
  deltaChunks: number
  deltaChars: number
  deltaLatencyMs: number
} {
  const deltaPassed = expandido.passed - baseline.passed
  const vazou = expandido.outcomes.some((o) => o.leaked.length > 0)
  return {
    recommendExpansion: deltaPassed > 0 && !vazou,
    reason: vazou
      ? 'a expansão trouxe documento que o agente não podia ler'
      : deltaPassed > 0
        ? `a expansão acertou ${deltaPassed} caso(s) a mais`
        : 'a expansão não acertou mais nada — gastar orçamento pelo mesmo resultado não é ganho',
    deltaPassed,
    deltaChunks: expandido.avgChunks - baseline.avgChunks,
    deltaChars: expandido.avgChars - baseline.avgChars,
    deltaLatencyMs: expandido.avgLatencyMs - baseline.avgLatencyMs,
  }
}
