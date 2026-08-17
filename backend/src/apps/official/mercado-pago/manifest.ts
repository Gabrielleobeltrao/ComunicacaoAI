import type { AppDefinition } from '../../types.js'
import { native, num, schema, str } from '../shared.js'

export const manifest: AppDefinition = {
  key: 'mercadopago',
  version: '1.0.0',
  source: 'system',
  name: 'Mercado Pago',
  description: 'Gerar link de pagamento (checkout) para o cliente pagar.',
  icon: 'mercadopago',
  categories: ['pagamentos'],
  documentationUrl:
    'https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/your-integrations/credentials',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'accessToken', label: 'Access Token', placeholder: 'APP_USR-...', required: true, secret: true }],
  },
  allowedDomains: ['api.mercadopago.com'],
  supportsMultipleConnections: true,
  actions: [
    {
      key: 'mercadopago_criar_link_pagamento',
      name: 'Criar link de pagamento',
      description: 'Cria um link de pagamento e retorna a URL para o cliente pagar.',
      risk: 'write',
      inputSchema: schema({ titulo: str('descrição da cobrança'), preco: num('valor em reais'), quantidade: num('quantidade (padrão 1)') }, [
        'titulo',
        'preco',
      ]),
      execution: native('mercadopago_criar_link_pagamento'),
    },
  ],
  status: 'published',
  dataAccess: ['Cria preferências de checkout na sua conta Mercado Pago.'],
  storageNote: 'O access token fica criptografado e nunca é reexibido.',
  disconnectNote: 'Links de pagamento já criados continuam válidos no Mercado Pago.',
  providerCostNote: 'As taxas da cobrança são do Mercado Pago; esta plataforma não intermedia o pagamento.',
}
