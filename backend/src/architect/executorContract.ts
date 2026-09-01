import type { ArchitectCapabilityManifest } from './capabilities.js'
import type { BlueprintAgent, OfficeBlueprintV1 } from './types.js'

// COMO o trabalho é feito — decisão separada de QUAL responsabilidade o agente tem.
//
// A função responde "de quem é isso"; o executor responde "por qual meio". Um analista
// pode interpretar um relatório com LLM e chamar `calculate_rsi` como função: são a
// mesma pessoa e dois meios diferentes.
//
// A regra que mais importa aqui é a ausência de QUEDA SILENCIOSA. Um `function` sem
// função declarada e um `tool` sem ação real não podem virar "então o LLM faz": o
// modelo diria que calculou, diria que registrou, e ninguém saberia que não aconteceu.
// Sem o recurso, o item vira pendência declarada — nunca um agente de linguagem
// fingindo determinismo.

export type ExecutorFindingCode =
  | 'function_without_name'
  | 'function_not_in_registry'
  | 'function_without_schema'
  | 'tool_without_reference'
  | 'tool_action_not_found'
  | 'tool_app_not_connected'
  | 'llm_without_judgment'
  | 'silent_llm_fallback'
  | 'sensitive_action_without_approval'

export interface ExecutorFinding {
  code: ExecutorFindingCode
  agentKey: string
  agentName: string
  message: string
  fix: string
  severity: 'error' | 'warning'
}

const texto = (v: unknown): string => String(v ?? '').trim()
const temSchema = (v: unknown): boolean => Boolean(v && typeof v === 'object' && Object.keys(v as object).length > 0)

/** O App e a ação que este agente pediu, quando pediu. */
function acoesPedidas(agent: BlueprintAgent, bp: OfficeBlueprintV1): { appKey: string; actionKeys: string[] }[] {
  return (bp.appRequirements ?? [])
    .filter((r) => (r.agentKeys ?? []).includes(agent.key))
    .map((r) => ({ appKey: r.appKey, actionKeys: r.actionKeys ?? [] }))
}

/**
 * O contrato de cada executor, conferido contra o catálogo real.
 *
 * `function` exige uma função do registro e schemas; `tool` exige App e ação que
 * existam; `llm` exige um julgamento que justifique linguagem. O que falta vira erro
 * com conserto — não vira LLM por omissão.
 */
export function validateExecutors(bp: OfficeBlueprintV1, manifest: ArchitectCapabilityManifest | null): ExecutorFinding[] {
  const achados: ExecutorFinding[] = []
  const funcoes = new Map((manifest?.functions ?? []).map((f) => [f.functionName, f]))
  const apps = new Map((manifest?.apps ?? []).map((a) => [a.key, a]))

  for (const agent of bp.agents ?? []) {
    const base = { agentKey: agent.key, agentName: agent.name }
    const erro = (code: ExecutorFindingCode, message: string, fix: string) => achados.push({ ...base, code, message, fix, severity: 'error' })
    const aviso = (code: ExecutorFindingCode, message: string, fix: string) => achados.push({ ...base, code, message, fix, severity: 'warning' })
    const kind = agent.executorKind ?? 'llm'

    if (kind === 'function') {
      // `functionName` não existe em `BlueprintAgent`: a proposta declara a função pelo
      // contrato de entrada/saída e pelo nome no objetivo. O que falta é dito por nome.
      const nome = texto(agent.inputContract).match(/[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*/i)?.[0] ?? ''
      if (!nome) {
        erro('function_without_name', `"${agent.name}" é uma função, mas não diz qual`, 'informe a função do registro que ele executa — sem nome, não há o que executar')
      } else if (manifest && !funcoes.has(nome)) {
        erro('function_not_in_registry', `a função "${nome}" não existe nesta instalação`, 'escolha uma função do catálogo, ou deixe o item como pendência')
      }
      if (!temSchema(agent.inputJsonSchema) || !temSchema(agent.outputJsonSchema)) {
        erro('function_without_schema', `"${agent.name}" executa uma função sem contrato de entrada e saída`, 'declare os schemas: sem eles ninguém sabe o que entra nem o que volta')
      }
      continue
    }

    if (kind === 'tool') {
      const pedidos = acoesPedidas(agent, bp)
      if (pedidos.length === 0) {
        erro('tool_without_reference', `"${agent.name}" é uma ferramenta, mas não aponta para App nenhum`, 'declare o App e a ação que ele executa')
        continue
      }
      for (const pedido of pedidos) {
        const app = apps.get(pedido.appKey)
        if (manifest && !app) {
          erro('tool_action_not_found', `o App "${pedido.appKey}" não existe no catálogo`, 'escolha um App real, ou trate como pendência de integração')
          continue
        }
        for (const acao of pedido.actionKeys) {
          if (app && !app.actions.some((a) => a.key === acao)) {
            erro('tool_action_not_found', `a ação "${acao}" não existe em ${pedido.appKey}`, 'escolha uma ação real do App')
          }
        }
        if (app && !app.connected) {
          aviso('tool_app_not_connected', `${pedido.appKey} ainda não está conectado`, 'conecte o App antes de aplicar — até lá este agente não executa nada')
        }
      }
      continue
    }

    /**
     * `llm` que deveria ser determinístico.
     *
     * É a queda silenciosa vista de frente: o objetivo fala em calcular, converter ou
     * ordenar, não há julgamento declarado, e o executor é linguagem. O modelo vai
     * acertar quase sempre — e errar sem avisar.
     */
    const alvo = `${texto(agent.objective)} ${texto(agent.role)}`.toLowerCase()
    const determinístico = /(calcul|converter|somar|média|ordenar|formatar|contar)/.test(alvo)
    if (determinístico && !texto(agent.role)) {
      erro(
        'silent_llm_fallback',
        `"${agent.name}" faz um trabalho de cálculo com um modelo de linguagem`,
        'use uma função determinística; se houver julgamento junto, escreva qual é',
      )
    }
  }

  /**
   * Ação sensível sem aprovação humana.
   *
   * O `risk` vem do próprio App. Uma operação que cobra, reembolsa ou apaga sem regra
   * de aprovação nasce com um risco que ninguém escolheu correr.
   */
  for (const req of bp.appRequirements ?? []) {
    const app = apps.get(req.appKey)
    if (!app) continue
    const sensiveis = app.actions.filter((a) => a.risk === 'high_risk' && (req.actionKeys ?? []).includes(a.key))
    for (const acao of sensiveis) {
      const agentes = (req.agentKeys ?? []).map((k) => (bp.agents ?? []).find((a) => a.key === k)).filter(Boolean)
      for (const agent of agentes) {
        achados.push({
          code: 'sensitive_action_without_approval',
          agentKey: agent!.key,
          agentName: agent!.name,
          message: `"${agent!.name}" pode executar "${acao.key}" (${app.key}), que é uma ação sensível`,
          fix: 'defina quem aprova antes: uma ação com consequência não deveria acontecer sozinha',
          severity: 'warning',
        })
      }
    }
  }

  return achados
}
