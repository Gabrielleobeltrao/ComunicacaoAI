// O WORKER de páginas — e o que ele recusa.
//
// Buscar página de terceiro é seguir endereço que outra pessoa escolheu. Estes casos
// cobrem o que impede isso de virar um jeito de alcançar a rede interna: revalidação a
// cada salto, subrequisição conferida como se fosse a primeira, e um interruptor.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createBrowserWorker } from '../src/server.mjs'
import { sign, __resetNonces } from '../src/auth.mjs'
import { checkTarget, isPrivateAddress, BlockedTarget } from '../src/guard.mjs'
import { fetchOnce, fetchWithSubrequests } from '../src/fetchPage.mjs'

// O alvo de teste é loopback — que é justamente o que o guarda recusa. A válvula libera
// SÓ loopback: metadata e rede privada continuam bloqueadas, senão o teste mediria um
// sistema que não existe em produção.
process.env.BROWSER_ALLOW_LOOPBACK = '1'

const SEGREDO = 'segredo-do-worker-de-teste'
let worker
let porta
let alvo
let portaAlvo
let respostas

before(async () => {
  worker = createBrowserWorker({ secret: SEGREDO })
  await new Promise((r) => worker.listen(0, '127.0.0.1', r))
  porta = worker.address().port

  alvo = createServer((req, res) => {
    // A página que NUNCA responde: é ela que prova que o teto do pedido devolve a vaga.
    if (req.url === '/trava') return
    const r = respostas[req.url] ?? respostas['*']
    if (!r) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      return res.end('nao')
    }
    res.writeHead(r.status ?? 200, r.headers ?? { 'content-type': 'text/html' })
    res.end(r.body ?? '')
  })
  await new Promise((r) => alvo.listen(0, '127.0.0.1', r))
  portaAlvo = alvo.address().port
})
after(async () => {
  await new Promise((r) => worker.close(r))
  await new Promise((r) => alvo.close(r))
})

/** O alvo é loopback; para exercitar o caminho feliz, o resolvedor devolve um IP público. */
const resolverFalso = async () => [{ address: '203.0.113.10', family: 4 }]

const chamar = async (caminho, corpo, over = {}) => {
  const body = JSON.stringify(corpo)
  const timestamp = over.timestamp ?? Date.now()
  const nonce = over.nonce ?? `n-${Math.random()}`
  const r = await fetch(`http://127.0.0.1:${porta}${caminho}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sandbox-timestamp': String(timestamp),
      'x-sandbox-nonce': nonce,
      'x-sandbox-signature': over.signature ?? sign(over.secret ?? SEGREDO, { timestamp, nonce, body }),
    },
    body,
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

// --- o guarda -----------------------------------------------------------------------

test('as faixas privadas e a metadata são reconhecidas', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1']) {
    assert.equal(isPrivateAddress(ip), true, ip)
  }
  for (const ip of ['8.8.8.8', '203.0.113.10', '172.32.0.1', '2606:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, ip)
  }
})

test('AMEAÇA: IPv4 mapeado em IPv6 não é porta dos fundos', () => {
  assert.equal(isPrivateAddress('::ffff:169.254.169.254'), true)
})

test('AMEAÇA: nome que resolve para privado é bloqueado', async () => {
  await assert.rejects(() => checkTarget('http://interno.exemplo/x', async () => [{ address: '10.0.0.5', family: 4 }]), BlockedTarget)
})

test('AMEAÇA: nome que resolve para público E privado é bloqueado inteiro', async () => {
  // Escolher "o primeiro que serve" seria cair exatamente no ataque.
  await assert.rejects(
    () => checkTarget('http://misto.exemplo/x', async () => [{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }]),
    /rede interna/,
  )
})

test('o guarda devolve o ENDEREÇO conferido — é isso que fecha o rebinding', async () => {
  const r = await checkTarget('https://exemplo.test/x', async () => [{ address: '203.0.113.7', family: 4 }])
  assert.equal(r.address, '203.0.113.7', 'quem conecta usa o que foi conferido, e não pergunta ao DNS de novo')
})

test('esquema e credencial no endereço são recusados', async () => {
  await assert.rejects(() => checkTarget('file:///etc/passwd'), /http e https/)
  await assert.rejects(() => checkTarget('http://user:senha@exemplo.test/'), /credencial no endereço/)
})

// --- a busca ---------------------------------------------------------------------------

test('busca uma página e devolve o conteúdo', async () => {
  respostas = { '/p': { body: '<html><body>ok</body></html>' } }
  const r = await fetchOnce(`http://exemplo.test:${portaAlvo}/p`, { resolver: async () => [{ address: '127.0.0.1', family: 4 }] })
  assert.match(r.body, /ok/)
  assert.equal(r.chain.length, 1)
})

test('AMEAÇA: o REDIRECT é revalidado — não só a URL digitada', async () => {
  respostas = { '/vai': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } } }
  await assert.rejects(
    () => fetchOnce(`http://exemplo.test:${portaAlvo}/vai`, { resolver: async (h) => [{ address: h === 'exemplo.test' ? '127.0.0.1' : '169.254.169.254', family: 4 }] }),
    /rede interna/,
  )
})

test('redirects demais é recusado', async () => {
  respostas = { '*': { status: 302, headers: { location: '/de-novo' } } }
  await assert.rejects(
    () => fetchOnce(`http://exemplo.test:${portaAlvo}/loop`, { resolver: async () => [{ address: '127.0.0.1', family: 4 }] }),
    /redirects demais/,
  )
})

test('AMEAÇA: download e binário são recusados', async () => {
  respostas = { '/bin': { headers: { 'content-type': 'application/octet-stream' }, body: 'MZ' } }
  await assert.rejects(
    () => fetchOnce(`http://exemplo.test:${portaAlvo}/bin`, { resolver: async () => [{ address: '127.0.0.1', family: 4 }] }),
    /tipo de conteúdo/,
  )

  respostas = { '/anexo': { headers: { 'content-type': 'text/html', 'content-disposition': 'attachment; filename=x.zip' }, body: 'x' } }
  await assert.rejects(
    () => fetchOnce(`http://exemplo.test:${portaAlvo}/anexo`, { resolver: async () => [{ address: '127.0.0.1', family: 4 }] }),
    /download não é permitido/,
  )
})

test('resposta grande demais é cortada com recusa', async () => {
  respostas = { '/grande': { body: 'x'.repeat(200_000) } }
  await assert.rejects(
    () => fetchOnce(`http://exemplo.test:${portaAlvo}/grande`, { resolver: async () => [{ address: '127.0.0.1', family: 4 }], limits: { maxBytes: 1000 } }),
    /limite de tamanho/,
  )
})

// --- as subrequisições ---------------------------------------------------------------------

test('a válvula de loopback NÃO libera metadata nem rede privada', async () => {
  await assert.rejects(() => checkTarget('http://169.254.169.254/x'), /rede interna/)
  await assert.rejects(() => checkTarget('http://10.0.0.1/x'), /rede interna/)
  await assert.doesNotReject(() => checkTarget('http://127.0.0.1:1/x'))
})

test('AMEAÇA: cada SUBREQUISIÇÃO é conferida como se fosse a primeira', async () => {
  respostas = { '/pagina': { body: '<html>ok</html>' }, '/ativo': { headers: { 'content-type': 'text/css' }, body: 'body{}' } }
  const r = await fetchWithSubrequests(
    `http://exemplo.test:${portaAlvo}/pagina`,
    [`http://exemplo.test:${portaAlvo}/ativo`, 'http://169.254.169.254/latest/meta-data/'],
    { resolver: async (h) => [{ address: h === 'exemplo.test' ? '127.0.0.1' : '169.254.169.254', family: 4 }] },
  )
  assert.equal(r.subrequests.length, 1, 'a legítima passou')
  assert.equal(r.blocked.length, 1, 'a que ia para a metadata foi bloqueada')
  assert.match(r.blocked[0].reason, /rede interna/)
  // E a página NÃO caiu por causa dela: derrubar tudo esconderia o conteúdo legítimo e a
  // informação de que alguém tentou.
  assert.match(r.body, /ok/)
})

test('o ORÇAMENTO de bytes limita o conjunto, não só cada uma', async () => {
  respostas = { '*': { body: 'y'.repeat(5_000) } }
  const muitas = Array.from({ length: 10 }, (_, i) => `http://exemplo.test:${portaAlvo}/a${i}`)
  const r = await fetchWithSubrequests(`http://exemplo.test:${portaAlvo}/p`, muitas, {
    resolver: async () => [{ address: '127.0.0.1', family: 4 }],
    limits: { maxTotalBytes: 12_000 },
  })
  assert.ok(r.subrequests.length < 10, `veio ${r.subrequests.length}`)
  assert.ok(r.blocked.some((b) => /orçamento/.test(b.reason)))
})

// --- o servidor ------------------------------------------------------------------------------

test('sem assinatura, o worker não atende', async () => {
  const r = await fetch(`http://127.0.0.1:${porta}/fetch`, { method: 'POST', body: '{}' })
  assert.equal(r.status, 401)
})

test('replay é recusado', async () => {
  const corpo = { url: 'https://exemplo.test/x' }
  const body = JSON.stringify(corpo)
  const timestamp = Date.now()
  const nonce = 'unico'
  const signature = sign(SEGREDO, { timestamp, nonce, body })
  await chamar('/fetch', corpo, { timestamp, nonce, signature })
  const replay = await chamar('/fetch', corpo, { timestamp, nonce, signature })
  assert.equal(replay.status, 401)
  __resetNonces()
})

test('o health diz o que ele faz E o que não faz', async () => {
  const r = await chamar('/health', {})
  assert.equal(r.body.capabilities.fetch, true)
  // Visão continua fora do worker: dizer que faz sem fazer é o que leva alguém a
  // configurar uma fonte que nunca vai funcionar. Ela é do backend, que tem o provedor.
  assert.equal(r.body.capabilities.vision, false)
})

test('o KILL SWITCH recusa tudo sem derrubar o processo', async () => {
  process.env.BROWSER_KILL_SWITCH = '1'
  try {
    const saude = await chamar('/health', {})
    assert.equal(saude.body.ok, false)
    assert.equal(saude.body.killSwitch, true)
    const busca = await chamar('/fetch', { url: 'https://exemplo.test/x' })
    assert.equal(busca.status, 503)
  } finally {
    delete process.env.BROWSER_KILL_SWITCH
  }
})

test('a busca por HTTP devolve erro TIPADO, e não exceção', async () => {
  const r = await chamar('/fetch', { url: 'http://169.254.169.254/latest/meta-data/' })
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, false)
  assert.equal(r.body.error.kind, 'blocked')
})

// --- a RENDERIZAÇÃO de verdade ----------------------------------------------------------
//
// O descuido clássico mora aqui: validar a URL digitada e deixar o navegador buscar tudo o
// que a página pedir é entregar a decisão para a página. Um `fetch` para a metadata dentro
// do JavaScript dela sai pela rede do worker, e a validação inicial não impediu nada.

import { loadEngine, renderPage } from '../src/render.mjs'

test('a capacidade de renderizar é MEDIDA, não declarada', async () => {
  const motor = await loadEngine()
  const r = await chamar('/health', {})
  assert.equal(r.body.capabilities.render, Boolean(motor), 'dizer que renderiza sem conseguir faria configurar uma fonte que nunca ia funcionar')
})

test('RENDERIZA a página e devolve o HTML depois do JavaScript', async (t) => {
  const motor = await loadEngine()
  if (!motor) return t.skip('sem motor neste ambiente')

  respostas = {
    '/render': {
      body: '<html><body><div id="alvo">antes</div><script>document.getElementById("alvo").textContent="depois"</script></body></html>',
    },
  }
  const r = await renderPage(`http://127.0.0.1:${portaAlvo}/render`, { engine: motor })
  assert.equal(r.rendered, true)
  // O HTML cru diz "antes"; o renderizado diz "depois". É essa a diferença que o motor faz.
  assert.match(r.body, /depois/)
  assert.ok(!/>antes</.test(r.body))
})

test('AMEAÇA: subrequisição para a METADATA é abortada, e a página continua', async (t) => {
  const motor = await loadEngine()
  if (!motor) return t.skip('sem motor neste ambiente')

  respostas = {
    '/comFetch': {
      body: `<html><body><div id="ok">conteudo legitimo</div>
        <script>fetch('http://169.254.169.254/latest/meta-data/').catch(()=>{})</script>
        </body></html>`,
    },
  }
  const r = await renderPage(`http://127.0.0.1:${portaAlvo}/comFetch`, { engine: motor })

  assert.match(r.body, /conteudo legitimo/, 'derrubar tudo esconderia o conteúdo e a tentativa')
  assert.ok(
    r.blocked.some((b) => b.url.includes('169.254.169.254')),
    `a tentativa precisa aparecer: ${JSON.stringify(r.blocked)}`,
  )
})

test('AMEAÇA: imagem apontando para rede privada é abortada', async (t) => {
  const motor = await loadEngine()
  if (!motor) return t.skip('sem motor neste ambiente')

  respostas = { '/comImg': { body: '<html><body><img src="http://10.0.0.5/logo.png"><p>texto</p></body></html>' } }
  const r = await renderPage(`http://127.0.0.1:${portaAlvo}/comImg`, { engine: motor })
  assert.ok(r.blocked.some((b) => b.url.includes('10.0.0.5')))
  assert.match(r.body, /texto/)
})

test('a renderização respeita o teto de subrequisições', async (t) => {
  const motor = await loadEngine()
  if (!motor) return t.skip('sem motor neste ambiente')

  const muitas = Array.from({ length: 30 }, (_, i) => `<img src="/img${i}.png">`).join('')
  respostas = { '*': { headers: { 'content-type': 'text/html' }, body: `<html><body>${muitas}</body></html>` } }
  const r = await renderPage(`http://127.0.0.1:${portaAlvo}/muitas`, { engine: motor, limits: { maxSubrequests: 5 } })
  // O que o teto garante é quantas requisições SAEM. As recusas acima do teto continuam
  // sendo registradas — esconder que a página pediu mais trinta seria perder a informação
  // que importa quando alguém for investigar.
  assert.ok(r.subrequests.length <= 5, `saíram ${r.subrequests.length}`)
  assert.ok(r.blocked.some((b) => /limite de subrequisições/.test(b.reason)))
})

test('sem motor, renderizar RECUSA em vez de fingir', async () => {
  await assert.rejects(() => renderPage('https://exemplo.test/x', { engine: null }), /motor de renderização/)
})

test('o RETRATO só é tirado quando pedido', async (t) => {
  const motor = await loadEngine()
  if (!motor) return t.skip('sem motor neste ambiente')

  respostas = { '/foto': { body: '<html><body><div id="alvo">R$ 42,50</div></body></html>' } }

  const sem = await renderPage(`http://127.0.0.1:${portaAlvo}/foto`, { engine: motor })
  assert.equal(sem.screenshot, undefined, 'tirar sempre custaria bytes e tokens em toda coleta')

  const com = await renderPage(`http://127.0.0.1:${portaAlvo}/foto`, { engine: motor, screenshot: true })
  assert.ok(com.screenshot.bytes > 0)
  assert.match(com.screenshot.base64.slice(0, 8), /^iVBOR/, 'é um PNG')
})

test('com seletor, o retrato é CORTADO no elemento', async (t) => {
  const motor = await loadEngine()
  if (!motor) return t.skip('sem motor neste ambiente')

  respostas = { '/corte': { body: '<html><body><p>muito texto irrelevante</p><div id="alvo">R$ 42,50</div></body></html>' } }
  const r = await renderPage(`http://127.0.0.1:${portaAlvo}/corte`, { engine: motor, screenshot: true, selector: '#alvo' })
  // Mandar a página inteira para um modelo de visão é dar a ele mais chance de ler o
  // número errado, além de custar mais.
  assert.equal(r.screenshot.croppedTo, '#alvo')
})

test('o health diz que retrata quando há motor', async () => {
  const motor = await loadEngine()
  const r = await chamar('/health', {})
  assert.equal(r.body.capabilities.screenshot, Boolean(motor))
  // Visão continua fora do worker: ela é do backend, que tem o provedor de modelo.
  assert.equal(r.body.capabilities.vision, false)
})

// --- DNS REBINDING: o ataque com nome ----------------------------------------------------
//
// Conferir o endereço e depois deixar o Chromium resolver de novo não fecha nada: entre a
// conferência e a conexão, o mesmo nome pode passar a responder um endereço privado. O que
// prova que fechou é a conexão acontecer NO ENDEREÇO CONFERIDO — e a prova é um nome que o
// DNS de verdade não resolve: se a página carrega, ninguém perguntou ao DNS.

test('AMEAÇA: a página é buscada no ENDEREÇO conferido, não no nome resolvido de novo', async (t) => {
  const motor = await loadEngine()
  if (!motor) return t.skip('sem motor neste ambiente')

  respostas = { '*': { headers: { 'content-type': 'text/html' }, body: '<html><body><p id="x">servido pelo endereco fixado</p></body></html>' } }
  // Um nome que o DNS real não conhece. Só o resolvedor injetado sabe onde ele mora.
  const resolver = async () => [{ address: '127.0.0.1', family: 4 }]
  const r = await renderPage(`http://alvo-que-nao-existe.invalid:${portaAlvo}/x`, { engine: motor, resolver })

  assert.match(r.body, /servido pelo endereco fixado/, 'se o navegador tivesse resolvido sozinho, este nome não iria a lugar nenhum')
})

test('AMEAÇA: o nome que MUDA de endereço entre a conferência e a subrequisição não passa', async (t) => {
  const motor = await loadEngine()
  if (!motor) return t.skip('sem motor neste ambiente')

  respostas = {
    '*': {
      headers: { 'content-type': 'text/html' },
      body: '<html><body><p>legitimo</p><script>fetch("/segunda").catch(()=>{})</script></body></html>',
    },
  }
  // O nome responde loopback (liberado no teste) nas duas primeiras resoluções — a
  // conferência prévia, antes de subir o navegador, e a busca do documento — e vira rede
  // privada a partir da terceira. É exatamente a troca do rebinding, e o que a subrequisição
  // encontra é o endereço novo.
  let vezes = 0
  const resolver = async () => {
    vezes += 1
    return vezes <= 2 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '10.0.0.5', family: 4 }]
  }
  const r = await renderPage(`http://muda-de-ideia.invalid:${portaAlvo}/x`, { engine: motor, resolver })

  assert.match(r.body, /legitimo/, 'a página principal foi buscada no endereço que passou')
  assert.ok(
    r.blocked.some((b) => /rede interna/.test(b.reason)),
    `a segunda resolução, privada, precisa ser recusada: ${JSON.stringify(r.blocked)}`,
  )
})

test('AMEAÇA: POST partindo de dentro da página não sai por esta rede', async (t) => {
  const motor = await loadEngine()
  if (!motor) return t.skip('sem motor neste ambiente')

  respostas = {
    '*': {
      headers: { 'content-type': 'text/html' },
      body: '<html><body><p>ok</p><script>fetch("/enviar",{method:"POST",body:"x"}).catch(()=>{})</script></body></html>',
    },
  }
  const r = await renderPage(`http://127.0.0.1:${portaAlvo}/post`, { engine: motor })
  assert.ok(r.blocked.some((b) => /método POST/.test(b.reason)), JSON.stringify(r.blocked))
})

test('o pedido tem TETO de tempo: a vaga volta mesmo com uma página que não termina', async () => {
  // Somados, os limites de cada etapa ainda deixam uma página patológica segurar a vaga
  // por muito mais do que qualquer um desses números sugere — e as vagas são duas.
  const antes = process.env.BROWSER_REQUEST_TIMEOUT_MS
  process.env.BROWSER_REQUEST_TIMEOUT_MS = '400'
  try {
    const saude = await chamar('/health', {})
    assert.equal(saude.body.limits.requestTimeoutMs, 400, 'o teto é anunciado: quem chama precisa saber quanto tempo tem')

    const comecou = Date.now()
    const r = await chamar('/fetch', { url: `http://127.0.0.1:${portaAlvo}/trava` })
    const levou = Date.now() - comecou
    assert.equal(r.body.ok, false)
    assert.equal(r.body.error.kind, 'timeout', 'estourar o teto é tempo esgotado, e não uma falha de busca')
    assert.match(r.body.error.message, /passou do teto/)
    assert.ok(levou < 5_000, `o teto precisa cortar antes dos limites internos: levou ${levou} ms`)

    // E a vaga voltou: o próximo pedido é atendido em vez de receber "ocupado".
    respostas = { '/depois': { body: '<html><body>ok</body></html>' } }
    const seguinte = await chamar('/fetch', { url: `http://127.0.0.1:${portaAlvo}/depois` })
    assert.equal(seguinte.body.ok, true)
  } finally {
    if (antes === undefined) delete process.env.BROWSER_REQUEST_TIMEOUT_MS
    else process.env.BROWSER_REQUEST_TIMEOUT_MS = antes
  }
})
