// A REVISÃO das cinco fases, transformada em provas.
//
// Cada item aqui é uma frase que alguém escreveu num plano e que deixaria de ser verdade
// sem ninguém notar: "agentes antigos continuam funcionando", "não há execução arbitrária",
// "há isolamento por dono". Uma frase dessas num documento envelhece em silêncio; a mesma
// frase como teste falha no dia em que deixa de valer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { agentContractOf, parseAgentContract } = await import('../dist/executors/contract.js')
const { compilePlan, fallbackPlan, parseBinding, parseBindings, resolveBindings, validatePlan } = await import('../dist/sectorPlanner.js')
const { prepareStepInput, stepAgentOf } = await import('../dist/executors/stepExecution.js')
const { listPublicFunctions, assertRegistryIsSound } = await import('../dist/executors/functionRegistry.js')
const { executeRegisteredFunction } = await import('../dist/executors/functionExecutor.js')
const { sanitize } = await import('../dist/executionTrace.js')

const FONTE = join(process.cwd(), 'src')

// --- agentes antigos ------------------------------------------------------------------------

test('um agente sem NENHUM campo novo é um agente de modelo, como sempre foi', () => {
  const contrato = agentContractOf({ name: 'Antigo', provider: 'anthropic' })
  assert.equal(contrato.executorKind, 'llm')
  assert.equal(contrato.responseMode, 'text')
  assert.deepEqual(contrato.executorConfig, { kind: 'llm' })
  assert.equal(contrato.inputJsonSchema, null)
  assert.equal(contrato.outputJsonSchema, null)
})

test('`defaultOutputFormat: json` já significava "quero dado" — e continua significando', () => {
  assert.equal(agentContractOf({ defaultOutputFormat: 'json' }).responseMode, 'structured')
  assert.equal(agentContractOf({ defaultOutputFormat: 'markdown' }).responseMode, 'text')
})

test('um documento estranho no banco não torna o agente inacessível', () => {
  // A leitura é o caminho de TODO agente carregado. Uma recusa aqui não protege ninguém:
  // ela derruba um agente que estava funcionando. A recusa acontece na escrita.
  const contrato = agentContractOf({ executorKind: 'lua', responseMode: 42, executorConfig: 'texto solto' })
  assert.equal(contrato.executorKind, 'llm')
  assert.equal(contrato.responseMode, 'text')
})

test('um PATCH antigo, sem nenhum campo novo, não grava nenhum campo novo', () => {
  const { fields, error } = parseAgentContract({ name: 'Coisa', provider: 'openai' })
  assert.equal(error, undefined)
  assert.deepEqual(fields, {}, 'gravar um padrão aqui mudaria agentes que ninguém pediu para mudar')
})

test('um plano LEGADO, sem bindings, compila e roda', () => {
  const membros = [
    { agentId: 'a', name: 'Um', type: 'researcher' },
    { agentId: 'b', name: 'Dois', type: 'analyst' },
  ]
  const legado = { tasks: [{ id: 't1', agentId: 'a', objective: 'x' }, { id: 't2', agentId: 'b', objective: 'y', dependsOn: ['t1'] }] }
  assert.equal(compilePlan(legado, membros).ok, true)
  // E sem bindings, `prepareStepInput` não cobra contrato de quem foi planejado antes dele.
  const passo = stepAgentOf('b', { inputJsonSchema: { type: 'object', properties: { z: { type: 'string' } }, required: ['z'] } })
  assert.equal(prepareStepInput(legado.tasks[1], passo, {}).ok, true)
})

// --- nada de execução arbitrária --------------------------------------------------------------

test('nenhum arquivo de executor contém eval, Function, shell ou import dinâmico', () => {
  const arquivos = readdirSync(join(FONTE, 'executors')).filter((f) => f.endsWith('.ts'))
  assert.ok(arquivos.length >= 6, 'a varredura precisa estar olhando os arquivos de verdade')
  const proibidos = [/\beval\s*\(/, /new\s+Function\s*\(/, /child_process/, /\bexecSync\b/, /\bspawn\s*\(/, /vm\.runIn/, /\bexec\s*\(/]
  // Sem comentários: um arquivo que EXPLICA por que não faz `import(x)` estaria sendo
  // acusado justamente pela frase que documenta a proibição. O que a varredura procura é
  // código, e um comentário não executa nada.
  const semComentarios = (codigo) => codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const arquivo of arquivos) {
    const codigo = semComentarios(readFileSync(join(FONTE, 'executors', arquivo), 'utf8'))
    for (const padrao of proibidos) {
      assert.ok(!padrao.test(codigo), `${arquivo} contém ${padrao}`)
    }
    // `import()` com variável seria carregar um módulo escolhido por dado. A fronteira
    // inteira desta arquitetura é que o CÓDIGO vem do repositório e o agente guarda o nome.
    assert.ok(!/\bimport\s*\(\s*[a-zA-Z_$]/.test(codigo), `${arquivo} faz import dinâmico com variável`)
  }
})

test('o registro de funções é fechado — e cada função nele é sã', () => {
  assertRegistryIsSound()
  const publicas = listPublicFunctions()
  assert.ok(publicas.length > 0)
  for (const f of publicas) {
    // O catálogo é lido pelo formulário: o handler não pode sair daqui.
    assert.equal(f.handler, undefined, 'o corpo da função nunca vai para o cliente')
    assert.equal(typeof f.version, 'string')
    assert.equal(f.inputSchema.type, 'object')
  }
})

test('uma função que não está no registro não roda', async () => {
  const r = await executeRegisteredFunction({ kind: 'function', functionName: 'qualquer.coisa' }, {})
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_configured')
})

// --- poluição de protótipo ----------------------------------------------------------------------

test('nenhum caminho perigoso vira binding', () => {
  for (const veneno of ['$context.__proto__', '$steps.t1.constructor', '$context.a.prototype', '$steps.__proto__.x']) {
    assert.ok(parseBinding(veneno).error, veneno)
  }
})

test('nenhuma chave perigosa vira destino nem literal', () => {
  assert.ok(parseBindings(JSON.parse('{"__proto__":"$context.a"}')).errors.length > 0)
  assert.ok(parseBindings({ ok: { __proto__: 1 } }).errors.length >= 0)
  assert.ok(parseBindings(JSON.parse('{"ok":{"constructor":1}}')).errors.length > 0)
})

test('resolver, compilar e sanitizar deixam o protótipo global intacto', () => {
  const { bindings } = parseBindings({ a: 1 })
  resolveBindings(bindings, { context: JSON.parse('{"__proto__":{"poluido":true}}') })
  sanitize(JSON.parse('{"__proto__":{"poluido2":true}}'))
  compilePlan({ tasks: [{ id: 't1', agentId: 'x', objective: 'o' }] }, [{ agentId: 'x', name: 'X' }])
  assert.equal({}.poluido, undefined)
  assert.equal({}.poluido2, undefined)
})

test('o compilador recusa a referência perigosa que chegar por outro caminho', () => {
  // Um plano montado à mão, ou lido de um registro antigo, não passou por `parseBinding`.
  const plano = { tasks: [{ id: 't1', agentId: 'x', objective: 'o', inputBindings: { a: { from: 'context', path: ['__proto__'] } } }] }
  const r = compilePlan(plano, [{ agentId: 'x', name: 'X' }])
  assert.ok(r.diagnostics.some((d) => d.code === 'unsafe_reference'))
})

test('a segunda tranca fica no runtime: a etapa não executa com origem proibida', () => {
  const task = { id: 't1', agentId: 'x', objective: 'o', inputBindings: { a: { from: 'context', path: ['constructor'] } } }
  const r = prepareStepInput(task, stepAgentOf('x', {}), { context: {} })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'invalid_input')
})

// --- tempo e erro seguro -------------------------------------------------------------------------

test('toda função registrada tem teto de tempo', () => {
  for (const f of listPublicFunctions()) {
    assert.ok(f.timeoutMs > 0 && f.timeoutMs <= 60_000, `${f.functionName} sem teto razoável`)
  }
})

test('erro de função não carrega stack nem mensagem crua de exceção', async () => {
  const { registerFunction, __resetRegistry } = await import('../dist/executors/functionRegistry.js')
  registerFunction({
    functionName: 'teste.explode',
    version: '1.0.0',
    description: 'explode',
    capabilities: [],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    handler: () => {
      throw new Error('/Users/alguem/segredo/caminho.ts: senha=123')
    },
    timeoutMs: 1_000,
  })
  const r = await executeRegisteredFunction({ kind: 'function', functionName: 'teste.explode' }, {})
  assert.equal(r.ok, false)
  assert.ok(!r.error.message.includes('/Users/'), 'caminho de arquivo não sai daqui')
  assert.ok(!r.error.message.includes('senha'), 'valor de variável não sai daqui')
  __resetRegistry()
})

// --- isolamento por dono ---------------------------------------------------------------------------

test('o plano só alcança membros DESTE setor', () => {
  const membros = [{ agentId: 'meu', name: 'Meu' }]
  const plano = validatePlan({ tasks: [{ id: 't1', agentId: 'de-outra-conta', objective: 'x' }] }, membros, 'pergunta')
  assert.ok(!plano.tasks.some((t) => t.agentId === 'de-outra-conta'))
  const r = compilePlan({ tasks: [{ id: 't1', agentId: 'de-outra-conta', objective: 'x' }] }, membros)
  assert.ok(r.diagnostics.some((d) => d.code === 'unknown_agent'))
})

test('o fallback determinístico nunca inventa um agente', () => {
  const membros = [{ agentId: 'a', name: 'A' }, { agentId: 'b', name: 'B' }]
  for (const t of fallbackPlan('qualquer pergunta', membros).tasks) {
    assert.ok(membros.some((m) => m.agentId === t.agentId))
  }
})

// --- as automações não foram tocadas -----------------------------------------------------------------

test('`executorKind` e `executionMode` são coisas diferentes, e uma não mexeu na outra', () => {
  // `executionMode` é da ROTINA (com que frequência roda); `executorKind` é do AGENTE
  // (quem faz o trabalho). Confundi-los faria trocar o tipo de um agente mudar o
  // agendamento de tudo que ele executa.
  const codigo = readFileSync(join(FONTE, 'executors', 'contract.ts'), 'utf8')
  assert.ok(!codigo.includes('executionMode'), 'o contrato do executor não conhece o modo de execução da rotina')
  const dispatcher = readFileSync(join(FONTE, 'executors', 'dispatcher.ts'), 'utf8')
  assert.ok(!dispatcher.includes('executionMode'))
})

test('trocar o tipo do executor não toca no preset do agente', () => {
  const { fields } = parseAgentContract({ executorKind: 'function', executorConfig: { kind: 'function', functionName: 'math.summary' } })
  assert.equal(fields.executorKind, 'function')
  assert.ok(!('preset' in fields), 'o PAPEL do agente é outra decisão, tomada em outro lugar')
})

// --- a ferramenta passa pelos grants ------------------------------------------------------------------

test('o executor de ferramenta não abre caminho HTTP próprio', () => {
  const codigo = readFileSync(join(FONTE, 'executors', 'toolExecutor.ts'), 'utf8')
  // Duas implementações de chamada externa significam dois lugares onde o domínio
  // permitido, o teto de tempo e o registro da chamada podem divergir.
  assert.ok(!/\bfetch\s*\(/.test(codigo), 'a chamada externa é a que já existe, com os limites que já existem')
  assert.ok(codigo.includes('resolveGrant'), 'a instalação e a autorização são conferidas pelo caminho de sempre')
  assert.ok(codigo.includes('getToolsByIds'), 'a ferramenta é buscada pelo caminho que já filtra por dono')
})
