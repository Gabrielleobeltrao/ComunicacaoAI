import type { Agent } from './agents.js'
import type { ResolvedTool } from './agentTools.js'
import { resolveHttpTool } from './agentTools.js'
import { getGoogleStatus } from './googleCalendar.js'
import { googleCalendarTools, googleSheetsTools } from './googleTools.js'
import {
  hubspotTools,
  mercadoPagoTools,
  nuvemshopTools,
  rdStationTools,
  slackTools,
  stripeTools,
} from './providerApps.js'

export interface BuiltinConfigField {
  key: string
  label: string
  placeholder?: string
  required: boolean
  // 'password' hides the value in the UI (for tokens/webhook URLs).
  type?: 'text' | 'password'
}

// A built-in integration ("app") the owner can connect to an agent. Some need
// an account connection (e.g. Google OAuth); others carry their credential in
// the per-agent config. Either way it turns into ready-made ResolvedTools.
export interface BuiltinApp {
  key: string
  label: string
  description: string
  connection?: 'google'
  configFields: BuiltinConfigField[]
  resolve: (ownerId: string, config: Record<string, string>) => ResolvedTool[]
}

export const BUILTIN_APPS: BuiltinApp[] = [
  {
    key: 'google_calendar',
    label: 'Google Agenda',
    description: 'Ver disponibilidade, listar e criar eventos na sua agenda.',
    connection: 'google',
    configFields: [
      { key: 'calendarId', label: 'ID da agenda', placeholder: 'padrão: agenda principal', required: false },
    ],
    resolve: googleCalendarTools,
  },
  {
    key: 'google_sheets',
    label: 'Google Sheets',
    description: 'Registrar leads e dados da conversa numa planilha.',
    connection: 'google',
    configFields: [
      { key: 'spreadsheetId', label: 'ID da planilha', placeholder: 'o trecho longo da URL da planilha', required: true },
      { key: 'sheetName', label: 'Aba', placeholder: 'opcional', required: false },
      { key: 'columns', label: 'Colunas', placeholder: 'Nome, Telefone, Interesse', required: true },
    ],
    resolve: googleSheetsTools,
  },
  {
    key: 'slack',
    label: 'Slack',
    description: 'Avisar um canal do Slack (ex: lead novo, pedido de atendimento humano).',
    configFields: [
      {
        key: 'webhookUrl',
        label: 'Incoming Webhook URL',
        placeholder: 'https://hooks.slack.com/services/...',
        required: true,
        type: 'password',
      },
    ],
    resolve: slackTools,
  },
  {
    key: 'mercadopago',
    label: 'Mercado Pago',
    description: 'Gerar link de pagamento (checkout) para o cliente pagar.',
    configFields: [
      { key: 'accessToken', label: 'Access Token', placeholder: 'APP_USR-...', required: true, type: 'password' },
    ],
    resolve: mercadoPagoTools,
  },
  {
    key: 'rdstation',
    label: 'RD Station CRM',
    description: 'Registrar leads e contatos no RD Station CRM.',
    configFields: [{ key: 'token', label: 'Token do RD Station CRM', required: true, type: 'password' }],
    resolve: rdStationTools,
  },
  {
    key: 'hubspot',
    label: 'HubSpot',
    description: 'Registrar leads e contatos no HubSpot CRM.',
    configFields: [
      {
        key: 'token',
        label: 'Private App Token',
        placeholder: 'pat-na1-...',
        required: true,
        type: 'password',
      },
    ],
    resolve: hubspotTools,
  },
  {
    key: 'stripe',
    label: 'Stripe',
    description: 'Gerar link de pagamento (Stripe Checkout) para o cliente pagar.',
    configFields: [
      { key: 'secretKey', label: 'Secret Key', placeholder: 'sk_live_... ou sk_test_...', required: true, type: 'password' },
      { key: 'successUrl', label: 'URL de sucesso', placeholder: 'https://seusite.com/obrigado', required: false },
    ],
    resolve: stripeTools,
  },
  {
    key: 'nuvemshop',
    label: 'Nuvemshop',
    description: 'Consultar status de pedidos na sua loja Nuvemshop.',
    configFields: [
      { key: 'storeId', label: 'ID da loja', placeholder: 'ex: 1234567', required: true },
      { key: 'accessToken', label: 'Access Token', required: true, type: 'password' },
    ],
    resolve: nuvemshopTools,
  },
]

export function getBuiltinApp(key: string): BuiltinApp | undefined {
  return BUILTIN_APPS.find((app) => app.key === key)
}

// The catalog the frontend renders as connectable "apps" (no executor).
export function builtinAppsCatalog() {
  return BUILTIN_APPS.map(({ key, label, description, connection, configFields }) => ({
    key,
    label,
    description,
    connection,
    configFields,
  }))
}

// Combine an agent's custom HTTP tools with its enabled built-in apps into the
// unified tool list the reply loop uses. Built-in apps whose account isn't
// connected are skipped so the model isn't offered a tool that would fail.
export async function resolveAgentTools(agent: Agent, ownerId: string): Promise<ResolvedTool[]> {
  const http = (agent.tools ?? []).map(resolveHttpTool)

  const enabled = agent.builtinTools ?? []
  if (enabled.length === 0) return http

  const needsGoogle = enabled.some((b) => getBuiltinApp(b.key)?.connection === 'google')
  const googleConnected = needsGoogle ? (await getGoogleStatus(ownerId)).connected : false

  const builtins: ResolvedTool[] = []
  for (const entry of enabled) {
    const app = getBuiltinApp(entry.key)
    if (!app) continue
    if (app.connection === 'google' && !googleConnected) continue
    builtins.push(...app.resolve(ownerId, entry.config ?? {}))
  }
  return [...http, ...builtins]
}
