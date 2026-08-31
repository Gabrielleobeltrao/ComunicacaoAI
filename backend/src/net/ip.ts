import net from 'node:net'

// O que é um endereço PÚBLICO — a resposta em um lugar só.
//
// A pergunta parece simples e não é: `::ffff:7f00:1` é 127.0.0.1 escrito em
// hexadecimal, `fe90::1` está dentro de fe80::/10 apesar de não começar com "fe80",
// `100.64.0.1` é a rede do provedor (CGNAT) e `198.18.0.1` é a faixa de benchmark que
// costuma estar roteada dentro do datacenter. Comparar prefixo por texto erra em todos
// esses casos — e cada erro é uma porta para a rede interna.
//
// Por isso aqui o endereço vira BYTES antes de qualquer decisão. É mais código que um
// `startsWith`, e é a diferença entre bloquear a faixa e bloquear a grafia.

/** Os 4 bytes de um IPv4, ou `null` se não for um. */
export function ipv4Bytes(ip: string): number[] | null {
  if (!net.isIPv4(ip)) return null
  const partes = ip.split('.').map(Number)
  return partes.length === 4 && partes.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? partes : null
}

/** Os 16 bytes de um IPv6, incluindo a forma com IPv4 no fim (`::ffff:1.2.3.4`). */
export function ipv6Bytes(ip: string): number[] | null {
  if (!net.isIPv6(ip)) return null
  // A zona (`%eth0`) não faz parte do endereço.
  const semZona = ip.split('%')[0]
  const [cabeca, cauda = null] = semZona.split('::')
  const paraGrupos = (parte: string): string[] => (parte ? parte.split(':').filter((g) => g !== '') : [])

  const expandir = (grupos: string[]): number[] | null => {
    const bytes: number[] = []
    for (const g of grupos) {
      if (g.includes('.')) {
        // IPv4 embutido no fim: `::ffff:127.0.0.1`.
        const v4 = ipv4Bytes(g)
        if (!v4) return null
        bytes.push(...v4)
        continue
      }
      const valor = Number.parseInt(g, 16)
      if (!Number.isFinite(valor) || valor < 0 || valor > 0xffff) return null
      bytes.push(valor >> 8, valor & 0xff)
    }
    return bytes
  }

  const esquerda = expandir(paraGrupos(cabeca))
  const direita = cauda === null ? [] : expandir(paraGrupos(cauda))
  if (!esquerda || !direita) return null
  if (cauda === null) return esquerda.length === 16 ? esquerda : null
  const faltando = 16 - esquerda.length - direita.length
  if (faltando < 0) return null
  return [...esquerda, ...Array(faltando).fill(0), ...direita]
}

/** Um IPv4 dentro de qualquer faixa que a plataforma não alcança. */
function v4Privado(b: number[]): boolean {
  const [a, s] = b
  if (a === 0) return true // "este host"
  if (a === 10) return true // privada
  if (a === 100 && s >= 64 && s <= 127) return true // CGNAT 100.64/10 — a rede do provedor
  if (a === 127) return true // loopback
  if (a === 169 && s === 254) return true // link-local E o metadata das nuvens
  if (a === 172 && s >= 16 && s <= 31) return true // privada
  if (a === 192 && s === 0 && b[2] === 0) return true // IETF protocol assignments
  if (a === 192 && s === 0 && b[2] === 2) return true // documentação
  if (a === 192 && s === 88 && b[2] === 99) return true // 6to4 relay anycast
  if (a === 192 && s === 168) return true // privada
  if (a === 198 && (s === 18 || s === 19)) return true // benchmarking 198.18/15
  if (a === 198 && s === 51 && b[2] === 100) return true // documentação
  if (a === 203 && s === 0 && b[2] === 113) return true // documentação
  if (a >= 224) return true // multicast (224/4) e reservado/broadcast (240/4)
  return false
}

const zeros = (b: number[], ate: number): boolean => b.slice(0, ate).every((x) => x === 0)

/**
 * `true` para todo endereço que o servidor NÃO pode alcançar a mando de um usuário.
 *
 * Não é "IP privado" no sentido estrito: é "endereço que não deveria ser destino de uma
 * requisição que alguém de fora pediu". Multicast, documentação e faixas reservadas
 * entram porque nenhuma delas é um serviço legítimo na internet, e todas já foram
 * usadas para atravessar filtros ingênuos.
 */
export function isPrivateIp(ip: string): boolean {
  const bruto = String(ip ?? '').trim()
  const semColchetes = bruto.startsWith('[') && bruto.endsWith(']') ? bruto.slice(1, -1) : bruto

  const v4 = ipv4Bytes(semColchetes)
  if (v4) return v4Privado(v4)

  const b = ipv6Bytes(semColchetes)
  // O que não dá para interpretar não passa: recusar é o único erro reversível aqui.
  if (!b) return true

  if (zeros(b, 15) && (b[15] === 0 || b[15] === 1)) return true // :: e ::1

  // IPv4-mapeado (::ffff:a.b.c.d) e IPv4-compatível (::a.b.c.d): o endereço REAL é o
  // IPv4 de dentro, e é ele que precisa ser conferido. `::ffff:7f00:1` é 127.0.0.1.
  if (zeros(b, 10) && b[10] === 0xff && b[11] === 0xff) return v4Privado(b.slice(12))
  if (zeros(b, 12)) return true // ::a.b.c.d e o resto do bloco ::/96, todos obsoletos

  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(b.slice(4), 8)) return v4Privado(b.slice(12)) // NAT64 64:ff9b::/96
  if (b[0] === 0x20 && b[1] === 0x02) return v4Privado(b.slice(2, 6)) // 6to4 2002::/16
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true // documentação
  if (b[0] === 0x01 && b[1] === 0x00 && zeros(b.slice(2), 6)) return true // descarte 100::/64
  if ((b[0] & 0xfe) === 0xfc) return true // ULA fc00::/7
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true // link-local fe80::/10 INTEIRO
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true // site-local fec0::/10 (obsoleto)
  if (b[0] === 0xff) return true // multicast ff00::/8

  return false
}

/** Loopback — a única exceção, e só onde o interruptor de teste está ligado. */
export const isLoopbackIp = (ip: string): boolean => {
  const v4 = ipv4Bytes(ip)
  if (v4) return v4[0] === 127
  const b = ipv6Bytes(ip)
  if (!b) return false
  if (zeros(b, 15) && b[15] === 1) return true
  if (zeros(b, 10) && b[10] === 0xff && b[11] === 0xff) return b[12] === 127
  return false
}
