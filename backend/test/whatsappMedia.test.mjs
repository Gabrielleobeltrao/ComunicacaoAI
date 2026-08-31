// A MÍDIA de um webhook: um endereço que veio de fora, e a credencial do dono.
//
// O webhook diz "tem uma imagem em tal URL" e o servidor vai buscar com o `Basic` da
// conta. Se esse endereço puder ser qualquer um, o webhook vira um jeito de fazer a
// plataforma entregar a credencial do dono para quem escolher o destino.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'
process.env.ENCRYPTION_KEY = 'chave-de-cifra-so-para-teste-9f3a2b7c1d'

const { getWhatsAppAdapter } = await import('../dist/whatsapp.js')
const { setHttpResolver } = await import('../dist/net/safeHttp.js')

let servidor
let porta
let recebidas = []

before(async () => {
  servidor = http.createServer((req, res) => {
    recebidas.push({ url: req.url, auth: req.headers.authorization, host: req.headers.host })
    if (req.url === '/enorme') {
      res.writeHead(200, { 'content-type': 'image/png' })
      let enviados = 0
      const empurrar = () => {
        while (enviados < 30_000_000) {
          enviados += 100_000
          if (!res.write(Buffer.alloc(100_000))) return res.once('drain', empurrar)
        }
        res.end()
      }
      empurrar()
      return
    }
    res.writeHead(200, { 'content-type': 'image/png' })
    res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  porta = servidor.address().port
  // Todo nome resolve para o servidor local: o que decide não é o DNS, é a lista.
  setHttpResolver(async () => [{ address: '127.0.0.1', family: 4 }])
})

after(async () => {
  setHttpResolver(null)
  await new Promise((r) => servidor.close(r))
})

beforeEach(() => {
  recebidas = []
})

const twilio = () => getWhatsAppAdapter('twilio')
const CONFIG = { accountSid: 'AC-de-teste', authToken: 'token-de-teste-1234567890' }

test('mídia em host arbitrário não é baixada — e não recebe a credencial', async () => {
  for (const url of [
    `http://servidor-do-atacante.test:${porta}/imagem.png`,
    `http://api.twilio.com.evil.test:${porta}/imagem.png`,
    `http://twiliocdn.com.attacker.test:${porta}/i.png`,
  ]) {
    const r = await twilio().fetchMedia(CONFIG, { kind: 'image', url })
    assert.equal(r, null, url)
  }
  assert.deepEqual(recebidas, [], 'nenhuma requisição saiu — a lista decide antes de conectar')
})

test('mídia de host oficial da Twilio é baixada, com a credencial', async () => {
  const r = await twilio().fetchMedia(CONFIG, { kind: 'image', url: `http://api.twilio.com:${porta}/Media/ME1` })
  assert.ok(r, 'o caminho legítimo continua funcionando')
  assert.equal(r.mimeType, 'image/png')
  assert.equal(recebidas.length, 1)
  assert.match(recebidas[0].auth, /^Basic /)
  assert.equal(recebidas[0].host, `api.twilio.com:${porta}`, 'o Host é o nome, e a conexão foi no IP conferido')
})

test('mídia gigante é abortada no meio do download', async () => {
  const r = await twilio().fetchMedia(CONFIG, { kind: 'image', url: `http://api.twilio.com:${porta}/enorme` })
  assert.equal(r, null, 'passou do teto: nada volta, e o download parou antes do fim')
})

test('a Meta também só busca em host dela', async () => {
  const meta = getWhatsAppAdapter('meta')
  const r = await meta.fetchMedia({ accessToken: 'token' }, { kind: 'image', mediaId: 'x' })
  // O primeiro passo já é a consulta ao graph — que aqui aponta para o servidor local e
  // devolve PNG em vez de JSON; o que importa é que só host da Meta é tentado.
  assert.equal(r, null)
  assert.ok(recebidas.every((c) => /facebook|fbcdn|whatsapp/.test(c.host)), 'nenhum host fora da lista foi tocado')
})
