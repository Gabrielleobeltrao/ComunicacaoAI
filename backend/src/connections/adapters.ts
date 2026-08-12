import nodemailer from 'nodemailer'
import type { EmailConfig, TelegramConfig } from './types.js'

// Delivery adapters. IO is injectable (transport factory / fetch) so tests never
// send real messages; the pure helpers (mask, chunk) are unit-tested. Tokens are
// never logged or returned (plan §12/§17.1).

export function maskDestination(dest: string): string {
  if (dest.includes('@')) {
    const [user, domain] = dest.split('@')
    return `${user.slice(0, 2)}***@${domain}`
  }
  return dest.length <= 4 ? '***' : `${dest.slice(0, 2)}***${dest.slice(-2)}`
}

// Telegram caps messages at 4096 chars; split deterministically.
export function chunkTelegram(text: string, max = 4096): string[] {
  if (text.length <= max) return [text]
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += max) chunks.push(text.slice(i, i + max))
  return chunks
}

export interface MailTransport {
  sendMail: (opts: { from: string; to: string; subject: string; text: string }) => Promise<{ messageId?: string }>
}

export async function sendEmail(
  config: EmailConfig,
  msg: { to: string; subject: string; text: string },
  factory?: (c: EmailConfig) => MailTransport,
): Promise<{ providerMessageId: string | null }> {
  const opts = { from: config.from, to: msg.to, subject: msg.subject, text: msg.text }
  if (factory) {
    const info = await factory(config).sendMail(opts)
    return { providerMessageId: info.messageId ?? null }
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  })
  const info = await transport.sendMail(opts)
  return { providerMessageId: info.messageId ?? null }
}

export type FetchImpl = typeof fetch

export async function sendTelegram(
  config: TelegramConfig,
  msg: { chatId: string; text: string },
  fetchImpl: FetchImpl = fetch,
): Promise<{ providerMessageId: string | null }> {
  let last: string | null = null
  for (const chunk of chunkTelegram(msg.text)) {
    const res = await fetchImpl(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: msg.chatId, text: chunk }),
    })
    const data = (await res.json()) as { ok?: boolean; result?: { message_id?: number }; description?: string }
    if (!data.ok) throw new Error(`Telegram falhou: ${data.description ?? res.status}`)
    if (data.result?.message_id != null) last = String(data.result.message_id)
  }
  return { providerMessageId: last }
}
