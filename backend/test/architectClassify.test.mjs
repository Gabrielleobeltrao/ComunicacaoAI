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

const { classifyJob, classifyBrief, classificationForPrompt, formaPedida } = await import('../dist/architect/classify.js')
const { detectGaps } = await import('../dist/architect/nextQuestion.js')
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

// --- quando o servidor discorda de quem pediu -------------------------------------------
//
// A REGRA DECIDE BEM, e mesmo assim decide sozinha. A pessoa escreve "quero um agente que
// guarde a máxima do dia"; a regra lê "guardar máxima" como cálculo sem julgamento e devolve
// FUNÇÃO. Ela está certa sobre o custo e errada sobre quem manda: o que sai não é o que foi
// pedido, e ninguém foi avisado da troca.
//
// O desenho é o mesmo de sempre — o código decide, o modelo não —, com um degrau a mais: a
// divergência vira PERGUNTA, e a resposta MANDA. Não é o modelo escolhendo a forma; é a
// pessoa, dentro de um conjunto fechado que o servidor ofereceu.

test('a forma PEDIDA é lida da frase — "um agente que…" é um pedido de agente', () => {
  assert.equal(formaPedida(job({ name: 'quero um agente que guarde a máxima do dia' })), 'agent')
  assert.equal(formaPedida(job({ name: 'crie uma ferramenta para consultar o pedido' })), 'tool')
  assert.equal(formaPedida(job({ name: 'uma rotina que roda todo dia' })), 'routine')
  // Sem pedido explícito, não há divergência a resolver: quem decide é a regra.
  assert.equal(formaPedida(job({ name: 'guardar a máxima do dia' })), null)
})

test('ACEITAÇÃO: pedido de AGENTE contra decisão de FUNÇÃO vira pergunta', () => {
  const j = job({ id: 'j1', name: 'quero um agente que calcule a máxima do dia', action: 'calcular a máxima' })
  const decisao = classifyJob(j, manifesto)
  assert.equal(decisao.kind, 'function', 'a regra continua decidindo o que decidia')

  const brief = { ...emptyBrief('guardar a máxima'), jobs: [j] }
  const gap = detectGaps(brief, manifesto).find((g) => g.id === `forma:${j.id}`)
  assert.ok(gap, `faltou a pergunta de forma: ${JSON.stringify(detectGaps(brief, manifesto).map((g) => g.id))}`)
  // As duas saídas, com nome de gente — e a do servidor primeiro, porque ela é a recomendação.
  assert.deepEqual(gap.choices.map((c) => c.value), ['function', 'agent'])
  assert.match(gap.why, /determin|mesma entrada|julgamento/i)
})

test('ACEITAÇÃO: respondida, a escolha da PESSOA manda — o desenho sai como ela pediu', () => {
  const j = job({ id: 'j1', name: 'quero um agente que calcule a máxima do dia', action: 'calcular a máxima' })
  const brief = { ...emptyBrief('guardar a máxima'), jobs: [j] }

  const escolhido = classifyBrief(brief, manifesto, { 'forma:j1': 'agent' })
  assert.equal(escolhido.decisions[0].kind, 'agent')
  // E o porquê não é apagado: quem lê a proposta vê que houve uma troca e qual era a recomendação.
  assert.match(escolhido.decisions[0].because, /você escolheu|escolha/i)
  assert.ok(
    escolhido.decisions[0].rejected.some((r) => r.kind === 'function'),
    'a recomendação recusada tem de continuar registrada',
  )
})

test('AMEAÇA: uma resposta fora do conjunto fechado é IGNORADA', () => {
  /**
   * A resposta chega pelo mesmo caminho de todas as outras, e esse caminho passa pelo
   * modelo. Aceitar qualquer string seria deixar o modelo escolher a forma por escrito —
   * exatamente o que a classificação existe para impedir. Só vale o que foi oferecido.
   */
  const j = job({ id: 'j1', name: 'quero um agente que calcule a máxima do dia', action: 'calcular a máxima' })
  const brief = { ...emptyBrief('guardar a máxima'), jobs: [j] }
  for (const lixo of ['superagente', 'agent; drop table', '', 'sector']) {
    assert.equal(classifyBrief(brief, manifesto, { 'forma:j1': lixo }).decisions[0].kind, 'function', `aceitou "${lixo}"`)
  }
})

test('respondida a favor da regra, nada muda — e a pergunta não volta', () => {
  const j = job({ id: 'j1', name: 'quero um agente que calcule a máxima do dia', action: 'calcular a máxima' })
  const brief = { ...emptyBrief('guardar a máxima'), jobs: [j], knownFacts: [{ key: 'forma:j1', value: 'function', source: 'user' }] }
  assert.equal(classifyBrief(brief, manifesto, { 'forma:j1': 'function' }).decisions[0].kind, 'function')
  assert.equal(detectGaps(brief, manifesto).find((g) => g.id === 'forma:j1'), undefined, 'a pergunta respondida voltou')
})

// --- a pergunta só quando há DÚVIDA -----------------------------------------------------
//
// Perguntar em toda divergência é quase tão ruim quanto trocar em silêncio: "agente" é
// como muita gente diz "quero que o sistema faça isso", e transformar cada uso da palavra
// numa escolha de arquitetura enche a conversa de degraus que não mudam nada.
//
// Dúvida é uma coisa MEDÍVEL, e são duas:
//
//   1. a recomendação não se sustenta — a regra pede uma função e não existe função
//      registrada que faça aquilo, ou pede ferramenta e nenhum App serve. Recomendar o que
//      não dá para construir é o caso em que a alternativa merece ser considerada;
//   2. a descrição da pessoa APOIA a forma que ela pediu — ela escreveu "agente" e o
//      trabalho tem julgamento no texto. Aí a palavra foi escolha, não modo de falar.
//
// Fora disso a regra decide e segue, e o porquê continua na proposta em `rejected`: não
// perguntar não é o mesmo que não contar.

test('SEM dúvida: cálculo puro com função registrada não vira pergunta', () => {
  // A função `lista.ordenar` existe e o trabalho a nomeia; nada no texto sugere julgamento.
  // A regra está certa e sozinha — perguntar aqui é degrau à toa.
  const j = job({ id: 'j1', name: 'quero um agente que faça ordenar a lista de preços', action: 'ordenar a lista' })
  const brief = { ...emptyBrief('médias'), jobs: [j] }
  assert.equal(classifyJob(j, manifesto).resolved, true, 'a recomendação tinha de estar resolvida')
  assert.equal(detectGaps(brief, manifesto).find((g) => g.id === 'forma:j1'), undefined)
})

test('COM dúvida: a recomendação não se sustenta — não há função que faça a conta', () => {
  const j = job({ id: 'j1', name: 'quero um agente que calcule o índice de satisfação', action: 'calcular o índice de satisfação' })
  const brief = { ...emptyBrief('satisfação'), jobs: [j] }
  const decisao = classifyJob(j, manifesto)
  assert.equal(decisao.kind, 'function')
  assert.equal(decisao.resolved, false, 'nenhuma função registrada faz isto')
  assert.ok(detectGaps(brief, manifesto).find((g) => g.id === 'forma:j1'), 'com recomendação sem lastro, tem de perguntar')
})

test('COM dúvida: o texto da pessoa APOIA a forma que ela pediu', () => {
  // "avaliar" é julgamento; "quero um agente" deixa de ser modo de falar.
  const j = job({ id: 'j1', name: 'quero um agente que consulte o pedido e avalie se cabe reembolso', action: 'consultar o pedido' })
  const brief = { ...emptyBrief('reembolso'), jobs: [j] }
  assert.ok(detectGaps(brief, manifesto).find((g) => g.id === 'forma:j1'))
})

test('SEM dúvida: pediu ferramenta e a regra deu ferramenta — nada a perguntar', () => {
  const j = job({ id: 'j1', name: 'crie uma ferramenta para consultar o pedido na Nuvemshop', action: 'consultar pedido' })
  const brief = { ...emptyBrief('pedidos'), jobs: [j] }
  assert.equal(detectGaps(brief, manifesto).find((g) => g.id === 'forma:j1'), undefined)
})
