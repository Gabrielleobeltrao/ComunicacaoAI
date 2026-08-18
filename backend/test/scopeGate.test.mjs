// O porteiro de escopo: quem paga a checagem, e quantas vezes.
//
// Um sistema de restaurante perguntado sobre a previsão do tempo não deve pagar por uma
// resposta — e não deve pagar DE NOVO na segunda vez que perguntarem. O que se mede aqui
// é exatamente isso: o número de chamadas ao modelo.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { checkScope } = await import('../dist/scopeGate.js')
const { forgetScope } = await import('../dist/scopeCache.js')

const base = { objective: 'Atende o restaurante: reservas e cardápio.', history: [] }

test('a mesma pergunta fora do escopo só é checada uma vez', async () => {
  forgetScope()
  let chamadas = 0
  const verificar = async () => {
    chamadas++
    return false
  }
  const args = { ...base, scopeId: 'a1', message: 'vai chover amanhã?', verificar }

  const primeira = await checkScope(args)
  assert.equal(primeira.inScope, false)
  assert.equal(primeira.checked, true, 'a primeira paga a checagem')

  const segunda = await checkScope({ ...args, message: '  Vai chover amanhã? ' })
  assert.equal(segunda.inScope, false, 'o veredito lembrado é o mesmo')
  assert.equal(segunda.checked, false, 'a repetição não paga nada')
  assert.equal(chamadas, 1, 'o modelo foi chamado uma única vez')
})

test('a lembrança é por agente: outro escopo decide sozinho', async () => {
  forgetScope()
  let chamadas = 0
  const args = { ...base, message: 'vai chover amanhã?', verificar: async () => (chamadas++, false) }

  await checkScope({ ...args, scopeId: 'restaurante' })
  const meteorologia = await checkScope({ ...args, scopeId: 'sector:previsao', verificar: async () => (chamadas++, true) })

  assert.equal(meteorologia.inScope, true, 'para um setor de meteorologia a mesma pergunta é do assunto')
  assert.equal(chamadas, 2)
})

test('falha do porteiro deixa passar e não é lembrada', async () => {
  forgetScope()
  let chamadas = 0
  const verificar = async () => {
    chamadas++
    throw new Error('provider offline')
  }
  const args = { ...base, scopeId: 'a2', message: 'tem mesa para quatro?', verificar }

  const primeira = await checkScope(args)
  assert.equal(primeira.inScope, true, 'erro de rede não pode negar atendimento a quem perguntou algo legítimo')

  await checkScope(args)
  assert.equal(chamadas, 2, 'um erro não vira veredito guardado')
})

test('perguntas diferentes são checadas em separado', async () => {
  forgetScope()
  let chamadas = 0
  const verificar = async () => (chamadas++, true)
  await checkScope({ ...base, scopeId: 'a3', message: 'qual o cardápio de hoje?', verificar })
  await checkScope({ ...base, scopeId: 'a3', message: 'posso reservar para sábado?', verificar })
  assert.equal(chamadas, 2)
})

// --- a lembrança expira -------------------------------------------------------------
// O dono edita o objetivo do agente e o que estava fora do escopo passa a estar dentro.
// Sem prazo, o veredito velho responderia por ele.
const { rememberScope, rememberedScope } = await import('../dist/scopeCache.js')

test('o veredito lembrado tem prazo', () => {
  forgetScope()
  const agora = 1_700_000_000_000
  rememberScope('a4', 'vai chover?', false, agora)
  assert.equal(rememberedScope('a4', 'vai chover?', agora + 60_000), false, 'um minuto depois ainda vale')
  assert.equal(rememberedScope('a4', 'vai chover?', agora + 31 * 60_000), null, 'meia hora depois é checado de novo')
})
