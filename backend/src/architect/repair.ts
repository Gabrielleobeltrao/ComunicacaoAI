import type { ExistingResources } from './context.js'
import type { ArchitectWarning, OfficeBlueprintV1 } from './types.js'

// O CONSERTO determinístico do que o modelo entrega torto.
//
// Há duas formas de tratar uma resposta imperfeita: recusar e mandar a pessoa pedir de
// novo, ou consertar o que dá para consertar sozinho e DIZER o que foi consertado. A
// primeira é o que estava acontecendo — e ela produzia uma tela com nove erros
// vermelhos que a pessoa não tinha como resolver, porque nenhum deles dependia dela.
//
// Nada aqui inventa conteúdo. Cada conserto ou apaga algo que não funcionaria, ou
// troca uma escolha impossível pela única possível — e sempre deixa um aviso.

/** Uma etapa de rotina só é aproveitável se ela tem identidade e tipo. */
const etapaUtil = (etapa: unknown): boolean => {
  const s = etapa as { id?: unknown; type?: unknown } | null
  return Boolean(s && typeof s === 'object' && typeof s.id === 'string' && s.id.trim() && typeof s.type === 'string' && s.type.trim())
}

/**
 * Conserta o que é possível conferir sem saber nada da conta.
 *
 * Duas coisas, as duas vistas em produção:
 *
 * 1. `delegationPolicy: "selected"` com a lista vazia. "Só estes agentes" sem dizer
 *    quais não é uma política, é um agente mudo. Vira delegação por andar, que é o que
 *    o coordenador precisa para alcançar o time.
 * 2. Rotina com etapas sem `id` ou sem `type`. Elas faziam o validador da plataforma
 *    responder "id is required" e "unknown step type: undefined" — a linguagem interna
 *    dele, na cara de quem está montando um atendimento. A rotina nasce rascunho de
 *    qualquer jeito: fica sem etapas, e o aviso diz onde terminá-la.
 */
export function repairBlueprintPatch(patch: Record<string, unknown>): { patch: Record<string, unknown>; warnings: ArchitectWarning[] } {
  const warnings: ArchitectWarning[] = []
  const fora: Record<string, unknown> = { ...patch }

  const agentes = Array.isArray(fora.agents) ? (fora.agents as Record<string, unknown>[]) : null
  if (agentes) {
    fora.agents = agentes.map((a) => {
      const lista = Array.isArray(a?.callableAgentKeys) ? (a.callableAgentKeys as unknown[]) : []
      if (a?.delegationPolicy !== 'selected' || lista.length > 0) return a
      warnings.push({
        path: `agents.${String(a?.key ?? '')}`,
        message: `a delegação de "${String(a?.name ?? a?.key ?? '')}" veio sem a lista de quem ele pode acionar; ficou como "agentes do andar"`,
      })
      return { ...a, delegationPolicy: 'floor' }
    })
  }

  const rotinas = Array.isArray(fora.routines) ? (fora.routines as Record<string, unknown>[]) : null
  if (rotinas) {
    fora.routines = rotinas.map((r) => {
      const steps = Array.isArray(r?.steps) ? (r.steps as unknown[]) : []
      if (steps.length === 0 || steps.every(etapaUtil)) return r
      warnings.push({
        path: `routines.${String(r?.key ?? '')}`,
        message: `as etapas propostas para a rotina "${String(r?.name ?? r?.key ?? '')}" não têm forma válida; ela vai ser criada como rascunho vazio, para você montar na tela de Rotinas`,
      })
      // Fora TODAS: aproveitar metade deixaria dependência apontando para etapa que não
      // existe mais — um rascunho quebrado é pior que um rascunho vazio.
      return { ...r, steps: [] }
    })
  }

  return { patch: fora, warnings }
}

/** O nome, comparável: sem acento, sem caixa e sem espaço sobrando. */
const normal = (texto: unknown): string =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

/**
 * Reaproveitamento que não tem o que reaproveitar vira criação.
 *
 * O modelo marca `reuse` sempre que o nome LHE PARECE existir. Quando não existe nada
 * com aquele nome na conta, o item fica exigindo um recurso que ninguém pode escolher:
 * a proposta trava com "o agente reutilizado precisa apontar para um recurso existente"
 * e não há, na tela inteira, um recurso para apontar.
 *
 * Quando o nome EXISTE, nada muda: a escolha continua sendo da pessoa, na tela de
 * ligações, porque reaproveitar um recurso é mexer no que já está rodando.
 */
export function repairReuseWithoutTarget(bp: OfficeBlueprintV1, existing?: ExistingResources): { blueprint: OfficeBlueprintV1; warnings: ArchitectWarning[] } {
  /**
   * Sem saber o que a conta tem, não se conserta nada.
   *
   * A leitura do escritório pode falhar (o serviço a envolve num `catch`). Tratar
   * "não sei" como "não existe" transformaria todo reaproveitamento legítimo em
   * criação — e a pessoa aplicaria uma cópia do próprio escritório sem perceber. O
   * erro bloqueante é chato; o duplicado silencioso é irreversível.
   */
  if (!existing) return { blueprint: bp, warnings: [] }

  const warnings: ArchitectWarning[] = []
  const nomes = {
    floor: new Set((existing?.floors ?? []).map((f) => normal(f.name))),
    agent: new Set((existing?.agents ?? []).map((a) => normal(a.name))),
    sector: new Set((existing?.sectors ?? []).map((s) => normal(s.name))),
  }

  const fora: OfficeBlueprintV1 = structuredClone(bp)
  const listas: [keyof OfficeBlueprintV1, keyof typeof nomes, string][] = [
    ['floors', 'floor', 'andar'],
    ['agents', 'agent', 'agente'],
    ['sectors', 'sector', 'setor'],
  ]

  for (const [lista, tipo, rotulo] of listas) {
    for (const item of (fora[lista] ?? []) as unknown as { key: string; name?: string; action: string; resourceId?: string | null }[]) {
      if (item.action !== 'reuse' && item.action !== 'update') continue
      if (item.resourceId) continue // já ligado por quem escolheu
      if (nomes[tipo].has(normal(item.name))) continue // existe: a escolha é da pessoa
      warnings.push({
        path: `${String(lista)}.${item.key}`,
        message: `pedi para reaproveitar o ${rotulo} "${item.name ?? item.key}", mas não existe nenhum com esse nome nesta conta; ele vai ser criado`,
      })
      item.action = 'create'
      delete item.resourceId
    }
  }
  return { blueprint: fora, warnings }
}
