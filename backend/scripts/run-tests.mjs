#!/usr/bin/env node
// O corredor da suíte do backend.
//
//   npm test
//
// Existe por uma razão só: 29 dos 70 arquivos de teste sobem um `mongod` de
// verdade — um replica set de um nó, como o Atlas. O `node --test` roda os
// ARQUIVOS em paralelo, um processo por arquivo, com concorrência igual ao número
// de CPUs. Numa máquina de desenvolvimento com 8 núcleos e 9 GB isso passa sempre.
// No runner do GitHub, menor, o mesmo commit passava numa execução e falhava na
// seguinte — inclusive um commit que só mexeu em documentação. Mesmo código,
// resultado diferente: é contenção de recurso, não regressão.
//
// A resposta aqui NÃO é repetir o teste que falhou nem esconder a falha. É parar
// de pedir à máquina mais do que ela tem:
//
//   1. o binário do mongod é baixado UMA vez, antes de tudo. Sem isto, 29
//      processos disputam o mesmo download e o mesmo lock num cache frio — que é
//      exatamente o estado de um runner novo;
//   2. os arquivos que sobem mongod rodam com concorrência limitada;
//   3. os que não sobem continuam em paralelo total, porque não custam nada.
//
// Nenhum teste é pulado, nenhuma asserção muda, e a contagem final é a mesma.
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const dirTestes = join(raiz, 'test')

// Quantos mongod simultâneos. No CI o runner é pequeno; na máquina de quem
// desenvolve dá para ir mais alto sem tornar o ciclo lento.
const LIMITE_MONGO = Number(process.env.MONGO_TEST_CONCURRENCY ?? (process.env.CI ? 2 : Math.min(4, availableParallelism())))

const arquivos = readdirSync(dirTestes)
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => join(dirTestes, f))
  .sort()

// Quem sobe banco é decidido LENDO o arquivo, não pelo nome. Um teste que passe a
// usar mongod entra no grupo certo sozinho, sem ninguém lembrar de renomeá-lo.
const usaMongo = (caminho) => /startMongo|MongoMemory/.test(readFileSync(caminho, 'utf8'))
const comBanco = arquivos.filter(usaMongo)
const semBanco = arquivos.filter((f) => !usaMongo(f))

async function prefetchMongod() {
  // Um download, uma extração, um lock — antes de qualquer processo de teste
  // existir. Num cache quente isto retorna na hora.
  const { MongoBinary } = await import('mongodb-memory-server')
  process.stdout.write('# preparando o binário do mongod… ')
  const caminho = await MongoBinary.getPath({})
  process.stdout.write(`ok (${caminho.split('/').pop()})\n`)
}

function rodar(lista, concorrencia, rotulo) {
  if (lista.length === 0) return Promise.resolve(0)
  console.log(`# ${rotulo}: ${lista.length} arquivo(s), concorrência ${concorrencia}`)
  return new Promise((resolver) => {
    const p = spawn(process.execPath, ['--test', `--test-concurrency=${concorrencia}`, ...lista], {
      cwd: raiz,
      stdio: 'inherit',
      env: process.env,
    })
    p.on('exit', (codigo) => resolver(codigo ?? 1))
  })
}

await prefetchMongod()

// Os sem banco primeiro: são rápidos e, quando algo estrutural quebra, a falha
// aparece em segundos em vez de depois de toda a suíte de integração.
const codigoUnit = await rodar(semBanco, availableParallelism(), 'sem banco')
const codigoIntegracao = await rodar(comBanco, LIMITE_MONGO, 'com mongod')

process.exit(codigoUnit || codigoIntegracao)
