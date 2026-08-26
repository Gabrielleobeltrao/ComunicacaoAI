import { ObjectId } from 'mongodb'
import { ValidationError } from '../../building.js'
import { streamManager } from '../../streams/manager.js'
import { listStreamsForInstallation } from '../../streams/repository.js'
import type { WsConnectionConfig } from '../../apps/official/websocket/config.js'
import { readAt } from '../../apps/official/websocket/config.js'
import { matchesFilters } from './pipeline.js'
import { activeSubscriptions, writeLog } from './repository.js'
import type { StreamAdapter, StreamRecord } from '../../streams/types.js'
import type { WsSubscription } from './types.js'

/**
 * As INSCRIÇÕES, de verdade.
 *
 * Guardar a mensagem de inscrição e nunca mandá-la é a diferença entre uma conexão que
 * recebe e uma que fica aberta em silêncio — e o silêncio parece funcionamento.
 *
 * Quatro momentos mandam quadro: ao conectar, ao reconectar (o serviço esqueceu tudo),
 * ao criar ou ativar uma assinatura com o socket já de pé, e ao pausar ou remover.
 */

/**
 * Uma mensagem de inscrição, conferida contra o formato da conexão.
 *
 * Numa conexão JSON, texto solto é erro de configuração e precisa aparecer na hora de
 * salvar — não na primeira vez que o serviço recusar o quadro, três dias depois.
 */
export function assertFrame(bruto: string, config: Pick<WsConnectionConfig, 'format'>, campo: string): string {
  const t = String(bruto ?? '').trim()
  if (!t) return ''
  if (config.format === 'json') {
    try {
      JSON.parse(t)
    } catch {
      throw new ValidationError(`${campo}: nesta conexão as mensagens são JSON, e este texto não é um JSON válido.`)
    }
  }
  return t
}

/** O stream vivo desta conexão, se houver um. */
async function streamDe(ownerId: string, installationId: string): Promise<string | null> {
  const streams = await listStreamsForInstallation(ownerId, installationId)
  const id = streams[0]?._id.toString()
  return id && streamManager()?.isConnected(id) ? id : null
}

/**
 * Manda um quadro por uma conexão de pé. Devolve se foi.
 *
 * `false` não é erro: assinar com o stream desligado é legítimo, e o quadro sai sozinho
 * no próximo `framesOnConnect`.
 */
async function mandar(ownerId: string, installationId: string, quadro: string, oque: 'subscribed' | 'dropped', assinatura: WsSubscription): Promise<boolean> {
  if (!quadro) return false
  const streamId = await streamDe(ownerId, installationId)
  if (!streamId) return false
  const foi = streamManager()?.send(streamId, quadro) ?? false
  if (foi) {
    // O log diz que assinou — nunca O QUE assinou. Uma inscrição pode conter
    // identificador de conta, chave de canal privado ou filtro que revela um cliente.
    await writeLog(ownerId, installationId, oque, oque === 'subscribed' ? `assinatura "${assinatura.name}" enviada` : `cancelamento de "${assinatura.name}" enviado`, assinatura._id.toString())
  }
  return foi
}

export const sendSubscribe = (ownerId: string, installationId: string, s: WsSubscription): Promise<boolean> =>
  mandar(ownerId, installationId, s.subscribeMessage, 'subscribed', s)

export const sendUnsubscribe = (ownerId: string, installationId: string, s: WsSubscription): Promise<boolean> =>
  mandar(ownerId, installationId, s.unsubscribeMessage, 'dropped', s)

/**
 * Um quadro AVULSO, escrito por quem está configurando.
 *
 * Mesmo caminho de sempre — o gerenciador, o socket que já está de pé —, e a mesma
 * regra: o log registra QUE foi enviado, nunca o conteúdo. Um quadro escrito à mão é
 * justamente onde alguém cola um token de sessão para testar.
 */
export async function sendRawFrame(ownerId: string, installationId: string, quadro: string): Promise<boolean> {
  const streamId = await streamDe(ownerId, installationId)
  if (!streamId) return false
  const foi = streamManager()?.send(streamId, quadro) ?? false
  if (foi) await writeLog(ownerId, installationId, 'subscribed', 'mensagem avulsa enviada pela tela')
  return foi
}

/**
 * Tudo que está assinado nesta conexão, para mandar ao conectar.
 *
 * É chamado a cada conexão e a cada reconexão: um serviço que caiu esqueceu tudo que
 * tinha sido pedido, e voltar conectado sem reassinar é voltar mudo.
 */
export async function framesOnConnect(ownerId: string, installationId: string): Promise<string[]> {
  const ativas = await activeSubscriptions(ownerId, installationId)
  const quadros = ativas.map((s) => s.subscribeMessage).filter(Boolean)
  if (quadros.length) {
    await writeLog(ownerId, installationId, 'subscribed', `${quadros.length} assinatura(s) enviada(s) ao conectar`)
  }
  return quadros
}

/** Uma assinatura por id, com o dono na consulta. */
export const idDe = (v: string): ObjectId | null => (ObjectId.isValid(v) ? new ObjectId(v) : null)

/**
 * TESTAR uma assinatura: abre, autentica, manda a inscrição, espera uma mensagem que
 * sirva e fecha tudo.
 *
 * Uma conexão à parte, e não a que está no ar: provar numa conexão viva significaria
 * mandar a inscrição de teste para o serviço de verdade e receber o resultado misturado
 * com o fluxo real. O que sai daqui é uma frase — nunca o segredo, nunca o payload.
 */
export async function testSubscription(
  ownerId: string,
  assinatura: WsSubscription,
  deps: {
    adapterFor: (record: StreamRecord) => Promise<StreamAdapter | null>
    credentialsOf: (ownerId: string, installationId: string) => Promise<Record<string, string> | null>
    /** A configuração da conexão — é dela que sai onde o canal mora na mensagem. */
    configOf: (ownerId: string, installationId: string) => Promise<{ paths: { channel: string } } | null>
  },
): Promise<{ ok: boolean; message: string }> {
  const gerente = streamManager()
  if (!gerente) return { ok: false, message: 'O motor de streams não está no ar neste processo.' }

  /**
   * Um registro SÓ para resolver o adapter — ele não é gravado nem gerenciado.
   *
   * O resolvedor precisa de dono, App e conexão; o resto do documento não é lido por
   * ele. Montar um de mentira aqui é mais honesto do que criar um stream de verdade
   * para depois desfazer.
   */
  const adapter = await deps.adapterFor({
    ownerId,
    appKey: 'websocket',
    installationId: assinatura.installationId,
    environment: 'default',
  } as StreamRecord)
  if (!adapter) return { ok: false, message: 'A conexão desta assinatura não está configurada.' }

  const credencial = await deps.credentialsOf(ownerId, assinatura.installationId)
  if (!credencial) return { ok: false, message: 'A conexão está revogada ou não existe mais.' }

  /**
   * Onde o canal mora NESTA conexão.
   *
   * Antes daqui o teste procurava um campo chamado `channel`, que é o nome que ele tem
   * em alguns serviços e em nenhum outro. Uma assinatura por canal era aprovada por
   * engano — o campo não existia, a comparação era pulada, e qualquer mensagem servia.
   */
  const config = await deps.configOf(ownerId, assinatura.installationId)
  const caminhoDoCanal = config?.paths.channel ?? ''

  const resultado = await gerente.probe(adapter, 'default', credencial, TEST_TIMEOUT_MS, {
    frame: assinatura.subscribeMessage,
    // "Serve" é a mesma pergunta que a entrega faz: canal e filtros da assinatura. Uma
    // prova mais frouxa aprovaria uma assinatura que nunca vai receber nada.
    aceita: (bruto) => {
      if (assinatura.channel) {
        // Sem caminho configurado não há como saber o canal — e aprovar assim mesmo
        // seria aprovar o que não foi conferido.
        if (!caminhoDoCanal) return false
        const canal = readAt(bruto, caminhoDoCanal)
        if (canal === undefined || canal === null || String(canal) !== assinatura.channel) return false
      }
      return matchesFilters(bruto, assinatura.filters)
    },
    mensagemOk: 'Chegou uma mensagem compatível com esta assinatura.',
  })
  await writeLog(ownerId, assinatura.installationId, resultado.ok ? 'subscribed' : 'error', `teste da assinatura "${assinatura.name}": ${resultado.ok ? 'ok' : 'sem mensagem compatível'}`, assinatura._id.toString())
  return resultado
}

/** Quanto tempo esperar por uma mensagem no teste. Alguém está olhando a tela. */
export const TEST_TIMEOUT_MS = Number(process.env.WS_TEST_TIMEOUT_MS ?? 10_000)


/**
 * TESTAR A CONEXÃO: abre com a configuração real, autentica e fecha.
 *
 * O botão existia e não abria nada — o teste genérico de App confere se os campos
 * obrigatórios estão preenchidos, e responde "a configuração está completa", que não é
 * a pergunta de quem clica. Um endereço errado, um subprotocolo que o serviço recusa ou
 * uma credencial inválida passavam por ele.
 *
 * O que sai daqui é `ok` e uma frase nossa. Nunca o quadro, nunca o corpo da resposta,
 * nunca a credencial: um erro de autenticação costuma vir do provedor com a mensagem
 * que o causou junto, e a mensagem que o causou é a que tem a chave.
 */
export async function testConnection(
  ownerId: string,
  installationId: string,
  deps: {
    adapterFor: (record: StreamRecord) => Promise<StreamAdapter | null>
    credentialsOf: (ownerId: string, installationId: string) => Promise<Record<string, string> | null>
    /** Um gerenciador para a sonda. Ela não usa estado — serve o do processo ou um novo. */
    manager: () => { probe: StreamManagerProbe } | null
  },
): Promise<{ ok: boolean; message: string }> {
  const gerente = deps.manager()
  if (!gerente) return { ok: false, message: 'O motor de streams não está no ar neste processo.' }

  let adapter: StreamAdapter | null
  try {
    // Aqui dentro acontece a conferência de endereço e a resolução de DNS: um destino
    // interno é recusado no TESTE como é na conexão, e o endereço conferido é o mesmo
    // em que a sonda vai abrir.
    adapter = await deps.adapterFor({ ownerId, appKey: 'websocket', installationId, environment: 'default' } as StreamRecord)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'endereço recusado' }
  }
  if (!adapter) return { ok: false, message: 'Esta conexão ainda não está configurada. Informe o endereço antes de testar.' }

  /**
   * Sem credencial é caso legítimo: `auth.kind: "none"` é a configuração de todo serviço
   * público. Recusar aqui faria o teste falhar justamente no caso mais simples.
   */
  const credencial = (await deps.credentialsOf(ownerId, installationId)) ?? {}

  return gerente.probe(adapter, 'default', credencial, TEST_TIMEOUT_MS)
}

/** Só o pedaço do gerenciador que a sonda usa — o resto não é necessário aqui. */
type StreamManagerProbe = (
  adapter: StreamAdapter,
  environment: string,
  credencial: Record<string, string>,
  timeoutMs?: number,
) => Promise<{ ok: boolean; message: string }>
