import type { ArchitectStatus, ChecklistItem, PreviewItem } from '../../lib/architect'

// Os rótulos, num lugar só: a lista, a conversa e a checklist falam do mesmo estado, e
// duas traduções divergem na primeira mudança.

export const STATUS_LABEL: Record<ArchitectStatus, string> = {
  discovery: 'Conversando',
  draft: 'Proposta em rascunho',
  ready: 'Pronta para aplicar',
  applying: 'Aplicando',
  applied: 'Aplicada',
  failed: 'Interrompida',
  archived: 'Arquivada',
}

export const statusTone = (status: ArchitectStatus): 'neutral' | 'success' | 'warning' | 'danger' | 'brand' =>
  status === 'applied' ? 'success' : status === 'failed' ? 'danger' : status === 'ready' ? 'warning' : 'neutral'

export const ACTION_LABEL: Record<PreviewItem['action'], string> = {
  create: 'Criar',
  reuse: 'Reaproveitar',
  update: 'Alterar',
  wait_user: 'Depende de você',
}

export const KIND_LABEL: Record<PreviewItem['kind'], string> = {
  // O prédio entra quando a proposta mexe no nome dele. Faltava aqui, e o item saía
  // rotulado como `undefined`.
  building: 'Prédio',
  floor: 'Andar',
  agent: 'Agente',
  sector: 'Setor',
  routine: 'Rotina',
  app: 'App',
  knowledge: 'Conhecimento',
  // Os do plano V2, com o nome que a pessoa usa no produto — não o do código.
  database: 'Database',
  dataset: 'Conjunto',
  source: 'Fonte',
  history: 'Histórico',
  live: 'Valor de agora',
  monitor: 'Monitor',
  flow: 'Flow',
  channel: 'Canal',
  delivery: 'Entrega',
  tool: 'Ferramenta',
}

export const CHECK_LABEL: Record<ChecklistItem['category'], string> = {
  structure: 'Estrutura',
  knowledge: 'Conhecimento',
  app: 'App',
  channel: 'Canal',
  routine: 'Rotina',
  test: 'Teste',
  review: 'Revisão',
}
