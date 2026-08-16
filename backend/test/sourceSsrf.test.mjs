// A URL da fonte vem do usuário e é buscada pelo SERVIDOR. Isso é a definição de
// SSRF, e é a parte deste recurso que não pode falhar.
//
// O que este arquivo prova: quem monta a URL não escolhe para onde o servidor vai.
// Endereço de rede interna, loopback, link-local e protocolo esquisito são
// recusados — tanto no "testar fonte" quanto no caminho que o worker usa, porque os
// dois passam pelo MESMO `safeFetch`. Testar com regra mais frouxa que a execução
// seria pior que não testar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertPublicUrl, isPrivateIp } from '../dist/net/safeHttp.js'
import { previewSource } from '../dist/automations/sourcePreview.js'

// Endereços que um atacante usaria para alcançar o que só o servidor alcança: o
// metadata da nuvem, um banco interno, um painel administrativo sem senha porque
// "só é acessível de dentro".
const PROIBIDOS = [
  ['http://localhost:4000/api/ready', 'a própria API'],
  ['http://127.0.0.1/', 'loopback'],
  ['http://[::1]/', 'loopback IPv6'],
  ['http://169.254.169.254/latest/meta-data/', 'metadata da nuvem'],
  ['http://10.0.0.5/admin', 'rede privada classe A'],
  ['http://192.168.1.1/', 'rede doméstica'],
  ['http://172.16.0.1/', 'rede privada classe B'],
  ['http://0.0.0.0/', 'endereço nulo'],
]

const PROTOCOLOS = [
  ['file:///etc/passwd', 'arquivo local'],
  ['ftp://exemplo.test/x', 'ftp'],
  ['gopher://exemplo.test/', 'gopher'],
  ['data:text/plain,oi', 'data URI'],
]

test('os intervalos privados são reconhecidos como privados', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.4', '169.254.169.254', '::1']) {
    assert.equal(isPrivateIp(ip), true, `${ip} tinha que ser privado`)
  }
  for (const ip of ['8.8.8.8', '1.1.1.1']) {
    assert.equal(isPrivateIp(ip), false, `${ip} é público`)
  }
})

test('nenhum endereço interno é aceito como fonte', async () => {
  for (const [url, oque] of PROIBIDOS) {
    await assert.rejects(() => assertPublicUrl(url), `${oque} (${url}) foi aceito`)
  }
})

test('só http e https: nenhum outro protocolo passa', async () => {
  for (const [url, oque] of PROTOCOLOS) {
    await assert.rejects(() => assertPublicUrl(url), `${oque} foi aceito`)
  }
})

// --- "testar fonte" usa exatamente a mesma porteira ------------------------------------

test('testar fonte recusa endereço interno, e diz por quê sem vazar nada', async () => {
  for (const [url] of PROIBIDOS.slice(0, 4)) {
    const r = await previewSource('http', url)
    assert.equal(r.ok, false, `${url} passou pelo teste de fonte`)
    assert.ok(r.message.length > 0, 'a recusa precisa dizer alguma coisa ao dono')
    // A recusa não conta o que existe do outro lado nem devolve corpo de resposta.
    assert.doesNotMatch(r.message, /<html|<!DOCTYPE|password|token/i)
  }
})

test('testar fonte recusa protocolo não-http', async () => {
  for (const [url] of PROTOCOLOS) {
    const r = await previewSource('rss', url)
    assert.equal(r.ok, false, `${url} passou`)
  }
})

test('a recusa nunca ecoa a URL inteira, que pode carregar token', async () => {
  const comSegredo = 'http://127.0.0.1/feed?api_key=SEGREDO-NAO-PODE-VAZAR&user=x'
  const r = await previewSource('rss', comSegredo)
  assert.equal(r.ok, false)
  assert.doesNotMatch(r.message, /SEGREDO-NAO-PODE-VAZAR/, 'a query string não pode aparecer na mensagem')
})

test('o preview e o worker compartilham a MESMA função de busca', async () => {
  // Não é um teste de comportamento, é um teste de arquitetura: se alguém trocar o
  // preview por um `fetch` direto "só para testar", as duas portas deixam de ser a
  // mesma e a de teste vira um caminho de SSRF.
  const { readFileSync } = await import('node:fs')
  const fonte = readFileSync(new URL('../src/automations/sourcePreview.ts', import.meta.url), 'utf8')
  assert.match(fonte, /import \{ safeFetch \} from '\.\.\/net\/safeHttp\.js'/)
  // E não existe um fetch cru escapando por fora dele.
  const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(semComentarios, /\bfetch\(/, 'o preview não pode chamar fetch direto')
})
