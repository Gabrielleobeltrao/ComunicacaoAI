import type { AppDefinition } from '../../types.js'
import { native, schema, str } from '../shared.js'

// --- Google -------------------------------------------------------------------
// One App, one OAuth connection, Calendar and Sheets actions chosen individually
// (plan §6). The legacy catalog split this into `google_calendar` and
// `google_sheets`; both keys still resolve, see LEGACY_APP_KEYS below.
export const manifest: AppDefinition = {
  key: 'google',
  version: '1.0.0',
  source: 'system',
  name: 'Google',
  description: 'Agenda e planilhas da sua conta Google.',
  icon: 'google',
  categories: ['produtividade', 'agenda'],
  documentationUrl: 'https://support.google.com/calendar/answer/37083',
  auth: {
    kind: 'oauth2',
    fields: [],
    scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/spreadsheets'],
    documentationUrl: 'https://developers.google.com/identity/protocols/oauth2',
  },
  allowedDomains: ['googleapis.com', 'accounts.google.com'],
  supportsMultipleConnections: false,
  actions: [
    {
      key: 'google_agenda_verificar_disponibilidade',
      name: 'Verificar disponibilidade',
      description: 'Verifica horários livres e ocupados na agenda em um intervalo.',
      risk: 'read',
      inputSchema: schema({ inicio: str('início em ISO 8601'), fim: str('fim em ISO 8601') }, ['inicio', 'fim']),
      execution: native('google_agenda_verificar_disponibilidade'),
      resourceFields: [{ key: 'calendarId', label: 'ID da agenda', placeholder: 'padrão: agenda principal', required: false }],
    },
    {
      key: 'google_agenda_listar_eventos',
      name: 'Listar eventos',
      description: 'Lista os eventos da agenda entre início e fim.',
      risk: 'read',
      inputSchema: schema({ inicio: str('início em ISO 8601'), fim: str('fim em ISO 8601') }, ['inicio', 'fim']),
      execution: native('google_agenda_listar_eventos'),
      resourceFields: [{ key: 'calendarId', label: 'ID da agenda', placeholder: 'padrão: agenda principal', required: false }],
    },
    {
      key: 'google_agenda_criar_evento',
      name: 'Criar evento',
      description: 'Cria um evento na agenda.',
      risk: 'write',
      inputSchema: schema(
        { titulo: str('título'), inicio: str('início em ISO 8601'), fim: str('fim em ISO 8601'), descricao: str('descrição') },
        ['titulo', 'inicio', 'fim'],
      ),
      execution: native('google_agenda_criar_evento'),
      resourceFields: [{ key: 'calendarId', label: 'ID da agenda', placeholder: 'padrão: agenda principal', required: false }],
    },
    {
      key: 'google_sheets_registrar',
      name: 'Registrar linha na planilha',
      description: 'Registra uma linha na planilha do Google com as colunas configuradas.',
      risk: 'write',
      inputSchema: schema({}, []),
      execution: native('google_sheets_registrar'),
      resourceFields: [
        { key: 'spreadsheetId', label: 'ID da planilha', placeholder: 'o trecho longo da URL da planilha', required: true },
        { key: 'sheetName', label: 'Aba', placeholder: 'opcional', required: false },
        { key: 'columns', label: 'Colunas', placeholder: 'Nome, Telefone, Interesse', required: true },
      ],
    },
  ],
  status: 'published',
  dataAccess: ['Eventos das agendas que você autorizar', 'Linhas das planilhas que você indicar'],
  storageNote: 'Guardamos apenas os tokens de acesso criptografados e o e-mail da conta conectada.',
  disconnectNote: 'Desconectar revoga o acesso imediatamente. Eventos e planilhas já criados permanecem no Google.',
}
