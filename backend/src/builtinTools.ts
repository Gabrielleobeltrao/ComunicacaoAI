import type { Agent } from './agents.js'
import { capabilitiesOf } from './agentCapabilities.js'
import { memorySearchTool } from './memory/tool.js'
import { sourceCheckTool } from './automations/sourceTool.js'
import { clarifyTool } from './clarify.js'
import { sourceSettingsOf } from './agents.js'
import { getToolsByIds } from './tools.js'
import { executeToolCall } from './toolExecution.js'
import type { ResolvedTool } from './agentTools.js'
import { resolveHttpTool } from './agentTools.js'
import { resolveAppGrantTools } from './apps/grants.js'
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

// A short "where do I get these credentials?" guide shown in the connect popup.
export interface BuiltinAppGuide {
  steps: string[]
  docUrl?: string
}

// Keyed by app key so the BUILTIN_APPS entries stay focused on wiring. Steps
// are written for a store/account owner (PT-BR), not a developer.
const APP_GUIDES: Record<string, BuiltinAppGuide> = {
  google_calendar: {
    steps: [
      'Conecte sua conta Google em Configurações → Integrações.',
      'Para usar sua agenda principal, deixe o campo "ID da agenda" em branco.',
      'Para outra agenda: no Google Agenda, passe o mouse na agenda → ⋮ → Configurações → seção "Integrar agenda" → copie o "ID da agenda".',
    ],
    docUrl: 'https://support.google.com/calendar/answer/37083',
  },
  google_sheets: {
    steps: [
      'Conecte sua conta Google em Configurações → Integrações.',
      'Abra a planilha. O "ID da planilha" é o trecho longo da URL, entre /d/ e /edit.',
      '"Aba": o nome da aba (deixe em branco para a primeira).',
      '"Colunas": os nomes das colunas separados por vírgula, na mesma ordem da planilha.',
    ],
    docUrl: 'https://support.google.com/docs/answer/3540681',
  },
  slack: {
    steps: [
      'Acesse api.slack.com/apps e clique em "Create New App" → "From scratch".',
      'Dê um nome e escolha o workspace.',
      'No menu lateral, abra "Incoming Webhooks" e ative a opção.',
      'Clique em "Add New Webhook to Workspace", escolha o canal e autorize.',
      'Copie a "Webhook URL" (começa com https://hooks.slack.com/services/...) e cole aqui.',
    ],
    docUrl: 'https://api.slack.com/messaging/webhooks',
  },
  mercadopago: {
    steps: [
      'Acesse mercadopago.com.br/developers e entre com sua conta.',
      'Vá em "Suas integrações" e crie uma aplicação (ou abra uma existente).',
      'Na aplicação, abra "Credenciais de produção".',
      'Copie o "Access Token" (começa com APP_USR-...) e cole aqui.',
    ],
    docUrl: 'https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/your-integrations/credentials',
  },
  rdstation: {
    steps: [
      'Entre no RD Station CRM (crm.rdstation.com).',
      'Clique no seu nome (canto superior) → "Configurações da conta".',
      'Vá em "Integrações" → "Token de acesso" (API do CRM).',
      'Copie o token e cole aqui.',
    ],
    docUrl: 'https://developers.rdstation.com/reference/token-de-autenticacao-crm',
  },
  hubspot: {
    steps: [
      'No HubSpot, clique na engrenagem (Configurações) no topo.',
      'No menu lateral: Integrações → "Aplicativos privados".',
      'Clique em "Criar aplicativo privado" e dê um nome.',
      'Na aba "Escopos", marque as permissões de CRM (ex: crm.objects.contacts.write).',
      'Salve e copie o "Token de acesso" (começa com pat-na1-...) e cole aqui.',
    ],
    docUrl: 'https://developers.hubspot.com/docs/api/private-apps',
  },
  stripe: {
    steps: [
      'Acesse dashboard.stripe.com e entre na sua conta.',
      'Vá em Desenvolvedores → Chaves de API.',
      'Copie a "Chave secreta" (sk_live_... em produção, ou sk_test_... para testar) e cole aqui.',
      '(Opcional) "URL de sucesso": para onde o cliente vai depois de pagar.',
    ],
    docUrl: 'https://dashboard.stripe.com/apikeys',
  },
  nuvemshop: {
    steps: [
      'É preciso um app na Nuvemshop: acesse partners.nuvemshop.com.br e crie uma conta de parceiro.',
      'Crie um app e autorize-o na sua loja.',
      'A autorização devolve o "user_id" (use como ID da loja) e o "access_token".',
      'Cole o ID da loja e o Access Token aqui.',
    ],
    docUrl: 'https://tiendanube.github.io/api-documentation/authentication',
  },
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
    guide: APP_GUIDES[key],
  }))
}

// Combine an agent's custom HTTP tools with its enabled built-in apps into the
// unified tool list the reply loop uses. Built-in apps whose account isn't
// connected are skipped so the model isn't offered a tool that would fail.
export async function resolveAgentTools(
  agent: Agent,
  ownerId: string,
  // Quantas vezes já se pediu esclarecimento nesta conversa. Zero em automação: lá não há
  // ninguém do outro lado para responder, e o teto é imediato (ver o Playground/canal).
  jaPerguntou = 0,
): Promise<ResolvedTool[]> {
  /**
   * O que este TIPO de agente pode acionar — decidido aqui, e não em cada chamador.
   *
   * Este é o funil por onde todo agente passa: o Playground, o canal, a automação e a
   * delegação. Filtrar em cada um deles seria a mesma regra escrita quatro vezes, e três
   * delas ficariam para trás na primeira mudança.
   *
   * Nada é apagado do banco. Um coordenador que tem app concedido continua com o app
   * gravado — ele só não recebe a ferramenta na mão, porque quem conduz não executa. Se
   * o dono mudar o tipo do agente, tudo volta sozinho.
   */
  const capacidades = capabilitiesOf(agent)

  // Lembrar é uma capacidade de todo agente, não um app que se conecta: a memória
  // já existe no prédio dele. A ferramenta busca sob demanda em vez de despejar
  // tudo no prompt — ver memory/tool.ts.
  const memoria = memorySearchTool(ownerId, agent._id)
  // Olhar uma fonte monitorada também é capacidade de todo agente — e é leitura: não
  // envia nada, não escreve e não avança o checkpoint da rotina. Sem fonte configurada
  // ela responde "sem_fonte", que é a verdade, em vez de não existir e o modelo ter que
  // adivinhar que não pode consultar.
  const fonte = sourceCheckTool(ownerId, agent._id, sourceSettingsOf(agent))
  // Perguntar em vez de responder é capacidade de todo agente. Sem ela, diante de um
  // pedido amplo demais o modelo só sabe responder por cima — e cobrar por isso.
  const esclarecer = clarifyTool(jaPerguntou)
  // Legacy per-agent HTTP tools, kept working untouched.
  const http = capacidades.externalTools ? (agent.tools ?? []).map(resolveHttpTool) : []

  // Reusable Custom Tools: the agent may call ONLY the ones assigned to it, and
  // getToolsByIds is owner-scoped, so a stale or foreign id resolves to nothing.
  // Each tool gets its own per-run counter, which is what stops a model from
  // hammering the same endpoint in a loop.
  const assigned = capacidades.externalTools ? await getToolsByIds(ownerId, agent.toolIds ?? []) : []
  const custom: ResolvedTool[] = assigned
    .filter((tool) => tool.enabled)
    .map((tool) => {
      let callsSoFar = 0
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        run: async (args) => {
          // autonomous: this is the model deciding to call, not the owner testing.
          const outcome = await executeToolCall(tool, args, { callsSoFar, autonomous: true })
          callsSoFar++
          return { ok: outcome.ok, result: outcome.result }
        },
      }
    })

  // Apps the owner connected once on the account, granted to this agent action by
  // action. The credential lives in the encrypted installation — never here.
  const fromGrants = capacidades.externalTools ? await resolveAppGrantTools(agent, ownerId) : []

  // DEPRECATED path, kept for agents not migrated yet. An entry the migration has
  // already moved carries `migratedAt`: its credential is gone from this document
  // and resolving it here would silently produce a tool that cannot authenticate.
  const enabled = capacidades.externalTools ? (agent.builtinTools ?? []).filter((entry) => !entry.migratedAt) : []
  // A memória é do agente que OPERA. Quem só conduz não tem operação para lembrar — e o
  // "olhar a fonte" é leitura de site, que segue a mesma regra da base.
  const proprias = [...(capacidades.memory ? [memoria] : []), ...(capacidades.webSources ? [fonte] : []), esclarecer]
  if (enabled.length === 0) return [...proprias, ...http, ...custom, ...fromGrants]

  const needsGoogle = enabled.some((b) => getBuiltinApp(b.key)?.connection === 'google')
  const googleConnected = needsGoogle ? (await getGoogleStatus(ownerId)).connected : false

  const builtins: ResolvedTool[] = []
  for (const entry of enabled) {
    const app = getBuiltinApp(entry.key)
    if (!app) continue
    if (app.connection === 'google' && !googleConnected) continue
    builtins.push(...app.resolve(ownerId, entry.config ?? {}))
  }
  return [...proprias, ...http, ...custom, ...fromGrants, ...builtins]
}
