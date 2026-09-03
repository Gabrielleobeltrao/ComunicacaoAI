// O ENTENDIMENTO antes do desenho.
//
// O Brief é o artefato que faltava: antes dele, o primeiro produto do Arquiteto era um
// Blueprint — andar, agente e setor inventados a partir de uma frase. Uma estrutura
// plausível sobre um negócio que ninguém entendeu, e uma conversa seguinte gasta
// consertando nomes em vez de descobrindo.
//
// Tudo aqui é puro: o Brief é do NEGÓCIO, sem id técnico, sem preset, sem modo de
// setor. Se precisasse de banco para ser exercitado, ele já teria a mistura que existe
// para evitar.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { emptyBrief, applyBriefPatch, resolveIntegrations, briefForPrompt, BRIEF_LIMITS } = await import('../dist/architect/brief.js')
const { detectGaps, nextQuestions, gapsForPrompt } = await import('../dist/architect/nextQuestion.js')

// --- o patch ------------------------------------------------------------------------------

test('o patch soma ao entendimento e sobe a versão', () => {
  const b0 = emptyBrief()
  assert.equal(b0.version, 0)

  const b1 = applyBriefPatch(b0, { businessGoal: 'atender clientes do restaurante', channels: ['WhatsApp'] })
  assert.equal(b1.version, 1)
  assert.equal(b1.businessGoal, 'atender clientes do restaurante')
  assert.deepEqual(b1.channels, ['WhatsApp'])

  // O que o patch NÃO tocou continua igual: uma revisão que só muda o canal não pode
  // apagar os trabalhos já mapeados.
  const b2 = applyBriefPatch({ ...b1, jobs: [{ id: 'j1', name: 'Responder dúvida', trigger: 'mensagem', input: 'pergunta', decision: 'qual resposta', action: 'responder', output: 'resposta' }] }, { channels: ['Instagram'] })
  assert.deepEqual(b2.channels, ['Instagram'])
  assert.equal(b2.jobs.length, 1)
})

test('campo que não está no contrato não entra', () => {
  // Espalhar o que veio deixaria qualquer campo do modelo seguir até o banco.
  const b = applyBriefPatch(emptyBrief(), { businessGoal: 'x', ownerId: 'outra-conta', __proto__: { poluido: true }, blueprint: { agents: [] } })
  assert.equal(b.ownerId, undefined)
  assert.equal(b.blueprint, undefined)
  assert.equal(b.poluido, undefined)
})

test('trabalho é casado por id: dá para corrigir um sem reenviar todos', () => {
  const base = applyBriefPatch(emptyBrief(), {
    jobs: [
      { id: 'duvida', name: 'Responder dúvida', trigger: 'mensagem', input: 'pergunta', decision: 'qual resposta', action: 'responder', output: 'resposta' },
      { id: 'pedido', name: 'Consultar pedido', trigger: 'mensagem', input: 'número', decision: '', action: 'consultar', output: 'status', risk: 'low' },
    ],
  })
  const depois = applyBriefPatch(base, { jobs: [{ id: 'pedido', requiresHumanApproval: true }, { id: 'duvida' }] })
  const pedido = depois.jobs.find((j) => j.id === 'pedido')
  assert.equal(pedido.requiresHumanApproval, true)
  assert.equal(pedido.name, 'Consultar pedido', 'o que o patch não repetiu não se perde')
  assert.equal(pedido.risk, 'low')
  assert.equal(depois.jobs.length, 2)
})

test('o modelo NÃO decide o que está conectado', () => {
  // Ele nem tem como saber. Quem responde é o servidor, com o manifesto.
  const b = applyBriefPatch(emptyBrief(), { integrations: [{ key: 'whatsapp', need: 'falar com o cliente', connected: true }] })
  assert.equal(b.integrations[0].connected, null)

  const manifesto = { apps: [{ key: 'whatsapp', name: 'WhatsApp', connected: true, actions: [] }], channels: [] }
  const resolvido = resolveIntegrations(b, manifesto)
  assert.equal(resolvido.integrations[0].connected, true)

  const semApp = resolveIntegrations(applyBriefPatch(emptyBrief(), { integrations: [{ key: 'nuvemshop', need: 'ver pedidos' }] }), manifesto)
  assert.equal(semApp.integrations[0].connected, null, 'App fora do manifesto é desconhecido, não "desconectado"')
})

test('as listas têm teto — um Brief é entendimento, não depósito', () => {
  const muitos = Array.from({ length: 60 }, (_, i) => ({ id: `j${i}`, name: `Trabalho ${i}` }))
  const b = applyBriefPatch(emptyBrief(), { jobs: muitos, channels: Array.from({ length: 60 }, (_, i) => `canal ${i}`) })
  assert.equal(b.jobs.length, BRIEF_LIMITS.jobs)
  assert.equal(b.channels.length, BRIEF_LIMITS.lista)
})

// --- as lacunas ---------------------------------------------------------------------------

test('sem objetivo, a pergunta é o objetivo — e vai SOZINHA', () => {
  const gaps = nextQuestions(emptyBrief(), null)
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].id, 'objetivo')
  // A segunda pergunta seria sobre um negócio que ainda não foi descrito, e a resposta
  // dela mudaria depois que o objetivo aparecesse. Perguntar as duas juntas parece
  // eficiente e produz retrabalho.
})

test('com o objetivo dito, cabem até duas — nunca mais que isso', () => {
  const brief = applyBriefPatch(emptyBrief(), {
    businessGoal: 'atender clientes',
    jobs: [{ id: 'j', name: 'J' }],
    integrations: [{ need: 'ver pedidos no meu sistema' }],
    knowledgeNeeds: [{ subject: 'cardápio', required: true }],
  })
  const gaps = nextQuestions(brief, null)
  assert.ok(gaps.length <= 2, `veio ${gaps.length}: cinco perguntas por turno é formulário com outro nome`)
  assert.ok(gaps.length >= 1)
})

test('a ordem é por IMPACTO, e não por ordem de descoberta', () => {
  const brief = applyBriefPatch(emptyBrief(), {
    businessGoal: 'atender clientes',
    knowledgeNeeds: [{ subject: 'cardápio', required: true }],
  })
  const ids = detectGaps(brief, null).map((g) => g.id)
  // "quais são os trabalhos" muda o desenho inteiro; "vocês têm o cardápio escrito"
  // muda uma pendência. A ordem reflete isso.
  assert.equal(ids[0], 'trabalhos')
  assert.ok(ids.indexOf('trabalhos') < ids.findIndex((i) => i.startsWith('conhecimento:')))
})

test('as opções de canal são as REAIS da conta', () => {
  const brief = applyBriefPatch(emptyBrief(), { businessGoal: 'x', jobs: [{ id: 'j', name: 'J' }] })
  const semNada = detectGaps(brief, { apps: [], channels: [{ key: 'web_chat', connected: false }] }).find((g) => g.id === 'canal')
  assert.equal(semNada.choices, undefined, 'oferecer canal não conectado é prometer integração que não existe')

  const comChat = detectGaps(brief, { apps: [], channels: [{ key: 'web_chat', connected: true }] }).find((g) => g.id === 'canal')
  assert.deepEqual(comChat.choices, [{ value: 'web_chat', label: 'web_chat' }])
})

test('ação com consequência sem regra de aprovação vira pergunta', () => {
  const brief = applyBriefPatch(emptyBrief(), {
    businessGoal: 'vender',
    channels: ['WhatsApp'],
    jobs: [{ id: 'reembolso', name: 'Reembolsar cliente', trigger: 'pedido', input: 'nota', decision: 'se cabe', action: 'reembolsar', output: 'confirmação', risk: 'high' }],
  })
  const gap = detectGaps(brief, null).find((g) => g.id === 'aprovacao:reembolso')
  assert.ok(gap, 'operação que mexe em dinheiro sem dizer quem aprova nasce com risco que ninguém escolheu')
  assert.deepEqual(gap.choices.map((c) => c.value), ['sozinho', 'aprovacao'])

  // Com a regra escrita, a pergunta some.
  const comRegra = applyBriefPatch(brief, { humanApprovals: [{ action: 'Reembolsar cliente', rule: 'o dono aprova acima de R$ 100' }] })
  assert.equal(detectGaps(comRegra, null).some((g) => g.id.startsWith('aprovacao:')), false)
})

test('o que a conta já respondeu não vira pergunta de novo', () => {
  const brief = applyBriefPatch(emptyBrief(), {
    businessGoal: 'atender',
    jobs: [{ id: 'j', name: 'J' }],
    knownFacts: [{ key: 'canal', value: 'WhatsApp', source: 'user' }],
  })
  assert.equal(detectGaps(brief, null).some((g) => g.id === 'canal'), false)
})

test('sem lacuna de alto impacto, o prompt manda PROPOR — e não inventar pergunta', () => {
  const texto = gapsForPrompt([])
  assert.match(texto, /já dá para propor/)
  assert.match(texto, /não invente pergunta/i)

  const comLacuna = gapsForPrompt(nextQuestions(emptyBrief(), null))
  assert.match(comLacuna, /no máximo uma pergunta/)
  assert.match(comLacuna, /não mude o assunto e não acrescente outra/)
})

test('o Brief no prompt fala de negócio, não de estrutura técnica', () => {
  const brief = applyBriefPatch(emptyBrief(), {
    businessGoal: 'atender o cliente do restaurante',
    channels: ['WhatsApp'],
    jobs: [{ id: 'j1', name: 'Responder dúvida', trigger: 'mensagem do cliente', input: 'pergunta', decision: 'qual resposta cabe', action: 'responder', output: 'resposta' }],
    knownFacts: [{ key: 'horario', value: '11h às 23h', source: 'user' }],
  })
  const texto = briefForPrompt(brief)
  assert.match(texto, /atender o cliente do restaurante/)
  assert.match(texto, /Responder dúvida/)
  assert.match(texto, /NÃO pergunte de novo/)
  assert.match(texto, /11h às 23h/)
  // Nada de vocabulário de desenho: isso é o que fazia a pessoa ter de responder
  // "qual o output schema do setor" para descrever a própria empresa.
  assert.doesNotMatch(texto, /preset|blueprint|orchestrated|schema|floorKey/i)
})

// --- compatibilidade: o Brief gravado ANTES de `recordsToKeep` -------------------------------

test('um Brief antigo, sem `recordsToKeep`, não derruba a rodada', () => {
  // É exatamente o que está no banco de todo projeto que já existia: o campo simplesmente
  // não está lá. Ler `.length` de `undefined` derrubaria a próxima mensagem dessas pessoas.
  const antigo = emptyBrief('Atender clientes')
  delete antigo.recordsToKeep
  antigo.version = 1

  const texto = briefForPrompt(antigo)
  assert.match(texto, /Atender clientes/)
  assert.equal(texto.includes('Registros a guardar'), false)
})

test('um patch com `recordsToKeep` preenche o campo que faltava', () => {
  const antigo = emptyBrief('Atender clientes')
  delete antigo.recordsToKeep
  const depois = applyBriefPatch(antigo, { recordsToKeep: [{ subject: 'Atendimentos', fields: ['cliente'], retentionDays: 90 }] })
  assert.equal(depois.recordsToKeep.length, 1)
  assert.equal(depois.recordsToKeep[0].retentionDays, 90)
})

test('uma retenção inválida NÃO vira "apague já"', () => {
  for (const valor of [-1, 0, 0.5, 'muito tempo', null, undefined]) {
    const r = applyBriefPatch(emptyBrief('x'), { recordsToKeep: [{ subject: 'Atendimentos', fields: ['a'], retentionDays: valor }] })
    assert.equal(r.recordsToKeep[0].retentionDays, null, `${valor} não é uma retenção`)
  }
  // E um número absurdo é limitado, em vez de virar retenção infinita por engano.
  const teto = applyBriefPatch(emptyBrief('x'), { recordsToKeep: [{ subject: 'A', fields: ['a'], retentionDays: 99999 }] })
  assert.equal(teto.recordsToKeep[0].retentionDays, 3650)
})
