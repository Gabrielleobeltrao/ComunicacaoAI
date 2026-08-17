import type { AppDefinition } from '../../types.js'

export const manifest: AppDefinition = {
  key: 'web_chat',
  version: '1.0.0',
  source: 'system',
  name: 'Chat Web',
  description: 'Atendimento no seu site: widget incorporável, roteamento para agente ou setor e histórico das conversas.',
  icon: 'message-circle',
  categories: ['atendimento'],
  // Nothing to connect: activating is idempotent and asks for no secret.
  auth: { kind: 'none', fields: [] },
  // Nothing to connect: activating is the whole flow, and it is idempotent.
  activation: 'instant',
  allowedDomains: [],
  supportsMultipleConnections: false,
  actions: [],
  surfaces: [
    { key: 'overview', label: 'Visão geral', description: 'Estado dos widgets, conversas e volume.', kind: 'native', scope: 'account', routeSegment: 'overview' },
    { key: 'widgets', label: 'Widgets', description: 'Criar, personalizar e instalar o widget no seu site.', kind: 'native', scope: 'account', routeSegment: 'widgets' },
    { key: 'conversations', label: 'Conversas Web', description: 'Conversas recebidas pelo chat do site.', kind: 'native', scope: 'account', routeSegment: 'conversations' },
  ],
  sidebar: { pinnable: true, defaultSurfaceKey: 'overview' },
  status: 'published',
  dataAccess: ['Mensagens trocadas no chat do seu site'],
  storageNote: 'As conversas e mensagens ficam nesta conta, associadas ao widget que as recebeu.',
  disconnectNote: 'Desativar interrompe novas conversas. Widgets, conversas e mensagens são preservados.',
}
