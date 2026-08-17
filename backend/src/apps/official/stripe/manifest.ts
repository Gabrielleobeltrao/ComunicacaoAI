import type { AppDefinition } from '../../types.js'
import { native, num, schema, str } from '../shared.js'

export const manifest: AppDefinition = {
  key: 'stripe',
  version: '1.0.0',
  source: 'system',
  name: 'Stripe',
  description: 'Gerar link de pagamento (Stripe Checkout) para o cliente pagar.',
  icon: 'stripe',
  categories: ['pagamentos'],
  documentationUrl: 'https://dashboard.stripe.com/apikeys',
  auth: {
    kind: 'api_key',
    fields: [{ key: 'secretKey', label: 'Secret Key', placeholder: 'sk_live_... ou sk_test_...', required: true, secret: true }],
  },
  allowedDomains: ['api.stripe.com'],
  supportsMultipleConnections: true,
  actions: [
    {
      key: 'stripe_criar_link_pagamento',
      name: 'Criar link de pagamento',
      description: 'Cria uma sessão de Checkout do Stripe e retorna a URL de pagamento.',
      risk: 'write',
      inputSchema: schema({ titulo: str('descrição da cobrança'), preco: num('valor em reais'), quantidade: num('quantidade (padrão 1)') }, [
        'titulo',
        'preco',
      ]),
      execution: native('stripe_criar_link_pagamento'),
      resourceFields: [{ key: 'successUrl', label: 'URL de sucesso', placeholder: 'https://seusite.com/obrigado', required: false }],
    },
  ],
  status: 'published',
  dataAccess: ['Cria sessões de checkout na sua conta Stripe.'],
  storageNote: 'A secret key fica criptografada e nunca é reexibida.',
  disconnectNote: 'Sessões de checkout já criadas continuam válidas no Stripe.',
  providerCostNote: 'As taxas da cobrança são do Stripe; esta plataforma não intermedia o pagamento.',
}
