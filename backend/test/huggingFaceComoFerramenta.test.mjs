// UM MODELO DO HUGGING FACE COMO FERRAMENTA DE AGENTE.
//
// A pergunta era se dá para um agente usar um classificador do Hugging Face — sentimento
// de avaliação de produto, por exemplo. Dá, e sem código novo: um classificador não
// conversa e não chama ferramenta, ele recebe texto e devolve rótulo com confiança. Isso
// é uma chamada HTTP com resposta estruturada, que é exatamente o que uma Ferramenta é.
//
// Estes casos rodam o EXECUTOR DE VERDADE contra um servidor local que responde no formato
// do Hugging Face. O que eles provam é o caminho inteiro dentro do sistema: o corpo montado
// a partir do argumento do modelo, o token no cabeçalho, o mascaramento, o host travado, e
// o comportamento no arranque a frio — que é o defeito que aparece em produção e não no
// primeiro teste de mesa.
//
// O que eles NÃO provam, e não têm como: que o modelo escolhido classifica bem as SUAS
// avaliações. Isso depende de token e de dados reais.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
process.env.ENCRYPTION_KEY ||= 'test-only-encryption-key-'.padEnd(40, 'x')
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { executeToolCall } = await import('../dist/toolExecution.js')
const { encrypt } = await import('../dist/crypto.js')

function subir(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}
const fechar = (server) => new Promise((resolve) => server.close(resolve))

/** O token do Hugging Face, do jeito que ele é: `hf_` mais um blob. */
const TOKEN = 'hf_' + 'x'.repeat(34)

/**
 * A ferramenta que alguém criaria na tela de Ferramentas.
 *
 * Nada aqui é especial para o Hugging Face: é POST, um endereço, um token no `bearer` e um
 * `inputSchema` com o campo que o modelo do HF espera (`inputs`).
 */
const ferramenta = (porta, over = {}) => ({
  _id: new ObjectId(),
  ownerId: 'o1',
  name: 'analisar_sentimento',
  description: 'Classifica o sentimento de uma avaliação de produto. Devolve rótulo e confiança.',
  method: 'POST',
  url: `http://127.0.0.1:${porta}/models/nlptown/bert-base-multilingual-uncased-sentiment`,
  headers: [],
  inputSchema: { type: 'object', properties: { inputs: { type: 'string' } }, required: ['inputs'] },
  bodyTemplate: null,
  auth: { kind: 'bearer', secretEncrypted: encrypt(TOKEN) },
  timeoutMs: 3000,
  maxResponseChars: 2000,
  allowedDomains: [],
  maxCallsPerRun: 3,
  /**
   * LIBERADA para o agente executar sozinha — e isto não é detalhe de teste.
   *
   * Sem esta linha o sistema recusa antes de fazer a requisição, com
   * `autonomous_execution_not_authorized`: uma ferramenta POST muda coisas do outro lado, e
   * agente disparando POST por conta própria é a diferença entre uma consulta e um pedido
   * feito em nome de alguém. Um classificador é um POST que não muda nada — mas o sistema
   * não tem como saber isso, e presumir que sabe seria presumir errado no caso perigoso.
   *
   * Na prática: criar a ferramenta não basta. É preciso marcar a execução autônoma nas
   * configurações dela.
   */
  allowAutonomousExecution: true,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
})

test('ACEITAÇÃO: o agente manda a avaliação e recebe o sentimento de volta', async () => {
  let recebido = null
  const { server, port } = await subir((req, res) => {
    let corpo = ''
    req.on('data', (c) => (corpo += c))
    req.on('end', () => {
      recebido = { autorizacao: req.headers.authorization, tipo: req.headers['content-type'], corpo }
      // O formato real do Hugging Face para classificação de texto: lista dentro de lista.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify([[{ label: '1 star', score: 0.87 }, { label: '2 stars', score: 0.09 }]]))
    })
  })

  const saida = await executeToolCall(ferramenta(port), { inputs: 'o produto veio quebrado' }, { callsSoFar: 0, autonomous: true })
  await fechar(server)

  assert.equal(saida.ok, true, `a chamada falhou: ${saida.result}`)
  // O corpo é montado a partir do argumento que o MODELO produziu — sem template, sem
  // configuração extra.
  assert.deepEqual(JSON.parse(recebido.corpo), { inputs: 'o produto veio quebrado' })
  assert.equal(recebido.tipo, 'application/json')
  assert.equal(recebido.autorizacao, `Bearer ${TOKEN}`, 'o token precisa chegar do jeito que o HF espera')
  // E a resposta volta inteira para o agente decidir o que fazer com ela.
  assert.match(saida.result, /1 star/)
  assert.match(saida.result, /0\.87/)
})

test('AMEAÇA: o token não aparece em lugar nenhum que alguém possa ler', async () => {
  /**
   * O executor guarda a requisição para a tela de detalhe e para a auditoria. Um token de
   * Hugging Face vazado ali é um token que dá acesso à conta inteira de quem o criou — e
   * ele vaza em silêncio, porque nada quebra quando isso acontece.
   */
  const { server, port } = await subir((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    // Uma API que ecoa o que recebeu é o segundo caminho de vazamento, e é comum.
    res.end(JSON.stringify({ recebi: req.headers.authorization }))
  })

  const saida = await executeToolCall(ferramenta(port), { inputs: 'bom' }, { callsSoFar: 0, autonomous: true })
  await fechar(server)

  const tudo = JSON.stringify(saida)
  assert.equal(tudo.includes(TOKEN), false, 'o token apareceu no resultado da ferramenta')
  assert.equal(tudo.includes('hf_'), false, 'sobrou pedaço reconhecível do token')
})

test('AMEAÇA: no arranque a frio, o agente é informado — e não recebe silêncio', async () => {
  /**
   * O caminho sem servidor dedicado do Hugging Face descarrega modelos parados. A PRIMEIRA
   * chamada do dia responde 503 dizendo que está carregando, com uma estimativa. É o
   * defeito que não aparece no teste de mesa e aparece na segunda-feira de manhã.
   *
   * O que se exige aqui é honestidade: a ferramenta não pode devolver algo que o agente
   * leia como "analisado e neutro".
   */
  const { server, port } = await subir((_req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'Model nlptown/bert-base-multilingual-uncased-sentiment is currently loading', estimated_time: 20 }))
  })

  const saida = await executeToolCall(ferramenta(port), { inputs: 'bom' }, { callsSoFar: 0, autonomous: true })
  await fechar(server)

  assert.equal(saida.ok, false, 'carregando não é sucesso')
  assert.match(saida.result, /loading|503|carregando/i, 'o motivo tem de chegar ao agente')
})

test('AMEAÇA: a ferramenta do Hugging Face não fala com outro host', async () => {
  /**
   * `allowedDomains` é conferido a cada chamada, e não só na criação. Sem isso, editar o
   * endereço de uma ferramenta que já tem um token guardado seria um jeito de mandar esse
   * token para onde se quisesse.
   */
  const { server, port } = await subir((_req, res) => res.end('{}'))
  const presa = ferramenta(port, { allowedDomains: ['router.huggingface.co'] })
  const saida = await executeToolCall(presa, { inputs: 'bom' }, { callsSoFar: 0, autonomous: true })
  await fechar(server)

  assert.equal(saida.ok, false)
  assert.match(saida.result, /permissão|127\.0\.0\.1/)
})

// --- um LLM do Hugging Face, também como ferramenta -------------------------------------

/**
 * Um LLM de conversa pede um corpo ANINHADO: `{model, messages:[{role, content}]}`. Sem
 * template, o corpo é o argumento cru que o modelo produziu — e o agente teria de montar
 * essa estrutura inteira toda vez, incluindo o nome do modelo remoto. Ele consegue, e vai
 * errar: um dia manda `messages` como string, outro dia troca o modelo.
 *
 * Com `bodyTemplate`, o formato fica FIXO na ferramenta e o agente manda uma coisa só —
 * um texto. É a diferença entre pedir "resuma isto" e pedir que ele preencha um protocolo.
 */
const comLlm = (porta, over = {}) => ({
  ...ferramenta(porta),
  name: 'resumir_com_llm',
  description: 'Resume um texto usando um modelo aberto. Passe o texto em `texto`.',
  url: `http://127.0.0.1:${porta}/v1/chat/completions`,
  inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
  bodyTemplate: JSON.stringify({
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    messages: [{ role: 'user', content: 'Resuma em uma frase: {{texto}}' }],
    max_tokens: 200,
  }),
  ...over,
})

test('ACEITAÇÃO: um LLM aberto responde como ferramenta, e o agente manda só o texto', async () => {
  let recebido = null
  const { server, port } = await subir((req, res) => {
    let corpo = ''
    req.on('data', (c) => (corpo += c))
    req.on('end', () => {
      recebido = JSON.parse(corpo)
      // O formato do roteador do Hugging Face é o da OpenAI — é isto que permite reusar
      // tudo o que já existe em vez de escrever um cliente.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'O cliente reclamou do prazo.' } }], usage: { total_tokens: 42 } }))
    })
  })

  const saida = await executeToolCall(comLlm(port), { texto: 'demorou 20 dias e ninguém avisou' }, { callsSoFar: 0, autonomous: true })
  await fechar(server)

  assert.equal(saida.ok, true, `a chamada falhou: ${saida.result}`)
  // O modelo remoto e o formato ficam na FERRAMENTA; o agente preencheu só o buraco.
  assert.equal(recebido.model, 'meta-llama/Llama-3.1-8B-Instruct')
  assert.equal(recebido.messages[0].content, 'Resuma em uma frase: demorou 20 dias e ninguém avisou')
  assert.match(saida.result, /O cliente reclamou do prazo/)
})

test('AMEAÇA: o texto do agente não escapa do template e vira outro campo', async () => {
  /**
   * O texto vem de fora — de uma avaliação de produto, por exemplo. Se ele for costurado
   * no template sem virar JSON válido, uma aspa no meio de "produto \"ótimo\"" quebra o
   * corpo, e um texto malicioso escreve campos que ninguém pediu. Isto é injeção, e o
   * caminho dela é o mesmo de sempre: dado tratado como estrutura.
   */
  let corpoCru = ''
  const { server, port } = await subir((req, res) => {
    req.on('data', (c) => (corpoCru += c))
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    })
  })

  const veneno = 'ótimo", "max_tokens": 99999, "lixo": "'
  await executeToolCall(comLlm(port), { texto: veneno }, { callsSoFar: 0, autonomous: true })
  await fechar(server)

  let corpo = null
  try {
    corpo = JSON.parse(corpoCru)
  } catch {
    corpo = null
  }
  assert.notEqual(corpo, null, `o texto do agente quebrou o JSON do corpo: ${corpoCru}`)
  /**
   * A conferência é sobre a MENSAGEM, e não sobre o topo do corpo.
   *
   * O buraco do template está dentro de `messages[0].content`, então é ali que o texto
   * escapado acrescenta campos — olhar só o topo faz o caso passar com a injeção
   * acontecendo. Foi o que aconteceu na primeira versão deste teste.
   */
  assert.equal(corpo.messages[0].content, `Resuma em uma frase: ${veneno}`, 'o texto não chegou inteiro dentro da string')
  assert.deepEqual(Object.keys(corpo.messages[0]).sort(), ['content', 'role'], `o texto acrescentou campos: ${JSON.stringify(corpo.messages[0])}`)
  assert.equal(corpo.max_tokens, 200, 'o texto conseguiu sobrescrever um campo do template')
})
