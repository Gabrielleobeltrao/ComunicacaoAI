import { computeDefinitionHash } from '../automations/validate.js'
import type { OfficeBlueprintV1 } from './types.js'
import type { OfficeBlueprintV2 } from './typesV2.js'

// O blueprint em si: como se cria um vazio, como se junta um patch e como se calcula
// o hash que a confirmação exige.

export const emptyBlueprint = (title: string, objective: string): OfficeBlueprintV1 => ({
  version: 1,
  title,
  objective,
  floors: [],
  agents: [],
  sectors: [],
  routines: [],
  appRequirements: [],
  knowledgeRequirements: [],
  assumptions: [],
  warnings: [],
  checklist: [],
})

/**
 * O hash que a confirmação carrega.
 *
 * Reutiliza o hash canônico das automações — mesma operação, mesma garantia: ordem de
 * chave não muda o resultado, e qualquer mudança de conteúdo muda o hash. É o que faz
 * "aplicar" recusar um blueprint que mudou entre a prévia e o clique.
 */
/**
 * O cadeado da revisão.
 *
 * Quando o projeto tem plano V2, ele entra no MESMO hash: sem isso, mudar só os monitores
 * deixaria o hash do V1 igual, e um clique feito olhando a revisão anterior aplicaria uma
 * operação que ninguém leu. Projetos sem V2 seguem com exatamente o hash que já tinham.
 */
export const computeBlueprintHash = (blueprint: OfficeBlueprintV1, v2?: OfficeBlueprintV2 | null): string =>
  v2 ? computeDefinitionHash({ v1: blueprint, v2 } as unknown as OfficeBlueprintV1) : computeDefinitionHash(blueprint)

const LISTAS = [
  'floors',
  'agents',
  'sectors',
  'routines',
  'appRequirements',
  'knowledgeRequirements',
  'assumptions',
  'warnings',
  'checklist',
] as const

const chaveDe = (item: unknown): string | null => {
  if (!item || typeof item !== 'object') return null
  const k = (item as { key?: unknown; id?: unknown }).key ?? (item as { id?: unknown }).id
  return typeof k === 'string' && k.trim() ? k.trim() : null
}

/**
 * Junta o que o modelo devolveu ao que já existia — POR KEY, e não por posição.
 *
 * Substituir a lista inteira faria uma revisão ("troque o nome do setor") apagar tudo
 * o que não foi repetido na resposta. Concatenar duplicaria. Casar por `key` é o que
 * permite o modelo mandar só o que mudou, que é o que ele faz quando a conversa já
 * tem contexto.
 *
 * Um item sem `key` é descartado: sem ela não há como referenciá-lo, nem no merge nem
 * no resto do blueprint.
 */
export function mergeBlueprintPatch(base: OfficeBlueprintV1 | null, patch: Partial<OfficeBlueprintV1> | null | undefined, fallback: { title: string; objective: string }): OfficeBlueprintV1 {
  const atual: OfficeBlueprintV1 = base ? { ...base } : emptyBlueprint(fallback.title, fallback.objective)
  if (!patch) return atual

  const fora: OfficeBlueprintV1 = {
    ...atual,
    version: 1,
    title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : atual.title,
    objective: typeof patch.objective === 'string' && patch.objective.trim() ? patch.objective.trim() : atual.objective,
    ...(patch.buildingPatch !== undefined ? { buildingPatch: patch.buildingPatch } : {}),
  }

  for (const lista of LISTAS) {
    const novos = patch[lista]
    if (!Array.isArray(novos)) continue
    const antigos = (atual[lista] ?? []) as unknown[]
    const porChave = new Map<string, unknown>()
    const ordem: string[] = []
    for (const item of antigos) {
      const k = chaveDe(item)
      if (!k) continue
      if (!porChave.has(k)) ordem.push(k)
      porChave.set(k, item)
    }
    for (const item of novos as unknown[]) {
      const k = chaveDe(item)
      if (!k) continue
      const anterior = porChave.get(k)
      if (!porChave.has(k)) ordem.push(k)
      // Campo ausente no patch mantém o valor anterior: uma revisão que só muda o nome
      // não pode zerar o objetivo do agente.
      porChave.set(k, anterior && typeof anterior === 'object' ? { ...(anterior as object), ...(item as object) } : item)
    }
    ;(fora as unknown as Record<string, unknown[]>)[lista] = ordem.map((k) => porChave.get(k)!) as unknown[]
  }
  return fora
}
