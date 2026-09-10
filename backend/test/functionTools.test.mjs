// AS FUNÇÕES COMO FERRAMENTA — e a linha que separa o que pode ser chamado do que não pode.
//
// O registro era lido pelo catálogo do Assistente, pelo planejador e pelo motor de Flow, e
// nunca por quem monta as ferramentas de um agente: as funções existiam, o modelo via o nome
// delas na proposta, e nenhum agente conseguia chamar nenhuma. Ele calculava de cabeça — que é
// o oposto do motivo pelo qual elas existem.
import { test } from 'node:test'
import assert from 'node:assert/strict'

await import('../dist/executors/registeredFunctions.js')
const { functionToolsFor, nomeDeFerramenta } = await import('../dist/executors/functionTools.js')
const { listPublicFunctions } = await import('../dist/executors/functionRegistry.js')

const ferramentas = () => functionToolsFor()
const pegar = (nome) => ferramentas().find((f) => f.name === nome)

test('AMEAÇA: só entram as funções que NÃO buscam dado', () => {
  /**
   * `data_history.range` abre o armazém e lê qualquer série da conta. Entregá-la como
   * ferramenta daria leitura irrestrita por fora do sistema de concessões — o mesmo que
   * decide quem lê qual Database. Quem precisa de dado passa por `database_query`, com o
   * grant daquele agente.
   */
  const nomes = ferramentas().map((f) => f.name)
  for (const proibida of ['data_history_range', 'data_history_latest', 'data_history_aggregate', 'data_history_series', 'realtime_data_get', 'realtime_data_list']) {
    assert.equal(nomes.includes(proibida), false, `${proibida} lê dado e não pode ser ferramenta de agente`)
  }
  // E as puras estão todas lá.
  for (const pura of ['registros_buscar', 'valores_comparar', 'serie_variacao', 'registros_contar_por', 'registros_filtrar', 'calculate_rsi']) {
    assert.ok(nomes.includes(pura), `${pura} não chegou ao agente`)
  }
})

test('AMEAÇA: uma função que NÃO declarou nada fica de fora — falha para o lado seguro', () => {
  const semMarca = listPublicFunctions().filter((f) => f.semAcessoADados !== true)
  assert.ok(semMarca.length > 0, 'o caso só vale se existir alguma sem a marca')
  const nomes = ferramentas().map((f) => f.name)
  for (const f of semMarca) {
    assert.equal(nomes.includes(nomeDeFerramenta(f.functionName)), false, `${f.functionName} entrou sem declarar`)
  }
})

test('AMEAÇA: o nome não pode ter ponto — o provedor recusa e a ferramenta some sem aviso', () => {
  for (const f of ferramentas()) {
    assert.match(f.name, /^[a-zA-Z0-9_-]{1,64}$/, `"${f.name}" não passa no formato que Anthropic e OpenAI aceitam`)
  }
  assert.equal(nomeDeFerramenta('registros.buscar'), 'registros_buscar')
})

test('cada ferramenta leva o schema da função e diz que é determinística', () => {
  const f = pegar('registros_filtrar')
  assert.ok(f, 'registros_filtrar não está entre as ferramentas')
  assert.equal(f.inputSchema.type, 'object')
  assert.deepEqual(f.inputSchema.properties.operador.enum, ['gt', 'gte', 'lt', 'lte', 'eq', 'ne'])
  assert.match(f.description, /mesma entrada dá sempre a mesma saída/)
  // Conta pura não escreve nada: é o que permite o laço rodar duas em paralelo.
  assert.equal(f.risk, 'read')
})

test('ACEITAÇÃO: o agente chama e recebe o resultado, calculado de verdade', async () => {
  const r = await pegar('registros_contar_por').run({
    registros: [{ st: 'pago' }, { st: 'pago' }, { st: 'aberto' }],
    campo: 'st',
  })
  assert.equal(r.ok, true, r.result)
  const saida = JSON.parse(r.result)
  assert.deepEqual(saida.grupos, [{ valor: 'pago', quantos: 2 }, { valor: 'aberto', quantos: 1 }])
})

test('AMEAÇA: recusa deliberada volta como TEXTO para o modelo, não como falha', async () => {
  /**
   * "Precisa de ao menos 2 pontos" é informação: ele pode buscar mais dados e chamar de novo.
   * Tratar isso como erro de execução encerraria a tarefa por uma coisa que tem conserto na
   * rodada seguinte.
   */
  const r = await pegar('serie_variacao').run({ registros: [{ v: 1 }], campo: 'v' })
  assert.equal(r.ok, false)
  assert.match(r.result, /^recusado:/, 'a primeira palavra impede o modelo de ler a recusa como resultado')
  assert.match(r.result, /ao menos 2 pontos/)
})

test('o RSI continua sendo conta, e não palpite do modelo', async () => {
  const r = await pegar('calculate_rsi').run({ closes: [10, 11, 12, 11, 13, 14, 13, 15, 16, 15, 17, 18, 17, 19, 20] })
  assert.equal(r.ok, true, r.result)
  const saida = JSON.parse(r.result)
  assert.equal(saida.method, 'wilder')
  assert.ok(saida.rsi > 0 && saida.rsi <= 100)
  // A mesma entrada, de novo: uma média que muda entre duas perguntas iguais não é uma média.
  const outra = JSON.parse((await pegar('calculate_rsi').run({ closes: [10, 11, 12, 11, 13, 14, 13, 15, 16, 15, 17, 18, 17, 19, 20] })).result)
  assert.equal(saida.rsi, outra.rsi)
})
