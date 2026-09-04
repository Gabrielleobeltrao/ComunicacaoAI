// Guards the PRODUCTION SHAPE, not the code. The history behind these assertions:
// the backend image once defaulted to the API only while the automation worker was
// a separate resource, so a deploy that created just the backend served HTTP while
// every scheduled routine silently never ran (3 active schedules, 0 runs ever).
//
// The fix was fewer moving parts, not more: no broker, no second process. These
// lock that in — a future edit that reintroduces a mandatory sidecar has to break
// a test first.
//
// Text-level on purpose: no YAML parser is a dependency of this project, and the
// facts asserted here are the ones a careless edit would break.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const compose = read('../../compose.production-test.yml')
const envExample = read('../.env.example')
const coolify = read('../../COOLIFY_DEPLOYMENT.md')
const pkg = JSON.parse(read('../package.json'))

// The block of a top-level service, up to the next service at the same indent.
function serviceBlock(name) {
  const start = compose.indexOf(`\n  ${name}:\n`)
  assert.notEqual(start, -1, `service "${name}" is missing from compose.production-test.yml`)
  const rest = compose.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}\w[\w-]*:\n/)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

test('production compose is exactly frontend + backend', () => {
  for (const name of ['frontend', 'backend']) {
    assert.ok(compose.includes(`\n  ${name}:\n`), `missing service: ${name}`)
  }
  // No broker and no sidecar worker: those are the parts a deploy can forget.
  for (const gone of ['redis:', 'backend-worker:', 'backend-api:']) {
    assert.ok(!compose.includes(`\n  ${gone}\n`), `${gone} must not be a production service any more`)
  }
})

test('nothing in production depends on a queue broker', () => {
  assert.ok(!/redis/i.test(compose), 'compose must not mention redis')
  assert.ok(!/REDIS_URL/.test(envExample), '.env.example must not ask for REDIS_URL')
  // The guide may MENTION redis (to say it is gone and can be deleted); what it
  // must never do is ask the operator to configure one.
  assert.ok(!/REDIS_URL\s*=/.test(coolify), 'the Coolify guide must not ask for a REDIS_URL')
  assert.ok(!/^\|\s*\d+\s*\|\s*`?redis/im.test(coolify), 'redis must not appear as a resource row')
  for (const dep of ['bullmq', 'ioredis']) {
    assert.ok(!(dep in (pkg.dependencies ?? {})), `${dep} must be gone from the backend dependencies`)
  }
})

test('the backend publishes its port and drains on shutdown', () => {
  const backend = serviceBlock('backend')
  assert.match(backend, /ports:/, 'the API is reachable')
  // In-flight automation runs must finish before SIGKILL.
  assert.match(backend, /stop_grace_period:/, 'the engine needs time to drain')
  assert.match(backend, /init: true/, 'PID-1 reaping + signal forwarding')
})

test('the internal drain budget stays below the orchestrator grace period', async () => {
  // Backwards, these two kill the very thing the grace period exists for: the
  // process would give up (or be SIGKILLed) with runs still in flight.
  const grace = /stop_grace_period:\s*(\d+)s/.exec(serviceBlock('backend'))
  assert.ok(grace, 'the backend must declare a stop_grace_period')

  const { config } = await import('../dist/config.js')
  assert.ok(
    config.shutdownTimeoutMs < Number(grace[1]) * 1000,
    `SHUTDOWN_TIMEOUT_MS (${config.shutdownTimeoutMs}ms) must be under stop_grace_period (${grace[1]}s)`,
  )
  assert.match(envExample, /SHUTDOWN_TIMEOUT_MS/, '.env.example must document the knob so the two are raised together')
})

test('readiness covers the engine, not just the port', () => {
  // The healthcheck has to hit /api/ready: /api/health is liveness only and would
  // stay green on an instance whose automation engine never started.
  assert.match(serviceBlock('backend'), /\/api\/ready/, 'the healthcheck must probe readiness')
})

test('the automation engine is documented as part of the backend', () => {
  // A reader must not have to discover that routines need something extra.
  assert.match(coolify, /dois recursos/i)
  assert.match(coolify, /Automation engine up/, 'the guide must show how to confirm it is running')
  assert.match(envExample, /EMBEDDED_WORKER/, '.env.example must document the opt-out')
  assert.ok(pkg.scripts['start:worker'], 'the dedicated-worker escape hatch must still exist')
})

test('no real secret value is committed in the deployment docs', () => {
  // Placeholders only: never a populated connection string or a 32-byte hex key.
  assert.ok(!/mongodb\+srv:\/\/[^<\s]+:[^<@\s]+@/.test(coolify), 'a real MongoDB credential leaked into the docs')
  assert.ok(!/\b[0-9a-f]{64}\b/.test(coolify), 'what looks like a generated secret leaked into the docs')
})

// --- o que o `npm ci` da imagem exige --------------------------------------------------------

/**
 * O `package.json` e o `package-lock.json` de CADA pacote com Dockerfile precisam concordar.
 *
 * O Dockerfile do backend copia os dois do contexto dele e roda `npm ci` — que **não** resolve
 * nada: ele instala exatamente o que o lock diz, e recusa quando os dois discordam
 * ("can only install packages when your package.json and package-lock.json are in sync").
 *
 * O defeito é silencioso onde dói: `npm install` na raiz atualiza o lock DA RAIZ, porque este é
 * um monorepo de workspaces. O lock do pacote, que só a imagem usa, fica para trás. Tudo passa
 * na máquina de quem editou, e o build quebra no deploy.
 *
 * Foi o que aconteceu: `ws` e `qs` estavam no `package.json` do backend e não no lock dele — e
 * a única forma de descobrir era rodar um build de container, que ninguém rodou.
 *
 * A conferência é a mesma que o `npm ci` faz, e cabe em duas leituras de arquivo.
 */
for (const pacote of ['backend', 'frontend']) {
  test(`o lock de ${pacote} concorda com o package.json — é o que o \`npm ci\` da imagem exige`, () => {
    const pkgDo = JSON.parse(read(`../../${pacote}/package.json`))
    const lockDo = JSON.parse(read(`../../${pacote}/package-lock.json`))
    const raiz = lockDo.packages?.[''] ?? {}

    for (const bloco of ['dependencies', 'devDependencies']) {
      const declarados = Object.entries(pkgDo[bloco] ?? {})
      const travados = raiz[bloco] ?? {}
      const faltando = declarados.filter(([nome]) => travados[nome] === undefined).map(([nome]) => nome)
      assert.deepEqual(
        faltando,
        [],
        `${pacote}: ${faltando.join(', ')} está em ${bloco} e não no lock — \`npm ci\` recusa, e o build da imagem falha`,
      )
      // A faixa também precisa bater: uma alteração de versão sem regravar o lock dá o mesmo erro.
      for (const [nome, faixa] of declarados) {
        assert.equal(travados[nome], faixa, `${pacote}: ${nome} pede ${faixa} e o lock guarda ${travados[nome]}`)
      }
    }
  })
}

/**
 * E o que cada Dockerfile COPIA precisa existir no contexto dele.
 *
 * Um `COPY` de caminho que não existe derruba o build na hora, com uma mensagem que fala de
 * caminho de container e não do arquivo que falta no repositório. É a segunda causa mais comum
 * de "funciona aqui e não no deploy", e ela é conferível sem daemon nenhum.
 */
for (const pacote of ['backend', 'frontend', 'runner', 'browser-worker']) {
  test(`todo COPY do Dockerfile de ${pacote} aponta para algo que existe`, () => {
    const dockerfile = read(`../../${pacote}/Dockerfile`)
    const origens = []
    for (const linha of dockerfile.split('\n')) {
      const m = /^COPY\s+(?!--from=)(?:--\S+\s+)*(.+)$/.exec(linha.trim())
      if (!m) continue
      // O último argumento é o destino no container; o resto são origens no contexto.
      const partes = m[1].split(/\s+/).filter(Boolean)
      origens.push(...partes.slice(0, -1))
    }
    assert.ok(origens.length > 0, `o Dockerfile de ${pacote} não copia nada — o contexto está certo?`)

    for (const origem of origens) {
      // `.` é o contexto inteiro: sempre existe.
      if (origem === '.') continue
      const caminho = new URL(`../../${pacote}/${origem}`, import.meta.url)
      assert.ok(existsSync(caminho), `${pacote}/Dockerfile copia "${origem}", que não existe no contexto do build`)
    }
  })
}

/**
 * Toda imagem precisa INSTALAR o que o `package.json` dela declara.
 *
 * O `browser-worker` declarava `playwright` e o Dockerfile não instalava nada: a imagem base
 * traz o navegador, não o pacote npm, e a resolução do Node sobe por `node_modules` a partir do
 * arquivo — o pacote global da base não está nesse caminho.
 *
 * O que torna isso grave é o silêncio: `loadEngine` devolve `null` de propósito, para o worker
 * continuar servindo `fetch` em vez de morrer sem navegador. O healthcheck é TCP e passa. O que
 * se vê é uma fonte de página configurada na Central que nunca renderiza — e nenhum alarme.
 */
for (const pacote of ['backend', 'frontend', 'runner', 'browser-worker']) {
  test(`o Dockerfile de ${pacote} instala as dependências que ele declara`, () => {
    const declaradas = Object.keys(JSON.parse(read(`../../${pacote}/package.json`)).dependencies ?? {})
    if (declaradas.length === 0) return // Sem dependências, não há o que instalar.

    const dockerfile = read(`../../${pacote}/Dockerfile`)
    const instala = /^RUN\s+.*npm\s+(ci|install|i)\b/m.test(dockerfile)
    assert.ok(
      instala,
      `${pacote} depende de ${declaradas.join(', ')} e o Dockerfile não roda npm ci/install: no container o import não resolve`,
    )
    // E o lock precisa chegar ao contexto, senão `npm ci` não tem o que ler.
    if (/npm\s+ci\b/.test(dockerfile)) {
      assert.match(dockerfile, /^COPY\s+(?:--\S+\s+)*package\.json\s+package-lock\.json/m, `${pacote}: \`npm ci\` sem COPY do lock`)
    }
  })
}
