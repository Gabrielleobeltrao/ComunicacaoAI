import { adapterFor, availableKinds } from './registry.js'
import type { ResourceKind, ResourceListContext, ResourceSummary } from './types.js'

// O CATÁLOGO: "o que existe no escritório?" e "o que este andar/setor/agente alcança?".
//
// Ele não guarda nada. Cada chamada pergunta ao adapter, que pergunta à fonte canônica —
// e é por isso que o catálogo nunca mostra um recurso que já foi apagado nem esconde um
// que acabou de nascer. Uma projeção materializada seria mais rápida e teria que ser
// invalidada por seis subsistemas diferentes; enquanto a conta couber numa consulta por
// tipo, a resposta certa vale mais que a rápida.

export interface CatalogQuery extends ResourceListContext {
  kinds?: ResourceKind[] | null
}

export async function listResources(q: CatalogQuery): Promise<{ items: ResourceSummary[]; byKind: Record<string, number> }> {
  const tipos = (q.kinds?.length ? q.kinds : availableKinds()).filter((k) => adapterFor(k))
  const listas = await Promise.all(
    tipos.map(async (kind) => {
      try {
        return await adapterFor(kind)!.list(q)
      } catch (erro) {
        // Um tipo que falha não pode apagar os outros da tela — e não pode virar "vazio",
        // que é a leitura que faz alguém concluir que não existe recurso nenhum.
        console.error(`[resources] falha ao listar ${kind}:`, (erro as Error).message)
        return [] as ResourceSummary[]
      }
    }),
  )
  const items = listas.flat()
  const byKind: Record<string, number> = {}
  for (const item of items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1
  return { items, byKind }
}
