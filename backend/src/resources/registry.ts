import { knowledgeAdapter } from './adapters/knowledgeAdapter.js'
import { appAdapter } from './adapters/appAdapter.js'
import { toolAdapter } from './adapters/toolAdapter.js'
import { databaseAdapter } from './adapters/databaseAdapter.js'
import type { ResourceAdapter, ResourceKind } from './types.js'

// O REGISTRO de adapters — o único lugar que sabe quais tipos existem.
//
// Um tipo novo entra aqui e passa a aparecer no catálogo, no acesso e no impacto sem que
// nenhuma rota mude. É o oposto do `switch (kind)` espalhado, que é como uma camada
// comum vira uma camada que precisa ser editada em cinco lugares por tipo novo.

const ADAPTERS: Partial<Record<ResourceKind, ResourceAdapter>> = {
  knowledge: knowledgeAdapter,
  app: appAdapter,
  tool: toolAdapter,
  database: databaseAdapter,
}

export const adapterFor = (kind: ResourceKind): ResourceAdapter | null => ADAPTERS[kind] ?? null

export const availableKinds = (): ResourceKind[] => Object.keys(ADAPTERS) as ResourceKind[]
