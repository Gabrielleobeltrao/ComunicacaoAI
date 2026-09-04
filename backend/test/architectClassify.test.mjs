// AGENTE, FUNÇÃO ou FERRAMENTA — a decisão que evita as duas patologias.
//
// De um lado o superagente: um agente responsável por atendimento, marketing, finanças
// e relatórios, que erra sem que ninguém saiba em qual etapa. Do outro o enxame: um
// agente por microetapa, nenhum com decisão própria. As duas nascem da mesma ausência —
// ninguém classificou o TRABALHO antes de criar gente.
//
// Puro de propósito: a classificação é a regra mais discutível do Arquiteto, e uma
// regra discutível precisa ser exercitável sem subir nada.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { classifyJob, classifyBrief, classificationForPrompt } = await import('../dist/architect/classify.js')
const { emptyBrief, applyBriefPatch } = await import('../dist/architect/brief.js')

const job = (over = {}) => ({ id: 'j', name: 'Trabalho', trigger: '', input: '', decision: '', action: '', output: '', ...over })

const manifesto = {
  functions: [
    { functionName: 'math.serie', description: 'série', capabilities: ['calcular'], version: '1', hasConfig: false },
    { functionName: 'lista.ordenar', description: 'ordena', capabilities: ['ordenar'], version: '1', hasConfig: false },
  ],
  apps: [
    { key: 'nuvemshop', name: 'Nuvemshop', connected: true, actions: [{ key: 'get_order', name: 'Consultar pedido', risk: 'read' }] },
    { key: 'web_chat', name: 'Chat Web', connected: true, actions: [] },
  ],
  presets: [],
  channels: [],
}

// --- função ---------------------------------------------------------------------------------

test('cálculo sem julgamento vira FUNÇÃO — não um agente que finge que calculou', () => {
  const d = classifyJob(job({ name: 'Calcular a média móvel do preço', action: 'calcular média', output: 'número' }), manifesto)
  assert.equal(d.kind, 'function')
  // O erro mais caro do catálogo: um modelo de linguagem acerta a conta na maioria das
  // vezes e erra em silêncio.
  assert.match(d.rejected[0].because, /não há julgamento/)
  assert.equal(d.rejected[0].kind, 'agent')
  // A função ESPECÍFICA só é apontada quando o nome dela aparece no trabalho. "Calcular
  // a média móvel" não é `math.serie`: casar por capacidade genérica ("calcular")
  // resolvia qualquer conta para qualquer função, e uma resolução errada vira proposta
  // aprovada sobre um recurso que não serve.
  assert.equal(d.resolved, false)
  assert.equal(d.resourceRef, undefined)
})

test('quando a função existe MESMO, ela é apontada pelo nome', () => {
  const d = classifyJob(job({ name: 'Ordenar os pedidos por valor', action: 'ordenar a lista', output: 'lista' }), manifesto)
  assert.equal(d.kind, 'function')
  assert.equal(d.resourceRef, 'lista.ordenar')
  assert.equal(d.resolved, true)
})

test('cálculo COM julgamento continua sendo agente — e a conta vira função dele', () => {
  const d = classifyJob(
    job({ name: 'Analisar o indicador e decidir se é hora de comprar', decision: 'se o sinal justifica a entrada', action: 'calcular indicador e recomendar', output: 'recomendação' }),
    manifesto,
  )
  assert.equal(d.kind, 'agent')
  assert.equal(d.suggestedPreset, 'analyst')
  assert.ok(d.rejected.some((r) => r.kind === 'function' && /acompanha um julgamento/.test(r.because)))
})

test('função que o registro não tem vira PENDÊNCIA, não invenção', () => {
  const d = classifyJob(job({ name: 'Calcular o frete por faixa de CEP', action: 'calcular frete', output: 'valor' }), manifesto)
  assert.equal(d.kind, 'function')
  assert.equal(d.resolved, false, 'o recurso não existe: isso é pendência declarada')
  assert.equal(d.resourceRef, undefined)
})

// --- ferramenta -----------------------------------------------------------------------------

test('chamada a sistema externo vira FERRAMENTA de quem já conversa', () => {
  const d = classifyJob(job({ name: 'Consultar pedido na Nuvemshop', action: 'consultar pedido', output: 'status' }), manifesto)
  assert.equal(d.kind, 'tool')
  assert.equal(d.resourceRef, 'nuvemshop')
  // "Consultar pedido" não é um cargo. Era assim que nascia o enxame de microagentes.
  assert.match(d.rejected[0].because, /não uma responsabilidade/)
})

test('App não conectado vira pendência, e não um agente para compensar', () => {
  const d = classifyJob(job({ name: 'Registrar no sistema de estoque', action: 'registrar' }), { ...manifesto, apps: [] })
  assert.equal(d.kind, 'tool')
  assert.equal(d.resolved, false)
})

// --- rotina ---------------------------------------------------------------------------------

test('vigiar uma fonte no tempo vira ROTINA', () => {
  const d = classifyJob(job({ name: 'Monitorar o preço da ação', action: 'acompanhar cotação', frequency: 'a cada hora' }), manifesto)
  assert.equal(d.kind, 'routine')
  assert.match(d.rejected[0].because, /quem dispara é o tempo/)
})

test('vigiar COM interpretação sugere o perfil monitor', () => {
  const d = classifyJob(job({ name: 'Monitorar reclamações e avisar quando o tom piorar', decision: 'se o tom piorou', action: 'avisar' }), manifesto)
  assert.equal(d.kind, 'routine')
  assert.equal(d.suggestedPreset, 'monitor')
})

// --- agente ---------------------------------------------------------------------------------

test('interpretar linguagem vira AGENTE, com o perfil de quem fala', () => {
  const d = classifyJob(job({ name: 'Responder dúvidas do cliente', decision: 'qual resposta cabe', action: 'responder', output: 'resposta' }), manifesto)
  assert.equal(d.kind, 'agent')
  assert.equal(d.suggestedPreset, 'communicator')
  assert.match(d.because, /exige julgamento/)
})

test('conversar E agir no sistema sugere operador', () => {
  const d = classifyJob(job({ name: 'Atender o cliente e registrar o pedido', decision: 'o que o cliente quer', action: 'registrar pedido' }), manifesto)
  assert.equal(d.kind, 'agent')
  assert.equal(d.suggestedPreset, 'operator')
})

// --- o conjunto ------------------------------------------------------------------------------

test('o restaurante simples não vira quatro agentes', () => {
  // O caso da especificação: um comunicador com ferramentas, e não um agente para cada
  // consulta que ele precisa fazer.
  const brief = applyBriefPatch(emptyBrief(), {
    jobs: [
      { id: 'duvida', name: 'Responder dúvidas do cardápio', decision: 'qual resposta cabe', action: 'responder', output: 'resposta' },
      { id: 'pedido', name: 'Consultar pedido na Nuvemshop', action: 'consultar pedido', output: 'status' },
      { id: 'frete', name: 'Calcular o total com frete', action: 'somar valores', output: 'total' },
      { id: 'preco', name: 'Monitorar o preço dos insumos', action: 'acompanhar preço', frequency: 'diário' },
    ],
  })
  const c = classifyBrief(brief, manifesto)
  assert.equal(c.agentCount, 1, `viraram ${c.agentCount} agentes: ${c.decisions.filter((d) => d.kind === 'agent').map((d) => d.jobName).join(', ')}`)
  assert.deepEqual(
    c.decisions.map((d) => d.kind),
    ['agent', 'tool', 'function', 'routine'],
  )
})

test('o que não existe no catálogo fica listado como pendência', () => {
  const brief = applyBriefPatch(emptyBrief(), {
    jobs: [{ id: 'x', name: 'Registrar no ERP da empresa', action: 'registrar' }],
  })
  const c = classifyBrief(brief, manifesto)
  assert.equal(c.unresolved.length, 1)
  assert.equal(c.unresolved[0].kind, 'tool')
})

test('o texto para o modelo carrega a decisão E a alternativa recusada', () => {
  const brief = applyBriefPatch(emptyBrief(), {
    jobs: [
      { id: 'duvida', name: 'Responder dúvidas', decision: 'qual resposta', action: 'responder' },
      { id: 'calc', name: 'Calcular a média do mês', action: 'calcular média' },
    ],
  })
  const texto = classificationForPrompt(classifyBrief(brief, manifesto))
  assert.match(texto, /decidido pelo servidor/)
  assert.match(texto, /"Responder dúvidas" → AGENTE com perfil "communicator"/)
  assert.match(texto, /"Calcular a média do mês" → FUNÇÃO determinística/)
  assert.match(texto, /Não crie agente para trabalho que já foi classificado/)
  assert.match(texto, /Isto é o núcleo: 1 agente/)
})

// --- "sempre" não é uma cadência ---------------------------------------------------------------
//
// `frequency` empurrava qualquer trabalho para ROTINA. Mas "sempre" e "sob demanda" não são
// horários: são "toda vez que acontecer". Um trabalho disparado por uma PESSOA — "quando o
// cliente pede mesa" — virava uma automação agendada, que é a mesma patologia de
// "quando o RSI ficar abaixo de 30" virando um cron das oito da manhã.

test('"sempre" NÃO transforma um trabalho reativo em rotina agendada', () => {
  const d = classifyJob(
    job({
      name: 'Reservar mesa',
      trigger: 'quando o cliente pede mesa',
      decision: 'se há disponibilidade',
      action: 'criar o evento na agenda',
      frequency: 'sempre',
    }),
    manifesto,
  )
  assert.notEqual(d.kind, 'routine', 'quem dispara é o cliente, e um cliente não tem horário')
  assert.equal(d.kind, 'agent', 'há julgamento: "se há disponibilidade"')
})

test('"sob demanda" e "a cada pedido" também não são cadências', () => {
  for (const frequencia of ['sob demanda', 'a cada pedido', 'quando pedirem', 'conforme a necessidade']) {
    const d = classifyJob(job({ name: 'Emitir a segunda via', trigger: 'quando o cliente pede', decision: 'se o boleto venceu', frequency: frequencia }), manifesto)
    assert.notEqual(d.kind, 'routine', `"${frequencia}" não é um horário`)
  }
})

test('uma cadência DE VERDADE continua virando rotina', () => {
  for (const frequencia of ['diário', 'a cada hora', 'toda segunda', 'a cada 15 minutos', 'semanal', 'mensal']) {
    const d = classifyJob(job({ name: 'Montar o relatório do dia', action: 'montar o relatório', frequency: frequencia }), manifesto)
    assert.equal(d.kind, 'routine', `"${frequencia}" é um horário e tem que virar rotina`)
  }
})

test('vigilância continua virando rotina mesmo sem frequência', () => {
  const d = classifyJob(job({ name: 'Monitorar o estoque', action: 'acompanhar o estoque' }), manifesto)
  assert.equal(d.kind, 'routine')
})
