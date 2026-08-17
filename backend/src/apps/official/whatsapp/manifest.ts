import type { AppDefinition } from '../../types.js'

export const manifest: AppDefinition = {
  key: 'whatsapp',
  version: '1.0.0',
  source: 'system',
  name: 'WhatsApp',
  description: 'Atendimento no WhatsApp pelo seu provedor: números conectados, roteamento e histórico das conversas.',
  icon: 'whatsapp',
  categories: ['atendimento'],
  // The provider credential is validated by the WhatsApp channel flow, which keeps
  // its own encrypted config and webhook validation.
  auth: { kind: 'api_key', fields: [], documentationUrl: 'https://developers.facebook.com/docs/whatsapp' },
  // The number and the provider credential live on the CHANNEL, in its own encrypted
  // config. A generic form with no declared fields would happily create a "connected"
  // installation with neither — so it is not allowed to.
  activation: 'managed_channel',
  activationRoute: '/apps/whatsapp/channels',
  allowedDomains: [],
  supportsMultipleConnections: true,
  actions: [],
  surfaces: [
    { key: 'overview', label: 'Visão geral', description: 'Status por número, conversas abertas e volume.', kind: 'native', scope: 'account', routeSegment: 'overview' },
    { key: 'channels', label: 'Números', description: 'Conectar provedor, escolher agente ou setor e testar.', kind: 'native', scope: 'account', routeSegment: 'channels' },
    { key: 'conversations', label: 'Conversas WhatsApp', description: 'Conversas recebidas pelos números conectados.', kind: 'native', scope: 'account', routeSegment: 'conversations' },
  ],
  sidebar: { pinnable: true, defaultSurfaceKey: 'overview' },
  status: 'published',
  dataAccess: ['Mensagens trocadas nos números que você conectar'],
  storageNote: 'As credenciais do provedor ficam criptografadas; conversas e mensagens ficam nesta conta.',
  disconnectNote: 'Desconectar um número interrompe novas mensagens. Conversas e histórico são preservados.',
  providerCostNote: 'As tarifas de mensagem são cobradas pelo seu provedor de WhatsApp, não por esta plataforma.',
}
