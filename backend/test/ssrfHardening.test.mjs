// A porta de saída: quem o servidor pode alcançar quando o endereço vem de fora.
//
// Cada caso aqui já foi um jeito real de atravessar um filtro ingênuo. `::ffff:7f00:1`
// é 127.0.0.1 em hexadecimal; `fe90::1` está dentro de fe80::/10 sem começar com
// "fe80"; 100.64/10 é a rede do provedor e 198.18/15 costuma estar roteada dentro do
// datacenter. Um `startsWith` deixa os quatro passarem.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { isPrivateIp, ipv6Bytes } = await import('../dist/net/ip.js')
const { safeFetch, checkPublicUrl, setHttpResolver, hostPermitido } = await import('../dist/net/safeHttp.js')

// --- o classificador -------------------------------------------------------------------

test('os quatro que passavam indevidamente agora são recusados', () => {
  for (const ip of ['::ffff:7f00:1', 'fe90::1', '100.64.0.1', '198.18.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip)
  }
})

test('toda a família de escapes, e não só a grafia mais comum', () => {
  const proibidos = [
    '0.0.0.0', '0.1.2.3',                       // "este host"
    '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '127.0.0.1', '127.1.2.3',
    '169.254.169.254',                          // metadata da nuvem
    '100.64.0.1', '100.127.255.255',            // CGNAT /10 inteiro
    '198.18.0.1', '198.19.255.255',             // benchmarking /15 inteiro
    '192.0.0.1', '192.0.2.1', '192.88.99.1', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '239.255.255.255',             // multicast
    '240.0.0.1', '255.255.255.255',             // reservado e broadcast
    '::', '::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', // IPv4-mapeado nas duas grafias
    '::127.0.0.1',                              // IPv4-compatível
    'fc00::1', 'fd12:3456::1',                  // ULA
    'fe80::1', 'fe90::1', 'fea0::1', 'febf::1', // link-local /10 INTEIRO
    'fec0::1',                                  // site-local
    'ff02::1', 'ff05::2',                       // multicast
    '2001:db8::1',                              // documentação
    '2002:7f00:1::',                            // 6to4 com 127.0.0.1 dentro
    '64:ff9b::a9fe:a9fe',                       // NAT64 com o metadata dentro
    '100::1',                                   // descarte
  ]
  for (const ip of proibidos) assert.equal(isPrivateIp(ip), true, `deveria bloquear ${ip}`)
})

test('endereço público de verdade continua passando — senão o filtro não serve', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPrivateIp(ip), false, ip)
  }
})

test('o que não dá para interpretar é recusado — recusar é o erro reversível', () => {
  for (const lixo of ['', 'nao-e-ip', '999.1.1.1', '::ggg', 'undefined']) assert.equal(isPrivateIp(lixo), true, lixo)
})

test('o IPv6 é lido em bytes, e a forma comprimida vira a mesma coisa que a expandida', () => {
  assert.deepEqual(ipv6Bytes('::1')?.slice(-2), [0, 1])
  assert.deepEqual(ipv6Bytes('0000:0000:0000:0000:0000:0000:0000:0001'), ipv6Bytes('::1'))
  assert.deepEqual(ipv6Bytes('::ffff:127.0.0.1'), ipv6Bytes('::ffff:7f00:1'))
})

// --- a URL -----------------------------------------------------------------------------

test('URL com usuário ou senha é recusada', async () => {
  await assert.rejects(() => checkPublicUrl('http://usuario:senha@example.com/'), /usuário ou senha/)
  await assert.rejects(() => checkPublicUrl('https://x:@example.com/'), /usuário ou senha/)
})

test('só http(s), e nome interno por convenção não passa', async () => {
  await assert.rejects(() => checkPublicUrl('file:///etc/passwd'), /http/)
  await assert.rejects(() => checkPublicUrl('gopher://example.com/'), /http/)
  for (const host of ['http://localhost/x', 'http://algo.local/x', 'http://api.internal/x', 'http://metadata.google.internal/x']) {
    await assert.rejects(() => checkPublicUrl(host), /não permitido/)
  }
})

test('IP interno escrito à mão não vira exceção por ser literal', async () => {
  for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/', 'http://[fe90::1]/', 'http://198.18.0.1/', 'http://[fc00::1]/']) {
    await assert.rejects(() => checkPublicUrl(url), /rede interna/)
  }
})

test('a exceção de teste é LOOPBACK, e só', async () => {
  // Este arquivo roda com ALLOW_LOOPBACK_HTTP_TARGETS=1 — é o que permite subir um
  // servidor em 127.0.0.1 e exercitar a camada de verdade. A porta que ela abre precisa
  // ser exatamente essa: um privado que não é loopback continua recusado, inclusive
  // escrito na forma mapeada.
  assert.ok(await checkPublicUrl('http://127.0.0.1/'))
  assert.ok(await checkPublicUrl('http://[::ffff:7f00:1]/'), '127.0.0.1 em hexadecimal continua sendo loopback')
  await assert.rejects(() => checkPublicUrl('http://[::ffff:10.0.0.1]/'), /rede interna/)
  await assert.rejects(() => checkPublicUrl('http://[::ffff:a9fe:a9fe]/'), /rede interna/)
})

// --- o DNS -----------------------------------------------------------------------------

const comResolvedor = async (mapa, fn) => {
  setHttpResolver(async (host) => mapa[host] ?? [])
  try {
    return await fn()
  } finally {
    setHttpResolver(null)
  }
}

test('TODOS os endereços do nome são conferidos, não o primeiro', async () => {
  // O ataque: um nome com um registro público e um interno. Conferir um e conectar em
  // outro é não conferir nada — quem escolhe na hora é o sistema operacional.
  await comResolvedor({ 'dois.example.com': [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }] }, async () => {
    await assert.rejects(() => checkPublicUrl('https://dois.example.com/'), /rede interna/)
  })
})

test('o endereço conferido é o que a conexão vai usar', async () => {
  await comResolvedor({ 'publico.example.com': [{ address: '93.184.216.34', family: 4 }] }, async () => {
    const alvo = await checkPublicUrl('https://publico.example.com/x')
    assert.equal(alvo.address, '93.184.216.34')
    assert.deepEqual(alvo.addresses, ['93.184.216.34'])
  })
})

test('resposta de DNS que não dá para conferir invalida a resolução inteira', async () => {
  await comResolvedor({ 'torto.example.com': [{ address: '93.184.216.34', family: 4 }, { address: undefined, family: 4 }] }, async () => {
    await assert.rejects(() => checkPublicUrl('https://torto.example.com/'), /inválido/)
  })
  await comResolvedor({ 'vazio.example.com': [] }, async () => {
    await assert.rejects(() => checkPublicUrl('https://vazio.example.com/'), /resolver/)
  })
})

// --- a conexão -------------------------------------------------------------------------

let servidor
let porta
let recebidas = []

before(async () => {
  servidor = http.createServer((req, res) => {
    recebidas.push({ url: req.url, host: req.headers.host, auth: req.headers.authorization, method: req.method })
    if (req.url === '/grande') {
      // Sem `content-length`: o teto só vale se for aplicado durante a leitura.
      res.writeHead(200, { 'content-type': 'text/plain' })
      let enviados = 0
      const empurrar = () => {
        while (enviados < 5_000_000) {
          enviados += 64_000
          if (!res.write('x'.repeat(64_000))) return res.once('drain', empurrar)
        }
        res.end()
      }
      empurrar()
      return
    }
    if (req.url === '/para-privado') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
      res.end()
      return
    }
    if (req.url === '/para-fora') {
      res.writeHead(302, { location: `http://outra.example.com:${porta}/destino` })
      res.end()
      return
    }
    if (req.url === '/interno') {
      res.writeHead(302, { location: '/destino' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('conteudo')
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  porta = servidor.address().port
})

after(async () => {
  setHttpResolver(null)
  await new Promise((r) => servidor.close(r))
})

const local = (caminho) => `http://127.0.0.1:${porta}${caminho}`

test('a conexão vai no IP conferido e o Host continua sendo o NOME', async () => {
  recebidas = []
  await comResolvedor({ 'site.example.com': [{ address: '127.0.0.1', family: 4 }] }, async () => {
    const r = await safeFetch(`http://site.example.com:${porta}/ok`)
    assert.equal(r.body, 'conteudo')
  })
  // É isto que faz a pinagem não quebrar hospedagem compartilhada nem TLS: o servidor
  // legítimo continua recebendo o nome, e é por ele que responde.
  assert.equal(recebidas[0].host, `site.example.com:${porta}`)
})

test('resposta sem tamanho declarado é ABORTADA ao passar do teto', async () => {
  // O teto antigo cortava o texto DEPOIS de baixar tudo: a memória era do atacante.
  await assert.rejects(() => safeFetch(local('/grande'), { maxBytes: 100_000 }), /grande demais/)
})

test('redirecionamento para rede interna é recusado no salto seguinte', async () => {
  await assert.rejects(() => safeFetch(local('/para-privado')), /rede interna/)
})

test('rebinding entre um salto e outro não passa', async () => {
  // O nome resolve para um endereço público no primeiro salto e para o metadata no
  // segundo. Só reconferir a CADA salto pega isso.
  let vez = 0
  setHttpResolver(async (host) => {
    if (host === 'muda.example.com') {
      vez += 1
      return vez === 1 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '169.254.169.254', family: 4 }]
    }
    return []
  })
  try {
    await assert.rejects(() => safeFetch(`http://muda.example.com:${porta}/interno`), /rede interna|resolver/)
  } finally {
    setHttpResolver(null)
  }
})

test('a credencial não atravessa troca de origem', async () => {
  recebidas = []
  await comResolvedor(
    { 'outra.example.com': [{ address: '127.0.0.1', family: 4 }] },
    async () => safeFetch(local('/para-fora'), { headers: { Authorization: 'Bearer token-de-teste' } }),
  )
  assert.equal(recebidas[0].auth, 'Bearer token-de-teste', 'o primeiro salto é o destino que a pessoa escolheu')
  assert.equal(recebidas[1].auth, undefined, 'o segundo foi escolhido pelo servidor anterior')
})

test('requisição com corpo não é reenviada para um host escolhido pelo servidor', async () => {
  await assert.rejects(() => safeFetch(local('/para-fora'), { method: 'POST', body: '{"a":1}' }), /corpo/)
})

test('a lista de hosts permitidos casa por sufixo, e não por pedaço do nome', () => {
  assert.equal(hostPermitido('api.twilio.com', ['twilio.com']), true)
  assert.equal(hostPermitido('twilio.com', ['twilio.com']), true)
  assert.equal(hostPermitido('evil-twilio.com', ['twilio.com']), false)
  assert.equal(hostPermitido('twilio.com.evil.test', ['twilio.com']), false)
})
