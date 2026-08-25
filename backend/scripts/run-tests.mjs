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
    // `--experimental-test-module-mocks` habilita `mock.module`, que é o único jeito de
    // substituir um SDK importado por ESM. É o que permite conferir o CORPO que sai para
    // o provedor — sem isso, os testes de payload chamariam a API de verdade.
    const p = spawn(process.execPath, ['--test', '--experimental-test-module-mocks', `--test-concurrency=${concorrencia}`, ...lista], {
      cwd: raiz,
      stdio: 'inherit',
      /**
       * Nenhum teste fala com um provedor pago. Nunca.
       *
       * Um arquivo de teste apagava `VOYAGE_API_KEY` no topo — e qualquer módulo do
       * `dist` que importa `dotenv/config` depois disso a trazia de volta do `.env`. O
       * resultado: a suíte chamando a API de embedding de verdade, gastando cota,
       * ficando lenta e falhando por 429 de forma intermitente — uma falha que não tem
       * nada a ver com o código sendo testado.
       *
       * Vazia (e não ausente) de propósito: `dotenv` não sobrescreve o que já existe no
       * ambiente, então isto vence o `.env` sem depender da ordem dos imports. E vazia é
       * falsa, que é exatamente como o código trata "não configurado".
       */
      env: {
        ...process.env,
        VOYAGE_API_KEY: '',
        /**
         * O `.env` de quem desenvolve NÃO entra na suíte.
         *
         * Mesma família do `VOYAGE_API_KEY` acima, e a que custou mais caro: um teste
         * que esquece de definir `ENCRYPTION_KEY` passa na máquina de quem escreveu
         * (o `.env` tem a chave real) e falha no CI, que não tem `.env`. A falha
         * aparece longe de quem a causou, num job vermelho de outra pessoa.
         *
         * Apontar o dotenv para um arquivo que não existe faz ele não carregar nada —
         * e aí local e CI são o mesmo ambiente. Cada teste passa a declarar o que
         * precisa, que é o que já se espera de um teste.
         */
        DOTENV_CONFIG_PATH: join(raiz, 'test', '.env.que-nao-existe'),
      },
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
