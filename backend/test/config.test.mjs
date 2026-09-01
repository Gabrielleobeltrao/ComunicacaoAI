// Deployment-readiness tests for the backend config module (src/config.ts →
// dist/config.js). Verifies the production fail-fast contract and dev defaults.
//
// Run:  npm run build && npm test        (uses Node's built-in test runner)
//
// Each case runs in a CLEAN child process because config.ts computes isProduction
// and builds `config` once at module load — env must be set before import. We
// point dotenv at a nonexistent path so a local .env never pollutes the run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const configUrl = 'file://' + resolve(here, '../dist/config.js')

// Import the built config in a child with a controlled env. Optionally call
// validateConfig() and print config.clientOrigins as JSON. Returns the child's
// stdout+stderr and whether it exited zero.
function run(caseVars, { validate = true } = {}) {
  const snippet = `
    const m = await import(${JSON.stringify(configUrl)})
    ${validate ? 'm.validateConfig()' : ''}
    process.stdout.write(JSON.stringify({ origins: m.config.clientOrigins, publicUrl: m.config.publicUrl, betterAuthUrl: m.config.betterAuthUrl }))
  `
  const env = {
    PATH: process.env.PATH,
    DOTENV_CONFIG_PATH: '/nonexistent-so-no-dotenv-loads',
    ...caseVars,
  }
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', snippet], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out }
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

// The definitive production origins (ASCII, no trailing slash).
const PROD_URLS = {
  NODE_ENV: 'production',
  CLIENT_URL: 'https://comunicacaoai.onplataform.com',
  BETTER_AUTH_URL: 'https://api.comunicacaoai.onplataform.com',
  PUBLIC_URL: 'https://api.comunicacaoai.onplataform.com',
}
// The non-URL variables a production deploy must carry. There is no REDIS_URL any
// more: the automation queue and scheduler live in MongoDB, so a deploy needs one
// database and nothing else.
// Valores FORTES e diferentes entre si — é o que a validação passou a exigir. Não são
// credenciais de lugar nenhum: são cadeias longas e variadas, escritas para o teste.
const PROD_SECRETS = {
  MONGODB_URI: 'mongodb://localhost:27017/comunicacaoai_test',
  BETTER_AUTH_SECRET: 'K7q2Zx9wR4tB6nY1vJ8mC3sP5hD0gF2aL4eU7iO9kX1z',
  ENCRYPTION_KEY: 'Q3n8Bv6cX2mZ9pL5tR7wY4hJ1kD0sG8fA6eN2uI5oT3b',
}

test('production: missing MONGODB_URI fails fast and names the variable', () => {
  const { ok, out } = run({ ...PROD_URLS, BETTER_AUTH_SECRET: PROD_SECRETS.BETTER_AUTH_SECRET, ENCRYPTION_KEY: PROD_SECRETS.ENCRYPTION_KEY })
  assert.equal(ok, false, 'should have thrown')
  assert.match(out, /MONGODB_URI/)
  assert.doesNotMatch(out, new RegExp(`${PROD_SECRETS.BETTER_AUTH_SECRET}|${PROD_SECRETS.ENCRYPTION_KEY}`), 'must not print secret values')
})

test('production: a required URL var missing fails fast at import', () => {
  const noPublic = { ...PROD_URLS, ...PROD_SECRETS }
  delete noPublic.PUBLIC_URL
  const { ok, out } = run(noPublic)
  assert.equal(ok, false)
  assert.match(out, /PUBLIC_URL/)
})

test('production: non-https URL is rejected', () => {
  const { ok, out } = run({ ...PROD_URLS, ...PROD_SECRETS, BETTER_AUTH_URL: 'http://api.comunicacaoai.onplataform.com' })
  assert.equal(ok, false)
  assert.match(out, /https/i)
})

test('production: valid config passes, strips trailing slash, splits CSV origins', () => {
  const { ok, out } = run({
    ...PROD_URLS,
    ...PROD_SECRETS,
    // prod origin + local dev origin, both with a stray trailing slash to strip.
    CLIENT_URL: 'https://comunicacaoai.onplataform.com/, http://localhost:5173/',
  })
  assert.equal(ok, true, out)
  const parsed = JSON.parse(out)
  assert.deepEqual(parsed.origins, ['https://comunicacaoai.onplataform.com', 'http://localhost:5173'])
  assert.equal(parsed.publicUrl, 'https://api.comunicacaoai.onplataform.com')
})

test('development: no env needed, falls back to localhost defaults', () => {
  const { ok, out } = run({}, { validate: true })
  assert.equal(ok, true, out)
  const parsed = JSON.parse(out)
  assert.deepEqual(parsed.origins, ['http://localhost:5173'])
  assert.match(parsed.betterAuthUrl, /^http:\/\/localhost:/)
})

test('production needs NO broker: a complete config without REDIS_URL is accepted', () => {
  // The automation engine polls MongoDB, so there is nothing else to configure.
  // This used to fail on purpose; keeping the case documents the removal.
  const { ok, out } = run({ ...PROD_URLS, ...PROD_SECRETS })
  assert.equal(ok, true, out)
  assert.ok(!out.includes('REDIS_URL'), 'REDIS_URL must not be demanded any more')
})

// --- o compose de teste sobe de verdade? ------------------------------------------------
//
// O `compose.production-test.yml` declarava `NODE_ENV=production` com URLs
// `http://localhost`, e `validateConfig` exige https em produção. O teste documentado
// nunca chegava a subir — e ninguém percebia, porque conferir isso exigia rodar Docker.
//
// Aqui os valores do próprio arquivo de exemplo são lidos e passados pela validação
// real. Se alguém voltar a colocar http lá, este teste quebra sem precisar de Docker.

test('os valores do compose de produção passam pela validação de produção', async () => {
  const { readFileSync } = await import('node:fs')
  const texto = readFileSync(new URL('../../compose.production-test.env.example', import.meta.url), 'utf8')

  const doArquivo = {}
  for (const linha of texto.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim())
    if (m) doArquivo[m[1]] = m[2]
  }

  for (const chave of ['CLIENT_URL', 'BETTER_AUTH_URL', 'PUBLIC_URL']) {
    assert.ok(doArquivo[chave], `${chave} não está no arquivo de exemplo`)
  }

  const { ok, out } = run({
    NODE_ENV: 'production',
    ...PROD_SECRETS,
    CLIENT_URL: doArquivo.CLIENT_URL,
    BETTER_AUTH_URL: doArquivo.BETTER_AUTH_URL,
    PUBLIC_URL: doArquivo.PUBLIC_URL,
  })
  assert.equal(ok, true, `a pilha não subiria: ${out}`)
})

test('e a exigência de https continua valendo — não há flag de escape', () => {
  // A alternativa fácil seria uma variável que desligasse a checagem. Ela existiria
  // também em produção, e um dia alguém a usaria lá.
  const comHttp = run({
    NODE_ENV: 'production',
    ...PROD_SECRETS,
    CLIENT_URL: 'http://localhost:8080',
    BETTER_AUTH_URL: 'https://a.b.com',
    PUBLIC_URL: 'https://a.b.com',
  })
  assert.equal(comHttp.ok, false)
  assert.match(comHttp.out, /https/i)
})

// --- a força dos segredos ---------------------------------------------------------------
//
// Um `ENCRYPTION_KEY=changeme` cifra toda credencial da plataforma com uma chave que
// está em qualquer tutorial, e nada em runtime denuncia isso. A hora de recusar é a de
// subir.

test('segredo curto, previsível ou de exemplo não sobe em produção', () => {
  const casos = [
    ['curto demais', { BETTER_AUTH_SECRET: 'abc123' }, /at least 32/i],
    ['placeholder', { BETTER_AUTH_SECRET: 'changeme-changeme-changeme-changeme-1' }, /placeholder/i],
    ['pouca variação', { ENCRYPTION_KEY: 'ababababababababababababababababababab' }, /variation/i],
  ]
  for (const [nome, sobrescrito, esperado] of casos) {
    const { ok, out } = run({ ...PROD_URLS, ...PROD_SECRETS, ...sobrescrito })
    assert.equal(ok, false, `${nome} deveria ser recusado`)
    assert.match(out, esperado, nome)
  }
})

test('os dois segredos precisam ser DIFERENTES', () => {
  // Iguais, um vazamento derruba a sessão e o cofre de credenciais de uma vez só.
  const mesmo = PROD_SECRETS.BETTER_AUTH_SECRET
  const { ok, out } = run({ ...PROD_URLS, ...PROD_SECRETS, BETTER_AUTH_SECRET: mesmo, ENCRYPTION_KEY: mesmo })
  assert.equal(ok, false)
  assert.match(out, /must be different/i)
})

test('os segredos DO ARQUIVO DE EXEMPLO são recusados — ninguém sobe com eles', async () => {
  const { readFileSync } = await import('node:fs')
  const texto = readFileSync(new URL('../../compose.production-test.env.example', import.meta.url), 'utf8')
  const doArquivo = {}
  for (const linha of texto.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim())
    if (m) doArquivo[m[1]] = m[2]
  }
  const { ok } = run({
    NODE_ENV: 'production',
    MONGODB_URI: PROD_SECRETS.MONGODB_URI,
    CLIENT_URL: doArquivo.CLIENT_URL,
    BETTER_AUTH_URL: doArquivo.BETTER_AUTH_URL,
    PUBLIC_URL: doArquivo.PUBLIC_URL,
    BETTER_AUTH_SECRET: doArquivo.BETTER_AUTH_SECRET,
    ENCRYPTION_KEY: doArquivo.ENCRYPTION_KEY,
  })
  assert.equal(ok, false, 'o exemplo não pode ser um segredo utilizável nem passar na validação')
})

// --- a imagem de produção ---------------------------------------------------------------
//
// Duas afirmações sobre o Dockerfile que só custam caro quando quebram no deploy: a
// imagem não carrega gerenciador de pacote, e a documentação manda subir o worker de um
// jeito que essa imagem consegue executar. Conferir aqui é grátis; conferir com Docker
// exige Docker, e é por isso que ninguém confere.

test('a imagem de produção não carrega npm — e a documentação não manda usá-lo', async () => {
  const { readFileSync } = await import('node:fs')
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')

  // O npm vem embutido na base do Node e nunca roda em produção: o processo é
  // `node dist/*.js`. O que fica é a árvore de dependências dele — e era a única coisa
  // que o scanner de imagem reprovava.
  assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/npm/)

  const doc = readFileSync(new URL('../../COOLIFY_DEPLOYMENT.md', import.meta.url), 'utf8')
  // Sem npm na imagem, `npm run start:worker` como start command não sobe — a instrução
  // e a imagem precisam concordar.
  const instrucoes = doc.split('\n').filter((l) => /start command|processo separado/.test(l))
  assert.ok(instrucoes.length > 0, 'a documentação do worker sumiu')
  for (const linha of instrucoes) {
    assert.doesNotMatch(linha, /`npm run start:worker`/, `a documentação ainda manda usar npm: ${linha}`)
  }
  assert.match(doc, /node dist\/worker\.js/)
})
