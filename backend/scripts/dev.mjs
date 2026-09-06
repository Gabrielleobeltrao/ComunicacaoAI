#!/usr/bin/env node
// O DESENVOLVIMENTO do backend: compila uma vez, em watch, e roda o JS pronto.
//
// Antes era `tsx watch src/index.ts`. `src/index.ts` puxa 169 imports sobre um grafo de
// 416 arquivos, e o tsx os transpila TODA vez que o processo sobe. Numa máquina apertada
// isso não é lento, é não subir: medido, seis minutos sem imprimir sequer a primeira
// linha, enquanto o mesmo backend a partir do `dist` respondia `/api/ready` em segundos.
//
// A primeira tentativa foi `tsc -w` ao lado de `node --watch`, e ela tem uma corrida que
// aparece toda vez: o `tsc` reescreve o `dist`, o `node --watch` reinicia na hora, e o
// processo novo tenta escutar a porta antes de o antigo largá-la — `EADDRINUSE`, e o
// servidor fica esperando um arquivo mudar para tentar de novo. O encerramento gracioso
// leva alguns segundos de propósito (ele drena o que está em execução), então "reiniciar
// na hora" é justamente o que não pode ser feito.
//
// Aqui o reinício acontece quando as DUAS coisas terminaram: a compilação, e a saída do
// processo anterior.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const alvos = process.argv.slice(2)
if (alvos.length === 0) {
  console.error('uso: node scripts/dev.mjs dist/index.js [dist/worker.js …]')
  process.exit(1)
}

const log = (m) => console.log(`[dev] ${m}`)

/** O prazo para o processo antigo sair sozinho antes de levar SIGKILL. */
const PRAZO_DE_SAIDA_MS = 12_000

let servidores = []
let reiniciando = false
let pendente = false

/**
 * Derruba o que está rodando e ESPERA de verdade.
 *
 * `kill()` só pede; quem não espera a saída reinicia por cima de uma porta ainda ocupada.
 * O SIGKILL é rede de segurança, não o caminho normal — um encerramento à força deixa
 * execução em andamento sem drenar.
 */
async function derrubar() {
  const saindo = servidores.map(
    (p) =>
      new Promise((pronto) => {
        if (p.exitCode !== null || p.signalCode) return pronto()
        const prazo = setTimeout(() => {
          log(`${p.spawnargs.at(-1)} não saiu em ${PRAZO_DE_SAIDA_MS}ms — SIGKILL`)
          p.kill('SIGKILL')
        }, PRAZO_DE_SAIDA_MS)
        p.once('exit', () => {
          clearTimeout(prazo)
          pronto()
        })
        p.kill('SIGTERM')
      }),
  )
  servidores = []
  await Promise.all(saindo)
}

function subir() {
  servidores = alvos.map((alvo) => {
    const caminho = resolve(raiz, alvo)
    if (!existsSync(caminho)) {
      log(`${alvo} ainda não existe — esperando a compilação`)
      return null
    }
    return spawn(process.execPath, [caminho], { cwd: raiz, stdio: 'inherit' })
  }).filter(Boolean)
}

/**
 * Um reinício por vez, e o pedido que chegar durante um reinício não se perde.
 *
 * Salvar dois arquivos seguidos dispara duas compilações; sem a fila, a segunda pegava o
 * processo no meio da saída e o mesmo `EADDRINUSE` voltava por outro caminho.
 */
async function reiniciar() {
  if (reiniciando) {
    pendente = true
    return
  }
  reiniciando = true
  await derrubar()
  subir()
  reiniciando = false
  if (pendente) {
    pendente = false
    await reiniciar()
  }
}

/**
 * O `tsc` é RESOLVIDO, não montado à mão.
 *
 * Isto é um monorepo de workspaces: o `typescript` fica içado para o `node_modules` da
 * raiz, e um caminho escrito como `backend/node_modules/typescript` simplesmente não
 * existe — o compilador morria no arranque e levava o servidor junto.
 */
const tscBin = createRequire(import.meta.url).resolve('typescript/bin/tsc')

const tsc = spawn(process.execPath, [tscBin, '-w', '--preserveWatchOutput'], {
  cwd: raiz,
  stdio: ['ignore', 'pipe', 'inherit'],
})

let sobra = ''
tsc.stdout.on('data', (buf) => {
  process.stdout.write(buf)
  const texto = sobra + buf.toString()
  sobra = texto.slice(-200)
  // A frase que o tsc imprime ao TERMINAR uma compilação. É o único momento em que o
  // `dist` está inteiro — reiniciar antes dela é ler um arquivo pela metade.
  if (/Watching for file changes/.test(texto)) void reiniciar()
})

const encerrar = async (sinal) => {
  log(`recebi ${sinal}, encerrando`)
  tsc.kill('SIGTERM')
  await derrubar()
  process.exit(0)
}
process.on('SIGINT', () => void encerrar('SIGINT'))
process.on('SIGTERM', () => void encerrar('SIGTERM'))
tsc.on('exit', (codigo) => {
  if (codigo !== 0 && codigo !== null) {
    log(`o compilador saiu com código ${codigo}`)
    void encerrar('tsc')
  }
})
