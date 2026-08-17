import type { AppDefinition } from '../../types.js'

export const manifest: AppDefinition = {
  key: 'telegram',
  version: '1.0.0',
  source: 'system',
  name: 'Telegram',
  description: 'Enviar mensagens pelas rotinas usando um bot do Telegram.',
  icon: 'telegram',
  categories: ['comunicação'],
  documentationUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
  auth: { kind: 'api_key', fields: [{ key: 'botToken', label: 'Token do bot', required: true, secret: true }] },
  allowedDomains: ['api.telegram.org'],
  supportsMultipleConnections: true,
  actions: [],
  status: 'published',
  dataAccess: ['Envia mensagens pelo seu bot.'],
  storageNote: 'O token do bot fica criptografado e nunca é reexibido.',
  disconnectNote: 'Rotinas que entregam por este bot param de enviar. O histórico de entregas é preservado.',
}
