import type { AppDefinition } from '../../types.js'
import { native, schema, str } from '../shared.js'

export const manifest: AppDefinition = {
  key: 'hubspot',
  version: '1.0.0',
  source: 'system',
  name: 'HubSpot',
  description: 'Registrar leads e contatos no HubSpot CRM.',
  icon: 'hubspot',
  categories: ['crm'],
  documentationUrl: 'https://developers.hubspot.com/docs/api/private-apps',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'token', label: 'Private App Token', placeholder: 'pat-na1-...', required: true, secret: true }],
  },
  allowedDomains: ['api.hubapi.com'],
  supportsMultipleConnections: true,
  actions: [
    {
      key: 'hubspot_registrar_contato',
      name: 'Registrar contato',
      description: 'Cria ou atualiza um contato/lead no HubSpot CRM.',
      risk: 'write',
      inputSchema: schema({ email: str('e-mail (identifica o contato)'), nome: str('nome'), telefone: str('telefone') }, ['email']),
      execution: native('hubspot_registrar_contato'),
    },
  ],
  status: 'published',
  dataAccess: ['Cria e atualiza contatos no seu HubSpot.'],
  storageNote: 'O token fica criptografado e nunca é reexibido.',
  disconnectNote: 'Contatos já registrados permanecem no HubSpot.',
}
