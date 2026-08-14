// Restaurant demo seed — wipes ONE account's data and rebuilds it as a working
// restaurant ("Cantina Bella"): two floors, four sectors, ten agents, a shared
// knowledge base, scheduled routines and a web channel.
//
// It goes through the app's OWN services (createFloor/createSector/createAgent/
// createRoutine/createDocumentFor/createWidget), so every invariant the API enforces
// — ownership, single sector per agent, sector-ref authorisation, routine publishing —
// holds exactly as if a person had clicked through the UI.
//
// DESTRUCTIVE. Everything below is scoped to the resolved ownerId: another tenant's
// data is never touched. There is no undo.
//
//   npm run seed:demo -w backend                      # uses SEED_EMAIL or the default
//   SEED_EMAIL=alguem@exemplo.com npm run seed:demo -w backend
//   SEED_DRY_RUN=1 npm run seed:demo -w backend       # report what WOULD be deleted
import 'dotenv/config'
import { ObjectId } from 'mongodb'
import { db, mongoClient } from '../db.js'
import { createFloor } from '../floors.js'
import { createSector } from '../sectors.js'
import type { SectorMember } from '../sectors.js'
import { createAgent } from '../agents.js'
import type { Agent } from '../agents.js'
import { createRoutine } from '../automations/routine.js'
import { createDocumentFor } from '../knowledge.js'
import { createWidget } from '../widgets.js'

const EMAIL = process.env.SEED_EMAIL ?? 'gabrielleoaus@gmail.com'
const DRY_RUN = process.env.SEED_DRY_RUN === '1'
const TZ = 'America/Sao_Paulo'

// Owner-scoped collections wiped before seeding. `user`/`session`/`account` are NOT
// here: the login must survive.
const OWNED_COLLECTIONS = [
  'offices', // floors
  'sectors',
  'agents',
  'widgets',
  'automations',
  'automation_versions',
  'automation_runs',
  'step_runs',
  'artifacts',
  'deliveries',
  'connections',
  'agent_delegations',
  'agent_execution_events',
  'sector_decisions',
  'visitor_profiles',
  'token_usage',
  'token_usage_charges',
] as const

async function resolveOwnerId(email: string): Promise<string> {
  const user = await db.collection('user').findOne({ email })
  if (!user) throw new Error(`conta não encontrada para ${email}`)
  return String(user._id)
}

// Knowledge and conversation rows hang off agents/widgets rather than carrying an
// ownerId, so they are removed by their parents' ids.
async function wipeAccount(ownerId: string): Promise<void> {
  const agentIds = (await db.collection('agents').find({ ownerId }, { projection: { _id: 1 } }).toArray()).map((a) => a._id)
  const sectorIds = (await db.collection('sectors').find({ ownerId }, { projection: { _id: 1 } }).toArray()).map((s) => s._id)
  const widgetIds = (await db.collection('widgets').find({ ownerId }, { projection: { _id: 1 } }).toArray()).map((w) => w._id)
  const ownerIds = [...agentIds, ...sectorIds]

  const plan: [string, Record<string, unknown>][] = [
    ...OWNED_COLLECTIONS.map((name) => [name, { ownerId }] as [string, Record<string, unknown>]),
    ['knowledge_documents', { $or: [{ ownerId: { $in: ownerIds } }, { agentId: { $in: agentIds } }] }],
    ['knowledge_chunks', { $or: [{ ownerId: { $in: ownerIds } }, { agentId: { $in: agentIds } }] }],
    ['widget_messages', { widgetId: { $in: widgetIds } }],
    ['conversation_memories', { widgetId: { $in: widgetIds } }],
    ['tool_calls', { widgetId: { $in: widgetIds } }],
  ]

  for (const [name, filter] of plan) {
    const count = await db.collection(name).countDocuments(filter).catch(() => 0)
    if (!count) continue
    if (DRY_RUN) {
      console.log(`  [dry-run] ${name}: ${count} documento(s) seriam removidos`)
      continue
    }
    const { deletedCount } = await db.collection(name).deleteMany(filter)
    console.log(`  ${name}: ${deletedCount} removido(s)`)
  }
}

const member = (agentId: ObjectId, routingDescription: string, isDefault = false): SectorMember => ({
  agentId,
  sector: '',
  routingDescription,
  advanceWhen: '',
  transitions: [],
  isDefault,
})

async function main(): Promise<void> {
  await mongoClient.connect()
  const ownerId = await resolveOwnerId(EMAIL)
  console.log(`Conta: ${EMAIL} (${ownerId})`)
  console.log(DRY_RUN ? '\nMODO DRY-RUN — nada será alterado.\n' : '\nApagando dados da conta…')
  await wipeAccount(ownerId)
  if (DRY_RUN) {
    await mongoClient.close()
    return
  }

  // ---------------------------------------------------------------- andares
  console.log('\nCriando andares…')
  const salao = await createFloor(ownerId, {
    name: 'Salão',
    mission: 'Atender quem chega: reservas, cardápio e pedidos.',
    description: 'O andar que fala com o cliente, pelo site e pelo WhatsApp.',
    timezone: TZ,
  })
  const bastidores = await createFloor(ownerId, {
    name: 'Bastidores',
    mission: 'Manter a operação girando: estoque, compras e divulgação.',
    description: 'O andar que ninguém vê — roda sozinho, no horário.',
    timezone: TZ,
  })
  console.log(`  Salão (${salao._id}) · Bastidores (${bastidores._id})`)

  // ----------------------------------------------------------------- agentes
  console.log('\nContratando agentes…')
  const hire = async (floorId: ObjectId, name: string, options: Parameters<typeof createAgent>[3]) => {
    const agent = await createAgent(ownerId, floorId, name, options)
    console.log(`  ${name} — ${options?.preset}`)
    return agent as Agent
  }

  // Salão
  const maitre = await hire(salao._id, 'Marcos', {
    preset: 'manager',
    objective:
      'Você é o maître da Cantina Bella. Receba o cliente, entenda o que ele quer e acione o colega certo: reservas, cardápio ou pedidos. Junte as respostas numa mensagem só, cordial e curta. Nunca invente preço, prato ou disponibilidade — se não souber, diga que vai confirmar.',
    capabilities: ['atendimento', 'coordenacao'],
    activationModes: ['manual', 'channel'],
    delegationPolicy: 'all',
    language: 'pt',
    responseTone: 'friendly',
    guardrailMode: 'prompt',
    handoffEnabled: true,
  })
  const reservas = await hire(salao._id, 'Valentina', {
    preset: 'secretary',
    objective:
      'Você cuida das reservas. Colete nome, telefone, data, horário, número de pessoas e a ocasião. Confirme a disponibilidade segundo a política de reservas e devolva a reserva resumida.',
    capabilities: ['reservas', 'agenda'],
    activationModes: ['agent_only', 'channel'],
    inputContract: 'Um pedido de reserva em linguagem natural.',
    outputContract: 'Reserva estruturada: nome, telefone, data, horário, pessoas, ocasião.',
    structuredOutputEnabled: true,
    structuredOutputFields: ['nome', 'telefone', 'data', 'horario', 'pessoas', 'ocasiao'],
    language: 'pt',
  })
  const cardapio = await hire(salao._id, 'Bruno', {
    preset: 'custom',
    objective:
      'Você conhece o cardápio de cor. Responda sobre pratos, preços, porções, ingredientes e restrições (vegano, sem glúten, alergênicos) usando SOMENTE a base de conhecimento do setor. Se algo não estiver lá, diga que vai confirmar com a cozinha.',
    capabilities: ['cardapio', 'alergenicos'],
    activationModes: ['agent_only', 'channel'],
    language: 'pt',
    guardrailMode: 'prompt',
  })
  const pedidos = await hire(salao._id, 'Caio', {
    preset: 'operator',
    objective:
      'Você cuida dos pedidos de delivery e retirada: registra o pedido, consulta o status e informa o prazo. Confirme exatamente o que foi feito; nunca simule uma ação que não conseguiu executar.',
    capabilities: ['pedidos', 'delivery'],
    activationModes: ['agent_only', 'channel'],
    language: 'pt',
  })

  // Bastidores
  const estoque = await hire(bastidores._id, 'Íris', {
    preset: 'monitor',
    objective:
      'Você acompanha o estoque da cozinha. Compare os níveis atuais com o mínimo de cada item e liste o que está abaixo ou perto do limite. Se estiver tudo certo, diga que está estável.',
    capabilities: ['monitoramento', 'estoque'],
    activationModes: ['scheduled', 'agent_only'],
    outputContract: 'Lista dos itens abaixo do mínimo, com quantidade atual e mínima.',
    language: 'pt',
  })
  const analista = await hire(bastidores._id, 'Théo', {
    preset: 'analyst',
    objective:
      'Você analisa consumo. A partir da lista de itens em falta e do consumo recente, projete quanto comprar de cada item para a próxima semana, considerando o movimento de fim de semana.',
    capabilities: ['analise', 'previsao'],
    activationModes: ['agent_only'],
    language: 'pt',
  })
  const compras = await hire(bastidores._id, 'Nina', {
    preset: 'operator',
    objective:
      'Você monta a lista de compras final a partir da projeção recebida: item, quantidade e fornecedor sugerido, pronta para enviar.',
    capabilities: ['compras', 'fornecedores'],
    activationModes: ['agent_only'],
    language: 'pt',
  })
  const mktGerente = await hire(bastidores._id, 'Rafa', {
    preset: 'manager',
    objective:
      'Você coordena o marketing da cantina. Peça as tendências ao pesquisador, o texto ao redator e entregue a pauta da semana pronta para publicar.',
    capabilities: ['marketing', 'coordenacao'],
    activationModes: ['manual', 'scheduled'],
    delegationPolicy: 'all',
    language: 'pt',
  })
  const pesquisa = await hire(bastidores._id, 'Duda', {
    preset: 'researcher',
    objective:
      'Você pesquisa tendências de gastronomia e datas comemorativas relevantes para um restaurante italiano de bairro. Devolva o resultado com as fontes e a data da coleta.',
    capabilities: ['pesquisa', 'tendencias'],
    activationModes: ['agent_only'],
    language: 'pt',
  })
  const redator = await hire(bastidores._id, 'Léo', {
    preset: 'communicator',
    objective:
      'Você escreve para as redes da cantina: legenda curta, tom caloroso de trattoria de bairro, com chamada para reserva. Nunca prometa promoção que não foi informada.',
    capabilities: ['redacao', 'redes'],
    activationModes: ['agent_only'],
    responseTone: 'friendly',
    language: 'pt',
  })

  // ----------------------------------------------------------------- setores
  console.log('\nMontando setores…')
  const atendimento = await createSector(
    ownerId,
    salao._id,
    'Atendimento',
    '#E8734A',
    'orchestrated',
    [
      member(maitre._id, 'Recebe o cliente e coordena os demais', true),
      member(reservas._id, 'Reservas: data, horário, número de pessoas'),
      member(cardapio._id, 'Cardápio, preços e restrições alimentares'),
      member(pedidos._id, 'Pedidos de delivery e retirada'),
    ],
    {
      coordinatorAgentId: maitre._id,
      instruction: 'Responda como uma única voz da Cantina Bella. Consulte quem souber e entregue uma resposta só, curta e cordial.',
      inputContract: 'Uma mensagem de cliente pelo site ou WhatsApp.',
      outputContract: 'Uma resposta cordial, com a informação confirmada ou o encaminhamento feito.',
    },
  )
  console.log(`  Atendimento (orquestrado) — ${atendimento.members.length} membros`)

  const cozinha = await createSector(ownerId, bastidores._id, 'Cozinha & Estoque', '#4A9E7F', 'pipeline', [], {
    inputContract: 'A posição atual do estoque.',
    outputContract: 'A lista de compras da semana, pronta para enviar.',
    stages: [
      {
        id: 's1',
        name: 'Conferir estoque',
        agentId: estoque._id,
        instruction: 'Liste os itens abaixo do mínimo, com quantidade atual e mínima.',
        dependsOn: [],
        inputMapping: {},
        expectedOutput: 'Itens em falta.',
        retryPolicy: { maxAttempts: 2, backoffMs: 2000 },
        onError: 'stop',
      },
      {
        id: 's2',
        name: 'Projetar consumo',
        agentId: analista._id,
        instruction: 'A partir dos itens em falta, projete a quantidade necessária para a próxima semana.',
        dependsOn: ['s1'],
        inputMapping: {},
        expectedOutput: 'Quantidade projetada por item.',
        retryPolicy: { maxAttempts: 2, backoffMs: 2000 },
        onError: 'stop',
      },
      {
        id: 's3',
        name: 'Montar compras',
        agentId: compras._id,
        instruction: 'Monte a lista final de compras: item, quantidade e fornecedor sugerido.',
        dependsOn: ['s2'],
        inputMapping: {},
        expectedOutput: 'Lista de compras pronta.',
        retryPolicy: { maxAttempts: 1, backoffMs: 2000 },
        onError: 'stop',
      },
    ],
  })
  console.log(`  Cozinha & Estoque (pipeline) — ${cozinha.stages?.length} etapas`)

  const marketing = await createSector(
    ownerId,
    bastidores._id,
    'Marketing',
    '#8A6FD1',
    'orchestrated',
    [member(mktGerente._id, 'Coordena a pauta da semana', true), member(pesquisa._id, 'Tendências e datas comemorativas'), member(redator._id, 'Escreve legenda e chamada')],
    {
      coordinatorAgentId: mktGerente._id,
      instruction: 'Traga uma pauta pronta: tema, legenda e chamada para reserva.',
      outputContract: 'Pauta da semana pronta para publicar.',
    },
  )
  console.log(`  Marketing (orquestrado) — ${marketing.members.length} membros`)

  const salaoGrupo = await createSector(ownerId, salao._id, 'Equipe do Salão', '#C7A15A', 'organization', [member(maitre._id, '', true)])
  console.log(`  Equipe do Salão (organização, só agrupa)`)

  // ------------------------------------------------------------ conhecimento
  console.log('\nEscrevendo o conhecimento do setor…')
  const knowledge: [string, string][] = [
    [
      'Cardápio — massas',
      [
        'Tagliatelle ao ragù de costela — R$ 68. Massa fresca, ragù cozido 6 horas. Contém glúten, ovo e leite.',
        'Rigatoni ao pomodoro — R$ 52. Molho de tomate San Marzano, manjericão. Vegetariano. Versão sem glúten disponível (+R$ 8).',
        'Gnocchi ao gorgonzola — R$ 61. Contém glúten, leite e castanha-de-caju no molho.',
        'Lasanha à bolonhesa — R$ 64. Contém glúten, ovo e leite.',
        'Espaguete aglio e olio — R$ 44. Vegano. Versão sem glúten disponível (+R$ 8).',
      ].join('\n\n'),
    ],
    [
      'Cardápio — entradas, sobremesas e bebidas',
      [
        'Bruschetta clássica — R$ 28 (4 fatias). Vegana se pedir sem parmesão.',
        'Burrata com tomate confit — R$ 46. Contém leite.',
        'Tiramisù da casa — R$ 26. Contém glúten, ovo, leite e café.',
        'Petit gâteau — R$ 28. Contém glúten, ovo e leite.',
        'Vinhos em taça a partir de R$ 24. Chianti, Sangiovese e um branco Vermentino.',
        'Refrigerante R$ 9 · Água com/sem gás R$ 7 · Café espresso R$ 8.',
      ].join('\n\n'),
    ],
    [
      'Política de reservas',
      [
        'Reservamos mesas de terça a domingo. Segunda-feira a casa fecha.',
        'Horários: terça a quinta, 18h30 às 23h. Sexta e sábado, 18h30 às 00h. Domingo, 12h às 16h (almoço).',
        'Reserva para até 8 pessoas pelo site ou WhatsApp. Acima de 8, a reserva precisa de confirmação do gerente.',
        'Seguramos a mesa por 20 minutos após o horário marcado.',
        'Aniversário: avisar na reserva — a casa leva a sobremesa com vela, sem custo.',
        'Não trabalhamos com couvert artístico. Não aceitamos reserva por telefone durante o serviço.',
      ].join('\n\n'),
    ],
    [
      'Restrições alimentares e alergênicos',
      [
        'Opções veganas: espaguete aglio e olio, rigatoni ao pomodoro (sem parmesão), bruschetta sem parmesão, salada da casa.',
        'Sem glúten: massa alternativa disponível para espaguete e rigatoni (+R$ 8). Aviso: a cozinha manipula glúten no mesmo ambiente.',
        'Sem lactose: aglio e olio e pomodoro sem parmesão. Sobremesas todas contêm leite.',
        'Castanhas: presentes no molho gorgonzola e no pesto. Sempre avisar o cliente.',
        'Em caso de alergia grave, registrar na reserva e avisar a cozinha na chegada.',
      ].join('\n\n'),
    ],
    [
      'Endereço, horários e delivery',
      [
        'Cantina Bella — Rua das Oliveiras, 214, bairro Santa Cecília.',
        'Delivery próprio num raio de 4 km, das 18h30 às 22h30, de terça a sábado. Taxa R$ 9.',
        'Retirada no balcão: pronto em cerca de 25 minutos.',
        'Estacionamento conveniado na esquina, R$ 15 a noite.',
      ].join('\n\n'),
    ],
  ]
  for (const [title, content] of knowledge) {
    const doc = await createDocumentFor({ ownerType: 'sector', ownerId: atendimento._id }, { title, content, source: 'manual', authorId: ownerId })
    console.log(`  ${title} — ${doc.indexStatus} (${doc.chunkCount} trecho(s))`)
  }

  // ------------------------------------------------------------------ canal
  console.log('\nAbrindo o canal do site…')
  const widget = await createWidget(ownerId, 'Site da Cantina', {
    primaryColor: '#E8734A',
    welcomeTitle: 'Cantina Bella',
    welcomeMessage: 'Boa noite! Posso ajudar com reserva, cardápio ou pedido?',
    sectorId: atendimento._id,
  })
  console.log(`  Widget "${widget.name}" → setor Atendimento`)

  // ---------------------------------------------------------------- rotinas
  console.log('\nAgendando rotinas…')
  const routines: [ObjectId, Parameters<typeof createRoutine>[2]][] = [
    [
      estoque._id,
      {
        name: 'Conferência de estoque',
        objective: 'Confira o estoque da cozinha e liste o que está abaixo do mínimo para a compra da semana.',
        recurrence: { kind: 'weekly', time: '07:00', weekdays: [2, 5] }, // terça e sexta
        timezone: TZ,
        outputFormat: 'markdown',
      },
    ],
    [
      mktGerente._id,
      {
        name: 'Pauta da semana',
        objective: 'Monte a pauta de conteúdo da semana: tema, legenda e chamada para reserva.',
        recurrence: { kind: 'weekly', time: '10:00', weekdays: [5] }, // sexta
        timezone: TZ,
        outputFormat: 'markdown',
      },
    ],
    [
      maitre._id,
      {
        name: 'Resumo do dia',
        objective: 'Resuma as reservas e os pedidos do dia anterior, destacando o que precisa de atenção hoje.',
        recurrence: { kind: 'daily', time: '09:00' },
        timezone: TZ,
        outputFormat: 'markdown',
      },
    ],
  ]
  for (const [agentId, spec] of routines) {
    const routine = await createRoutine(ownerId, agentId, spec)
    console.log(`  ${routine.name} — ${routine.status}`)
  }

  console.log('\nDemo pronto:')
  console.log(`  2 andares · 4 setores · 10 agentes · ${knowledge.length} documentos · 3 rotinas · 1 canal`)
  console.log(`  Setor de organização criado: ${salaoGrupo.name}`)
  await mongoClient.close()
}

main().catch(async (error) => {
  console.error('\nFalhou:', error instanceof Error ? error.message : error)
  await mongoClient.close().catch(() => undefined)
  process.exit(1)
})
