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
 * Como um nome vira endereços.
 *
 * Injetável pela mesma razão que o socket e a posse: sem isto, provar "nome público
 * resolve para IP público e é aceito" ou "o DNS devolveu lixo" exigiria rede de
 * verdade — e um teste que depende de rede não é um teste, é um palpite.
 */
export type ResolvedAddress = { address: string; family: number }
export type WebSocketResolver = (hostname: string) => Promise<ResolvedAddress[]>

const resolverPadrao: WebSocketResolver = (hostname) => lookup(hostname, { all: true })
let resolverAtual: WebSocketResolver = resolverPadrao

export const setWebSocketResolver = (r: WebSocketResolver | null): void => {
  resolverAtual = r ?? resolverPadrao
}

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

/** Uma frase só para "o nome não resolveu", venha a falha de onde vier. */
const ERRO_DNS = 'Não foi possível resolver o hostname do serviço.'

/** Nomes que nunca saem da máquina ou da rede de dentro, por convenção. */
const HOSTS_PROIBIDOS = [/^localhost$/i, /\.local$/i, /\.internal$/i, /^metadata(\.google)?\.internal$/i]

export interface CheckedTarget {
  url: URL
  /** O endereço em que a conexão DEVE ser aberta — já conferido. */
  address: string
  /** O nome original, para o SNI e o cabeçalho `Host` continuarem certos. */
  hostname: string
  family: 4 | 6
  /** Todos os endereços que o nome devolveu. Todos foram conferidos. */
  addresses: string[]
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

  /**
   * Um IPv6 literal chega COM colchetes — `[::1]` —, e `net.isIP` não os reconhece.
   *
   * Sem tirá-los, `wss://[::1]/x` não caía no ramo de IP: ia para o DNS, que falhava, e
   * a recusa acontecia pelo motivo errado. Bastaria um resolvedor devolver algo para
   * um endereço interno literal atravessar a conferência de IP inteira.
   */
  const literal = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host

  if (net.isIP(literal)) {
    // Um IP escrito à mão pula o DNS — e é justamente por isso que ele precisa da
    // mesma conferência.
    if (bloqueado(literal)) throw new WebSocketTargetError('Endereço de rede interna não é permitido.')
    return { url, address: literal, hostname: literal, family: net.isIPv6(literal) ? 6 : 4, addresses: [literal] }
  }

  /**
   * TODOS os endereços do nome, e todos conferidos.
   *
   * `lookup` sem `all` devolve um só — e um nome com dois registros, um público e um
   * interno, passava pelo público e conectava no que o sistema operacional escolhesse
   * na hora. Conferir um e conectar em outro é não conferir nada.
   */
  let enderecos: ResolvedAddress[]
  try {
    enderecos = (await resolverAtual(host)) ?? []
  } catch {
    throw new WebSocketTargetError(ERRO_DNS)
  }
  if (!Array.isArray(enderecos) || enderecos.length === 0) throw new WebSocketTargetError(ERRO_DNS)

  /**
   * Só o que é IP DE VERDADE segue adiante.
   *
   * O validador de rede interna recebe uma string e confia nela. Uma entrada sem
   * `address` — resolvedor de terceiro, resposta truncada, formato inesperado — chegava
   * nele como `undefined` e explodia com um erro que não dizia nada a ninguém. Aqui a
   * regra é a segura: o que não dá para conferir não passa.
   */
  const validos = enderecos.filter((e) => typeof e?.address === 'string' && net.isIP(e.address) !== 0)
  if (validos.length === 0) throw new WebSocketTargetError(ERRO_DNS)
  if (validos.length !== enderecos.length) throw new WebSocketTargetError('A resolução do domínio devolveu um endereço que não dá para conferir.')

  const proibido = validos.find((e) => bloqueado(e.address))
  if (proibido) throw new WebSocketTargetError('O domínio aponta para uma rede interna.')

  /**
   * O primeiro conferido é o que a conexão vai usar — e ela usa o ENDEREÇO, não o nome.
   *
   * É o que fecha a janela do rebinding: entre conferir e conectar, o nome pode passar a
   * resolver para outra coisa. Conectando no endereço já conferido, não há intervalo em
   * que a resposta do DNS possa mudar o destino. O nome continua viajando à parte, para
   * o SNI e o `Host` continuarem certos.
   */
  const escolhido = validos[0]
  return {
    url,
    address: escolhido.address,
    hostname: host,
    // A família vem do que o endereço É, e não do que o resolvedor disse que ele era:
    // um `family: 4` acompanhando um IPv6 abriria o socket na pilha errada.
    family: net.isIPv6(escolhido.address) ? 6 : 4,
    addresses: validos.map((e) => e.address),
  }
}

/** Um endereço que a plataforma nunca alcança — com a exceção de loopback nos testes. */
const bloqueado = (ip: string): boolean => isPrivateIp(ip) && !(loopbackLiberado() && ehLoopback(ip))

/** A mesma conferência, em forma de resposta — para a tela poder explicar antes de salvar. */
export async function checkWebSocketUrl(bruto: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { url } = await assertPublicWebSocketUrl(bruto)
    return { ok: true, message: `Endereço aceito (${url.host}).` }
  } catch (error) {
    return { ok: false, message: error instanceof WebSocketTargetError ? error.message : 'Endereço inválido.' }
  }
}
