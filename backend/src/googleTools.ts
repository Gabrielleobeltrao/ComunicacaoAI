import type { ResolvedTool } from './agentTools.js'
import { getGoogleAccessToken } from './googleCalendar.js'

// One authenticated call to a Google API, returning the loop's {ok, result}.
async function googleFetch(
  ownerId: string,
  url: string,
  init: { method: string; body?: string },
): Promise<{ ok: boolean; result: string }> {
  const token = await getGoogleAccessToken(ownerId)
  if (!token) {
    return { ok: false, result: 'A conta Google não está conectada. Conecte em Configurações → Integrações.' }
  }
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: init.body,
    })
    const text = (await res.text()).slice(0, 4000)
    if (!res.ok) return { ok: false, result: `Google API ${res.status}: ${text}` }
    return { ok: true, result: text || '(ok)' }
  } catch (error) {
    return { ok: false, result: `Falha ao chamar o Google: ${(error as Error).message}` }
  }
}

const str = (description: string) => ({ type: 'string', description })
const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
})

export function googleCalendarTools(ownerId: string, config: Record<string, string>): ResolvedTool[] {
  const calendarId = config.calendarId?.trim() || 'primary'
  const path = encodeURIComponent(calendarId)
  return [
    {
      name: 'google_agenda_verificar_disponibilidade',
      description:
        'Verifica os horários ocupados na agenda entre início e fim (datas ISO 8601 com fuso, ex: 2026-08-20T14:00:00-03:00). Use antes de sugerir ou marcar um horário.',
      inputSchema: objectSchema({ inicio: str('início, ISO 8601'), fim: str('fim, ISO 8601') }, ['inicio', 'fim']),
      run: (args) =>
        googleFetch(ownerId, 'https://www.googleapis.com/calendar/v3/freeBusy', {
          method: 'POST',
          body: JSON.stringify({ timeMin: args.inicio, timeMax: args.fim, items: [{ id: calendarId }] }),
        }),
    },
    {
      name: 'google_agenda_listar_eventos',
      description: 'Lista os eventos da agenda entre início e fim (datas ISO 8601).',
      inputSchema: objectSchema({ inicio: str('início, ISO 8601'), fim: str('fim, ISO 8601') }, ['inicio', 'fim']),
      run: (args) =>
        googleFetch(
          ownerId,
          `https://www.googleapis.com/calendar/v3/calendars/${path}/events?timeMin=${encodeURIComponent(
            String(args.inicio),
          )}&timeMax=${encodeURIComponent(String(args.fim))}&singleEvents=true&orderBy=startTime`,
          { method: 'GET' },
        ),
    },
    {
      name: 'google_agenda_criar_evento',
      description: 'Cria um evento na agenda. inicio e fim em ISO 8601 com fuso.',
      inputSchema: objectSchema(
        {
          titulo: str('título do evento'),
          inicio: str('início, ISO 8601'),
          fim: str('fim, ISO 8601'),
          descricao: str('descrição (opcional)'),
        },
        ['titulo', 'inicio', 'fim'],
      ),
      run: (args) =>
        googleFetch(ownerId, `https://www.googleapis.com/calendar/v3/calendars/${path}/events`, {
          method: 'POST',
          body: JSON.stringify({
            summary: args.titulo,
            description: args.descricao ?? '',
            start: { dateTime: args.inicio },
            end: { dateTime: args.fim },
          }),
        }),
    },
  ]
}

export function googleSheetsTools(ownerId: string, config: Record<string, string>): ResolvedTool[] {
  const spreadsheetId = config.spreadsheetId?.trim() || ''
  const sheetName = config.sheetName?.trim() || ''
  const columns = (config.columns ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
  if (!spreadsheetId || columns.length === 0) return []

  // One string param per configured column (campo_1..n); the model reads the
  // column name in each param's description.
  const properties: Record<string, unknown> = {}
  columns.forEach((col, i) => {
    properties[`campo_${i + 1}`] = str(col)
  })
  const range = sheetName ? `${sheetName}!A1` : 'A1'

  return [
    {
      name: 'google_sheets_registrar',
      description: `Registra uma linha na planilha do Google com as colunas: ${columns.join(
        ', ',
      )}. Use quando tiver os dados do cliente para salvar.`,
      inputSchema: objectSchema(properties, []),
      run: (args) => {
        const values = columns.map((_, i) => String(args[`campo_${i + 1}`] ?? ''))
        return googleFetch(
          ownerId,
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
            range,
          )}:append?valueInputOption=USER_ENTERED`,
          { method: 'POST', body: JSON.stringify({ values: [[new Date().toISOString(), ...values]] }) },
        )
      },
    },
  ]
}
