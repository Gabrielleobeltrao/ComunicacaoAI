import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// O GUARDA de destino — e ele roda em TODA requisição, não só na primeira.
//
// O erro clássico aqui é validar a URL que a pessoa digitou e depois seguir redirects
// alegremente. O segundo salto é o que importa: `https://encurtador.exemplo/abc` resolve
// para `169.254.169.254` e a página de metadados da nuvem sai pela porta da frente.
//
// Pior ainda é o DNS rebinding: o mesmo nome resolve para um endereço público na
// validação e para um privado na conexão. Por isso o que se valida é o ENDEREÇO resolvido,
// e é ele que a conexão usa — não o nome de novo.

/** Faixas que nunca são alvo legítimo de uma fonte de monitoramento. */
const BLOQUEADAS_V4 = [
  [0, 8], // "este" host
  [10, 8],
  [100, 10, 64], // CGNAT 100.64/10
  [127, 8],
  [169, 16, 254], // link-local e metadata
  [172, 12, 16], // 172.16/12
  [192, 16, 168],
  [198, 15, 18], // benchmark
  [224, 4], // multicast
  [240, 4], // reservado
]

export function isPrivateIPv4(endereco) {
  const partes = endereco.split('.').map(Number)
  if (partes.length !== 4 || partes.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true
  const [a, b] = partes
  for (const [primeiro, bits, segundo] of BLOQUEADAS_V4) {
    if (a !== primeiro) continue
    if (bits <= 8) return true
    if (segundo === undefined) return true
    // Para /12 e /16 o segundo octeto decide.
    if (bits === 12) return b >= segundo && b < segundo + 16
    if (bits === 10) return b >= segundo && b < segundo + 64
    if (bits === 15) return b >= segundo && b < segundo + 2
    return b === segundo
  }
  return false
}

export function isPrivateIPv6(endereco) {
  const e = endereco.toLowerCase().replace(/^\[|\]$/g, '')
  if (e === '::1' || e === '::') return true
  if (e.startsWith('fe80') || e.startsWith('fc') || e.startsWith('fd')) return true
  // IPv4 mapeado: `::ffff:169.254.169.254` alcança a mesma metadata pela porta dos fundos.
  const mapeado = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(e)
  return mapeado ? isPrivateIPv4(mapeado[1]) : false
}

export const isPrivateAddress = (endereco) => (isIP(endereco) === 6 ? isPrivateIPv6(endereco) : isPrivateIPv4(endereco))

/**
 * A válvula do TESTE — e por que ela não é um risco.
 *
 * Sem ela, testar a busca exigiria um servidor na internet: o alvo local é loopback, que é
 * justamente o que o guarda existe para recusar. A variável é lida do ambiente do
 * PROCESSO, nunca de um pedido, e em produção ninguém a define — o mesmo padrão que o
 * backend já usa para a ferramenta HTTP.
 */
const loopbackLiberado = () => process.env.BROWSER_ALLOW_LOOPBACK === '1'

/** O que a conferência de verdade usa: privado, a menos que a válvula esteja aberta. */
const bloqueado = (endereco) => {
  if (!isPrivateAddress(endereco)) return false
  // A válvula libera SÓ loopback. Metadata e rede privada continuam recusadas mesmo com
  // ela aberta — senão o teste estaria medindo um sistema que não existe em produção.
  if (loopbackLiberado() && (endereco === '127.0.0.1' || endereco === '::1' || endereco.startsWith('127.'))) return false
  return true
}

export class BlockedTarget extends Error {
  constructor(message) {
    super(message)
    this.code = 'blocked'
  }
}

/**
 * Resolve o nome e devolve o ENDEREÇO validado.
 *
 * Devolver o endereço, e não só um "pode", é o que fecha o rebinding: quem conecta usa
 * exatamente o que foi conferido, e não pergunta ao DNS de novo.
 */
export async function checkTarget(rawUrl, resolver = lookup) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new BlockedTarget('endereço inválido')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BlockedTarget('só http e https')
  if (url.username || url.password) throw new BlockedTarget('credencial no endereço não é permitida')

  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    if (bloqueado(host)) throw new BlockedTarget('endereço de rede interna não é permitido')
    return { url, address: host, family: isIP(host) }
  }

  let resolvidos
  try {
    resolvidos = await resolver(host, { all: true })
  } catch {
    throw new BlockedTarget('não foi possível resolver o endereço')
  }
  const lista = Array.isArray(resolvidos) ? resolvidos : [resolvidos]
  if (lista.length === 0) throw new BlockedTarget('não foi possível resolver o endereço')

  // TODOS precisam ser públicos: um nome que resolve para um público e um privado é
  // exatamente o ataque, e escolher "o primeiro que serve" seria cair nele.
  for (const r of lista) {
    if (bloqueado(r.address)) throw new BlockedTarget('endereço de rede interna não é permitido')
  }
  return { url, address: lista[0].address, family: lista[0].family }
}
