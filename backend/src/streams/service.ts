import { ObjectId } from 'mongodb'
import { ValidationError } from '../building.js'
import { resolveConnection } from '../apps/connectionProfile.js'
import { decryptInstallationConfig, getInstallation } from '../apps/installations.js'
import {
  countStreams,
  deleteStream,
  findStream,
  listResumableStreams,
  listStreams,
  listOrphanStreams,
  listStreamsForInstallation,
  releaseAllLeases,
  STREAM_LEASE_MS,
  setStreamPaused,
  upsertStream,
} from './repository.js'
import { StreamManager, setStreamManager, streamManager } from './manager.js'
import { streamAdapters } from './registry.js'
import { createRealSocket } from './socket.js'
import type { StreamAdapter, StreamRecord } from './types.js'
import { MAX_STREAMS_PER_OWNER, MAX_SYMBOLS_PER_STREAM } from './types.js'

/**
 * A camada que a API e o worker enxergam. O gerenciador cuida de socket; aqui é onde
 * dono, permissão e limite são conferidos — antes de qualquer conexão sair.
 */

// O mapa vive em `registry.ts`, sem dependência nenhuma. Reexportado daqui porque é
// deste módulo que o resto do sistema já importava.
export { registerStreamAdapter, streamAdapters, clearStreamAdapters, hasStreamAdapter } from './registry.js'
const adapters = streamAdapters()

/**
 * A credencial para abrir o stream — só depois de a conexão passar em todas as
 * conferências que a ferramenta conectada já faz (dono, status, ambiente).
 *
 * `requireConnectable: false` porque um App de streaming não precisa declarar perfil
 * de conexão REST: quem empresta base e cabeçalho para ferramenta é outra coisa.
 */
export async function streamCredentials(ownerId: string, installationId: string): Promise<Record<string, string> | null> {
  const conexao = await resolveConnection(ownerId, installationId, { requireConnectable: false })
  if (!conexao.ok) return null
  const id = ObjectId.isValid(installationId) ? new ObjectId(installationId) : null
  const instalacao = id ? await getInstallation(ownerId, id) : null
  return instalacao ? decryptInstallationConfig(instalacao) : null
}

/** Símbolos saneados: maiúsculo, sem repetição, sem vazio, dentro do teto. */
export function normalizeSymbols(bruto: unknown): string[] {
  const lista = Array.isArray(bruto) ? bruto : []
  const limpos = [...new Set(lista.map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean))]
  if (limpos.length > MAX_SYMBOLS_PER_STREAM) {
    throw new ValidationError(`no máximo ${MAX_SYMBOLS_PER_STREAM} símbolos por stream`)
  }
  return limpos
}

/**
 * Garantir que um stream exista e esteja de pé. Idempotente: pedir de novo com os
 * mesmos símbolos não abre uma segunda conexão.
 */
export async function ensureStream(ownerId: string, installationId: string, symbols: unknown): Promise<StreamRecord> {
  const conexao = await resolveConnection(ownerId, installationId, { requireConnectable: false })
  if (!conexao.ok) throw new ValidationError(conexao.message)

  const limpos = normalizeSymbols(symbols)
  const existentes = await listStreamsForInstallation(ownerId, installationId)
  // O teto conta o que ainda NÃO existe: renovar um stream que já está lá nunca é
  // barrado por limite, senão mexer nos símbolos viraria um erro sem sentido.
  if (!existentes.some((s) => s.environment === conexao.environment) && (await countStreams(ownerId)) >= MAX_STREAMS_PER_OWNER) {
    throw new ValidationError(`limite de ${MAX_STREAMS_PER_OWNER} streams por conta atingido`)
  }

  const record = await upsertStream({
    ownerId,
    installationId,
    appKey: conexao.appKey,
    environment: conexao.environment,
    symbols: limpos,
  })
  await streamManager()?.start(record)
  return record
}

/**
 * Desligar de vez: para a conexão viva e apaga o registro.
 *
 * Diferente de pausar, que guarda a intenção de voltar. Aqui o dono está dizendo que
 * não quer mais aquele stream, e deixar o documento para trás faria ele ressuscitar no
 * próximo restart.
 */
export async function removeStream(ownerId: string, id: ObjectId): Promise<boolean> {
  const existia = await findStream(ownerId, id)
  if (!existia) return false
  await streamManager()?.stop(id.toString())
  return deleteStream(ownerId, id)
}

/**
 * A conexão saiu do ar — o stream dela sai junto, AGORA.
 *
 * Chamado ao revogar e ao remover uma instalação. Duas coisas precisam acontecer, e
 * nenhuma sozinha basta: parar a conexão viva (senão ela continua recebendo com a
 * credencial que acabou de ser revogada, até o próximo erro) e marcar como pausado
 * (senão o próximo restart do worker ressuscita o stream a partir do documento).
 */
export async function disableStreamsForInstallation(ownerId: string, installationId: string): Promise<number> {
  const streams = await listStreamsForInstallation(ownerId, installationId)
  const gerente = streamManager()
  for (const s of streams) {
    await gerente?.stop(s._id.toString())
    await setStreamPaused(ownerId, s._id, true)
  }
  return streams.length
}

/**
 * A credencial mudou — reabre com a nova.
 *
 * Sem isto, o stream continuaria de pé com a chave antiga até ela ser recusada pelo
 * provider; trocar a credencial pareceria não ter efeito, que é o pior desfecho de
 * uma troca de credencial.
 */
export async function reconnectStreamsForInstallation(ownerId: string, installationId: string): Promise<number> {
  const streams = await listStreamsForInstallation(ownerId, installationId)
  const gerente = streamManager()
  let religados = 0
  for (const s of streams) {
    if (s.paused) continue
    await gerente?.stop(s._id.toString())
    await gerente?.start({ ...s, state: 'disconnected' })
    religados += 1
  }
  return religados
}

/** A instalação foi removida: o registro do stream vai junto, senão fica órfão. */
export async function deleteStreamsForInstallation(ownerId: string, installationId: string): Promise<number> {
  const streams = await listStreamsForInstallation(ownerId, installationId)
  for (const s of streams) {
    await streamManager()?.stop(s._id.toString())
    await deleteStream(ownerId, s._id)
  }
  return streams.length
}

export async function pauseStream(ownerId: string, id: ObjectId): Promise<StreamRecord | null> {
  const record = await setStreamPaused(ownerId, id, true)
  if (record) await streamManager()?.stop(id.toString())
  return record
}

export async function resumeStream(ownerId: string, id: ObjectId): Promise<StreamRecord | null> {
  const record = await setStreamPaused(ownerId, id, false)
  if (record) await streamManager()?.start(record)
  return record
}

/** Reconectar: descer e subir. Explícito, porque "tentar de novo agora" é um pedido comum. */
export async function reconnectStream(ownerId: string, id: ObjectId): Promise<StreamRecord | null> {
  const record = await findStream(ownerId, id)
  if (!record) return null
  const gerente = streamManager()
  await gerente?.stop(id.toString())
  if (!record.paused) await gerente?.start({ ...record, state: 'disconnected' })
  return record
}

/**
 * Testar a conexão SEM abrir stream: só confere se a credencial ainda resolve.
 *
 * Não devolve nada do provider — um teste que ecoa a resposta é um teste que vaza.
 */
export async function testStreamConnection(ownerId: string, installationId: string): Promise<{ ok: boolean; message: string }> {
  const conexao = await resolveConnection(ownerId, installationId, { requireConnectable: false })
  if (!conexao.ok) return { ok: false, message: conexao.message }
  const credencial = await streamCredentials(ownerId, installationId)
  if (!credencial || Object.keys(credencial).length === 0) {
    return { ok: false, message: 'A conexão não tem credencial guardada.' }
  }
  const adapter = adapters.get(conexao.appKey)
  if (!adapter) return { ok: false, message: `O App "${conexao.appName}" não oferece streaming neste sistema.` }

  /**
   * O teste ABRE mesmo o socket, autentica e fecha.
   *
   * Antes daqui ele conferia se havia credencial guardada e adapter registrado — o que
   * responde "está configurado", não "funciona". Uma chave errada passava no teste e
   * falhava quando o stream fosse ligado de verdade, longe de quem clicou em testar.
   */
  const gerente = streamManager()
  if (!gerente) return { ok: false, message: 'O motor de streams não está no ar neste processo.' }
  const resultado = await gerente.probe(adapter, conexao.environment, credencial)
  return { ok: resultado.ok, message: `${resultado.message} (${conexao.environment})` }
}

export const listOwnerStreams = listStreams

/**
 * Subir de novo o que estava de pé antes do restart.
 *
 * É a diferença entre um worker que reinicia e um worker que reinicia e some com os
 * streams de todo mundo até alguém perceber.
 */
/**
 * O RECONCILIADOR: de tempos em tempos, tenta assumir o que está órfão.
 *
 * Sem ele, a posse só era disputada quando alguém chamava `restoreStreams` — o que
 * acontece uma vez, no boot. Uma instância que caísse deixava os streams dela parados
 * até o próximo deploy: o arrendamento vencia, ninguém percebia, e o dado simplesmente
 * parava de chegar sem nenhum erro em lugar nenhum.
 *
 * Ele é deliberadamente sonolento. O intervalo padrão é um terço do arrendamento, e
 * cada volta só busca o que NÃO tem dono vivo — não é uma varredura de tudo. Ciclos não
 * se sobrepõem: uma volta lenta atrasa a próxima em vez de rodar junto.
 */
/** Lido ao INICIAR, e não na carga do módulo: o ambiente já está montado nessa hora. */
const intervaloDeReconciliacao = (): number => Number(process.env.STREAM_RECONCILE_MS ?? Math.max(10_000, Math.floor(STREAM_LEASE_MS / 3)))
let reconciliador: NodeJS.Timeout | null = null
/** A volta em andamento, para o encerramento poder ESPERAR por ela. */
let voltaAtual: Promise<void> | null = null
/** Ligado no encerramento: nenhuma aquisição nova depois disto. */
let parando = false

export function startStreamReconciler(onError: (where: string, e: unknown) => void = () => undefined): void {
  if (reconciliador) return
  parando = false

  const volta = async () => {
    const gerente = streamManager()
    if (!gerente || parando) return
    try {
      // A espera após erro é o próprio intervalo vezes três: tempo suficiente para não
      // virar laço, curto o bastante para um endereço corrigido voltar sozinho.
      const orfaos = await listOrphanStreams(gerente.instanceId, new Date(), intervaloDeReconciliacao() * 3)
      for (const record of orfaos) {
        /**
         * Duas saídas antecipadas, e as duas importam.
         *
         * `parando` é conferido a CADA item: a consulta pode ter terminado depois do
         * início do encerramento, e reabrir um socket nessa hora seria abrir algo que
         * ninguém vai fechar.
         *
         * E o que já está vivo aqui é pulado: ele aparece na lista porque a posse é
         * desta instância, e mandá-lo para `start` seria uma ida ao banco por volta
         * para descobrir que já está de pé.
         */
        if (parando) return
        if (gerente.isTracked(record._id.toString())) continue
        await gerente.start(record).catch((e) => onError(`stream ${record._id.toString()} reconciliação`, e))
      }
    } catch (error) {
      onError('reconciliação de streams', error)
    }
  }

  const disparar = () => {
    // Ciclos não se sobrepõem: uma volta lenta atrasa a próxima em vez de rodar junto.
    if (voltaAtual || parando) return
    voltaAtual = volta().finally(() => {
      voltaAtual = null
    })
  }

  reconciliador = setInterval(disparar, intervaloDeReconciliacao())
  reconciliador.unref?.()
}

/**
 * Para o reconciliador E ESPERA a volta que já começou.
 *
 * Limpar o `setInterval` não basta: uma volta em andamento tem uma consulta no ar, e
 * quando ela voltar chamaria `start` para cada órfão — abrindo sockets no meio de um
 * encerramento. `parando` corta as aquisições na hora; a espera garante que ninguém
 * fique executando depois que esta função retorna.
 */
export async function stopStreamReconciler(): Promise<void> {
  parando = true
  if (reconciliador) clearInterval(reconciliador)
  reconciliador = null
  await voltaAtual?.catch(() => undefined)
  voltaAtual = null
}

export async function restoreStreams(onError: (where: string, e: unknown) => void = () => undefined): Promise<number> {
  const gerente = streamManager()
  if (!gerente) return 0
  const pendentes = await listResumableStreams()
  let subiram = 0
  for (const record of pendentes) {
    try {
      // Só conta o que ESTE processo assumiu: um stream cuja posse é de outra instância
      // não subiu aqui, e contá-lo faria o log dizer que restaurou o que não restaurou.
      if (await gerente.start(record)) subiram += 1
    } catch (error) {
      onError(`stream ${record._id.toString()} restauração`, error)
    }
  }
  return subiram
}

/** Criar o gerenciador deste processo. Chamado uma vez, quando o motor sobe. */
export function createStreamManager(
  onError?: (where: string, e: unknown) => void,
  adapterFor?: (record: StreamRecord) => Promise<StreamAdapter | null>,
): StreamManager {
  const m = new StreamManager({
    adapters,
    credentialsOf: streamCredentials,
    onError,
    createSocket: createRealSocket,
    ...(adapterFor ? { adapterFor } : {}),
  })
  setStreamManager(m)
  return m
}

export async function shutdownStreams(): Promise<void> {
  // O reconciliador para ANTES de tudo — e o encerramento ESPERA a volta em andamento:
  // uma consulta que voltasse depois disto tentaria assumir streams que este processo
  // está justamente largando.
  await stopStreamReconciler()
  const gerente = streamManager()
  await gerente?.stopAll()
  // Rede de segurança: `stopAll` já solta a posse de cada stream, mas um que tenha
  // falhado no caminho não pode deixar o arrendamento pendurado até vencer.
  if (gerente) await releaseAllLeases(gerente.instanceId).catch(() => undefined)
  setStreamManager(null)
  /**
   * O que estava dentro da janela de gravação vai ao banco ANTES de o processo sair.
   *
   * Sem isto, o valor mais recente de cada chave — que é o único que interessa — era
   * justamente o que se perdia no SIGTERM. Falhar aqui não pode impedir o encerramento:
   * um dado ao vivo perdido é ruim, um processo que não morre é pior.
   */
  const { flushLiveData } = await import('../integrations/websocket/liveData.js')
  await flushLiveData().catch(() => undefined)
}
