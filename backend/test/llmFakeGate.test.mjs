// O adaptador falso de LLM não pode existir em produção.
//
// Ele é necessário para o smoke de MVP rodar uma execução real sem chave e sem
// rede. E é exatamente o tipo de coisa que, se ficar atrás de uma checagem no
// ponto de uso, um dia alguém liga sem querer no ambiente errado.
//
// O portão é resolvido no CARREGAMENTO do módulo, a partir de `NODE_ENV`. Este
// teste carrega o módulo em processos separados, com ambientes diferentes, e
// afirma as duas metades: liga quando deve, e não liga de jeito nenhum quando o
// processo subiu como produção.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const LEITURA = `
  const { FAKE_LLM_ENABLED } = await import('./dist/llm.js')
  process.stdout.write(String(FAKE_LLM_ENABLED))
`

// URIs e chaves sintaticamente válidas só para os módulos carregarem. Nada
// conecta: o teste lê uma constante e sai.
// Valores sintaticamente válidos só para os módulos carregarem — inclusive os que
// `config.ts` EXIGE quando NODE_ENV=production, e que ele recusa a inventar. Nada
// conecta e nada é chamado: o teste lê uma constante e sai.
const BASE = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/gate_test',
  ENCRYPTION_KEY: 'x'.repeat(32),
  BETTER_AUTH_SECRET: 'y'.repeat(32),
  CLIENT_URL: 'http://localhost:5173',
  PUBLIC_URL: 'http://localhost:4000',
  BETTER_AUTH_URL: 'http://localhost:4000',
}

const comAmbiente = (env) =>
  execFileSync(process.execPath, ['--input-type=module', '-e', LEITURA], {
    env: { ...process.env, ...BASE, ...env },
    encoding: 'utf8',
  }).trim()

test('em produção, o falso não liga nem com a variável pedindo', () => {
  assert.equal(comAmbiente({ NODE_ENV: 'production', LLM_FAKE: '1' }), 'false')
})

test('em desenvolvimento, o falso não liga nem com a variável pedindo', () => {
  assert.equal(comAmbiente({ NODE_ENV: 'development', LLM_FAKE: '1' }), 'false')
})

test('sem NODE_ENV nenhum, o falso não liga', () => {
  assert.equal(comAmbiente({ NODE_ENV: '', LLM_FAKE: '1' }), 'false')
})

test('em teste, sem pedir explicitamente, o falso não liga', () => {
  assert.equal(comAmbiente({ NODE_ENV: 'test', LLM_FAKE: '' }), 'false')
})

test('em teste E pedindo, o falso liga — é assim que o smoke roda sem chave', () => {
  assert.equal(comAmbiente({ NODE_ENV: 'test', LLM_FAKE: '1' }), 'true')
})

test('ligar a variável DEPOIS do boot não muda nada', () => {
  // O valor é congelado no carregamento. Mudar `process.env` em runtime — que é o
  // que um endpoint mal escrito ou uma configuração de usuário conseguiriam fazer
  // — não alcança o portão.
  const roteiro = `
    process.env.NODE_ENV = 'production'
    const antes = (await import('./dist/llm.js')).FAKE_LLM_ENABLED
    process.env.NODE_ENV = 'test'
    process.env.LLM_FAKE = '1'
    const depois = (await import('./dist/llm.js')).FAKE_LLM_ENABLED
    process.stdout.write(antes + ',' + depois)
  `
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', roteiro], {
    env: { ...process.env, ...BASE, NODE_ENV: 'production', LLM_FAKE: '1' },
    encoding: 'utf8',
  }).trim()
  assert.equal(saida, 'false,false')
})
