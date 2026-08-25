import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { isPrivateIp } from './safeHttp.js'

/**
 * Para onde um WebSocket PODE apontar.
 *
 * O endereço vem do usuário e quem conecta é o servidor — é a definição de SSRF, e um
 * WebSocket é pior que um GET: ele fica aberto, mantém a conexão e recebe dados
 * continuamente de onde quer que tenha chegado.
 *
 * A conferência acontece ao conectar E ao RECONECTAR, de propósito. Um nome que
 * resolvia para um endereço público na primeira vez pode resolver para 169.254.169.254
 * na segunda — é o ataque de rebinding, e ele só é pego se o DNS for consultado de novo
 * a cada tentativa.
 */

export class WebSocketTargetError extends Error {}

/**
 * `ws://` só fora de produção.
 *
 * Em produção o tráfego sai da nossa rede com a credencial do dono dentro: texto claro
 * não é uma escolha que caiba num campo de formulário.
 */
const emProducao = (): boolean => process.env.NODE_ENV === 'production'

/**
 * Loopback liberado só onde já era: o mesmo interruptor do HTTP, que a validação de
 * produção recusa. É ele que permite um servidor WebSocket de teste na própria máquina
 * sem afrouxar nada em produção.
 */
const loopbackLiberado = (): boolean => process.env.ALLOW_LOOPBACK_HTTP_TARGETS === '1'
const ehLoopback = (ip: string): boolean => ip === '127.0.0.1' || ip.startsWith('127.') || ip === '::1'

/** Nomes que nunca saem da máquina ou da rede de dentro, por convenção. */
const HOSTS_PROIBIDOS = [/^localhost$/i, /\.local$/i, /\.internal$/i, /^metadata(\.google)?\.internal$/i]

export interface CheckedTarget {
  url: URL
  /** O IP que o nome resolveu AGORA. Guardado para o log dizer para onde a conexão foi. */
  address: string
}

/**
 * O endereço conferido, ou a recusa com o motivo.
 *
 * Devolve a URL já normalizada: quem conecta usa esta, e não a string que o usuário
 * digitou — assim não há espaço entre o que foi conferido e o que é usado.
 */
export async function assertPublicWebSocketUrl(bruto: string): Promise<CheckedTarget> {
  let url: URL
  try {
    url = new URL(String(bruto ?? '').trim())
  } catch {
    throw new WebSocketTargetError('Endereço inválido.')
  }

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new WebSocketTargetError('O endereço precisa começar com wss://.')
  }
  if (url.protocol === 'ws:' && emProducao()) {
    throw new WebSocketTargetError('Em produção, só wss:// é aceito — ws:// trafega a credencial em texto claro.')
  }

  const host = url.hostname.toLowerCase()
  if (!host) throw new WebSocketTargetError('O endereço precisa de um domínio.')
  if (HOSTS_PROIBIDOS.some((r) => r.test(host))) throw new WebSocketTargetError('Este host não é permitido.')

  if (net.isIP(host)) {
    // Um IP escrito à mão pula o DNS — e é justamente por isso que ele precisa da
    // mesma conferência.
    if (isPrivateIp(host) && !(loopbackLiberado() && ehLoopback(host))) {
      throw new WebSocketTargetError('Endereço de rede interna não é permitido.')
    }
    return { url, address: host }
  }

  let address: string
  try {
    ;({ address } = await lookup(host))
  } catch {
    throw new WebSocketTargetError('Não foi possível resolver o domínio.')
  }
  if (isPrivateIp(address) && !(loopbackLiberado() && ehLoopback(address))) {
    throw new WebSocketTargetError('O domínio aponta para uma rede interna.')
  }
  return { url, address }
}

/** A mesma conferência, em forma de resposta — para a tela poder explicar antes de salvar. */
export async function checkWebSocketUrl(bruto: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { url } = await assertPublicWebSocketUrl(bruto)
    return { ok: true, message: `Endereço aceito (${url.host}).` }
  } catch (error) {
    return { ok: false, message: error instanceof WebSocketTargetError ? error.message : 'Endereço inválido.' }
  }
}
