import type { AppDefinition } from '../../types.js'
import { native, schema, str } from '../shared.js'

export const manifest: AppDefinition = {
  key: 'slack',
  version: '1.0.0',
  source: 'system',
  name: 'Slack',
  description: 'Avisar um canal do Slack (ex: lead novo, pedido de atendimento humano).',
  icon: 'slack',
  categories: ['comunicação'],
  documentationUrl: 'https://api.slack.com/messaging/webhooks',
  auth: {
    kind: 'webhook',
    fields: [
      {
        key: 'webhookUrl',
        label: 'Incoming Webhook URL',
        placeholder: 'https://hooks.slack.com/services/...',
        required: true,
        secret: true,
        help: 'Em api.slack.com/apps → Incoming Webhooks → Add New Webhook to Workspace.',
      },
    ],
  },
  allowedDomains: ['hooks.slack.com'],
  supportsMultipleConnections: true,
  actions: [
    {
      key: 'slack_notificar',
      name: 'Notificar canal',
      description: 'Envia uma mensagem para o canal do Slack configurado.',
      risk: 'write',
      inputSchema: schema({ mensagem: str('texto da mensagem') }, ['mensagem']),
      execution: native('slack_notificar'),
    },
  ],
  status: 'published',
  dataAccess: ['Nada é lido do Slack; o App apenas envia mensagens.'],
  storageNote: 'A URL do webhook fica criptografada e nunca é reexibida.',
  disconnectNote: 'Desconectar interrompe os avisos. As mensagens já enviadas permanecem no Slack.',
}
