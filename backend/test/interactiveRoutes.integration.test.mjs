// INTEGRAÇÃO: as rotas interativas contra o servidor de verdade.
//
// Duas garantias que só aparecem atravessando a rota inteira:
//
// 1. Contrato de saída quebrado NÃO é sucesso e NÃO sai de graça. O provedor cobrou a
//    resposta e cobrou o reparo; o registro precisa mostrar os dois. A versão anterior
//    lançava antes de copiar o uso e gravava zero token numa chamada que custou duas.
//
// 2. Trocar de modelo-base preenche o que está vazio e nada além disso — e uma definição
//    escrita por gente não é tocada nem quando a troca é confirmada.
//
// O modelo é o adaptador falso (LLM_FAKE=1, só existe com NODE_ENV=test): ele responde
// `[fake] ...`, que nunca é JSON válido. Um agente com contrato JSON portanto falha as
// duas vezes — a resposta e o reparo —, que é exatamente o caso a provar.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { MongoClient, ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

const RAIZ = new URL('..', import.meta.url).pathname
const PORTA = 4491
const base = `http://127.0.0.1:${PORTA}`

let proc
let cliente
let cookie = ''

const comSessao = (extra = {}) => ({ ...extra, Cookie: cookie, 'Content-Type': 'application/json' })

before(async () => {
  const uri = await startMongo()
  cliente = await MongoClient.connect(uri)
  proc = spawn(process.execPath, ['dist/index.js'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: join(RAIZ, 'test/.sem-env'),
      NODE_ENV: 'test',
      LLM_FAKE: '1',
      ALLOW_LOOPBACK_HTTP_TARGETS: '1',
      PORT: String(PORTA),
      MONGODB_URI: uri,
      BETTER_AUTH_SECRET: 'interativo-'.padEnd(40, 'x'),
      ENCRYPTION_KEY: 'interativo-'.padEnd(40, 'y'),
      CLIENT_URL: `http://127.0.0.1:${PORTA}`,
      PUBLIC_URL: `http://127.0.0.1:${PORTA}`,
      BETTER_AUTH_URL: `http://127.0.0.1:${PORTA}`,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', () => undefined)
  proc.stderr.on('data', () => undefined)

  const limite = Date.now() + 60_000
  let dePe = false
  while (Date.now() < limite) {
    const res = await fetch(`${base}/api/ready`).catch(() => null)
    if (res?.status === 200) {
      dePe = true
      break
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  if (!dePe) throw new Error('a API não subiu para o teste das rotas interativas')

  const registro = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dono', email: 'dono@interativo.test', password: 'senha-de-teste-123' }),
  })
  assert.ok(registro.ok, `registro devolveu ${registro.status}`)
  cookie = (registro.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  assert.ok(cookie, 'sem cookie de sessão não há como testar rota privada')
})

after(async () => {
  if (proc && proc.exitCode === null) {
    const saiu = new Promise((r) => proc.once('exit', r))
    proc.kill('SIGTERM')
    await Promise.race([saiu, new Promise((r) => setTimeout(() => (proc.kill('SIGKILL'), r()), 15_000))])
  }
  await cliente?.close()
  await stopMongo()
})

const criarAgente = async (corpo = {}) => {
  const res = await fetch(`${base}/api/agents`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({ name: 'Agente de teste', ...corpo }),
  })
  assert.ok(res.ok, `criação devolveu ${res.status}`)
  return res.json()
}

const patch = (id, corpo) =>
  fetch(`${base}/api/agents/${id}`, { method: 'PATCH', headers: comSessao(), body: JSON.stringify(corpo) })

const somar = (docs) =>
  docs.reduce(
    (soma, d) => ({
      inputTokens: soma.inputTokens + (d.inputTokens ?? 0),
      outputTokens: soma.outputTokens + (d.outputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  )

// A cobrança é disparada sem `await` na rota — a resposta do visitante não espera pelo
// contador. Por isso o teste ESPERA por ela em vez de ler uma vez: ler antes da escrita
// chegar seria um falso verde do defeito que este arquivo existe para pegar.
const tokensDoDono = async () => somar(await cliente.db().collection('token_usage').find({}).toArray())

const esperarCobranca = async (antes, limiteMs = 8000) => {
  const fim = Date.now() + limiteMs
  let atual = await tokensDoDono()
  while (Date.now() < fim && atual.inputTokens === antes.inputTokens && atual.outputTokens === antes.outputTokens) {
    await new Promise((r) => setTimeout(r, 200))
    atual = await tokensDoDono()
  }
  return atual
}

// --- contrato de saída quebrado ---------------------------------------------------------

test('output_invalid: erro controlado, sem 500 e sem a resposta do modelo', async () => {
  const agente = await criarAgente()
  // Contrato JSON com schema: o `[fake] ...` do dublê falha no parse, e falha de novo no
  // reparo. É a segunda resposta inválida que o teste precisa exercitar.
  const r = await patch(agente._id, {
    defaultOutputFormat: 'json',
    outputJsonSchema: { type: 'object', required: ['nome'], properties: { nome: { type: 'string' } } },
  })
  assert.ok(r.ok, `patch do contrato devolveu ${r.status}`)

  const antes = await tokensDoDono()

  const res = await fetch(`${base}/api/agents/${agente._id}/playground`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({ messages: [{ role: 'user', content: 'me devolva um json' }] }),
  })

  assert.equal(res.status, 502, 'contrato quebrado é erro de upstream, não 500 genérico')
  const corpo = await res.json()
  assert.equal(corpo.code, 'output_invalid', 'o código precisa ser estável para quem consome a API')
  assert.equal(corpo.reply, undefined, 'a resposta inválida não pode ser entregue')
  // O diagnóstico diz o que o SCHEMA recusou, e não o que o modelo escreveu.
  assert.doesNotMatch(JSON.stringify(corpo), /\[fake\]/, 'o texto do modelo não sai na resposta')
  assert.doesNotMatch(JSON.stringify(corpo), /me devolva um json/, 'o prompt não sai na resposta')

  // --- e o que foi gasto aparece -------------------------------------------------------
  const depois = await esperarCobranca(antes)
  const gastos = {
    inputTokens: depois.inputTokens - antes.inputTokens,
    outputTokens: depois.outputTokens - antes.outputTokens,
  }
  assert.ok(gastos.inputTokens > 0, 'a chamada custou tokens de entrada e eles precisam ser cobrados')
  assert.ok(gastos.outputTokens > 0, 'idem para os de saída')

  // O dublê responde `[fake] ` + até 160 caracteres e cobra ceil(len/4) na saída. Uma
  // chamada só devolveria os tokens de "[fake] me devolva um json" (6 de saída). Exigir
  // mais que isso é exigir que o REPARO também tenha entrado na conta.
  const umaChamadaSo = Math.ceil('[fake] me devolva um json'.length / 4)
  assert.ok(
    gastos.outputTokens > umaChamadaSo,
    `o reparo precisa estar somado: ${gastos.outputTokens} não é mais que ${umaChamadaSo}`,
  )
})

test('output_invalid: a execução fica registrada como falha, com o motivo', async () => {
  const buscar = async () => cliente.db().collection('agent_execution_events').find({ source: 'manual' }).toArray()
  let falho
  const fim = Date.now() + 8000
  while (Date.now() < fim && !falho) {
    falho = (await buscar()).find((e) => e.metadata?.errorKind === 'output_invalid')
    if (!falho) await new Promise((r) => setTimeout(r, 200))
  }
  assert.ok(falho, 'o evento precisa dizer POR QUE falhou, e não só que falhou')
  assert.equal(falho.status, 'failed')
  assert.ok((falho.inputTokens ?? 0) > 0, 'o evento carrega o que foi gasto')
  // Nada de prompt nem de resposta na telemetria.
  assert.doesNotMatch(JSON.stringify(falho.metadata ?? {}), /\[fake\]|me devolva um json/)
})

test('contrato cumprido continua sendo 200 — o erro é do JSON, não da rota', async () => {
  const agente = await criarAgente()
  const res = await fetch(`${base}/api/agents/${agente._id}/playground`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }] }),
  })
  assert.equal(res.status, 200)
  const corpo = await res.json()
  assert.match(corpo.reply, /\[fake\]/)
})

// --- troca de modelo-base -----------------------------------------------------------------

test('trocar de modelo-base preenche os campos VAZIOS quando confirmado', async () => {
  const agente = await criarAgente({ name: 'Vazio' })
  assert.equal(agente.role ?? '', '', 'o agente nasce sem definição escrita')

  const res = await patch(agente._id, { preset: 'researcher', applyPresetSuggestions: true })
  assert.ok(res.ok, `patch devolveu ${res.status}`)
  const atualizado = await res.json()

  assert.equal(atualizado.preset, 'researcher', 'o modelo-base escolhido fica gravado')
  assert.match(atualizado.role, /Pesquisador/)
  assert.ok(atualizado.instructions.trim(), 'as instruções do molde entram no campo vazio')
  assert.ok(atualizado.constraints.trim())
  assert.ok(atualizado.objective.trim(), 'o objetivo também é um campo vazio a preencher')
})

test('sem confirmação, a troca muda só o modelo-base', async () => {
  const agente = await criarAgente({ name: 'Só o molde' })
  const res = await patch(agente._id, { preset: 'analyst' })
  assert.ok(res.ok)
  const atualizado = await res.json()

  assert.equal(atualizado.preset, 'analyst')
  assert.equal(atualizado.role ?? '', '', 'sem applyPresetSuggestions, nada é preenchido')
  assert.equal(atualizado.instructions ?? '', '')
  assert.equal(atualizado.objective ?? '', '')
})

test('texto escrito à mão nunca é sobrescrito por uma troca de molde', async () => {
  const agente = await criarAgente({ name: 'Escrito' })
  const meu = 'Atendente do plano empresarial, e mais ninguém.'
  const escreveu = await patch(agente._id, { role: meu })
  assert.ok(escreveu.ok)

  const res = await patch(agente._id, { preset: 'manager', applyPresetSuggestions: true })
  const atualizado = await res.json()

  assert.equal(atualizado.role, meu, 'o que a pessoa escreveu fica exatamente como estava')
  // E a marca de edição bloqueia o resto: sugerir por cima de uma definição humana, ainda
  // que num campo vazio, é decidir pelo dono sem ele ver.
  assert.equal(atualizado.instructions ?? '', '')
  assert.equal(atualizado.preset, 'manager', 'o molde escolhido ainda assim é gravado')
})

test('salvar o formulário sem mudar nada não conta como escrever à mão', async () => {
  // O autosave manda os quatro campos da definição em TODO salvamento. Marcar a edição
  // pela presença fazia o primeiro salvamento matar a sugestão para sempre.
  const agente = await criarAgente({ name: 'Autosave' })
  const comoVeio = await patch(agente._id, {
    name: 'Autosave',
    objective: agente.objective ?? '',
    role: agente.role ?? '',
    instructions: agente.instructions ?? '',
    constraints: agente.constraints ?? '',
  })
  assert.ok(comoVeio.ok)
  assert.equal((await comoVeio.json()).definitionEditedAt ?? null, null, 'salvar igual não é editar')

  const res = await patch(agente._id, { preset: 'communicator', applyPresetSuggestions: true })
  const atualizado = await res.json()
  assert.ok(atualizado.role.trim(), 'a sugestão continua disponível depois de um autosave')
})

// --- o teste diz qual modelo rodou ---------------------------------------------------------
//
// "Automático" escolhe por regra. Uma regra em que se confia sem conferir é um palpite com
// passos extras: quem testa precisa ver qual modelo rodou, por quê, e a que preço.

test('o Playground do agente informa o modelo, a origem da escolha e o custo', async () => {
  const agente = await criarAgente({ name: 'Com diagnóstico' })

  const res = await fetch(`${base}/api/agents/${agente._id}/playground`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }] }),
  })
  assert.equal(res.status, 200)
  const { diagnostics } = await res.json()

  assert.ok(diagnostics, 'a resposta precisa trazer o diagnóstico')
  assert.ok(diagnostics.model, 'sem o nome do modelo não há o que conferir')
  assert.equal(diagnostics.modelChoice, 'default', 'agente novo não escolheu modelo: é o padrão')
  assert.equal(diagnostics.modelReason, null, 'padrão não tem motivo a explicar')
  assert.ok(diagnostics.inputTokens > 0 && diagnostics.outputTokens > 0, 'o teste custou, e o custo aparece')
  assert.ok(typeof diagnostics.durationMs === 'number')
})

test('com "Automático", o diagnóstico diz o modelo escolhido E o motivo', async () => {
  const agente = await criarAgente({ name: 'Automático' })
  // Comunicador: transforma um texto que já existe — a regra manda o modelo barato.
  const r = await patch(agente._id, { model: 'auto', preset: 'communicator' })
  assert.ok(r.ok, `patch devolveu ${r.status}`)

  const res = await fetch(`${base}/api/agents/${agente._id}/playground`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }] }),
  })
  const { diagnostics } = await res.json()

  assert.equal(diagnostics.modelChoice, 'auto')
  assert.match(diagnostics.modelReason, /já existe/, 'o motivo é o que torna a regra conferível')
  assert.ok(diagnostics.model, 'e o modelo escolhido vem nomeado')
  assert.notEqual(diagnostics.model, 'auto', 'o marcador nunca é apresentado como modelo')
})

test('um perfil que planeja recebe o modelo principal, e o motivo diz isso', async () => {
  const agente = await criarAgente({ name: 'Gerente' })
  await patch(agente._id, { model: 'auto', preset: 'manager' })

  const res = await fetch(`${base}/api/agents/${agente._id}/playground`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }] }),
  })
  const { diagnostics } = await res.json()
  assert.match(diagnostics.modelReason, /coordena/)
})

test('a execução do chat grava QUAL modelo rodou, e não só quantos tokens', async () => {
  // Sem isto, "economia" não é verificável: trocar de modelo não muda um token, muda o
  // preço de cada um — e o contador de tokens mostra o mesmo número antes e depois.
  const agente = await criarAgente({ name: 'Registro de modelo' })
  await patch(agente._id, { model: 'auto', preset: 'communicator' })

  await fetch(`${base}/api/agents/${agente._id}/playground`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }] }),
  })

  const fim = Date.now() + 8000
  let evento
  while (Date.now() < fim && !evento) {
    const eventos = await cliente.db().collection('agent_execution_events').find({ source: 'manual' }).toArray()
    evento = eventos.find((e) => e.model)
    if (!evento) await new Promise((r) => setTimeout(r, 200))
  }
  assert.ok(evento, 'o evento precisa dizer em qual modelo a execução rodou')
  assert.notEqual(evento.model, 'auto', 'o marcador não é nome de modelo')
  assert.ok(evento.inputTokens > 0)
})

// --- a conversa de teste que fica guardada -------------------------------------------------
//
// O Playground apagava tudo ao trocar de aba, e voltar ao ponto onde se estava exigia
// repetir as mesmas perguntas — o que custa tokens de verdade. O que se guarda é a TELA:
// a memória do agente continua fora do teste.

const esperarTurnos = async (agenteId, quantos, limiteMs = 8000) => {
  const fim = Date.now() + limiteMs
  let corpo = { turns: [] }
  while (Date.now() < fim) {
    const res = await fetch(`${base}/api/agents/${agenteId}/playground`, { headers: comSessao() })
    corpo = await res.json()
    if ((corpo.turns ?? []).length >= quantos) break
    await new Promise((r) => setTimeout(r, 150))
  }
  return corpo.turns ?? []
}

test('a conversa de teste é guardada, devolvida e só some quando se pede', async () => {
  const agente = await criarAgente({ name: 'Agente que lembra da tela' })

  const envio = await fetch(`${base}/api/agents/${agente._id}/playground`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({ messages: [{ role: 'user', content: 'qual foi o último provento de BBSE3?' }] }),
  })
  assert.ok(envio.ok, `playground devolveu ${envio.status}`)
  const resposta = await envio.json()

  // A gravação é disparada sem `await`: quem pergunta não espera pelo histórico.
  const turnos = await esperarTurnos(agente._id, 2)
  assert.equal(turnos.length, 2, 'a pergunta e a resposta ficam guardadas')
  assert.equal(turnos[0].role, 'user')
  assert.equal(turnos[0].content, 'qual foi o último provento de BBSE3?')
  assert.equal(turnos[1].role, 'assistant')
  assert.equal(turnos[1].content, resposta.reply, 'o que foi guardado é o que a tela mostrou')
  // O custo também: sem ele a conversa recarregada mentiria por omissão sobre o preço.
  assert.equal(typeof turnos[1].diagnostics?.model, 'string')

  // Segundo envio: acrescenta, não substitui.
  const segundo = await fetch(`${base}/api/agents/${agente._id}/playground`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'qual foi o último provento de BBSE3?' },
        { role: 'assistant', content: resposta.reply },
        { role: 'user', content: 'e o anterior?' },
      ],
    }),
  })
  assert.ok(segundo.ok)
  const depois = await esperarTurnos(agente._id, 4)
  assert.equal(depois.length, 4)
  assert.equal(depois[2].content, 'e o anterior?')

  // Limpar é explícito, e é a única forma de apagar.
  const apagou = await fetch(`${base}/api/agents/${agente._id}/playground`, { method: 'DELETE', headers: comSessao() })
  assert.equal(apagou.status, 204)
  const vazio = await fetch(`${base}/api/agents/${agente._id}/playground`, { headers: comSessao() })
  assert.deepEqual((await vazio.json()).turns, [])
})

test('a conversa de teste é do dono do agente, e de mais ninguém', async () => {
  const agente = await criarAgente({ name: 'Agente de outra pessoa' })
  // Sem sessão: nem ler nem apagar.
  const semSessao = await fetch(`${base}/api/agents/${agente._id}/playground`)
  assert.equal(semSessao.status, 401)
  const apagar = await fetch(`${base}/api/agents/${agente._id}/playground`, { method: 'DELETE' })
  assert.equal(apagar.status, 401)
})

// --- o balão do agente que conversa --------------------------------------------------------
//
// Rotina e delegação acendiam o balão; conversar não acendia nada. Quem abrisse o mapa
// enquanto um agente atendia via um andar parado — e o plano (§8.6) sempre pediu
// "geração de resposta para canal → responding". O estado é efêmero e não entra em
// métrica: ele existe para a pessoa ver que o agente está trabalhando.

test('conversar acende o balão do agente e o deixa em estado terminal', async () => {
  const agente = await criarAgente({ name: 'Agente que aparece no mapa' })

  const antes = await cliente.db().collection('agent_live_states').countDocuments({})
  const res = await fetch(`${base}/api/agents/${agente._id}/playground`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }] }),
  })
  assert.ok(res.ok, `playground devolveu ${res.status}`)

  const linhas = await cliente.db().collection('agent_live_states').find({ agentId: new ObjectId(agente._id) }).toArray()
  assert.ok(linhas.length > antes || linhas.length > 0, 'a conversa precisa ter deixado um estado')
  const linha = linhas.at(-1)
  // Terminal: uma execução que acabou não pode ficar "pensando" no mapa até o TTL.
  assert.ok(['completed', 'failed', 'canceled'].includes(linha.state), `estado final inesperado: ${linha.state}`)
  // E ele expira sozinho — nenhum agente fica preso por causa de um processo que morreu.
  assert.ok(linha.expiresAt instanceof Date)
})

// --- o site cadastrado na tela vira conhecimento? ------------------------------------------
//
// O caminho da PESSOA, pelas rotas de verdade: cadastra o endereço, clica em atualizar,
// e espera ver o conteúdo na base. O gerente já tem teste próprio; o que falta provar é
// que a tela chega até ele.
import { createServer } from 'node:http'

test('cadastrar um site e clicar em atualizar cria conhecimento no agente', async () => {
  const site = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<html><head><title>Boletim da empresa</title></head><body><article>${'Conteúdo publicado hoje pela empresa. '.repeat(20)}</article></body></html>`)
  })
  await new Promise((r) => site.listen(0, '127.0.0.1', r))
  const portaDoSite = site.address().port

  try {
    const agente = await criarAgente({ name: 'Agente com site' })

    const salvou = await fetch(`${base}/api/agents/${agente._id}/sources`, {
      method: 'PUT',
      headers: comSessao(),
      body: JSON.stringify({
        sources: [{ name: 'Boletim', kind: 'http', url: `http://127.0.0.1:${portaDoSite}/boletim`, when: 'on_demand', refreshMode: 'manual' }],
      }),
    })
    assert.ok(salvou.ok, `salvar a fonte devolveu ${salvou.status}`)

    const atualizou = await fetch(`${base}/api/agents/${agente._id}/sources/refresh`, { method: 'POST', headers: comSessao() })
    assert.ok(atualizou.ok, `atualizar devolveu ${atualizou.status}`)
    const resultado = await atualizou.json()
    assert.equal(resultado.sources?.length, 1, `nenhuma fonte foi processada: ${JSON.stringify(resultado)}`)
    assert.equal(resultado.sources[0].error, null, `a leitura falhou: ${resultado.sources[0].error}`)
    assert.equal(resultado.sources[0].created, 1, `nada foi criado: ${JSON.stringify(resultado.sources[0])}`)

    const base_ = await fetch(`${base}/api/agents/${agente._id}/documents`, { headers: comSessao() })
    const pagina = await base_.json()
    assert.equal(pagina.summary?.web, 1, `o documento não apareceu na base: ${JSON.stringify(pagina.summary)}`)
    assert.match(pagina.items[0].title, /Boletim da empresa/)
  } finally {
    await new Promise((r) => site.close(r))
  }
})

test('o modo escolhido na tela sobrevive ao salvar', async () => {
  // Se o modo não voltar do jeito que foi gravado, tudo o mais é irrelevante: a política
  // decide pelo que está no banco.
  const agente = await criarAgente({ name: 'Agente com modo' })
  const salvou = await fetch(`${base}/api/agents/${agente._id}/sources`, {
    method: 'PUT',
    headers: comSessao(),
    body: JSON.stringify({
      sources: [
        {
          name: 'Boletim',
          kind: 'http',
          url: 'https://exemplo.test/boletim',
          when: 'on_demand',
          refreshMode: 'on_demand',
          maxStalenessMinutes: 15,
        },
      ],
    }),
  })
  assert.ok(salvou.ok, `salvar devolveu ${salvou.status}`)

  const lido = await (await fetch(`${base}/api/agents/${agente._id}/sources`, { headers: comSessao() })).json()
  const fonte = lido.sources.find((f) => f.origem === 'agente')
  assert.equal(fonte.refreshMode, 'on_demand', `o modo voltou como ${fonte.refreshMode}`)
  assert.equal(fonte.maxStalenessMinutes, 15)
})

// --- O CASO RELATADO: mandar mensagem no Playground e o site não ser lido ---------------------
//
// O caminho exato de quem testa: um agente com um endereço em "Como trabalha", uma
// mensagem no chat de teste, e a expectativa de que ele passe pelo site ANTES de procurar
// na base. Aqui isso é verificado por MODO, porque é o modo que decide.

const comSite = async (nome, refreshMode, porta) => {
  const agente = await criarAgente({ name: nome })
  const r = await fetch(`${base}/api/agents/${agente._id}/sources`, {
    method: 'PUT',
    headers: comSessao(),
    body: JSON.stringify({
      sources: [{ name: 'Boletim', kind: 'http', url: `http://127.0.0.1:${porta}/pagina`, when: 'on_demand', refreshMode }],
    }),
  })
  assert.ok(r.ok, `salvar a fonte devolveu ${r.status}`)
  return agente
}

const perguntar = (agenteId, texto) =>
  fetch(`${base}/api/agents/${agenteId}/playground`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({ messages: [{ role: 'user', content: texto }] }),
  })

const documentosDe = async (agenteId) =>
  (await (await fetch(`${base}/api/agents/${agenteId}/documents`, { headers: comSessao() })).json()).summary?.web ?? 0

test('mandar mensagem no teste dispara a leitura do site — e a base vazia é inicializada em qualquer modo', async () => {
  const site = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<html><head><title>Calendário de agosto</title></head><body><article>${'O calendário de agosto tem feriado no dia 15. '.repeat(20)}</article></body></html>`)
  })
  await new Promise((r) => site.listen(0, '127.0.0.1', r))
  const porta = site.address().port

  try {
    // ANTES DE USAR O AGENTE: a mensagem dispara a leitura, e a base sai do zero.
    const sobDemanda = await comSite('Sob demanda', 'on_demand', porta)
    assert.equal(await documentosDe(sobDemanda._id), 0, 'a base começa vazia')
    const r1 = await perguntar(sobDemanda._id, 'qual o calendário de agosto?')
    assert.ok(r1.ok, `playground devolveu ${r1.status}`)
    assert.equal(await documentosDe(sobDemanda._id), 1, 'a mensagem tinha que ter disparado a leitura')

    // SÓ QUANDO EU PEDIR: a PRIMEIRA pergunta ainda inicializa a base — "não leia a toda
    // hora" não quer dizer "nunca leia, nem uma vez". Da segunda em diante, o modo manda.
    const soManual = await comSite('Só manual', 'manual', porta)
    const r2 = await perguntar(soManual._id, 'qual o calendário de agosto?')
    assert.ok(r2.ok)
    assert.equal(await documentosDe(soManual._id), 1, 'a base vazia é inicializada na primeira pergunta')

    const r3 = await perguntar(soManual._id, 'e o calendário de agosto, mudou?')
    assert.ok(r3.ok)
    assert.equal(await documentosDe(soManual._id), 1, 'a segunda pergunta não lê de novo em manual')

    // E o botão continua funcionando para ele.
    const clique = await fetch(`${base}/api/agents/${soManual._id}/sources/refresh`, { method: 'POST', headers: comSessao() })
    assert.ok(clique.ok)
    assert.equal(await documentosDe(soManual._id), 1, 'ler de novo o mesmo conteúdo não duplica')
  } finally {
    await new Promise((r) => site.close(r))
  }
})
