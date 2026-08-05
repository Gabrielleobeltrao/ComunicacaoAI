import type { Agent } from './agents.js'
import type { ResolvedTool } from './agentTools.js'
import { resolveHttpTool } from './agentTools.js'
import { getGoogleStatus } from './googleCalendar.js'
import { googleCalendarTools, googleSheetsTools } from './googleTools.js'

export interface BuiltinConfigField {
  key: string
  label: string
  placeholder?: string
  required: boolean
}

// A built-in integration ("app") the owner can connect to an agent. Each needs
// an account connection (e.g. Google) and turns into ready-made ResolvedTools.
export interface BuiltinApp {
  key: string
  label: string
  description: string
  connection: 'google'
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
