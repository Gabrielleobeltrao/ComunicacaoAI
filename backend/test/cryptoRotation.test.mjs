// A ROTAÇÃO da chave do cofre.
//
// Antes, trocar `ENCRYPTION_KEY` era escolher entre dois males: perder toda credencial
// já guardada — canal de WhatsApp mudo, integração quebrada, sem explicação — ou nunca
// mais trocar a chave. Um formato versionado e uma lista de chaves antigas transformam
// a troca num deploy.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const CHAVE_ANTIGA = 'chave-antiga-de-teste-a1b2c3d4e5f6a7b8'
const CHAVE_NOVA = 'chave-nova-de-teste-9z8y7x6w5v4u3t2s'

process.env.ENCRYPTION_KEY = CHAVE_ANTIGA
const { encrypt, decrypt, usesCurrentKey, reencrypt } = await import('../dist/crypto.js')

test('o formato novo é versionado — e o antigo continua sendo lido', () => {
  const cifrado = encrypt('segredo do dono')
  assert.match(cifrado, /^v2\./)
  assert.equal(decrypt(cifrado), 'segredo do dono')

  // O formato ANTERIOR (três partes, sem versão) é o que está no banco hoje. Recusá-lo
  // apagaria toda integração já configurada.
  const semVersao = cifrado.split('.').slice(1).join('.')
  assert.equal(decrypt(semVersao), 'segredo do dono')
})

test('depois da rotação, o que foi cifrado com a chave ANTIGA continua abrindo', () => {
  const antes = encrypt('token do provedor')
  const antesSemVersao = antes.split('.').slice(1).join('.')

  // O deploy da rotação: a nova entra, a anterior fica na lista.
  process.env.ENCRYPTION_KEY = CHAVE_NOVA
  process.env.ENCRYPTION_KEY_PREVIOUS = CHAVE_ANTIGA

  assert.equal(decrypt(antes), 'token do provedor', 'a credencial de ontem não pode sumir')
  assert.equal(decrypt(antesSemVersao), 'token do provedor', 'inclusive no formato antigo')
  assert.equal(usesCurrentKey(antes), false, 'e dá para saber que ela ainda precisa ser regravada')

  const regravado = reencrypt(antes)
  assert.equal(decrypt(regravado), 'token do provedor')
  assert.equal(usesCurrentKey(regravado), true)
})

test('sem a chave antiga na lista, o texto de antes NÃO abre — a lista é o que sustenta a troca', () => {
  process.env.ENCRYPTION_KEY = CHAVE_ANTIGA
  delete process.env.ENCRYPTION_KEY_PREVIOUS
  const antigo = encrypt('credencial')

  process.env.ENCRYPTION_KEY = CHAVE_NOVA
  assert.throws(() => decrypt(antigo))

  process.env.ENCRYPTION_KEY_PREVIOUS = `${CHAVE_ANTIGA},outra-chave-que-nao-serve-mais-11223344`
  assert.equal(decrypt(antigo), 'credencial', 'mais de uma anterior é aceita: uma rotação pode pegar a do meio')
})

test('texto adulterado não abre com chave nenhuma', () => {
  process.env.ENCRYPTION_KEY = CHAVE_NOVA
  process.env.ENCRYPTION_KEY_PREVIOUS = CHAVE_ANTIGA
  const cifrado = encrypt('intacto')
  const partes = cifrado.split('.')
  // Um byte trocado no conteúdo: o GCM autentica, então isso é recusa, não lixo.
  const corrompido = [partes[0], partes[1], partes[2], Buffer.from('outro conteudo').toString('base64')].join('.')
  assert.throws(() => decrypt(corrompido))
})
