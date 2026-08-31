import { createHmac, timingSafeEqual } from 'node:crypto'
import type { WithId } from 'mongodb'
import { decrypt } from './crypto.js'
import { safeFetch } from './net/safeHttp.js'
import type { Widget } from './widgets.js'

// A WhatsApp channel connects a phone number (through some provider) to an
// agent/team. Each provider ships an adapter that normalizes inbound webhooks
// and knows how to send a reply. The rest of the system stays provider-agnostic.

// A piece of media on an inbound message, with the provider-specific handle
// needed to download it (Meta: an id; Twilio: a URL; Evolution: inline base64).
export interface InboundMediaRef {
  kind: 'image' | 'audio' | 'video' | 'document' | 'sticker'
  mimeType?: string
  mediaId?: string
  url?: string
  base64?: string
  filename?: string
}

export interface InboundMessage {
  from: string // customer phone number, digits only (also used as conversationId)
  text: string // the caption for a media message (may be empty)
  externalId: string // provider message id, for idempotent webhook handling
  senderName?: string
  media?: InboundMediaRef
}

const MIME_KIND: [string, InboundMediaRef['kind']][] = [
  ['image/', 'image'],
  ['audio/', 'audio'],
  ['video/', 'video'],
]
function kindFromMime(mime: string | undefined): InboundMediaRef['kind'] {
  const found = MIME_KIND.find(([prefix]) => (mime ?? '').startsWith(prefix))
  return found ? found[1] : 'document'
}

export interface WhatsAppConfigField {
  key: string
  label: string
  placeholder?: string
  required: boolean
  type?: 'text' | 'password'
}

/** Tudo o que uma conferência de origem pode precisar — e nada além. */
export interface InboundAuthContext {
  /** O corpo EXATO recebido, para o HMAC bater byte a byte. */
  rawBody?: Buffer
  headers: Record<string, string | undefined>
  /** A URL pública desta entrega, como o provedor a chamou. Twilio assina isto. */
  url: string
  /** Os parâmetros do formulário, quando o provedor posta `x-www-form-urlencoded`. */
  params: Record<string, unknown>
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
  // GET verification handshake (Meta): return the challenge to echo, or null to
  // reject. Providers without a handshake (Evolution/Twilio) omit this.
  verifyChallenge?: (config: Record<string, string>, query: Record<string, string>) => string | null
  /**
   * A prova de que a entrega veio MESMO do provedor.
   *
   * Obrigatória em todos os adaptadores: o endereço do webhook é público, e sem prova
   * de origem qualquer um cria conversa, faz o servidor baixar mídia e gasta o modelo
   * na conta do dono. Cada provedor prova de um jeito — assinatura HMAC (Meta),
   * assinatura sobre URL+parâmetros (Twilio) ou segredo combinado (Evolution) —, e
   * `false` derruba a entrega antes de qualquer efeito.
   */
  authenticateInbound: (config: Record<string, string>, ctx: InboundAuthContext) => boolean
  // Parse a raw webhook body into zero or more inbound customer messages.
  parseInbound: (payload: unknown) => InboundMessage[]
  // Download the bytes for an inbound media reference (provider-specific auth).
  fetchMedia?: (
    config: Record<string, string>,
    ref: InboundMediaRef,
  ) => Promise<{ bytes: Buffer; mimeType: string } | null>
  // Send a plain-text reply to a customer number.
  sendText: (config: Record<string, string>, to: string, text: string) => Promise<{ ok: boolean; error?: string }>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/**
 * Os limites de um download de mídia.
 *
 * Um webhook diz "tem uma imagem em tal endereço" e o servidor vai buscar. Sem teto,
 * sem prazo e sem lista de tipos, esse endereço é um jeito de fazer o servidor baixar
 * o que o outro lado quiser, pelo tempo que ele quiser.
 */
const MEDIA_LIMITES = {
  timeoutMs: 15_000,
  maxBytes: 12 * 1024 * 1024,
  contentTypeAllowlist: ['image/', 'application/pdf', 'text/', 'application/octet-stream', 'audio/', 'video/'],
}

/** De onde a mídia de cada provedor PODE vir. Fora daqui não há download nem credencial. */
const HOSTS_TWILIO = ['twilio.com', 'twiliocdn.com']
const HOSTS_META = ['facebook.com', 'fbcdn.net', 'whatsapp.net']

/** O segredo comparado sem vazar o tempo da comparação. */
function segredoConfere(esperado: string, recebido: string): boolean {
  const a = Buffer.from(esperado)
  const b = Buffer.from(recebido)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
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
    {
      key: 'webhookSecret',
      label: 'Segredo do webhook',
      placeholder: 'invente um segredo e configure na sua instância',
      required: true,
      type: 'password',
    },
  ],
  webhookNote:
    'Cole o URL acima como webhook (evento messages.upsert) na sua instância e envie o segredo acima no cabeçalho "x-webhook-secret" (ou assine o corpo em "x-hub-signature-256").',
  /**
   * Evolution e Z-API não assinam nada por conta própria.
   *
   * Sem uma prova de origem, o endereço do webhook é público e QUALQUER um pode
   * inventar uma mensagem em nome de um cliente — e ela viraria conversa, download de
   * mídia e chamada ao modelo, tudo na conta do dono. O segredo é dele e viaja em
   * cabeçalho; quem preferir assinar o corpo usa o mesmo HMAC do Meta.
   */
  authenticateInbound(config, { rawBody, headers }) {
    const signature = headers['x-hub-signature-256']
    const secret = config.webhookSecret?.trim()
    // Sem segredo configurado o canal não recebe nada. Aberto por padrão era o buraco.
    if (!secret) return false
    const enviado = String(headers?.['x-webhook-secret'] ?? '').trim()
    if (enviado) return segredoConfere(secret, enviado)
    if (signature && rawBody) {
      const esperado = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
      return segredoConfere(esperado, signature)
    }
    return false
  },
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
      const from = remote.split('@')[0]
      const externalId = String(key.id ?? '')
      const senderName = typeof d.pushName === 'string' ? d.pushName : undefined

      const extended = asRecord(message.extendedTextMessage)
      const text = (message.conversation as string) ?? (extended.text as string) ?? ''
      if (text) {
        out.push({ from, text: String(text), externalId, senderName })
        continue
      }

      // Media message: Evolution includes the bytes inline as base64 when the
      // instance has webhook base64 enabled.
      const mediaKeys: [string, InboundMediaRef['kind']][] = [
        ['imageMessage', 'image'],
        ['audioMessage', 'audio'],
        ['videoMessage', 'video'],
        ['documentMessage', 'document'],
        ['stickerMessage', 'sticker'],
      ]
      const hit = mediaKeys.find(([mk]) => message[mk])
      if (hit) {
        const mm = asRecord(message[hit[0]])
        const base64 =
          (typeof message.base64 === 'string' && message.base64) ||
          (typeof mm.base64 === 'string' ? mm.base64 : undefined)
        out.push({
          from,
          externalId,
          senderName,
          text: String(mm.caption ?? ''),
          media: {
            kind: hit[1],
            mimeType: typeof mm.mimetype === 'string' ? mm.mimetype : undefined,
            filename: typeof mm.fileName === 'string' ? mm.fileName : undefined,
            base64: base64 || undefined,
          },
        })
      }
    }
    return out
  },
  async fetchMedia(_config, ref) {
    if (!ref.base64) return null
    try {
      return { bytes: Buffer.from(ref.base64, 'base64'), mimeType: ref.mimeType || 'application/octet-stream' }
    } catch {
      return null
    }
  },
  async sendText(config, to, text) {
    const base = (config.baseUrl ?? '').replace(/\/+$/, '')
    const instance = config.instance ?? ''
    if (!base || !instance) return { ok: false, error: 'Configuração incompleta (baseUrl/instance).' }
    try {
      // A URL da instância é digitada pelo dono: é endereço escolhido por usuário, e
      // por isso sai pela camada com SSRF conferido — não por `fetch` direto.
      const res = await safeFetch(`${base}/message/sendText/${encodeURIComponent(instance)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: config.apiKey ?? '' },
        body: JSON.stringify({ number: to, text }),
        timeoutMs: 15_000,
        maxBytes: 64 * 1024,
      })
      // A resposta do outro lado não é ecoada: ela pode conter o que ele quiser.
      return res.status >= 200 && res.status <= 299 ? { ok: true } : { ok: false, error: `Evolution respondeu ${res.status}.` }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  },
}

// --- Meta WhatsApp Cloud API (official) -----------------------------------
const META_VERSION = 'v21.0'
const meta: WhatsAppAdapter = {
  key: 'meta',
  label: 'Meta Cloud API (oficial)',
  description:
    'API oficial da Meta (WhatsApp Business Platform). Exige um número verificado e um app na Meta, mas é a opção oficial e escalável.',
  available: true,
  fields: [
    { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: 'do painel da Meta', required: true },
    { key: 'accessToken', label: 'Access Token', required: true, type: 'password' },
    {
      key: 'verifyToken',
      label: 'Verify Token',
      placeholder: 'invente um segredo e repita na Meta',
      required: true,
      type: 'password',
    },
    { key: 'appSecret', label: 'App Secret', required: true, type: 'password' },
  ],
  webhookNote: 'Na Meta, use este URL como Callback URL e o mesmo Verify Token acima; assine o campo "messages".',
  verifyChallenge(config, query) {
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === (config.verifyToken ?? '')) {
      return query['hub.challenge'] ?? ''
    }
    return null
  },
  authenticateInbound(config, { rawBody, headers }) {
    const signature = headers['x-hub-signature-256']
    const secret = config.appSecret?.trim()
    // Sem segredo, NADA passa. Antes isto era "pular a conferência" — e um canal sem
    // App Secret aceitava qualquer entrega forjada como se fosse da Meta.
    if (!secret || !rawBody || !signature) return false
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
    return segredoConfere(expected, signature)
  },
  parseInbound(payload) {
    const body = asRecord(payload)
    const out: InboundMessage[] = []
    const entries = Array.isArray(body.entry) ? body.entry : []
    for (const entry of entries) {
      const changes = Array.isArray(asRecord(entry).changes) ? (asRecord(entry).changes as unknown[]) : []
      for (const change of changes) {
        const value = asRecord(asRecord(change).value)
        const nameByWaId = new Map<string, string>()
        for (const c of Array.isArray(value.contacts) ? value.contacts : []) {
          const contact = asRecord(c)
          const profile = asRecord(contact.profile)
          if (contact.wa_id && profile.name) nameByWaId.set(String(contact.wa_id), String(profile.name))
        }
        for (const m of Array.isArray(value.messages) ? value.messages : []) {
          const msg = asRecord(m)
          const from = String(msg.from ?? '')
          const externalId = String(msg.id ?? '')
          const senderName = nameByWaId.get(from) || undefined
          const type = String(msg.type ?? '')

          if (type === 'text') {
            const text = asRecord(msg.text).body
            if (text) out.push({ from, text: String(text), externalId, senderName })
          } else if (['image', 'audio', 'video', 'document', 'sticker'].includes(type)) {
            const mediaObj = asRecord(msg[type])
            out.push({
              from,
              externalId,
              senderName,
              text: String(mediaObj.caption ?? ''),
              media: {
                kind: type as InboundMediaRef['kind'],
                mediaId: String(mediaObj.id ?? ''),
                mimeType: typeof mediaObj.mime_type === 'string' ? mediaObj.mime_type : undefined,
                filename: typeof mediaObj.filename === 'string' ? mediaObj.filename : undefined,
              },
            })
          }
        }
      }
    }
    return out
  },
  async fetchMedia(config, ref) {
    if (!ref.mediaId) return null
    const token = config.accessToken ?? ''
    try {
      const lookup = await safeFetch(`https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(ref.mediaId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        hostAllowlist: HOSTS_META,
        timeoutMs: 10_000,
        maxBytes: 64 * 1024,
        requireOk: true,
      })
      const meta = JSON.parse(lookup.body) as { url?: string; mime_type?: string }
      if (!meta.url) return null
      /**
       * O ENDEREÇO veio de uma resposta de fora — mesmo sendo a Meta.
       *
       * O token do dono só viaja para host oficial: se a resposta trouxer outro
       * destino, o download nem começa, e a credencial não vai junto.
       */
      const bin = await safeFetch(meta.url, {
        headers: { Authorization: `Bearer ${token}` },
        hostAllowlist: HOSTS_META,
        asBytes: true,
        requireOk: true,
        ...MEDIA_LIMITES,
      })
      return { bytes: bin.bytes ?? Buffer.alloc(0), mimeType: meta.mime_type || ref.mimeType || 'application/octet-stream' }
    } catch {
      return null
    }
  },
  async sendText(config, to, text) {
    const phoneNumberId = config.phoneNumberId ?? ''
    if (!phoneNumberId) return { ok: false, error: 'Configuração incompleta (phoneNumberId).' }
    try {
      const res = await safeFetch(`https://graph.facebook.com/${META_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.accessToken ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
        hostAllowlist: HOSTS_META,
        timeoutMs: 15_000,
        maxBytes: 64 * 1024,
      })
      // O corpo da resposta não volta para a tela: ele pode repetir o número, o texto
      // enviado e o identificador da conta.
      return res.status >= 200 && res.status <= 299 ? { ok: true } : { ok: false, error: `Meta respondeu ${res.status}.` }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  },
}

// --- Twilio (official BSP) -------------------------------------------------
const twilio: WhatsAppAdapter = {
  key: 'twilio',
  label: 'Twilio (oficial)',
  description: 'WhatsApp oficial através da Twilio. Setup rápido (tem sandbox para testar), pago por mensagem.',
  available: true,
  fields: [
    { key: 'accountSid', label: 'Account SID', placeholder: 'AC...', required: true },
    { key: 'authToken', label: 'Auth Token', required: true, type: 'password' },
    { key: 'fromNumber', label: 'Número do WhatsApp', placeholder: '+14155238886', required: true },
  ],
  webhookNote: 'No Twilio, aponte "When a message comes in" (método POST) para este URL.',
  /**
   * A assinatura da Twilio é sobre a URL EXATA mais os parâmetros do formulário.
   *
   * Concatena-se a URL pública com cada par chave+valor em ordem alfabética e assina-se
   * tudo com o Auth Token da conta. É por isso que a URL pública precisa estar certa:
   * assinar outra coisa dá outro resultado, e a entrega legítima seria recusada.
   */
  authenticateInbound(config, { headers, url, params }) {
    const token = config.authToken?.trim()
    const assinatura = String(headers['x-twilio-signature'] ?? '')
    if (!token || !assinatura) return false
    const dados = Object.keys(params)
      .sort()
      .reduce((acc, chave) => acc + chave + String(params[chave] ?? ''), url)
    const esperado = createHmac('sha1', token).update(Buffer.from(dados, 'utf8')).digest('base64')
    return segredoConfere(esperado, assinatura)
  },
  parseInbound(payload) {
    // Twilio posts application/x-www-form-urlencoded (parsed by express.urlencoded).
    const body = asRecord(payload)
    const from = String(body.From ?? '')
      .replace(/^whatsapp:/, '')
      .replace(/^\+/, '')
    if (!from) return []
    const text = String(body.Body ?? '')
    const externalId = String(body.MessageSid ?? body.SmsMessageSid ?? '')
    const senderName = typeof body.ProfileName === 'string' ? body.ProfileName : undefined

    if (Number(body.NumMedia ?? 0) > 0 && body.MediaUrl0) {
      const mimeType = typeof body.MediaContentType0 === 'string' ? body.MediaContentType0 : undefined
      return [
        {
          from,
          externalId,
          senderName,
          text,
          media: { kind: kindFromMime(mimeType), url: String(body.MediaUrl0), mimeType },
        },
      ]
    }
    if (!text) return []
    return [{ from, text, externalId, senderName }]
  },
  async fetchMedia(config, ref) {
    if (!ref.url) return null
    try {
      /**
       * O endereço vem DENTRO do webhook.
       *
       * Mesmo com a assinatura conferida, ele não é lugar para mandar a credencial da
       * conta: a lista de hosts oficiais é o que garante que o `Basic` do dono só sai
       * para a Twilio. Fora dela não há download — e não há credencial.
       */
      const res = await safeFetch(ref.url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.accountSid ?? ''}:${config.authToken ?? ''}`).toString('base64')}`,
        },
        hostAllowlist: HOSTS_TWILIO,
        asBytes: true,
        requireOk: true,
        ...MEDIA_LIMITES,
      })
      return { bytes: res.bytes ?? Buffer.alloc(0), mimeType: res.contentType || ref.mimeType || 'application/octet-stream' }
    } catch {
      return null
    }
  },
  async sendText(config, to, text) {
    const sid = config.accountSid ?? ''
    const token = config.authToken ?? ''
    const from = config.fromNumber ?? ''
    if (!sid || !from) return { ok: false, error: 'Configuração incompleta (accountSid/fromNumber).' }
    const withPrefix = (n: string) => (n.startsWith('whatsapp:') ? n : `whatsapp:${n.startsWith('+') ? n : `+${n}`}`)
    const body = new URLSearchParams()
    body.set('From', withPrefix(from))
    body.set('To', withPrefix(to))
    body.set('Body', text)
    try {
      const res = await safeFetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        hostAllowlist: HOSTS_TWILIO,
        timeoutMs: 15_000,
        maxBytes: 64 * 1024,
      })
      return res.status >= 200 && res.status <= 299 ? { ok: true } : { ok: false, error: `Twilio respondeu ${res.status}.` }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  },
}

const ADAPTERS: WhatsAppAdapter[] = [evolution, meta, twilio]

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

// Decrypt a channel's stored provider config, or null if missing/corrupt.
function channelConfig(widget: WithId<Widget>): Record<string, string> | null {
  const wa = widget.whatsapp
  if (!wa) return null
  try {
    return JSON.parse(decrypt(wa.configEnc)) as Record<string, string>
  } catch {
    return null
  }
}

// Send an outbound reply on a WhatsApp-channel widget. Never throws.
export async function sendWhatsAppText(
  widget: WithId<Widget>,
  to: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const wa = widget.whatsapp
  if (!wa) return { ok: false, error: 'Widget não é um canal de WhatsApp.' }
  const adapter = getWhatsAppAdapter(wa.provider)
  if (!adapter || !adapter.available) return { ok: false, error: 'Provedor de WhatsApp indisponível.' }
  const config = channelConfig(widget)
  if (!config) return { ok: false, error: 'Configuração do canal corrompida.' }
  return adapter.sendText(config, to, text)
}

// Download an inbound media reference for a channel, decrypting its config.
export async function fetchWhatsAppMedia(
  widget: WithId<Widget>,
  ref: InboundMediaRef,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const adapter = widget.whatsapp && getWhatsAppAdapter(widget.whatsapp.provider)
  if (!adapter?.fetchMedia) return null
  const config = channelConfig(widget)
  if (!config) return null
  return adapter.fetchMedia(config, ref)
}

// GET webhook verification (Meta). Returns the challenge to echo, or null when
// the provider has no handshake or the token doesn't match.
export function verifyWhatsAppChallenge(
  widget: WithId<Widget>,
  query: Record<string, string>,
): string | null {
  const adapter = widget.whatsapp && getWhatsAppAdapter(widget.whatsapp.provider)
  if (!adapter?.verifyChallenge) return null
  const config = channelConfig(widget)
  if (!config) return null
  return adapter.verifyChallenge(config, query)
}

// True if the provider has a challenge handshake (so a failed GET is a real 403,
// not just an Evolution-style ack).
export function whatsAppUsesChallenge(widget: WithId<Widget>): boolean {
  const adapter = widget.whatsapp && getWhatsAppAdapter(widget.whatsapp.provider)
  return Boolean(adapter?.verifyChallenge)
}

/**
 * A entrega é autêntica?
 *
 * Fecha por padrão: adaptador sem conferência, configuração ilegível ou provedor
 * desconhecido devolvem `false`. Antes o padrão era `true` — e "não sei conferir"
 * valia como "pode entrar".
 */
export function authenticateWhatsAppInbound(widget: WithId<Widget>, ctx: InboundAuthContext): boolean {
  const adapter = widget.whatsapp && getWhatsAppAdapter(widget.whatsapp.provider)
  if (!adapter?.authenticateInbound) return false
  const config = channelConfig(widget)
  if (!config) return false
  try {
    return adapter.authenticateInbound(config, ctx)
  } catch {
    return false
  }
}
