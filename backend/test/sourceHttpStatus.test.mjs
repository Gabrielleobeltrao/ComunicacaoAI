// Uma FONTE de monitoramento não aceita qualquer resposta; a ferramenta HTTP do
// agente aceita. Este arquivo prova que a porteira do 2xx vale só de um lado.
//
// Por que a distinção importa: uma página de erro tem conteúdo próprio, com
// timestamp, id de requisição, "tente novamente em 30 segundos". Se ela contasse
// como conteúdo, cada instabilidade do servidor seria lida como "o site mudou" — o
// dono receberia um alerta por hora sobre um site que não mudou nada. Já a
// ferramenta HTTP existe justamente para o agente VER o 404: é a resposta que ele
// foi buscar.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
process.env.ENCRYPTION_KEY ||= 'test-only-encryption-key-'.padEnd(40, 'x')
// Deixa o teste alcançar o servidor que ele mesmo subiu. SÓ loopback — todo o resto
// da rede privada continua bloqueado, então os testes de SSRF seguem honestos.
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { safeFetch } = await import('../dist/net/safeHttp.js')
const { previewSource } = await import('../dist/automations/sourcePreview.js')

const FEED = '<?xml version="1.0"?><rss><channel><item><title>Item</title><guid>g1</guid></item></channel></rss>'

let server
let base

before(async () => {
  server = createServer((req, res) => {
    const rota = req.url ?? '/'
    if (rota === '/feed') {
      res.writeHead(200, { 'content-type': 'application/xml' })
      return res.end(FEED)
    }
    if (rota === '/pagina') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('<html><body><p>Preço: R$ 10</p></body></html>')
    }
    if (rota === '/so-script') {
      // 200, com corpo — e nada de conteúdo depois de tirar a marcação. É a página
      // que só monta no navegador, que aqui não roda.
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('<html><head><script>montaTudo()</script></head><body><div id="app"></div></body></html>')
    }
    if (rota === '/vazio') {
      res.writeHead(204).end()
      return
    }
    // /status/404, /status/429, /status/500 — com corpo, que é o caso perigoso: a
    // resposta tem conteúdo, e sem a porteira ele seria lido como conteúdo da fonte.
    const m = /^\/status\/(\d+)$/.exec(rota)
    if (m) {
      res.writeHead(Number(m[1]), { 'content-type': 'text/html' })
      return res.end(`<html><body>Erro ${m[1]} às ${new Date().toISOString()}</body></html>`)
    }
    res.writeHead(404).end('')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

// --- a fonte recusa ---------------------------------------------------------------------

test('4xx e 5xx não passam por uma fonte, e o status aparece na mensagem', async () => {
  for (const status of [404, 429, 500]) {
    await assert.rejects(
      () => safeFetch(`${base}/status/${status}`, { requireOk: true }),
      (erro) => {
        assert.match(erro.message, new RegExp(String(status)))
        return true
      },
      `${status} passou`,
    )
  }
})

test('testar a fonte devolve o erro do servidor em vez da página de erro', async () => {
  for (const status of [404, 429, 500]) {
    const r = await previewSource('http', `${base}/status/${status}`)
    assert.equal(r.ok, false, `${status} foi dado como sucesso`)
    assert.match(r.message, new RegExp(String(status)))
    // E o corpo da página de erro não vaza para a tela como se fosse conteúdo.
    assert.equal(r.excerpt, undefined)
  }
})

test('um feed atrás de um 500 não é "sem novidade": é falha', async () => {
  const r = await previewSource('rss', `${base}/status/500`)
  assert.equal(r.ok, false)
  assert.equal(r.itemCount, undefined)
})

// --- a ferramenta HTTP genérica continua vendo tudo ---------------------------------------

test('sem `requireOk`, o 404 chega inteiro a quem pediu', async () => {
  // É isto que a ferramenta HTTP do agente faz. Se este teste quebrar, a mudança
  // vazou da camada de fontes para o resto do sistema.
  const res = await safeFetch(`${base}/status/404`)
  assert.equal(res.status, 404)
  assert.match(res.body, /Erro 404/)

  const erro500 = await safeFetch(`${base}/status/500`)
  assert.equal(erro500.status, 500)
})

// --- 2xx passa --------------------------------------------------------------------------

test('o caminho normal não foi estreitado: 200 continua passando', async () => {
  const feed = await previewSource('rss', `${base}/feed`)
  assert.equal(feed.ok, true)
  assert.equal(feed.itemCount, 1)

  const pagina = await previewSource('http', `${base}/pagina`)
  assert.equal(pagina.ok, true)
  assert.match(pagina.excerpt, /R\$ 10/)
})

test('HTML no endereço de um feed é recusado com um motivo acionável', async () => {
  // 200, conteúdo válido, e mesmo assim não serve. A mensagem precisa dizer o que
  // fazer — o erro mais comum é apontar para a página em vez do feed.
  const r = await previewSource('rss', `${base}/pagina`)
  assert.equal(r.ok, false)
  assert.match(r.message, /feed/i)
})

// --- 2xx que não traz conteúdo -----------------------------------------------------------

test('página que só monta no navegador é recusada com o motivo real', async () => {
  // Não é erro de rede nem status ruim: o servidor respondeu 200. Dizer "não foi
  // possível consultar" mandaria o dono conferir a URL, que está certa. O que ele
  // precisa saber é que a página depende de JavaScript.
  const r = await previewSource('http', `${base}/so-script`)
  assert.equal(r.ok, false)
  assert.match(r.message, /JavaScript/i)
  assert.equal(r.excerpt, undefined)
})

test('204 sem corpo nenhum cai na mesma regra', async () => {
  const r = await previewSource('http', `${base}/vazio`)
  assert.equal(r.ok, false)
  assert.equal(r.excerpt, undefined)
})
