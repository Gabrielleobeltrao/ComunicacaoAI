// UMA fonte de verdade — conferida no CÓDIGO, e não na intenção.
//
// A regra da Fase 2 é que nenhum executor monte a própria lista de bases. Uma regra
// dessas não se sustenta por acordo: o próximo fluxo copia o vizinho mais parecido, e o
// vizinho mais parecido pode ser o errado. Aqui o que se afirma é o que o código faz.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const SRC = new URL('../src/', import.meta.url)

function arquivos(dir = '') {
  const fora = []
  for (const entrada of readdirSync(new URL(dir, SRC), { withFileTypes: true })) {
    const caminho = `${dir}${entrada.name}`
    if (entrada.isDirectory()) fora.push(...arquivos(`${caminho}/`))
    else if (caminho.endsWith('.ts')) fora.push(caminho)
  }
  return fora
}

const ler = (arquivo) => readFileSync(new URL(arquivo, SRC), 'utf8')

/** Os únicos lugares que podem falar com a busca por DONOS diretamente. */
const CAMADA = ['knowledge.ts', 'knowledgeRetrieval.ts']

test('só a camada de conhecimento chama a busca por donos', () => {
  const infratores = arquivos()
    .filter((a) => !CAMADA.includes(a))
    .filter((a) => /\bretrieveForOwners\s*\(/.test(ler(a)))
  assert.deepEqual(infratores, [], 'um executor chamando a busca direto monta a própria lista de bases')
})

test('os executores entram pela porta única', () => {
  // Cada um destes é um caminho por onde um agente responde. Todos precisam resolver a
  // política do mesmo jeito — senão a mesma pergunta tem respostas diferentes conforme
  // a porta por onde ela entrou.
  const EXECUTORES = {
    'index.ts': 'chat de teste e canal',
    'delegationWiring.ts': 'delegação e setor',
    'automations/runProcessor.ts': 'rotina',
  }
  for (const [arquivo, quem] of Object.entries(EXECUTORES)) {
    const fonte = ler(arquivo)
    assert.match(fonte, /retrieveForAgents?\b/, `${quem} (${arquivo}) precisa passar pela resolução de política`)
  }
})

test('a política só é resolvida em um lugar', () => {
  const donos = arquivos().filter((a) => /export\s+(async\s+)?function\s+resolveKnowledgeOwnersForExecution/.test(ler(a)))
  assert.deepEqual(donos, ['knowledgeAccess.ts'], 'duas resoluções divergem na primeira mudança de regra')
})

test('a busca por donos não é alcançável de fora da camada', () => {
  // As três funções que consultam a base por DONO. Chamar qualquer uma delas fora da
  // camada é montar a própria lista — que é o defeito que a Fase 2 veio apagar. A
  // escrita (criar, editar, apagar um documento) nomeia o dono e continua podendo: ali
  // o dono já foi resolvido pela conta, e não há política de leitura envolvida.
  const BUSCA = /\b(searchKnowledgeForOwners|searchKnowledgeLexicallyForOwners|retrieveForOwners)\s*\(/
  const infratores = arquivos()
    .filter((a) => !CAMADA.includes(a))
    .filter((a) => BUSCA.test(ler(a)))
  assert.deepEqual(infratores, [], 'quem busca direto decide sozinho o que o agente pode ler')
})
