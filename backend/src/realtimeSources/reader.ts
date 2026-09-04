import { ObjectId } from 'mongodb'
import { readPath } from '../automations/conditions.js'
import { getLiveValue, waitForLiveValue } from '../integrations/websocket/liveData.js'
import { fontesDoAgente } from './repository.js'
import type { RealtimeDataSource, RealtimeReading } from './types.js'

/**
 * A LEITURA de uma fonte em tempo real — o único lugar que sabe onde o valor mora.
 *
 * Ele existe para que a mesma resposta sirva a um agente de LLM e a um agente de
 * código: as duas execuções chamam daqui, então o que uma vê a outra vê. Duas
 * implementações divergiriam na primeira mudança, e o modelo receberia um formato
 * diferente do que o código recebe.
 *
 * Nada aqui abre conexão. O stream já está de pé alimentando o Dado ao vivo; isto é uma
 * leitura de uma linha, e dez agentes lendo a mesma chave continuam sendo um stream só.
 */

/** Só os campos concedidos. Vazio = o valor inteiro, como veio. */
function recortar(valor: unknown, campos: readonly string[] | null): Record<string, unknown> | null {
  if (valor === null || valor === undefined) return null
  const objeto = typeof valor === 'object' && !Array.isArray(valor) ? (valor as Record<string, unknown>) : { value: valor }
  if (!campos || !campos.length) return objeto
  const fora: Record<string, unknown> = {}
  for (const c of campos) {
    const lido = readPath(objeto, c)
    if (lido !== undefined) fora[c.replace(/[.[\]]/g, '_')] = lido
  }
  return fora
}

/**
 * A conexão do `live_data` desta fonte — a mesma coleção, origens diferentes.
 *
 * Uma conexão de WebSocket é identificada pelo id dela; uma fonte da Central, pelo prefixo
 * `monitoring:` mais o id. As duas empurram valores por chave, e é por isso que uma
 * leitura só serve às duas.
 */
const conexaoDe = (fonte: RealtimeDataSource): string | null =>
  fonte.sourceKind === 'live_data' ? fonte.sourceRef : fonte.sourceKind === 'monitoring' ? `monitoring:${fonte.sourceRef}` : null

const semValor = (fonte: RealtimeDataSource): RealtimeReading => ({
  found: false,
  alias: fonte.alias,
  key: fonte.key,
  value: null,
  receivedAt: null,
  ageMs: null,
  // Sem valor nenhum não há o que estar velho. `found: false` já é a resposta inteira,
  // e marcar `stale` aqui faria parecer que existe algo desatualizado guardado.
  stale: false,
  updates: null,
})

/**
 * O valor de agora — com a idade dele à vista.
 *
 * `stale` é resposta, não erro: o valor volta junto. Esconder um preço de doze segundos
 * atrás tiraria de quem chamou a chance de decidir se aquilo ainda serve; devolvê-lo
 * calado como se fosse de agora seria pior, porque a decisão seria tomada com uma
 * premissa falsa.
 */
export async function lerFonte(fonte: RealtimeDataSource, agora = new Date()): Promise<RealtimeReading> {
  const conexao = conexaoDe(fonte)
  if (!conexao) return semValor(fonte)
  const r = await getLiveValue(fonte.ownerId, conexao, fonte.key, agora)
  if (!r) return semValor(fonte)
  const ageMs = agora.getTime() - r.receivedAt.getTime()
  return {
    found: true,
    alias: fonte.alias,
    key: fonte.key,
    value: recortar(r.value, fonte.allowedFields),
    receivedAt: r.receivedAt.toISOString(),
    ageMs,
    stale: ageMs > fonte.staleAfterSeconds * 1000,
    updates: r.updates,
  }
}

/**
 * Esperar o valor mudar para algo — sem laço de espera ocupada.
 *
 * Reaproveita `waitForLiveValue`, que já resolve isso do jeito certo e já tem teto de
 * tempo. Um agente que ficasse consultando de 100 em 100 ms para esperar um preço
 * gastaria o processo inteiro nisso.
 */
export async function esperarFonte(
  fonte: RealtimeDataSource,
  condicao: { path: string; operator: string; value?: unknown },
  timeoutMs: number,
  agora = new Date(),
): Promise<RealtimeReading & { matched: boolean }> {
  const conexao = conexaoDe(fonte)
  if (!conexao) return { ...semValor(fonte), matched: false }
  const r = await waitForLiveValue(
    fonte.ownerId,
    conexao,
    fonte.key,
    condicao as Parameters<typeof waitForLiveValue>[3],
    timeoutMs,
  )
  if (!r?.record) return { ...semValor(fonte), matched: false }
  const leitura = await lerFonte(fonte, new Date())
  void agora
  return { ...leitura, matched: Boolean(r.matched) }
}

/**
 * A fonte que este agente chamou pelo APELIDO — ou nada.
 *
 * O agente pede `btc_price`, e não um id de banco: ele não deveria precisar saber o que
 * é uma ObjectId. E a busca já é a autorização — a consulta filtra por dono E por
 * agente concedido, então um apelido que existe na conta mas não foi concedido àquele
 * agente simplesmente não é encontrado.
 */
export async function resolverPorAlias(ownerId: string, agentId: ObjectId, alias: string): Promise<RealtimeDataSource | null> {
  const lista = await fontesDoAgente(ownerId, agentId)
  const procurado = String(alias ?? '').trim()
  return lista.find((f) => f.alias === procurado) ?? null
}
