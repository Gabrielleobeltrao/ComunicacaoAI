import type { AppDefinition } from '../../types.js'
import { native, schema, str } from '../shared.js'

export const manifest: AppDefinition = {
  key: 'rdstation',
  version: '1.0.0',
  source: 'system',
  name: 'RD Station CRM',
  description: 'Registrar leads e contatos no RD Station CRM.',
  icon: 'rdstation',
  categories: ['crm'],
  documentationUrl: 'https://developers.rdstation.com/reference/token-de-autenticacao-crm',
  auth: { kind: 'api_key', fields: [{ key: 'token', label: 'Token do RD Station CRM', required: true, secret: true }] },
  allowedDomains: ['crm.rdstation.com'],
  supportsMultipleConnections: true,
  actions: [
    {
      key: 'rdstation_registrar_contato',
      name: 'Registrar contato',
      description: 'Cria um contato/lead no RD Station CRM.',
      risk: 'write',
      inputSchema: schema({ nome: str('nome'), email: str('e-mail'), telefone: str('telefone') }, ['nome']),
      execution: native('rdstation_registrar_contato'),
    },
  ],
  status: 'published',
  dataAccess: ['Cria contatos no seu RD Station CRM.'],
  storageNote: 'O token fica criptografado e nunca é reexibido.',
  disconnectNote: 'Contatos já registrados permanecem no RD Station.',
}
