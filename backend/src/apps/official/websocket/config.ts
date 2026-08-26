import { ValidationError } from '../../../building.js'
import { readPath } from '../../../automations/conditions.js'
import { contemSegredo } from '../../../integrations/websocket/redact.js'
import { normalizeMapping, normalizeMappingTarget } from '../../../integrations/websocket/mapping.js'
import type { PayloadMappingRule } from '../../../integrations/websocket/mapping.js'

/**
 * A CONFIGURAÇÃO de uma conexão WebSocket genérica, saneada.
 *
 * Tudo aqui é DADO: endereço, nome de campo, caminho, valor. Não existe expressão, não
 * existe template executável e não existe código. É a regra que torna esta tela segura:
 * um App genérico que aceitasse "uma expressão para extrair o campo" seria um App que
 * executa o que o usuário digitou — e o usuário nem sempre é quem parece ser.
 *
 * O que o servidor faz com esses dados é sempre a mesma coisa: ler um caminho de
 * objeto, comparar por igualdade ou por "contém", e substituir `{{campo}}` por um valor
 * já conhecido. Nada mais.
 */

export type WsFormat = 'json' | 'text'
export type WsAuthKind = 'none' | 'header' | 'query' | 'message'
export type WsDedupeStrategy = 'none' | 'message_id' | 'payload_hash'

export interface WsFilter {
  /** Caminho de objeto, ex.: `data.type`. Só leitura — ver `readPath`. */
  path: string
  operator: 'equals' | 'contains'
  value: string
}

export interface WsConnectionConfig {
  endpoint: string
  format: WsFormat
  auth: {
    kind: WsAuthKind
    /** Nome do cabeçalho ou do parâmetro. O VALOR é o segredo e mora cifrado à parte. */
    name: string
    /** Prefixo do valor, ex.: `Bearer `. Não é segredo. */
    prefix: string
    /** A primeira mensagem, com `{{token}}` substituído pelo segredo na hora de enviar. */
    messageTemplate: string
  }
  /**
   * Cabeçalhos ADICIONAIS do handshake, além do de autenticação.
   *
   * Alguns serviços exigem `Origin`, `User-Agent` ou um cabeçalho próprio de conta.
   * O VALOR pode ser `{{token}}`, e aí a credencial entra na hora de conectar — em
   * texto, aqui, ele nunca fica.
   */
  headers: { name: string; value: string }[]
  /**
   * As mensagens mandadas ao abrir, NA ORDEM.
   *
   * Um serviço costuma querer autenticar primeiro e assinar depois; alguns querem três
   * quadros. Uma mensagem só não cobria isso, e mandar tudo junto num quadro é o que os
   * serviços recusam. `{{token}}` vale aqui como vale na de autenticação.
   */
  initialMessages: string[]
  protocols: string[]
  /**
   * O batimento. `timeoutMs` é quanto se espera pela resposta antes de dar o socket
   * por morto: sem ele, um serviço que aceita o ping e não responde mantinha a conexão
   * "viva" até o detector de silêncio, que é muito mais longo.
   *
   * `native` usa o ping/pong do protocolo, que é o certo quando o serviço o suporta:
   * ele não passa pela aplicação do outro lado e não vira mensagem para ninguém.
   */
  heartbeat: { enabled: boolean; native: boolean; message: string; intervalMs: number; timeoutMs: number }
  idleTimeoutMs: number
  /** Prazo para o handshake completar. Um serviço fora do ar não deixa a tela pendurada. */
  connectTimeoutMs: number
  /** Onde estão as coisas dentro da mensagem. Vazio = a mensagem inteira. */
  paths: { payload: string; messageId: string; channel: string; occurredAt: string }
  /** Schema opcional para RECUSAR o que não bate, em vez de guardar lixo. */
  schema: Record<string, unknown> | null
  filters: WsFilter[]
  dedupe: WsDedupeStrategy
  maxMessagesPerMinute: number
  maxMessageBytes: number
  /** `$.data.ticker → symbol`: dois provedores viram o mesmo objeto aqui dentro. */
  mapping: PayloadMappingRule[]
  /**
   * Onde está a CHAVE do dado ao vivo, dentro do objeto já mapeado.
   *
   * Vazio desliga o Live Data Store para esta conexão. Preenchido — normalmente
   * `symbol` — faz cada mensagem atualizar o último valor daquela chave, em vez de
   * virar mais uma linha de histórico.
   */
  liveKeyPath: string
  /** Por quanto tempo o último valor continua valendo. */
  liveTtlSeconds: number
  /**
   * Espaço mínimo entre duas PUBLICAÇÕES da mesma chave no barramento.
   *
   * O Live Data Store aceita todo tique; o barramento, não. Sem isto, uma cotação
   * ativa vira um evento por tique — e um evento é durável, é entregue e pode disparar
   * coisas. Zero mantém o comportamento de sempre.
   */
  publishThrottleMs: number
}

/** Tetos que não são configuráveis para baixo por acidente nem para cima por engano. */
export const WS_LIMITS = {
  maxMessageBytes: Number(process.env.WS_MAX_MESSAGE_BYTES ?? 64_000),
  maxMessagesPerMinute: Number(process.env.WS_MAX_MESSAGES_PER_MINUTE ?? 600),
  minIntervalMs: 5_000,
  maxIntervalMs: 300_000,
  maxFilters: 10,
  maxProtocols: 5,
  maxHeaders: 10,
  maxInitialMessages: 10,
  /** Teto do dado ao vivo: por conexão e por dono. Ver `liveData.ts`. */
  maxLiveKeysPerConnection: Number(process.env.WS_MAX_LIVE_KEYS ?? 500),
  /** O teto do DONO: dez conexões abaixo do teto individual somam dez vezes o teto. */
  maxLiveKeysPerOwner: Number(process.env.WS_MAX_LIVE_KEYS_PER_OWNER ?? 2_000),
  maxLiveTtlSeconds: 24 * 60 * 60,
}

const texto = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max)

/**
 * Um caminho de objeto, e nada além disso.
 *
 * Só letras, números, `_`, `.` e índice numérico. `__proto__`, `constructor` e
 * `prototype` são recusados — é por eles que uma leitura vira escrita no protótipo.
 */
export function normalizePath(bruto: unknown, campo: string): string {
  const p = texto(bruto, 200)
  if (!p) return ''
  if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+|\[\d+\])*$/.test(p)) {
    throw new ValidationError(`${campo}: use um caminho simples, como "data.evento" — sem expressão nem código.`)
  }
  if (/(^|\.)(__proto__|constructor|prototype)(\.|$)/.test(p)) {
    throw new ValidationError(`${campo}: caminho não permitido.`)
  }
  return p
}

const numeroEntre = (v: unknown, padrao: number, min: number, max: number): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return padrao
  return Math.min(Math.max(Math.round(n), min), max)
}

/**
 * Um quadro de SAÍDA, no formato desta conexão.
 *
 * `json` exige JSON válido: uma inscrição malformada só falharia na hora de conectar, e
 * aí longe de quem a escreveu. `text` aceita texto puro — há serviço que assina com
 * `SUBSCRIBE canal` e recusa qualquer coisa entre chaves, e exigir JSON dele tornava o
 * App genérico só no nome.
 *
 * O que nenhum dos dois aceita é template livre: a única substituição que existe é
 * `{{token}}`, por um valor conhecido.
 */
function mensagem(bruto: unknown, campo: string, formato: WsFormat = 'json'): string {
  const t = texto(bruto, 4_000)
  if (!t) return ''
  if (formato === 'text') return t
  try {
    JSON.parse(t)
  } catch {
    throw new ValidationError(`${campo}: precisa ser um JSON válido. (Se o serviço espera texto puro, mude o formato da conexão para "texto".)`)
  }
  return t
}

/**
 * O CAMPO PÚBLICO não pode conter a credencial de verdade.
 *
 * Cabeçalho, mensagem inicial, mensagem de autenticação e batimento ficam no metadata
 * PÚBLICO da instalação — que é o que a tela lê e o que uma listagem devolve. Colar a
 * chave neles a tira de dentro do campo cifrado e a põe em texto claro, e ninguém
 * percebe porque a conexão funciona igual.
 *
 * O jeito certo é `{{token}}`: o segredo continua cifrado e entra só na hora de enviar.
 */
function semCredencial(valor: string, campo: string, credencial: string): string {
  // Literal, escapada e percent-encoded: colar a URL que o serviço devolveu põe a chave
  // codificada, e uma comparação só com a forma literal não a veria.
  if (contemSegredo(valor, [credencial])) {
    throw new ValidationError(`${campo}: não escreva a credencial aqui — use {{token}} e ela entra na hora de conectar, sem ficar guardada.`)
  }
  return valor
}

/**
 * Parâmetros de consulta cujo VALOR é quase sempre um segredo.
 *
 * O endereço fica no metadata público: uma chave colada em `?apikey=...` está em texto
 * claro no banco, aparece na listagem e vai para qualquer lugar que mostre a conexão. O
 * caminho certo já existe — `auth.kind: "query"` com o valor no campo de credencial —, e
 * ele produz exatamente a mesma URL na hora de conectar.
 *
 * Query comum continua passando: só estes nomes são recusados, e só quando têm valor.
 */
const PARAMETROS_DE_SEGREDO = new Set(['apikey', 'api_key', 'api-key', 'token', 'access_token', 'accesstoken', 'auth_token', 'key', 'secret', 'password', 'authorization'])

function enderecoSemSegredo(endpoint: string, credencial: string): string {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    // Endereço malformado: quem reclama é a guarda de destino, com a mensagem dela.
    return endpoint
  }
  for (const [nome, valor] of url.searchParams) {
    if (!valor.trim()) continue
    // `{{token}}` é o jeito certo e passa: o segredo entra só na hora de conectar.
    if (valor.includes('{{token}}')) continue
    if (PARAMETROS_DE_SEGREDO.has(nome.toLowerCase())) {
      throw new ValidationError(
        `O endereço traz "${nome}" com valor em texto claro, e ele ficaria guardado assim. Tire o parâmetro do endereço, escolha autenticação "parâmetro no endereço" com o nome "${nome}" e informe o valor no campo de credencial.`,
      )
    }
  }
  return semCredencial(endpoint, 'Endereço', credencial)
}

/**
 * Cabeçalhos extras. O NOME é validado como nome de cabeçalho; o valor pode ser
 * `{{token}}`, e nesse caso o segredo entra só na hora de conectar.
 */
function cabecalhos(bruto: unknown, credencialAtual = ''): { name: string; value: string }[] {
  const lista = Array.isArray(bruto) ? bruto : []
  if (lista.length > WS_LIMITS.maxHeaders) throw new ValidationError(`No máximo ${WS_LIMITS.maxHeaders} cabeçalhos.`)
  return lista.map((h, i) => {
    const raw = (typeof h === 'object' && h !== null ? h : {}) as Record<string, unknown>
    const name = texto(raw.name, 100)
    if (!name) throw new ValidationError(`Cabeçalho ${i + 1}: informe o nome.`)
    // Sem dois-pontos, sem quebra de linha: os dois separam cabeçalhos no protocolo, e
    // um nome com eles é injeção de cabeçalho, não configuração.
    if (!/^[A-Za-z0-9-]+$/.test(name)) throw new ValidationError(`Cabeçalho ${i + 1}: use letras, números e hífen no nome.`)
    const value = semCredencial(String(raw.value ?? '').replace(/[\r\n]/g, '').slice(0, 500), `Cabeçalho ${i + 1}`, credencialAtual)
    return { name, value }
  })
}

/** As mensagens iniciais, na ordem em que foram escritas. Cada uma precisa ser JSON. */
function mensagensIniciais(bruto: unknown, formato: WsFormat, credencialAtual = ''): string[] {
  const lista = Array.isArray(bruto) ? bruto : []
  if (lista.length > WS_LIMITS.maxInitialMessages) throw new ValidationError(`No máximo ${WS_LIMITS.maxInitialMessages} mensagens iniciais.`)
  return lista.map((m, i) => semCredencial(mensagem(m, `Mensagem inicial ${i + 1}`, formato), `Mensagem inicial ${i + 1}`, credencialAtual)).filter(Boolean)
}

/**
 * `credencialAtual` é o segredo em vigor, quando quem chama o conhece.
 *
 * Ele NÃO é guardado nem devolvido: serve só para recusar um campo público que contenha
 * o segredo em texto claro. Ausente, a conferência é pulada — é o caso de quem valida
 * uma configuração sem ter acesso à credencial.
 */
export function normalizeConnectionConfig(bruto: unknown, credencialAtual = ''): WsConnectionConfig {
  const c = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Record<string, unknown>
  const auth = (typeof c.auth === 'object' && c.auth !== null ? c.auth : {}) as Record<string, unknown>
  const paths = (typeof c.paths === 'object' && c.paths !== null ? c.paths : {}) as Record<string, unknown>
  const heartbeat = (typeof c.heartbeat === 'object' && c.heartbeat !== null ? c.heartbeat : {}) as Record<string, unknown>

  const endpoint = enderecoSemSegredo(texto(c.endpoint, 2_000), credencialAtual)
  if (!endpoint) throw new ValidationError('Informe o endereço wss:// do serviço.')

  const kind = (['none', 'header', 'query', 'message'] as const).find((k) => k === auth.kind) ?? 'none'
  if ((kind === 'header' || kind === 'query') && !texto(auth.name)) {
    throw new ValidationError('Informe o nome do cabeçalho ou do parâmetro de autenticação.')
  }
  const formato: WsFormat = c.format === 'text' ? 'text' : 'json'
  const messageTemplate = kind === 'message' ? semCredencial(mensagem(auth.messageTemplate, 'Mensagem de autenticação', formato), 'Mensagem de autenticação', credencialAtual) : ''
  if (kind === 'message' && !messageTemplate) throw new ValidationError('Informe a mensagem de autenticação.')

  const filtrosBrutos = Array.isArray(c.filters) ? c.filters : []
  if (filtrosBrutos.length > WS_LIMITS.maxFilters) throw new ValidationError(`No máximo ${WS_LIMITS.maxFilters} filtros.`)
  const filters: WsFilter[] = filtrosBrutos.map((f, i) => {
    const raw = (typeof f === 'object' && f !== null ? f : {}) as Record<string, unknown>
    const operator = raw.operator === 'contains' ? 'contains' : 'equals'
    const path = normalizePath(raw.path, `Filtro ${i + 1}`)
    if (!path) throw new ValidationError(`Filtro ${i + 1}: informe o campo.`)
    return { path, operator, value: texto(raw.value, 500) }
  })

  const schema = typeof c.schema === 'object' && c.schema !== null && !Array.isArray(c.schema) ? (c.schema as Record<string, unknown>) : null
  const mapping = normalizeMapping(c.mapping)

  return {
    endpoint,
    format: formato,
    // O prefixo NÃO é aparado: `Bearer ` precisa do espaço no fim, e é o caso mais
    // comum de todos. Aparar transformava o cabeçalho em `Bearerabc`, que o serviço
    // recusa por um motivo que a tela não teria como explicar.
    auth: { kind, name: texto(auth.name, 100), prefix: String(auth.prefix ?? '').slice(0, 50), messageTemplate },
    headers: cabecalhos(c.headers, credencialAtual),
    initialMessages: mensagensIniciais(c.initialMessages, formato, credencialAtual),
    protocols: (Array.isArray(c.protocols) ? c.protocols : []).map((p) => texto(p, 60)).filter(Boolean).slice(0, WS_LIMITS.maxProtocols),
    heartbeat: {
      enabled: heartbeat.enabled === true,
      // O ping do protocolo não carrega mensagem: quando ele está ligado, o campo de
      // texto some da tela e daqui, em vez de ficar guardado sem efeito.
      native: heartbeat.enabled === true && heartbeat.native !== false,
      message: heartbeat.enabled === true && heartbeat.native === false ? semCredencial(mensagem(heartbeat.message, 'Mensagem de heartbeat', formato), 'Mensagem de heartbeat', credencialAtual) : '',
      intervalMs: numeroEntre(heartbeat.intervalMs, 30_000, WS_LIMITS.minIntervalMs, WS_LIMITS.maxIntervalMs),
      timeoutMs: numeroEntre(heartbeat.timeoutMs, 10_000, 1_000, WS_LIMITS.maxIntervalMs),
    },
    idleTimeoutMs: numeroEntre(c.idleTimeoutMs, 90_000, WS_LIMITS.minIntervalMs, WS_LIMITS.maxIntervalMs),
    connectTimeoutMs: numeroEntre(c.connectTimeoutMs, 15_000, 1_000, 60_000),
    paths: {
      payload: normalizePath(paths.payload, 'Caminho do conteúdo'),
      messageId: normalizePath(paths.messageId, 'Caminho do identificador'),
      channel: normalizePath(paths.channel, 'Caminho do canal'),
      occurredAt: normalizePath(paths.occurredAt, 'Caminho da data'),
    },
    schema,
    filters,
    dedupe: (['none', 'message_id', 'payload_hash'] as const).find((d) => d === c.dedupe) ?? 'none',
    maxMessagesPerMinute: numeroEntre(c.maxMessagesPerMinute, 120, 1, WS_LIMITS.maxMessagesPerMinute),
    maxMessageBytes: numeroEntre(c.maxMessageBytes, 16_000, 200, WS_LIMITS.maxMessageBytes),
    mapping,
    // Sem mapeamento não há objeto normalizado de onde tirar a chave — e uma chave lida
    // do payload cru dependeria do formato de cada provedor, que é o que o mapeamento
    // existe para esconder.
    liveKeyPath: mapping.length ? normalizeMappingTarget(texto(c.liveKeyPath) || 'symbol', 'Chave do dado ao vivo') : '',
    liveTtlSeconds: numeroEntre(c.liveTtlSeconds, 300, 5, WS_LIMITS.maxLiveTtlSeconds),
    publishThrottleMs: numeroEntre(c.publishThrottleMs, 0, 0, 60_000),
  }
}

/**
 * O que a TELA pode ver da configuração.
 *
 * Tudo menos o valor da credencial — que nunca esteve aqui: ele mora cifrado, num campo
 * separado, e não passa por esta estrutura em nenhum momento.
 */
export const connectionConfigPublic = (c: WsConnectionConfig) => ({ ...c, auth: { ...c.auth } })

/** Lê um caminho, ou devolve a mensagem inteira quando o caminho é vazio. */
export const readAt = (valor: unknown, caminho: string): unknown => (caminho ? readPath(valor, caminho) : valor)

/**
 * Substitui `{{token}}` pelo segredo — e só isso.
 *
 * Um template com mais poder que isto (condicional, chamada, expressão) seria código
 * escrito por quem configura e executado pelo servidor. Aqui há uma substituição, de um
 * nome conhecido, por um valor conhecido.
 */
export const fillToken = (template: string, token: string): string => template.split('{{token}}').join(token)
