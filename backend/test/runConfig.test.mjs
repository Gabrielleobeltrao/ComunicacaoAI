// A configuração de execução e a matriz de capacidades.
//
// O defeito que este arquivo existe para impedir é específico e caro: a interface
// oferece um parâmetro que aquele modelo não aceita, o adapter manda de qualquer jeito,
// o provedor devolve 400, e a execução do dono falha por causa de um campo que a
// própria tela ofereceu. A matriz precisa valer nas duas pontas.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const {
  capabilitiesFor,
  effectiveRunConfig,
  LIMITS,
  normalizeRunConfig,
  resolveRunConfig,
  shouldRetryInference,
  classifyProviderError,
} = await import('../dist/runConfig.js')

// --- padrão do sistema ------------------------------------------------------------------

test('config vazia é config vazia: nada é inventado', () => {
  // É isto que faz um agente criado antes desta tela se comportar exatamente como
  // antes. Preencher um padrão aqui mudaria o comportamento de todos eles de uma vez.
  assert.deepEqual(normalizeRunConfig({}), {})
  assert.deepEqual(normalizeRunConfig(null), {})
  assert.deepEqual(normalizeRunConfig(undefined), {})
  assert.deepEqual(normalizeRunConfig('lixo'), {})
})

test('campo com tipo errado é descartado, não convertido', () => {
  // Um texto onde se espera número não expressa intenção nenhuma.
  assert.deepEqual(normalizeRunConfig({ temperature: 'quente', retries: [], toolChoice: 'talvez' }), {})
})

// --- limites ------------------------------------------------------------------------------

test('valor fora da faixa é apertado para o limite, não recusado', () => {
  // O dono digitou 5 porque queria "bem criativo". Recusar o salvamento inteiro por
  // causa disso é pior que salvar 2 e mostrar 2.
  assert.equal(normalizeRunConfig({ temperature: 5 }).temperature, LIMITS.temperature.max)
  assert.equal(normalizeRunConfig({ temperature: -3 }).temperature, LIMITS.temperature.min)
  assert.equal(normalizeRunConfig({ retries: 50 }).retries, LIMITS.retries.max)
  assert.equal(normalizeRunConfig({ timeoutMs: 99_999_999 }).timeoutMs, LIMITS.timeoutMs.max)
  assert.equal(normalizeRunConfig({ maxOutputTokens: 1 }).maxOutputTokens, LIMITS.maxOutputTokens.min)
})

test('os tetos existem por um motivo concreto', () => {
  // Timeout de horas seguraria um worker; retries alto multiplicaria a conta de uma
  // falha persistente.
  assert.ok(LIMITS.timeoutMs.max <= 600_000)
  assert.ok(LIMITS.retries.max <= 3)
})

// --- precedência --------------------------------------------------------------------------

test('a camada de cima ganha CAMPO A CAMPO, não em bloco', () => {
  // Um objeto substituindo o outro faria a rotina que só quis mudar o timeout perder a
  // temperatura do agente.
  const doAgente = { temperature: 0.2, timeoutMs: 30_000, cache: true }
  const daRotina = { timeoutMs: 60_000 }
  assert.deepEqual(resolveRunConfig(doAgente, daRotina), { temperature: 0.2, timeoutMs: 60_000, cache: true })
})

test('camada ausente não apaga nada', () => {
  assert.deepEqual(resolveRunConfig({ temperature: 0.5 }, null, undefined), { temperature: 0.5 })
})

// --- matriz de capacidades ------------------------------------------------------------------

test('modelo de raciocínio não aceita temperatura', () => {
  // Mandar o campo é erro do provedor, não ajuste ignorado.
  const caps = capabilitiesFor('openai', 'o3-mini')
  assert.equal(caps.temperature, false)
  assert.equal(caps.reasoningEffort, true)
})

test('modelo comum aceita temperatura e não expõe esforço', () => {
  const caps = capabilitiesFor('openai', 'gpt-4o-mini')
  assert.equal(caps.temperature, true)
  assert.equal(caps.reasoningEffort, false)
})

test('provedor desconhecido cai no conjunto conservador, sem quebrar', () => {
  const caps = capabilitiesFor('provedor-novo', 'modelo-x')
  assert.equal(caps.temperature, true)
  assert.equal(caps.reasoningEffort, false)
})

// --- o que chega ao adapter -------------------------------------------------------------------

test('campo não suportado é REMOVIDO, e o motivo é registrado', () => {
  // Remover, não ignorar: o adapter recebe um objeto em que o campo não existe, então
  // não há como ele escapar para a requisição.
  const r = effectiveRunConfig({ temperature: 0.7, reasoningEffort: 'high' }, { provider: 'openai', model: 'o3', context: 'chat' })
  assert.equal(r.temperature, undefined)
  assert.equal(r.reasoningEffort, 'high')
  assert.ok(r.dropped.some((d) => d.field === 'temperature'))
  assert.match(r.dropped.find((d) => d.field === 'temperature').reason, /temperatura/i)
})

test('um parâmetro descartado nunca é silencioso', () => {
  // Um parâmetro que não vale sem ninguém dizer é pior que um erro.
  const r = effectiveRunConfig({ reasoningEffort: 'high' }, { provider: 'openai', model: 'gpt-4o', context: 'chat' })
  assert.equal(r.reasoningEffort, undefined)
  assert.equal(r.dropped.length, 1)
  assert.ok(r.dropped[0].reason.length > 10)
})

// --- streaming por contexto ---------------------------------------------------------------------

test('streaming não é oferecido enquanto o transporte não existir', () => {
  // Decisão, não esquecimento: nem o servidor emite pedaços nem a tela os desenha.
  // Aceitar a opção agora prometeria uma experiência que não acontece — e "simular" com
  // efeito de digitação seria enganar sobre onde está a espera.
  //
  // Quando o transporte existir, `stream` volta à matriz e este teste vira o de baixo.
  for (const context of ['chat', 'automation']) {
    const r = effectiveRunConfig({ stream: true }, { provider: 'openai', model: 'gpt-4o', context })
    assert.equal(r.stream, undefined, `${context} não pode aceitar stream sem transporte`)
    assert.ok(r.dropped.some((d) => d.field === 'stream'))
  }
})

test('quando o streaming existir, a regra de contexto continua valendo', () => {
  // Uma automação grava o resultado e segue: não há para quem entregar os pedaços. Esta
  // asserção não depende da matriz — ela testa a regra do produto direto.
  const { effectiveRunConfig: fn } = { effectiveRunConfig }
  const automacao = fn({ stream: true }, { provider: 'openai', model: 'gpt-4o', context: 'automation' })
  assert.equal(automacao.stream, undefined)
})

test('o cache da OpenAI não é oferecido: é automático e sem opt-out', () => {
  // Um controle que não faz nada é pior que controle nenhum.
  const r = effectiveRunConfig({ cache: true }, { provider: 'openai', model: 'gpt-4o', context: 'chat' })
  assert.equal(r.cache, undefined)
  const anthropic = effectiveRunConfig({ cache: true }, { provider: 'anthropic', model: 'claude-sonnet-5', context: 'chat' })
  assert.equal(anthropic.cache, true)
})

// --- paralelismo só de leitura --------------------------------------------------------------------

test('ferramentas paralelas só quando TODAS são de leitura', () => {
  const soLeitura = effectiveRunConfig(
    { parallelTools: true },
    { provider: 'openai', model: 'gpt-4o', context: 'automation', toolRisks: ['read', 'read'] },
  )
  assert.equal(soLeitura.parallelTools, true)
})

test('uma única ferramenta de escrita torna tudo sequencial', () => {
  // Duas escritas em paralelo podem chegar fora de ordem — e a ordem é o que o dono
  // configurou.
  const comEscrita = effectiveRunConfig(
    { parallelTools: true },
    { provider: 'openai', model: 'gpt-4o', context: 'automation', toolRisks: ['read', 'write'] },
  )
  assert.equal(comEscrita.parallelTools, undefined)
  assert.match(comEscrita.dropped.find((d) => d.field === 'parallelTools').reason, /altera dados|ordem/i)
})

test('ação de risco alto também derruba o paralelismo', () => {
  const r = effectiveRunConfig({ parallelTools: true }, { provider: 'openai', model: 'gpt-4o', context: 'automation', toolRisks: ['high_risk'] })
  assert.equal(r.parallelTools, undefined)
})

// --- toolChoice não supera permissão -------------------------------------------------------------

test('exigir ferramenta sem ferramenta nenhuma é contradição, e é removido', () => {
  // O modelo seria obrigado a chamar algo que não existe.
  const r = effectiveRunConfig({ toolChoice: 'required' }, { provider: 'openai', model: 'gpt-4o', context: 'chat', toolRisks: [] })
  assert.equal(r.toolChoice, undefined)
  assert.match(r.dropped.find((d) => d.field === 'toolChoice').reason, /não há ferramenta/i)
})

test('exigir ferramenta com ferramenta disponível é respeitado', () => {
  const r = effectiveRunConfig({ toolChoice: 'required' }, { provider: 'openai', model: 'gpt-4o', context: 'chat', toolRisks: ['read'] })
  assert.equal(r.toolChoice, 'required')
})

test('`none` sempre vale: recusar ferramenta é sempre possível', () => {
  const r = effectiveRunConfig({ toolChoice: 'none' }, { provider: 'openai', model: 'gpt-4o', context: 'chat', toolRisks: [] })
  assert.equal(r.toolChoice, 'none')
})

// --- retry ---------------------------------------------------------------------------------------

test('retry de inferência só em falha de TRÂNSITO', () => {
  // "provider" saiu da lista: era genérico demais. Um 401 e um 503 chegam pelo mesmo
  // caminho, e repetir o 401 três vezes só demora três vezes mais para dizer que a
  // credencial está errada.
  for (const kind of ['network', 'timeout', 'rate_limit', 'server']) {
    assert.equal(shouldRetryInference(kind, { hasValidAnswer: false }), true, kind)
  }
  for (const kind of ['client', 'provider', 'validation', 'config', 'persistence', 'telemetry', 'unknown']) {
    assert.equal(shouldRetryInference(kind, { hasValidAnswer: false }), false, kind)
  }
})

test('o erro do SDK é classificado pelo status, não pelo tipo genérico', () => {
  assert.equal(classifyProviderError({ status: 429 }), 'rate_limit')
  assert.equal(classifyProviderError({ status: 503 }), 'server')
  assert.equal(classifyProviderError({ status: 500 }), 'server')
  // Estes NÃO se consertam repetindo: o pedido ou a credencial estão errados.
  assert.equal(classifyProviderError({ status: 400 }), 'client')
  assert.equal(classifyProviderError({ status: 401 }), 'client')
  assert.equal(classifyProviderError({ status: 403 }), 'client')
  assert.equal(classifyProviderError({ status: 422 }), 'client')
})

test('falha de rede e timeout são reconhecidos pelo código e pela mensagem', () => {
  assert.equal(classifyProviderError({ code: 'ECONNRESET' }), 'network')
  assert.equal(classifyProviderError({ code: 'ETIMEDOUT' }), 'timeout')
  assert.equal(classifyProviderError({ name: 'AbortError' }), 'timeout')
  assert.equal(classifyProviderError(new Error('Request timed out')), 'timeout')
  assert.equal(classifyProviderError(new Error('socket hang up')), 'network')
})

test('erro desconhecido NÃO é retentável', () => {
  // Na dúvida sobre gastar de novo, não gaste.
  assert.equal(classifyProviderError(new Error('algo estranho')), 'unknown')
  assert.equal(shouldRetryInference(classifyProviderError(new Error('algo estranho')), { hasValidAnswer: false }), false)
})

test('a classificação decide o retry ponta a ponta', () => {
  const retenta = (erro) => shouldRetryInference(classifyProviderError(erro), { hasValidAnswer: false })
  assert.equal(retenta({ status: 429 }), true)
  assert.equal(retenta({ status: 503 }), true)
  assert.equal(retenta({ status: 401 }), false)
  assert.equal(retenta({ status: 400 }), false)
})

test('nunca repetir a inferência depois de haver resposta válida', () => {
  // O texto já existe; o que falhou foi guardá-lo. Repetir pagaria o modelo duas vezes
  // por um problema que não é dele.
  assert.equal(shouldRetryInference('persistence', { hasValidAnswer: true }), false)
  assert.equal(shouldRetryInference('provider', { hasValidAnswer: true }), false)
  assert.equal(shouldRetryInference('telemetry', { hasValidAnswer: true }), false)
})
