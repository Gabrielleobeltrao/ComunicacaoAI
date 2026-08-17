import type { AppDefinition } from '../../types.js'
import { native, schema, str } from '../shared.js'

export const manifest: AppDefinition = {
  key: 'nuvemshop',
  version: '1.0.0',
  source: 'system',
  name: 'Nuvemshop',
  description: 'Consultar status de pedidos na sua loja Nuvemshop.',
  icon: 'nuvemshop',
  categories: ['e-commerce'],
  documentationUrl: 'https://tiendanube.github.io/api-documentation/authentication',
  auth: {
    kind: 'bearer',
    fields: [
      { key: 'storeId', label: 'ID da loja', placeholder: 'ex: 1234567', required: true, secret: false },
      { key: 'accessToken', label: 'Access Token', required: true, secret: true },
    ],
  },
  allowedDomains: ['api.nuvemshop.com.br'],
  supportsMultipleConnections: true,
  actions: [
    {
      key: 'nuvemshop_status_pedido',
      name: 'Status do pedido',
      description: 'Consulta o status de um pedido pelo número.',
      risk: 'read',
      inputSchema: schema({ numero_pedido: str('número do pedido') }, ['numero_pedido']),
      execution: native('nuvemshop_status_pedido'),
    },
  ],
  status: 'published',
  dataAccess: ['Lê pedidos da sua loja Nuvemshop.'],
  storageNote: 'O access token fica criptografado e nunca é reexibido.',
  disconnectNote: 'Nada é alterado na loja ao desconectar.',
}
