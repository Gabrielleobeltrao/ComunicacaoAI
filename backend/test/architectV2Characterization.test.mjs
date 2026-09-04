// AS 13 LACUNAS DO V1 — capturadas ANTES de mudar qualquer comportamento.
//
// Um teste de caracterização não afirma que o comportamento está certo. Ele afirma qual é
// o comportamento HOJE, para que a mudança que vem depois seja visível: sem isto, uma
// correção e uma regressão têm exatamente a mesma aparência no diff.
//
// Cada caso abaixo cita a lacuna da seção 4 do plano e trava o que o V1 faz agora. Quando
// a fase correspondente do V2 entrar, o caso é REESCRITO para afirmar o comportamento novo
// — e a linha que muda mostra o que foi consertado.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { compileBrief } = await import('../dist/architect/compile.js')
const { emptyBrief } = await import('../dist/architect/brief.js')
const { validateOfficeBlueprint, emptyOwnershipContext } = await import('../dist/architect/validate.js')

/** Um manifesto pequeno e explícito: o que a conta tem, com as ações reais. */
const manifesto = (over = {}) => ({
  version: 1,
  presets: [],
  executorKinds: [],
  sectorModes: [],
  activationModes: [],
  functions: [],
  apps: [
    {
      key: 'whatsapp',
      name: 'WhatsApp',
      connected: true,
      actions: [
        { key: 'send_message', name: 'Enviar mensagem', risk: 'write' },
        { key: 'list_messages', name: 'Listar mensagens', risk: 'read' },
      ],
    },
    {
      key: 'google_calendar',
      name: 'Google Calendar',
      connected: false,
      actions: [
        { key: 'list_events', name: 'Listar eventos', risk: 'read' },
        { key: 'create_event', name: 'Criar evento', risk: 'write' },
      ],
    },
  ],
  tools: [],
  knowledgeScopes: ['agent', 'sector', 'floor', 'building'],
  channels: [
    { key: 'web_chat', connected: true },
    { key: 'whatsapp', connected: false },
  ],
  ...over,
})

const briefDe = (over = {}) => ({
  ...emptyBrief('Atender clientes'),
  jobs: [
    {
      id: 'atender',
      name: 'Atender o cliente',
      trigger: 'chega uma mensagem',
      input: 'a mensagem',
      decision: 'o que a pessoa quer',
      action: 'responder',
      output: 'uma resposta',
    },
  ],
  ...over,
})

// --- lacuna 1: o Blueprint V1 não representa a operação inteira -------------------------

test('LACUNA 1: o Blueprint V1 não tem onde guardar Databases, Sources, Monitors ou Flows', () => {
  const { blueprint } = compileBrief(briefDe(), manifesto(), { title: 'Atendimento', objective: 'Atender' })

  // O que ele TEM:
  for (const campo of ['floors', 'agents', 'sectors', 'routines', 'appRequirements', 'knowledgeRequirements']) {
    assert.ok(campo in blueprint, `o V1 deveria ter ${campo}`)
  }
  // O que ele NÃO tem — e é exatamente a operação que o produto promete montar.
  for (const campo of ['databases', 'datasets', 'tools', 'sources', 'monitors', 'flows', 'deliveries', 'channels', 'access', 'acceptanceTests']) {
    assert.equal(campo in blueprint, false, `o V1 ainda não deveria ter ${campo} (lacuna 1)`)
  }
  assert.equal(blueprint.version, 1)
})

// --- lacuna 2: liveDataNeeds não vira nada ----------------------------------------------

test('LACUNA 2: uma necessidade de dado ao vivo não é compilada em fonte, destino nem monitor', () => {
  const brief = briefDe({
    liveDataNeeds: [{ source: 'cotação do dólar', freshness: 'até 1 minuto', required: true }],
  })
  const { blueprint, pending } = compileBrief(brief, manifesto(), { title: 'Câmbio', objective: 'Acompanhar' })

  // Nada nasce dela, e nem sequer aparece como pendência declarada.
  assert.equal(JSON.stringify(blueprint).includes('dólar'), false)
  assert.equal(pending.some((p) => p.ref?.includes('dólar')), false, 'nem pendência ela vira (lacuna 2)')
})

// --- lacuna 3: só quatro tipos podem ser reaproveitados ---------------------------------

test('LACUNA 3 CORRIGIDA: reaproveitar vale também para Database, fonte, monitor e Flow', async () => {
  // `links.js` puxa o banco no import, e este arquivo é unitário de propósito: o que se
  // afirma aqui é o VOCABULÁRIO, que está no código-fonte.
  const { readFile } = await import('node:fs/promises')
  const fonte = await readFile(new URL('../src/architect/links.ts', import.meta.url), 'utf8')
  const linha = /const KINDS: LinkKind\[\] = \[([^\]]+)\]/.exec(fonte)
  assert.ok(linha, 'a lista de tipos precisa existir')
  const tipos = linha[1].split(',').map((t) => t.trim().replace(/'/g, '')).filter(Boolean)

  // Os quatro do V1 continuam valendo…
  for (const antigo of ['floor', 'agent', 'sector', 'routine']) assert.ok(tipos.includes(antigo), `${antigo} sumiu`)
  // …e os do V2 passaram a existir. Sem eles, a pessoa via a proposta criar um segundo
  // Database ao lado do dela e não tinha onde dizer o contrário.
  for (const novo of ['database', 'source', 'monitor', 'flow']) {
    assert.ok(tipos.includes(novo), `${novo} ainda não pode ser reaproveitado`)
  }
})

// --- lacuna 4: um andar genérico, sem escolha entre expandir e criar --------------------

test('LACUNA 4: o compilador cria sempre UM andar chamado a partir do título, e sempre "create"', () => {
  const brief = briefDe({
    businessGoal: 'Uma empresa com atendimento, financeiro e logística',
    jobs: [
      { id: 'atender', name: 'Atender', trigger: 'mensagem', input: 'x', decision: 'y', action: 'z', output: 'w' },
      { id: 'cobrar', name: 'Cobrar', trigger: 'vencimento', input: 'x', decision: 'y', action: 'z', output: 'w' },
      { id: 'entregar', name: 'Entregar', trigger: 'pedido pago', input: 'x', decision: 'y', action: 'z', output: 'w' },
    ],
  })
  const { blueprint } = compileBrief(brief, manifesto(), { title: 'Empresa', objective: 'Operar' })

  assert.equal(blueprint.floors.length, 1, 'três áreas continuam virando um andar só (lacuna 4)')
  assert.equal(blueprint.floors[0].key, 'operacao')
  assert.equal(blueprint.floors[0].action, 'create', 'nunca "reuse": expandir não é considerado (lacuna 4)')
  assert.equal(blueprint.floors[0].workMode, 'organization')
})

// --- lacuna 5: App sem ação nenhuma -----------------------------------------------------

test('LACUNA 5: todo requisito de App é compilado com actionKeys vazio', () => {
  const brief = briefDe({
    channels: ['whatsapp'],
    jobs: [
      {
        id: 'agendar',
        name: 'Agendar no calendário',
        trigger: 'o cliente pede horário',
        input: 'o horário',
        decision: 'se cabe',
        action: 'criar o evento no google_calendar',
        output: 'a confirmação',
      },
    ],
  })
  const { blueprint } = compileBrief(brief, manifesto(), { title: 'Agenda', objective: 'Agendar' })

  assert.ok(blueprint.appRequirements.length > 0, 'algum App precisa ter sido pedido')
  for (const req of blueprint.appRequirements) {
    assert.deepEqual(req.actionKeys, [], `${req.appKey} sai sem ação nenhuma (lacuna 5)`)
  }
  // E um grant sem ação resolve para zero ferramentas: o agente fica com o App e sem poder usá-lo.
  assert.equal(
    blueprint.appRequirements.every((r) => r.actionKeys.length === 0),
    true,
  )
})

// --- lacuna 6: o canal conectado ganha do canal pedido ----------------------------------

test('LACUNA 6: o canal escolhido é o primeiro CONECTADO, e não o que a pessoa pediu', () => {
  // A pessoa pediu WhatsApp; o que está conectado é o web_chat.
  const brief = briefDe({ channels: ['whatsapp'] })
  const { blueprint } = compileBrief(brief, manifesto(), { title: 'Atendimento', objective: 'Atender' })

  const canal = blueprint.appRequirements.find((r) => r.reason.includes('Receber o que chega'))
  assert.ok(canal, 'o canal precisa ter sido proposto')
  assert.equal(canal.appKey, 'web_chat', 'o conectado ganhou do pedido (lacuna 6)')
  assert.notEqual(canal.appKey, 'whatsapp')
})

// --- lacuna 9: trabalho condicionado por dado vira cron ---------------------------------

test('LACUNA 9: "quando o RSI ficar abaixo de 30" vira rotina com cron padrão', () => {
  const brief = briefDe({
    businessGoal: 'Acompanhar CXSE3',
    liveDataNeeds: [{ source: 'cotação CXSE3', required: true }],
    jobs: [
      {
        id: 'avisar-rsi',
        name: 'Avisar quando o RSI ficar abaixo de 30',
        trigger: 'o RSI de CXSE3 fica abaixo de 30',
        input: 'as cotações',
        decision: 'se o RSI cruzou 30',
        action: 'avisar',
        output: 'o aviso',
        frequency: 'a cada fechamento de candle',
      },
    ],
  })
  const { blueprint } = compileBrief(brief, manifesto(), { title: 'CXSE3', objective: 'Vigiar' })

  // Não existe monitor nem fonte no V1; se virar rotina, ela nasce com cron fixo.
  const rotina = blueprint.routines[0]
  if (rotina) {
    assert.equal(rotina.triggerType, 'schedule', 'condição virou horário (lacuna 9)')
    assert.equal(rotina.cron, '0 8 * * *', 'e o horário é um padrão inventado (lacuna 9)')
  }
  assert.equal('monitors' in blueprint, false, 'não há monitor para onde a condição pudesse ir (lacuna 9)')
})

test('LACUNA 9 CORRIGIDA: o mesmo Brief, no V2, vira fonte + histórico + monitor + Flow', async () => {
  const { compileBriefV2 } = await import('../dist/architect/compileV2.js')
  const brief = briefDe({
    businessGoal: 'Acompanhar CXSE3',
    liveDataNeeds: [{ source: 'cotação CXSE3', required: true }],
    jobs: [
      {
        id: 'avisar-rsi',
        name: 'Avisar quando o RSI ficar abaixo de 30',
        trigger: 'o RSI de CXSE3 fica abaixo de 30',
        input: 'as cotações',
        decision: '',
        action: 'avisar',
        output: 'o aviso',
        frequency: 'a cada fechamento de candle',
      },
    ],
  })
  const { blueprint } = compileBriefV2({
    brief,
    manifest: manifesto(),
    inventory: null,
    base: { title: 'CXSE3', objective: 'Vigiar' },
    changeKind: 'create',
  })

  // A condição é sobre o DADO, não sobre o horário: ela precisa de um "antes" e um "agora".
  assert.ok(blueprint.operations.sources.length > 0, 'sem fonte, não há o que observar')
  assert.ok(blueprint.operations.histories.length > 0, 'uma borda só existe com valor anterior')
  assert.ok(blueprint.operations.monitors.length > 0, 'a condição precisa de um monitor')
  assert.ok(blueprint.operations.flows.length > 0, 'o aviso precisa de um Flow para sair')
  // E nenhuma rotina com cron inventado.
  assert.equal(
    blueprint.operations.routines.some((r) => r.cron === '0 8 * * *'),
    false,
    'um horário inventado dispara o aviso na hora errada, todo dia',
  )
})

// --- lacuna 11: responsabilidade pode faltar no agente compilado ------------------------

test('LACUNA 11: o validador ACEITA um agente sem responsabilidade e sem contratos', () => {
  const { blueprint } = compileBrief(briefDe(), manifesto(), { title: 'Atendimento', objective: 'Atender' })

  // O compilador preenche `role`. Mas nada obriga: um Blueprint editado à mão, ou vindo
  // de uma fixture legada, passa sem responsabilidade nenhuma — e o Flow renderiza vazio.
  const semPapel = structuredClone(blueprint)
  delete semPapel.agents[0].role
  delete semPapel.agents[0].objective
  delete semPapel.agents[0].inputContract
  delete semPapel.agents[0].outputContract

  const r = validateOfficeBlueprint(semPapel, emptyOwnershipContext())
  const bloqueantes = r.issues.filter((i) => i.severity === 'error')
  assert.equal(
    bloqueantes.some((i) => /responsabilidade|papel|contrato/i.test(i.message)),
    false,
    'agente sem responsabilidade nem contrato passa no validador (lacuna 11)',
  )
})

// --- lacuna 7: declarar um App de canal não cria o vínculo operacional ------------------

test('LACUNA 7: a aplicação não cria vínculo entre canal, agente de entrada e conversa', async () => {
  const { readFile } = await import('node:fs/promises')
  const apply = await readFile(new URL('../src/architect/apply.ts', import.meta.url), 'utf8')

  // A saga tem passos para andar, agente, setor, wiring, conhecimento, rotina e grant.
  for (const passo of ['floor', 'agent', 'sector', 'wiring', 'knowledge', 'routine', 'grant']) {
    assert.ok(apply.includes(`'${passo}'`), `o passo ${passo} existe`)
  }
  // E nenhum passo de canal: o App é concedido, mas ninguém liga a porta de entrada.
  assert.equal(/channelBinding|channel_binding|vincularCanal/.test(apply), false, 'não há vínculo de canal (lacuna 7)')
})

// --- lacuna 8: revisão não atualiza a topologia inteira ---------------------------------

test('LACUNA 8 CORRIGIDA: atualizar um setor mexe na topologia inteira', async () => {
  // Esta era uma caracterização; a Fase 4 a virou do avesso. O que ela afirma agora é o
  // comportamento novo — e é nesta linha que a correção fica visível no histórico.
  const { readFile } = await import('node:fs/promises')
  const apply = await readFile(new URL('../src/architect/apply.ts', import.meta.url), 'utf8')

  const inicio = apply.indexOf("if (sector.action === 'update')")
  assert.ok(inicio > 0, 'o caminho de update existe')
  const corpo = apply.slice(inicio, apply.indexOf('const floorId = ctx.mapa.get', inicio))

  for (const campo of ['name', 'color', 'instruction', 'inputContract', 'outputContract']) {
    assert.ok(corpo.includes(`patch.${campo}`), `update mexe em ${campo}`)
  }
  // A topologia, que antes ficava de fora:
  for (const campo of ['members', 'coordinatorAgentId', 'stages', 'mode', 'officeId']) {
    assert.ok(corpo.includes(`patch.${campo}`), `update passou a mexer em ${campo}`)
  }
  // E mover de andar sem mover a equipe é bloqueado com o nome de quem teria de ir junto.
  assert.match(corpo, /exige mover antes/)

  // `reuse` continua saindo antes de qualquer escrita — reusar não é atualizar.
  const reuse = apply.slice(apply.indexOf("if (sector.action === 'reuse')"), inicio)
  assert.match(reuse, /return \{ id: String\(sector\.resourceId\), status: 'reused' \}/)
})

// --- lacuna 10: a simulação é estrutural --------------------------------------------------

test('LACUNA 10: a simulação percorre o Blueprint e não toca em nenhum subsistema real', async () => {
  const { readFile } = await import('node:fs/promises')
  const sim = await readFile(new URL('../src/architect/simulate.ts', import.meta.url), 'utf8')

  // Ela não importa nada dos domínios canônicos: é leitura do documento, e só.
  for (const dominio of ['monitoring/', 'automations/', 'apps/', 'databases/', 'dataHistory/']) {
    assert.equal(sim.includes(dominio), false, `a simulação não alcança ${dominio} (lacuna 10)`)
  }
  assert.ok(sim.includes('sideEffectsAvoided'), 'ela declara que evita efeitos — e evita mesmo')
})

test('LACUNA 10 CORRIGIDA: a prova de integração mora em outro módulo, e ele TOCA nos domínios', async () => {
  const { readFile } = await import('node:fs/promises')
  const aceitacao = await readFile(new URL('../src/architect/acceptance.ts', import.meta.url), 'utf8')

  // A simulação continua estrutural de propósito: ela responde "a regra faz sentido?".
  // Quem responde "isto funciona?" é o teste de aceitação — e ele bate na origem de
  // verdade, pelos serviços canônicos.
  for (const dominio of ['monitoring/service.js', 'monitors/condition.js', 'databases/store.js']) {
    assert.ok(aceitacao.includes(dominio), `o teste de aceitação precisa alcançar ${dominio}`)
  }
  // E o resultado dele entra na linha do tempo, em ambiente de teste.
  assert.ok(aceitacao.includes("environment: 'test'"), 'um teste não pode contar como produção')
})
