// POR QUE a chamada ao provedor falhou.
//
// Uma frase só para cinco causas mandava a pessoa tentar de novo em quatro casos onde
// tentar de novo nunca resolve. Estes testes fixam a distinção — e fixam também o que
// NÃO pode sair: nada do texto do provedor, que pode trazer a URL com a chave.
import { test } from 'node:test'
import assert from 'node:assert/strict'

// `openai.js` arrasta o executor de ferramentas e, por ele, o banco. Este arquivo é
// puro; a variável só existe para o import não derrubar a carga.
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { classifyLlmFailure } = await import('../dist/llmFailure.js')
const { aceitaReasoningEffort } = await import('../dist/openai.js')

/** Um erro como os SDKs entregam: status no objeto, mensagem no `message`. */
const erro = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra })

test('chave recusada: 401 e 403 viram "confira a chave"', () => {
  for (const status of [401, 403]) {
    const r = classifyLlmFailure(erro(status, 'Incorrect API key provided: sk-abc...xyz'))
    assert.equal(r.code, 'provider_key_invalid')
    assert.match(r.message, /chave do provedor/i)
  }
  // Também pelo código, quando o status não vem.
  assert.equal(classifyLlmFailure({ code: 'invalid_api_key', message: 'x' }).code, 'provider_key_invalid')
})

test('modelo inexistente diz QUAL modelo — é o que se conserta', () => {
  const r = classifyLlmFailure(erro(404, 'The model `gpt-4o-turbo` does not exist'), 'gpt-4o-turbo')
  assert.equal(r.code, 'provider_model_unavailable')
  assert.match(r.message, /gpt-4o-turbo/, 'sem o nome, a pessoa não sabe o que trocar')
  assert.match(r.message, /Configurações/)
})

test('sem crédito não é "tente de novo"', () => {
  assert.equal(classifyLlmFailure(erro(402, 'billing hard limit reached')).code, 'provider_no_credit')
  assert.equal(classifyLlmFailure({ code: 'insufficient_quota', message: 'x' }).code, 'provider_no_credit')
})

test('limite de taxa é a ÚNICA em que esperar resolve — e a frase diz isso', () => {
  const r = classifyLlmFailure(erro(429, 'Rate limit reached'))
  assert.equal(r.code, 'provider_rate_limited')
  assert.match(r.message, /instantes/)
})

test('400 é pedido recusado: quase sempre um parâmetro que o modelo não aceita', () => {
  const r = classifyLlmFailure(erro(400, "Unrecognized request argument supplied: reasoning_effort"), 'gpt-4o-mini')
  assert.equal(r.code, 'provider_rejected_request')
  assert.match(r.message, /gpt-4o-mini/)
  assert.match(r.message, /trocar o modelo/i)
})

test('prazo e rede caem em timeout; 5xx cai em fora do ar', () => {
  assert.equal(classifyLlmFailure(new Error('Request timeout')).code, 'provider_timeout')
  assert.equal(classifyLlmFailure({ code: 'ECONNRESET', message: 'socket hang up' }).code, 'provider_timeout')
  assert.equal(classifyLlmFailure(erro(503, 'service unavailable')).code, 'provider_unavailable')
  assert.equal(classifyLlmFailure(erro(500, 'internal')).code, 'provider_unavailable')
})

test('o que não dá para classificar não vira palpite', () => {
  const r = classifyLlmFailure(new Error('coisa estranha'))
  assert.equal(r.code, 'provider_error')
  assert.match(r.message, /registro do servidor/)
})

test('NADA do texto do provedor sai na mensagem', () => {
  // O caso que motiva a regra: a mensagem do provedor pode trazer a URL da requisição,
  // e com ela a chave.
  const vazando = erro(401, 'Error at https://api.openai.com/v1/chat?key=sk-super-secreto-123: bad key')
  const r = classifyLlmFailure(vazando, 'gpt-5.1')
  assert.ok(!r.message.includes('sk-super-secreto-123'), `vazou: ${r.message}`)
  assert.ok(!r.message.includes('api.openai.com'))

  // E o nome do modelo PODE sair: ele é configuração nossa, não segredo de ninguém.
  const r2 = classifyLlmFailure(erro(404, 'no such model'), 'gpt-5.1')
  assert.match(r2.message, /gpt-5\.1/)
})

test('sem modelo informado, a frase continua fazendo sentido', () => {
  const r = classifyLlmFailure(erro(404, 'no such model'))
  assert.equal(r.code, 'provider_model_unavailable')
  assert.ok(!r.message.includes('(modelo'), 'não inventa um nome que não existe')
})

// --- a armadilha do reasoning_effort -------------------------------------------------

test('só a família que raciocina aceita o controle de esforço', () => {
  for (const m of ['gpt-5.1', 'gpt-5-mini', 'gpt-5-nano', 'o1', 'o3-mini', 'o4-mini']) {
    assert.equal(aceitaReasoningEffort(m), true, m)
  }
  // Estes NÃO aceitam: mandar o parâmetro devolve 400 e mata a chamada inteira.
  for (const m of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4-turbo', 'chatgpt-4o-latest']) {
    assert.equal(aceitaReasoningEffort(m), false, m)
  }
  // Na dúvida, não manda: perder o ajuste custa latência; mandá-lo custa a resposta.
  assert.equal(aceitaReasoningEffort(null), false)
  assert.equal(aceitaReasoningEffort(''), false)
  assert.equal(aceitaReasoningEffort('modelo-desconhecido'), false)
})
