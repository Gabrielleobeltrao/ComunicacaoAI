import type { WithId } from 'mongodb'
import { decrypt } from './crypto.js'
import type { Widget } from './widgets.js'

// A WhatsApp channel connects a phone number (through some provider) to an
// agent/team. Each provider ships an adapter that normalizes inbound webhooks
// and knows how to send a reply. The rest of the system stays provider-agnostic.

export interface InboundMessage {
  from: string // customer phone number, digits only (also used as conversationId)
  text: string
  externalId: string // provider message id, for idempotent webhook handling
  senderName?: string
}

export interface WhatsAppConfigField {
  key: string
  label: string
  placeholder?: string
  required: boolean
  type?: 'text' | 'password'
}

export interface WhatsAppAdapter {
  key: string
  label: string
  description: string
  // false = shown in the catalog as "coming soon" but not connectable yet.
  available: boolean
  fields: WhatsAppConfigField[]
  // How the owner should point their provider's webhook at us.
  webhookNote?: string
  // Parse a raw webhook body into zero or more inbound customer messages.
  parseInbound: (payload: unknown) => InboundMessage[]
  // Send a plain-text reply to a customer number.
  sendText: (config: Record<string, string>, to: string, text: string) => Promise<{ ok: boolean; error?: string }>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

// --- Evolution API / Z-API (unofficial, QR-based) -------------------------
const evolution: WhatsAppAdapter = {
  key: 'evolution',
  label: 'Evolution API / Z-API',
  description:
    'Conecta via sua instância Evolution (ou Z-API), escaneando o QR code no número que você já usa. Rápido de subir, mas é não-oficial.',
  available: true,
  fields: [
    { key: 'baseUrl', label: 'URL da API', placeholder: 'https://sua-evolution.com', required: true },
    { key: 'instance', label: 'Instância', placeholder: 'nome da instância', required: true },
    { key: 'apiKey', label: 'API Key', required: true, type: 'password' },
  ],
  webhookNote: 'Cole o URL acima como webhook (evento messages.upsert) na configuração da sua instância.',
  parseInbound(payload) {
    const body = asRecord(payload)
    const event = body.event
    if (typeof event === 'string' && event !== 'messages.upsert') return []
    const raw = body.data
    const items = Array.isArray(raw) ? raw : [raw]
    const out: InboundMessage[] = []
    for (const item of items) {
      const d = asRecord(item)
      const key = asRecord(d.key)
      if (key.fromMe) continue // our own outgoing message echoed back
      const remote = String(key.remoteJid ?? '')
      if (!remote.endsWith('@s.whatsapp.net')) continue // skip groups/status/broadcast
      const message = asRecord(d.message)
      const extended = asRecord(message.extendedTextMessage)
      const text = (message.conversation as string) ?? (extended.text as string) ?? ''
      if (!text) continue // ignore media-only / unsupported types for now
      out.push({
        from: remote.split('@')[0],
        text: String(text),
        externalId: String(key.id ?? ''),
        senderName: typeof d.pushName === 'string' ? d.pushName : undefined,
      })
    }
    return out
  },
  async sendText(config, to, text) {
    const base = (config.baseUrl ?? '').replace(/\/+$/, '')
    const instance = config.instance ?? ''
    if (!base || !instance) return { ok: false, error: 'Configuração incompleta (baseUrl/instance).' }
    try {
      const res = await fetch(`${base}/message/sendText/${encodeURIComponent(instance)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: config.apiKey ?? '' },
        body: JSON.stringify({ number: to, text }),
      })
      const respBody = (await res.text()).slice(0, 500)
      return res.ok ? { ok: true } : { ok: false, error: `Evolution ${res.status}: ${respBody}` }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  },
}

// Not-yet-implemented adapters, listed so the owner sees the full roadmap in the
// connect UI. They can't be connected until `available` flips to true.
function comingSoon(key: string, label: string, description: string): WhatsAppAdapter {
  return {
    key,
    label,
    description,
    available: false,
    fields: [],
    parseInbound: () => [],
    sendText: async () => ({ ok: false, error: 'Provedor ainda não disponível.' }),
  }
}

const ADAPTERS: WhatsAppAdapter[] = [
  evolution,
  comingSoon(
    'meta',
    'Meta Cloud API (oficial)',
    'API oficial da Meta. Exige número verificado e templates aprovados para mensagens proativas. Em breve.',
  ),
  comingSoon(
    'twilio',
    'Twilio (oficial)',
    'WhatsApp oficial através da Twilio. Pago por mensagem. Em breve.',
  ),
]

export function getWhatsAppAdapter(key: string): WhatsAppAdapter | undefined {
  return ADAPTERS.find((a) => a.key === key)
}

// The catalog the connect UI renders (no executors, no secrets).
export function whatsappProvidersCatalog() {
  return ADAPTERS.map(({ key, label, description, available, fields, webhookNote }) => ({
    key,
    label,
    description,
    available,
    fields,
    webhookNote,
  }))
}

// Send an outbound reply on a WhatsApp-channel widget, decrypting its stored
// provider config on the way. Never throws — returns an ok/error result.
export async function sendWhatsAppText(
  widget: WithId<Widget>,
  to: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const wa = widget.whatsapp
  if (!wa) return { ok: false, error: 'Widget não é um canal de WhatsApp.' }
  const adapter = getWhatsAppAdapter(wa.provider)
  if (!adapter || !adapter.available) return { ok: false, error: 'Provedor de WhatsApp indisponível.' }
  let config: Record<string, string>
  try {
    config = JSON.parse(decrypt(wa.configEnc)) as Record<string, string>
  } catch {
    return { ok: false, error: 'Configuração do canal corrompida.' }
  }
  return adapter.sendText(config, to, text)
}
