import type { ResolvedTool } from './agentTools.js'

// These built-in apps carry their credential in the agent's per-app config (a
// webhook URL / API token), so they don't need an account connection.

const str = (description: string) => ({ type: 'string', description })
const num = (description: string) => ({ type: 'number', description })
const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
})

export function slackTools(_ownerId: string, config: Record<string, string>): ResolvedTool[] {
  const webhookUrl = config.webhookUrl?.trim() || ''
  if (!webhookUrl) return []
  return [
    {
      name: 'slack_notificar',
      description:
        'Envia uma mensagem para o canal do Slack configurado — use para avisar a equipe (ex: lead novo, cliente quer falar com humano).',
      inputSchema: objectSchema({ mensagem: str('texto da mensagem') }, ['mensagem']),
      run: async (args) => {
        if (!/^https:\/\/hooks\.slack\.com\//.test(webhookUrl)) {
          return { ok: false, result: 'Webhook do Slack inválido (deve ser hooks.slack.com).' }
        }
        try {
          const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: String(args.mensagem ?? '') }),
          })
          const text = (await res.text()).slice(0, 500)
          return res.ok ? { ok: true, result: 'Mensagem enviada.' } : { ok: false, result: `Slack ${res.status}: ${text}` }
        } catch (error) {
          return { ok: false, result: `Falha ao enviar no Slack: ${(error as Error).message}` }
        }
      },
    },
  ]
}

export function mercadoPagoTools(_ownerId: string, config: Record<string, string>): ResolvedTool[] {
  const token = config.accessToken?.trim() || ''
  if (!token) return []
  return [
    {
      name: 'mercadopago_criar_link_pagamento',
      description: 'Cria um link de pagamento (checkout Mercado Pago) e retorna a URL para o cliente pagar.',
      inputSchema: objectSchema(
        {
          titulo: str('descrição do que está sendo cobrado'),
          preco: num('valor em reais'),
          quantidade: num('quantidade (padrão 1)'),
        },
        ['titulo', 'preco'],
      ),
      run: async (args) => {
        try {
          const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [
                {
                  title: String(args.titulo ?? ''),
                  quantity: Number(args.quantidade) || 1,
                  unit_price: Number(args.preco) || 0,
                  currency_id: 'BRL',
                },
              ],
            }),
          })
          const text = (await res.text()).slice(0, 2000)
          if (!res.ok) return { ok: false, result: `Mercado Pago ${res.status}: ${text}` }
          const data = JSON.parse(text) as { init_point?: string }
          return { ok: true, result: `Link de pagamento: ${data.init_point ?? '(sem link retornado)'}` }
        } catch (error) {
          return { ok: false, result: `Falha no Mercado Pago: ${(error as Error).message}` }
        }
      },
    },
  ]
}

export function hubspotTools(_ownerId: string, config: Record<string, string>): ResolvedTool[] {
  const token = config.token?.trim() || ''
  if (!token) return []
  return [
    {
      name: 'hubspot_registrar_contato',
      description: 'Cria ou atualiza um contato/lead no HubSpot CRM com e-mail, nome e telefone.',
      inputSchema: objectSchema(
        { email: str('e-mail (identifica o contato)'), nome: str('nome'), telefone: str('telefone') },
        ['email'],
      ),
      run: async (args) => {
        const properties: Record<string, string> = { email: String(args.email ?? '') }
        if (args.nome) properties.firstname = String(args.nome)
        if (args.telefone) properties.phone = String(args.telefone)
        try {
          const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ properties }),
          })
          const text = (await res.text()).slice(0, 2000)
          return res.ok
            ? { ok: true, result: 'Contato registrado no HubSpot.' }
            : { ok: false, result: `HubSpot ${res.status}: ${text}` }
        } catch (error) {
          return { ok: false, result: `Falha no HubSpot: ${(error as Error).message}` }
        }
      },
    },
  ]
}

export function stripeTools(_ownerId: string, config: Record<string, string>): ResolvedTool[] {
  const secretKey = config.secretKey?.trim() || ''
  if (!secretKey) return []
  const successUrl = config.successUrl?.trim() || 'https://example.com/obrigado'
  return [
    {
      name: 'stripe_criar_link_pagamento',
      description: 'Cria um link de pagamento (Stripe Checkout) e retorna a URL para o cliente pagar.',
      inputSchema: objectSchema(
        { titulo: str('descrição do que está sendo cobrado'), preco: num('valor em reais'), quantidade: num('quantidade (padrão 1)') },
        ['titulo', 'preco'],
      ),
      run: async (args) => {
        const body = new URLSearchParams()
        body.set('mode', 'payment')
        body.set('success_url', successUrl)
        body.set('line_items[0][price_data][currency]', 'brl')
        body.set('line_items[0][price_data][product_data][name]', String(args.titulo ?? ''))
        body.set('line_items[0][price_data][unit_amount]', String(Math.round((Number(args.preco) || 0) * 100)))
        body.set('line_items[0][quantity]', String(Number(args.quantidade) || 1))
        try {
          const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
          })
          const text = (await res.text()).slice(0, 2000)
          if (!res.ok) return { ok: false, result: `Stripe ${res.status}: ${text}` }
          const data = JSON.parse(text) as { url?: string }
          return { ok: true, result: `Link de pagamento: ${data.url ?? '(sem link retornado)'}` }
        } catch (error) {
          return { ok: false, result: `Falha no Stripe: ${(error as Error).message}` }
        }
      },
    },
  ]
}

export function nuvemshopTools(_ownerId: string, config: Record<string, string>): ResolvedTool[] {
  const storeId = config.storeId?.trim() || ''
  const token = config.accessToken?.trim() || ''
  if (!storeId || !token) return []
  return [
    {
      name: 'nuvemshop_status_pedido',
      description: 'Consulta um pedido na Nuvemshop pelo número e retorna seus dados (status, itens, envio).',
      inputSchema: objectSchema({ numero_pedido: str('número do pedido') }, ['numero_pedido']),
      run: async (args) => {
        try {
          const res = await fetch(
            `https://api.nuvemshop.com.br/v1/${encodeURIComponent(storeId)}/orders?q=${encodeURIComponent(String(args.numero_pedido ?? ''))}`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': 'ComunicacaoAI (contato@comunicacaoai.app)',
              },
            },
          )
          const text = (await res.text()).slice(0, 3000)
          return res.ok ? { ok: true, result: text || '[]' } : { ok: false, result: `Nuvemshop ${res.status}: ${text}` }
        } catch (error) {
          return { ok: false, result: `Falha na Nuvemshop: ${(error as Error).message}` }
        }
      },
    },
  ]
}

export function rdStationTools(_ownerId: string, config: Record<string, string>): ResolvedTool[] {
  const token = config.token?.trim() || ''
  if (!token) return []
  return [
    {
      name: 'rdstation_registrar_contato',
      description: 'Registra um contato/lead no RD Station CRM com nome, e-mail e telefone.',
      inputSchema: objectSchema(
        { nome: str('nome do contato'), email: str('e-mail'), telefone: str('telefone') },
        ['nome'],
      ),
      run: async (args) => {
        const contact: { name: string; emails?: { email: string }[]; phones?: { phone: string }[] } = {
          name: String(args.nome ?? ''),
        }
        if (args.email) contact.emails = [{ email: String(args.email) }]
        if (args.telefone) contact.phones = [{ phone: String(args.telefone) }]
        try {
          const res = await fetch(`https://crm.rdstation.com/api/v1/contacts?token=${encodeURIComponent(token)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact }),
          })
          const text = (await res.text()).slice(0, 2000)
          return res.ok
            ? { ok: true, result: 'Contato registrado no RD Station.' }
            : { ok: false, result: `RD Station ${res.status}: ${text}` }
        } catch (error) {
          return { ok: false, result: `Falha no RD Station: ${(error as Error).message}` }
        }
      },
    },
  ]
}
