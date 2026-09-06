#!/usr/bin/env node
// O smoke de MVP: a pilha inteira, de verdade, sem nada de fora.
//
//   npm run smoke
//
// Sobe um mongod próprio (binário real, réplica de um nó, como o Atlas), o backend
// compilado apontado para ele, e o frontend compilado servido estático. Depois roda
// o Playwright contra isso e derruba tudo.
//
// O que ele NÃO usa, de propósito: conta real, banco real, chave de provedor,
// arquivo `.env` do desenvolvedor e qualquer chamada de rede para fora. O LLM é o
// adaptador falso, que só existe com NODE_ENV=test (ver `llmFakeGate.test.mjs`).
// Se este script passar numa máquina limpa e sem segredo nenhum, ele passa em
// qualquer lugar — é esse o ponto.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const backend = join(raiz, 'backend')
const frontend = join(raiz, 'frontend')

const PORTA_API = Number(process.env.SMOKE_API_PORT ?? 4399)
const PORTA_WEB = Number(process.env.SMOKE_WEB_PORT ?? 4398)

const encerrar = []
let saida = 0

const log = (msg) => console.log(`[smoke] ${msg}`)

async function esperar(descricao, verificar, { timeoutMs = 90_000, intervaloMs = 500 } = {}) {
  const limite = Date.now() + timeoutMs
  let ultimoErro
  while (Date.now() < limite) {
    try {
      if (await verificar()) return
    } catch (e) {
      ultimoErro = e
    }
    await new Promise((r) => setTimeout(r, intervaloMs))
  }
  throw new Error(`tempo esgotado esperando ${descricao}${ultimoErro ? ` — ${ultimoErro.message}` : ''}`)
}

// --- mongod isolado ------------------------------------------------------------------

async function subirMongo() {
  // Resolvido a partir do backend, que é quem declara a dependência — o npm
  // workspaces iça para a raiz, então o caminho fixo não serve.
  const { createRequire } = await import('node:module')
  const exigir = createRequire(join(backend, 'package.json'))
  const { MongoMemoryReplSet } = await import(exigir.resolve('mongodb-memory-server'))
  log('subindo mongod isolado…')
  const servidor = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  let parado = false
  const parar = async () => {
    if (parado) return
    parado = true
    await servidor.stop()
  }
  encerrar.push(parar)
  log(`mongod pronto`)
  return { uri: servidor.getUri(), parar }
}

// --- backend -------------------------------------------------------------------------

async function subirBackend(mongoUri) {
  if (!existsSync(join(backend, 'dist/index.js'))) throw new Error('backend não compilado — rode `npm run build` antes')
  log(`subindo a API na porta ${PORTA_API}…`)
  const proc = spawn(process.execPath, ['dist/index.js'], {
    cwd: backend,
    env: {
      ...process.env,
      // Nada de `.env` do desenvolvedor: o smoke tem que valer numa máquina limpa.
      DOTENV_CONFIG_PATH: join(raiz, 'scripts/.smoke-no-env'),
      NODE_ENV: 'test',
      // O único lugar que liga o adaptador falso de LLM. Em produção não existe
      // caminho: o portão lê NODE_ENV no carregamento do módulo.
      LLM_FAKE: '1',
      PORT: String(PORTA_API),
      MONGODB_URI: mongoUri,
      // Chaves de TESTE, geradas aqui e jogadas fora no fim. Nenhuma é secreta e
      // nenhuma sai deste processo.
      BETTER_AUTH_SECRET: 'smoke-'.padEnd(40, 'x'),
      ENCRYPTION_KEY: 'smoke-'.padEnd(40, 'y'),
      CLIENT_URL: `http://localhost:${PORTA_WEB}`,
      PUBLIC_URL: `http://localhost:${PORTA_API}`,
      BETTER_AUTH_URL: `http://localhost:${PORTA_API}`,
      // Motor rápido, para uma rotina agendada disparar dentro do teste em vez de
      // dentro de quinze segundos.
      RUN_POLL_MS: '400',
      SCHEDULER_POLL_MS: '800',
      // Sem chave de provedor nenhuma: se alguma coisa tentar chamar para fora, o
      // teste falha em vez de gastar dinheiro de alguém.
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      VOYAGE_API_KEY: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const linhas = []
  const capturar = (buf) => {
    const texto = buf.toString()
    linhas.push(texto)
    if (process.env.SMOKE_VERBOSE) process.stdout.write(`[api] ${texto}`)
  }
  proc.stdout.on('data', capturar)
  proc.stderr.on('data', capturar)
  encerrar.push(
    async () =>
      new Promise((r) => {
        if (proc.exitCode !== null) return r()
        proc.once('exit', r)
        // SIGTERM de verdade: é assim que o orquestrador encerra em produção, e o
        // motor precisa drenar o que está em andamento.
        proc.kill('SIGTERM')
        setTimeout(() => {
          proc.kill('SIGKILL')
          r()
        }, 20_000)
      }),
  )

  await esperar('a API responder /api/ready', async () => {
    const res = await fetch(`http://localhost:${PORTA_API}/api/ready`).catch(() => null)
    if (!res) return false
    if (res.status === 200) return true
    // 503 é resposta legítima enquanto banco/migração/motor não terminam de subir.
    return false
  })
  /**
   * O arranque NÃO pode ser mudo.
   *
   * Entre o processo começar e "Backend listening" existe conexão ao banco, migração e o
   * motor conferindo uma dezena de índices em série. Numa máquina carregada isso leva
   * minutos, e minutos de terminal mudo são indistinguíveis de um servidor morto: quem
   * espera conclui que quebrou e mata o processo justamente enquanto ele subia. Foi o que
   * aconteceu de verdade, e por isso está preso aqui.
   */
  const registro = linhas.join('')
  const etapas = ['Backend: iniciando', 'Backend: MongoDB conectado', 'Backend: migrações aplicadas', 'Backend: ligando o motor de automações']
  const faltando = etapas.filter((e) => !registro.includes(e))
  if (faltando.length) throw new Error(`o arranque não disse onde estava: faltaram ${faltando.join(', ')}`)
  for (const l of registro.split('\n').filter((l) => /^Backend[:.]/.test(l.trim()))) log(l.trim())

  log('API pronta (/api/ready 200)')
  return { proc, linhas }
}

// --- frontend estático ---------------------------------------------------------------

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

// O bundle é construído AQUI, com as flags de produção explícitas, em vez de
// reaproveitar o `dist` que estiver na máquina. O `.env` do desenvolvedor pode ter
// qualquer combinação — e uma flag desligada esconderia metade das telas que o
// smoke precisa visitar, transformando um bug de produto num "seletor não
// encontrado".
async function compilarFrontend() {
  log('compilando o frontend com as flags de produção…')
  const codigo = await new Promise((r) => {
    const p = spawn('npx', ['vite', 'build', '--mode', 'production'], {
      cwd: frontend,
      env: {
        ...process.env,
        // Mesma origem: o servidor estático abaixo faz o proxy de /api.
        VITE_API_URL: '',
        VITE_AI_BUILDING_ENABLED: 'true',
        VITE_AI_AUTOMATIONS_ENABLED: 'true',
        VITE_AI_OFFICE_LIVE_STATUS_ENABLED: 'true',
      },
      stdio: process.env.SMOKE_VERBOSE ? 'inherit' : 'ignore',
    })
    p.on('exit', (c) => r(c ?? 1))
  })
  if (codigo !== 0) throw new Error('o build do frontend falhou')
}

async function subirFrontend() {
  const dist = join(frontend, 'dist')
  if (!existsSync(join(dist, 'index.html'))) throw new Error('frontend não compilado')
  log(`servindo o frontend compilado na porta ${PORTA_WEB}…`)

  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORTA_WEB}`)

    // Proxy da API na MESMA origem, como o nginx de produção faz — assim o cookie
    // de sessão e o CORS se comportam como lá, em vez de como um atalho de teste.
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) {
      try {
        const alvo = `http://localhost:${PORTA_API}${url.pathname}${url.search}`
        const corpo = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : await lerCorpo(req)
        const upstream = await fetch(alvo, {
          method: req.method,
          headers: { ...req.headers, host: `localhost:${PORTA_API}` },
          body: corpo,
          redirect: 'manual',
        })
        res.writeHead(upstream.status, Object.fromEntries(upstream.headers))
        res.end(Buffer.from(await upstream.arrayBuffer()))
      } catch (e) {
        res.writeHead(502).end(String(e))
      }
      return
    }

    const caminho = join(dist, url.pathname === '/' ? 'index.html' : url.pathname.slice(1))
    // SPA fallback: rota do react-router que não é arquivo volta o index — o mesmo
    // que o nginx faz com `try_files`.
    const arquivo = existsSync(caminho) && extname(caminho) ? caminho : join(dist, 'index.html')
    res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' })
    res.end(readFileSync(arquivo))
  })

  await new Promise((r) => servidor.listen(PORTA_WEB, r))
  encerrar.push(async () => new Promise((r) => servidor.close(r)))
  log('frontend pronto')
}

const lerCorpo = (req) =>
  new Promise((resolver) => {
    const partes = []
    req.on('data', (c) => partes.push(c))
    req.on('end', () => resolver(partes.length ? Buffer.concat(partes) : undefined))
  })

// --- playwright ----------------------------------------------------------------------

async function rodarSmoke() {
  log('rodando o smoke…')
  const args = ['playwright', 'test', 'e2e/mvp-smoke.spec.ts', '--workers=1', '--reporter=list']
  if (process.env.SMOKE_GREP) args.push('-g', process.env.SMOKE_GREP)
  const codigo = await new Promise((r) => {
    const p = spawn('npx', args, {
      cwd: frontend,
      env: {
        ...process.env,
        SMOKE: '1',
        // A base é o servidor estático, que faz proxy da API na mesma origem.
        E2E_BASE_URL: `http://localhost:${PORTA_WEB}`,
        PLAYWRIGHT_SKIP_WEBSERVER: '1',
      },
      stdio: 'inherit',
    })
    p.on('exit', (c) => r(c ?? 1))
  })
  return codigo
}

// --- prontidão e encerramento --------------------------------------------------------

// O banco cai DEPOIS do boot: é o caso que o orquestrador vê em produção, e o que
// `COOLIFY_DEPLOYMENT.md` promete. `/api/ready` tem que virar 503 — um backend que
// aceita rotinas sem conseguir executá-las não pode passar por saudável.
//
// (Com o banco fora JÁ NO BOOT o processo nem chega a escutar: `start()` falha em
// `mongoClient.connect()`. O healthcheck recebe conexão recusada em vez de 503, e o
// recurso fica vermelho do mesmo jeito.)
async function verificarProntidaoComBancoFora(pararMongo) {
  log('derrubando o banco para conferir /api/ready…')
  await pararMongo()
  let status = null
  await esperar(
    '/api/ready virar 503',
    async () => {
      const res = await fetch(`http://localhost:${PORTA_API}/api/ready`).catch(() => null)
      if (!res) return false
      status = res.status
      return status === 503
    },
    { timeoutMs: 60_000, intervaloMs: 1000 },
  ).catch(() => undefined)
  if (status !== 503) throw new Error(`/api/ready devolveu ${status ?? 'nada'} com o banco fora — tinha que ser 503`)
  log('prontidão correta: 503 depois que o banco caiu')
}

// SIGTERM é como o orquestrador encerra. O motor precisa drenar o que está em
// andamento antes de o processo sair, e dizer isso no log.
async function verificarEncerramento(proc, linhas) {
  log('conferindo o encerramento por SIGTERM…')
  const saiu = new Promise((r) => proc.once('exit', (codigo, sinal) => r({ codigo, sinal })))
  const t0 = Date.now()
  proc.kill('SIGTERM')

  /**
   * A PACIÊNCIA daqui precisa ser MAIOR que o prazo que a aplicação declara.
   *
   * Ela usa `SHUTDOWN_TIMEOUT_MS` (25s por padrão) como freio de emergência, "deliberadamente
   * abaixo do prazo do orquestrador" — está escrito no código dela. Esperar 20s aqui era
   * cobrar um contrato que ninguém prometeu: quando o dreno legitimamente passava de 20s, o
   * SIGKILL vinha antes do freio e a falha aparecia como "não encerrou sozinho".
   *
   * Com a margem, SIGKILL volta a significar o que deve: a aplicação estourou o PRÓPRIO prazo.
   */
  const PRAZO_DA_APLICACAO_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000)
  const forcado = setTimeout(() => proc.kill('SIGKILL'), PRAZO_DA_APLICACAO_MS + 10_000)
  const { codigo, sinal } = await saiu
  clearTimeout(forcado)
  const levou = Date.now() - t0
  const registro = linhas.join('\n')
  if (sinal === 'SIGKILL') {
    /**
     * O QUE FALTOU aparece junto do erro.
     *
     * O log do backend só era impresso no caminho feliz, então a falha chegava sem nenhuma
     * pista de onde o tempo foi — e três hipóteses foram testadas e descartadas às cegas por
     * causa disso. As etapas do encerramento se cronometram sozinhas; aqui elas viram a
     * mensagem.
     */
    const etapas = linhas.filter((l) => /shutdown:|Received SIGTERM|Shutdown complete|engine stopped/i.test(l))
    throw new Error(
      `o processo não saiu sozinho com SIGTERM em ${levou}ms (prazo da aplicação: ${PRAZO_DA_APLICACAO_MS}ms)\n` +
        `etapas do encerramento:\n${etapas.length ? etapas.map((l) => `  ${l}`).join('\n') : '  (nenhuma — ele nem começou a encerrar)'}`,
    )
  }
  if (!/Automation engine stopped/.test(registro)) throw new Error('o motor não registrou encerramento limpo')
  /**
   * As etapas aparecem SEMPRE, e não só quando falha.
   *
   * São quatro linhas por corrida, e elas são a diferença entre "às vezes demora" e saber
   * QUAL etapa demora. O encerramento normal leva ~3s; medindo, apareceu um pico de 21s — que
   * era exatamente o que batia no limite antigo e produzia uma falha sem explicação.
   */
  for (const l of linhas.filter((l) => /shutdown:|Shutdown complete/.test(l))) log(l.trim())
  log(`encerrou sozinho com SIGTERM (código ${codigo ?? 0}) em ${levou}ms e o motor drenou`)
}

// --- orquestração --------------------------------------------------------------------

try {
  await compilarFrontend()
  const { uri, parar: pararMongo } = await subirMongo()
  const { proc, linhas } = await subirBackend(uri)
  await subirFrontend()
  saida = await rodarSmoke()

  // O motor tem que ter subido: um backend que aceita rotinas sem conseguir
  // executá-las é o defeito que este projeto já teve uma vez.
  if (!/Automation engine up/.test(linhas.join('\n'))) {
    console.error('[smoke] FALHA: o motor de automações não subiu')
    saida = 1
  }

  // O que o log do backend NÃO pode ter. O smoke exercita registro, execução e
  // webhook — se algo desses vazasse credencial ou conteúdo, vazaria aqui.
  const log_ = linhas.join('\n')
  const proibido = [
    [/BETTER_AUTH_SECRET|ENCRYPTION_KEY/, 'nome de variável secreta'],
    [/smoke-x{10,}|smoke-y{10,}/, 'valor de chave'],
    [/\[fake\] /, 'resposta do modelo'],
  ]
  for (const [padrao, oque] of proibido) {
    if (padrao.test(log_)) {
      console.error(`[smoke] FALHA: ${oque} apareceu no log do backend`)
      saida = 1
    }
  }
  if (saida === 0) log('log do backend limpo: sem credencial e sem conteúdo de execução')

  if (saida === 0) {
    // Nesta ordem: primeiro o banco cai com o processo vivo, depois o processo é
    // encerrado. O contrário derrubaria o processo antes de haver o que medir.
    await verificarProntidaoComBancoFora(pararMongo)
    await verificarEncerramento(proc, linhas)
  }
} catch (erro) {
  console.error(`[smoke] ${erro.message}`)
  saida = 1
} finally {
  log('encerrando…')
  for (const fn of encerrar.reverse()) await fn().catch(() => undefined)
}

process.exit(saida)
