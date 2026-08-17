// Monitoramento de fonte: quando a rotina roda e quando ela NÃO roda.
//
// A regra que este arquivo existe para proteger é a mais cara de errar: a LLM só é
// chamada quando há conteúdo novo. Errar para um lado gasta tokens do usuário a
// cada 5 minutos; errar para o outro perde a notícia que ele pediu para vigiar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectHttpChange,
  detectRssChange,
  normalizeHttpContent,
  chaveDoItem,
  pareceFeed,
  sourceFingerprint,
  normalizeSourceUrl,
  INITIAL_WINDOWS,
} from '../dist/automations/sourceChange.js'
import { runDefinition } from '../dist/automations/runner.js'
import { recurrenceToCron, cronToRecurrence, describeRecurrence, isValidRecurrence } from '../dist/automations/schedule.js'

const agora = Date.parse('2026-03-10T12:00:00Z')

const feed = (itens) =>
  `<?xml version="1.0"?><rss><channel>${itens
    .map((i) => `<item><title>${i.title}</title><link>${i.link ?? ''}</link>${i.guid ? `<guid>${i.guid}</guid>` : ''}${i.date ? `<pubDate>${i.date}</pubDate>` : ''}</item>`)
    .join('')}</channel></rss>`

// --- recorrência ---------------------------------------------------------------------

test('os intervalos curtos viram cron, e voltam de lá inteiros', () => {
  for (const every of [5, 15, 30]) {
    const cron = recurrenceToCron({ kind: 'minutes', every })
    assert.equal(cron, `*/${every} * * * *`)
    assert.deepEqual(cronToRecurrence(cron), { kind: 'minutes', every })
  }
  assert.equal(recurrenceToCron({ kind: 'hourly' }), '0 * * * *')
  assert.deepEqual(cronToRecurrence('0 * * * *'), { kind: 'hourly' })
})

test('as recorrências antigas continuam exatamente como eram', () => {
  assert.equal(recurrenceToCron({ kind: 'daily', time: '08:00' }), '0 8 * * *')
  assert.equal(recurrenceToCron({ kind: 'weekly', time: '09:30', weekdays: [1, 3] }), '30 9 * * 1,3')
  assert.equal(recurrenceToCron({ kind: 'monthly', time: '07:15', day: 5 }), '15 7 5 * *')
  assert.deepEqual(cronToRecurrence('0 8 * * *'), { kind: 'daily', time: '08:00' })
})

test('um intervalo fora dos oferecidos é recusado', () => {
  assert.equal(isValidRecurrence({ kind: 'minutes', every: 7 }), false)
  assert.equal(isValidRecurrence({ kind: 'minutes', every: 15 }), true)
})

test('o intervalo curto é descrito sem inventar uma hora do dia', () => {
  assert.equal(describeRecurrence({ kind: 'minutes', every: 15 }), 'A cada 15 minutos')
  assert.equal(describeRecurrence({ kind: 'hourly' }), 'A cada hora')
})

// --- RSS ------------------------------------------------------------------------------

test('primeira volta respeita a janela escolhida', () => {
  const xml = feed([
    { title: 'De hoje', guid: 'a', date: 'Tue, 10 Mar 2026 10:00:00 GMT' },
    { title: 'De duas semanas atrás', guid: 'b', date: 'Tue, 24 Feb 2026 10:00:00 GMT' },
  ])
  const r = detectRssChange(xml, [], INITIAL_WINDOWS['24h'], agora, false)
  assert.equal(r.primeiraLeitura, true)
  assert.deepEqual(r.novos.map((i) => i.title), ['De hoje'])
})

test('janela maior traz o que a menor deixou de fora', () => {
  const xml = feed([{ title: 'Três dias atrás', guid: 'c', date: 'Sat, 07 Mar 2026 10:00:00 GMT' }])
  assert.equal(detectRssChange(xml, [], INITIAL_WINDOWS['24h'], agora, false).novos.length, 0)
  assert.equal(detectRssChange(xml, [], INITIAL_WINDOWS['7d'], agora, false).novos.length, 1)
})

test('a segunda volta entrega só o que ainda não foi visto', () => {
  const xml = feed([
    { title: 'Velho', guid: 'a' },
    { title: 'Novo', guid: 'b' },
  ])
  const r = detectRssChange(xml, ['a'], INITIAL_WINDOWS['24h'], agora, true)
  assert.equal(r.primeiraLeitura, false)
  assert.deepEqual(r.novos.map((i) => i.title), ['Novo'])
  assert.deepEqual(r.novasChaves, ['b'])
})

test('nada novo é nada novo — e isso não é erro', () => {
  const xml = feed([{ title: 'Velho', guid: 'a' }])
  const r = detectRssChange(xml, ['a'], INITIAL_WINDOWS['24h'], agora, true)
  assert.equal(r.changed, false)
  assert.equal(r.novos.length, 0)
})

test('depois da primeira volta a janela deixa de filtrar', () => {
  // Um item com data antiga (ou sem data) publicado agora não pode ser descartado
  // para sempre só porque não cabe na janela inicial.
  const xml = feed([{ title: 'Data velha, publicado agora', guid: 'z', date: 'Mon, 01 Jan 2020 10:00:00 GMT' }])
  assert.equal(detectRssChange(xml, [], INITIAL_WINDOWS['24h'], agora, false).novos.length, 0)
  assert.equal(detectRssChange(xml, ['outro'], INITIAL_WINDOWS['24h'], agora, true).novos.length, 1)
})

test('a chave do item prefere o GUID, depois o link, e nunca a posição', () => {
  assert.equal(chaveDoItem({ guid: 'g1', url: 'http://x', title: 't', publishedAt: null }), 'g1')
  assert.equal(chaveDoItem({ guid: '', url: 'http://x', title: 't', publishedAt: null }), 'http://x')
  // Sem guid e sem link, sobra um hash estável do que dá para ler — o mesmo item
  // gera a mesma chave em execuções diferentes.
  const a = chaveDoItem({ guid: '', url: '', title: 'igual', publishedAt: '2026-01-01' })
  const b = chaveDoItem({ guid: '', url: '', title: 'igual', publishedAt: '2026-01-01' })
  assert.equal(a, b)
  assert.notEqual(a, chaveDoItem({ guid: '', url: '', title: 'outro', publishedAt: '2026-01-01' }))
})

test('Atom é lido como RSS, com o link no atributo', () => {
  const atom = `<feed><entry><title>Do Atom</title><id>tag:1</id><link href="https://exemplo.test/1"/></entry></feed>`
  const r = detectRssChange(atom, [], INITIAL_WINDOWS['24h'], agora, false)
  assert.equal(r.novos.length, 1)
  assert.equal(r.novos[0].title, 'Do Atom')
  assert.equal(r.novos[0].url, 'https://exemplo.test/1')
})

test('feed quebrado não derruba a rotina: rende menos itens, não uma exceção', () => {
  const r = detectRssChange('<rss><channel><item><title>Sem fim', [], INITIAL_WINDOWS['24h'], agora, false)
  assert.equal(r.changed, false)
})

// --- HTTP -----------------------------------------------------------------------------

test('a primeira verificação HTTP é sempre mudança: é a linha de base', () => {
  const r = detectHttpChange('<p>oi</p>', 'text/html', null, false)
  assert.equal(r.primeiraLeitura, true)
  assert.equal(r.changed, true)
})

test('mesmo conteúdo com espaçamento diferente NÃO é mudança', () => {
  const primeiro = detectHttpChange('<p>Preço:  R$ 10</p>', 'text/html', null, false)
  const segundo = detectHttpChange(`<p>Preço:

   R$ 10</p>
`, 'text/html', primeiro.contentHash, true)
  assert.equal(segundo.changed, false, 'reformatação não pode acordar a LLM')
})

test('script e style mudando não contam como mudança de conteúdo', () => {
  const antes = detectHttpChange('<html><script>var t=1</script><p>Estável</p></html>', 'text/html', null, false)
  const depois = detectHttpChange('<html><script>var t=999</script><p>Estável</p></html>', 'text/html', antes.contentHash, true)
  assert.equal(depois.changed, false)
})

test('conteúdo de verdade diferente É mudança', () => {
  const antes = detectHttpChange('<p>R$ 10</p>', 'text/html', null, false)
  const depois = detectHttpChange('<p>R$ 12</p>', 'text/html', antes.contentHash, true)
  assert.equal(depois.changed, true)
})

test('a normalização tira a marcação e mantém o texto', () => {
  assert.equal(normalizeHttpContent('<div> <b>Olá</b>   mundo </div>', 'text/html'), 'Olá mundo')
  // JSON não é HTML: nada de tirar "tags" de um payload.
  assert.equal(normalizeHttpContent('{"a": 1}', 'application/json'), '{"a": 1}')
})

// --- o runner: quem roda e quem não roda ----------------------------------------------

const passoFonte = (tipo, config = {}) => ({
  id: 'fonte',
  name: 'Fonte',
  type: tipo,
  enabled: true,
  dependsOn: [],
  inputMapping: {},
  config: { url: 'https://exemplo.test/feed', ...config },
  timeoutMs: 10_000,
  retryPolicy: { maxAttempts: 2, backoffMs: 0 },
  continueOnError: false,
})

const passoAgente = {
  id: 'run',
  name: 'Executar agente',
  type: 'agent.execute',
  enabled: true,
  dependsOn: ['fonte'],
  inputMapping: {},
  config: { agentId: 'a1', objective: 'resumir', instruction: 'resumir', format: 'markdown' },
  timeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  continueOnError: false,
}

const definicao = (passos) => ({
  trigger: { type: 'schedule', timezone: 'UTC', cron: '*/15 * * * *' },
  inputs: [],
  steps: passos,
  resultFormat: 'markdown',
  deliveries: [],
  limits: { maxSteps: 10, maxOutputChars: 10_000 },
})

function estado(inicial = { seenKeys: [], contentHash: null, initialized: true }, opts = {}) {
  const registro = { avancos: [], verificacoes: 0, atual: inicial, leasesTomados: 0, leasesLiberados: 0, fingerprints: [], buscas: 0 }
  return {
    api: {
      // `fonteTrocada` simula a rotina já publicando outra fonte.
      isCurrent: async () => !opts.fonteTrocada,
      begin: async (_stepId, fingerprint) => {
        registro.verificacoes++
        registro.fingerprints.push(fingerprint)
        return registro.atual
      },
      // `leaseOcupado` simula outra execução já segurando a fonte.
      acquire: async () => {
        if (opts.leaseOcupado) return false
        registro.leasesTomados++
        return true
      },
      release: async () => {
        registro.leasesLiberados++
      },
      advance: async (stepId, fingerprint, avanco) => {
        registro.avancos.push({ stepId, fingerprint, avanco })
      },
    },
    registro,
  }
}

test('sem novidade: nenhuma inferência, nenhuma entrega, zero token', async () => {
  const { api, registro } = estado({ seenKeys: ['a'], contentHash: null, initialized: true })
  let chamouLLM = 0
  const out = await runDefinition(definicao([passoFonte('source.rss'), passoAgente]), {
    fetchUrl: async () => ({ body: feed([{ title: 'Velho', guid: 'a' }]), contentType: 'application/xml' }),
    runAgent: async () => {
      chamouLLM++
      return { output: 'nunca' }
    },
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: api,
  })

  assert.equal(out.status, 'succeeded', 'sem novidade é SUCESSO, não falha')
  assert.equal(out.sourceOutcome, 'no_change')
  assert.equal(chamouLLM, 0, 'a LLM não pode ser chamada sem conteúdo novo')
  assert.equal(out.usage.inputTokens + out.usage.outputTokens, 0)
  // O checkpoint não avança porque não houve o que registrar…
  assert.equal(registro.avancos.length, 0)
  // …mas a verificação foi registrada: a rotina está viva, só não tinha o que fazer.
  assert.equal(registro.verificacoes, 1)
  // E a etapa do agente aparece como pulada, não como ausente.
  assert.equal(out.steps.find((s) => s.stepId === 'run').status, 'skipped')
})

test('com novidade: a LLM roda UMA vez e o checkpoint avança', async () => {
  const { api, registro } = estado({ seenKeys: ['a'], contentHash: null, initialized: true })
  let chamouLLM = 0
  const out = await runDefinition(definicao([passoFonte('source.rss'), passoAgente]), {
    fetchUrl: async () => ({ body: feed([{ title: 'Velho', guid: 'a' }, { title: 'Novo', guid: 'b' }]), contentType: 'application/xml' }),
    runAgent: async () => {
      chamouLLM++
      return { output: 'resumo', usage: { inputTokens: 10, outputTokens: 5 } }
    },
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: api,
  })

  assert.equal(out.status, 'succeeded')
  assert.notEqual(out.sourceOutcome, 'no_change')
  assert.equal(chamouLLM, 1)
  assert.equal(registro.avancos.length, 1)
  assert.deepEqual(registro.avancos[0].avanco, { novasChaves: ['b'] })
})

test('HTTP sem mudança não chama a LLM; alterado chama uma vez', async () => {
  const semMudanca = estado({ seenKeys: [], contentHash: null, initialized: true })
  const primeiro = detectHttpChange('<p>estável</p>', 'text/html', null, false)
  semMudanca.registro.atual = { seenKeys: [], contentHash: primeiro.contentHash, initialized: true }

  let chamadas = 0
  const rodar = async (corpo, api) =>
    runDefinition(definicao([passoFonte('source.http'), passoAgente]), {
      fetchUrl: async () => ({ body: corpo, contentType: 'text/html' }),
      runAgent: async () => {
        chamadas++
        return { output: 'ok' }
      },
      deliver: async () => ({ providerMessageId: null }),
      now: () => agora,
      sourceState: api,
    })

  const igual = await rodar('<p>estável</p>', semMudanca.api)
  assert.equal(igual.sourceOutcome, 'no_change')
  assert.equal(chamadas, 0)

  const diferente = await rodar('<p>mudou</p>', semMudanca.api)
  assert.equal(diferente.sourceOutcome, undefined)
  assert.equal(chamadas, 1, 'conteúdo alterado dispara exatamente uma execução')
})

test('se a LLM falhar, o checkpoint NÃO avança', async () => {
  const { api, registro } = estado({ seenKeys: [], contentHash: null, initialized: true })
  const out = await runDefinition(definicao([passoFonte('source.rss'), passoAgente]), {
    fetchUrl: async () => ({ body: feed([{ title: 'Novo', guid: 'novo', date: 'Tue, 10 Mar 2026 11:00:00 GMT' }]), contentType: 'application/xml' }),
    runAgent: async () => {
      throw Object.assign(new Error('provedor fora do ar'), { kind: 'provider' })
    },
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: api,
  })

  assert.equal(out.status, 'failed')
  // O item continua "não visto": a próxima volta tenta de novo em vez de perdê-lo.
  assert.equal(registro.avancos.length, 0)
})

test('se a ENTREGA falhar, o checkpoint também não avança', async () => {
  const { api, registro } = estado({ seenKeys: [], contentHash: null, initialized: true })
  const entrega = {
    id: 'deliver',
    name: 'Entregar',
    type: 'delivery.send',
    enabled: true,
    dependsOn: ['run'],
    inputMapping: {},
    config: { connectionId: 'c1', fromStepId: 'run' },
    timeoutMs: 5000,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    continueOnError: false,
  }
  const out = await runDefinition(definicao([passoFonte('source.rss'), passoAgente, entrega]), {
    fetchUrl: async () => ({ body: feed([{ title: 'Novo', guid: 'novo', date: 'Tue, 10 Mar 2026 11:00:00 GMT' }]), contentType: 'application/xml' }),
    runAgent: async () => ({ output: 'resumo' }),
    deliver: async () => {
      throw new Error('e-mail recusado')
    },
    now: () => agora,
    sourceState: api,
  })

  assert.equal(out.status, 'failed')
  assert.equal(registro.avancos.length, 0, 'o usuário não recebeu — o conteúdo não pode contar como entregue')
})

test('sem novidade não há retry: a resposta certa não se tenta de novo', async () => {
  const { api } = estado({ seenKeys: ['a'], contentHash: null, initialized: true })
  let buscas = 0
  const out = await runDefinition(definicao([passoFonte('source.rss'), passoAgente]), {
    fetchUrl: async () => {
      buscas++
      return { body: feed([{ title: 'Velho', guid: 'a' }]), contentType: 'application/xml' }
    },
    runAgent: async () => ({ output: 'x' }),
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: api,
  })
  assert.equal(out.sourceOutcome, 'no_change')
  // maxAttempts é 2 no passo da fonte; "sem novidade" não é falha, então não repete.
  assert.equal(buscas, 1)
})

test('rotina SEM fonte se comporta exatamente como antes', async () => {
  // Nenhum `sourceState`: é o caminho de toda rotina que existia antes disto.
  let chamouLLM = 0
  const out = await runDefinition(definicao([{ ...passoAgente, dependsOn: [] }]), {
    fetchUrl: async () => ({ body: '', contentType: 'text/plain' }),
    runAgent: async () => {
      chamouLLM++
      return { output: 'resultado', usage: { inputTokens: 3, outputTokens: 2 } }
    },
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
  })
  assert.equal(out.status, 'succeeded')
  assert.equal(out.sourceOutcome, undefined)
  assert.equal(chamouLLM, 1)
  assert.equal(out.finalOutput, 'resultado')
})

test('a fonte antiga, sem estado, continua devolvendo a lista de itens', async () => {
  const out = await runDefinition(definicao([passoFonte('source.rss'), passoAgente]), {
    fetchUrl: async () => ({ body: feed([{ title: 'Item', guid: 'i', date: 'Tue, 10 Mar 2026 11:00:00 GMT' }]), contentType: 'application/xml' }),
    runAgent: async () => ({ output: 'ok' }),
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
  })
  assert.equal(out.status, 'succeeded')
  assert.equal(out.sourceOutcome, undefined)
  assert.equal(out.steps[0].output.length, 1)
})

// --- primeira leitura: a linha de base ------------------------------------------------

test('feed com item recente e item velho: o velho nunca volta como novo', async () => {
  // O caso que este teste existe para impedir: na primeira leitura só o recente é
  // entregue, mas o VELHO também precisa entrar no checkpoint. Se não entrasse, na
  // volta seguinte — quando a janela deixa de valer — ele apareceria como novidade.
  const { api, registro } = estado({ seenKeys: [], contentHash: null, initialized: false })
  const xml = feed([
    { title: 'De hoje', guid: 'recente', date: 'Tue, 10 Mar 2026 11:00:00 GMT' },
    { title: 'De duas semanas atrás', guid: 'velho', date: 'Tue, 24 Feb 2026 10:00:00 GMT' },
  ])
  const entregues = []
  const out = await runDefinition(definicao([passoFonte('source.rss', { windowMs: INITIAL_WINDOWS['24h'] }), passoAgente]), {
    fetchUrl: async () => ({ body: xml, contentType: 'application/xml' }),
    runAgent: async (call) => {
      entregues.push(call)
      return { output: 'resumo' }
    },
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: api,
  })

  assert.equal(out.status, 'succeeded')
  // O agente recebeu SÓ o recente…
  assert.equal(out.steps[0].output.length, 1)
  assert.equal(out.steps[0].output[0].guid, 'recente')
  // …e o checkpoint recebeu OS DOIS.
  assert.deepEqual(registro.avancos[0].avanco.novasChaves.sort(), ['recente', 'velho'])
  // Aqui houve entrega de verdade: NÃO é linha de base.
  assert.notEqual(registro.avancos[0].avanco.baseline, true)
  assert.equal(entregues.length, 1)
})

test('primeira leitura sem nada recente: sem LLM, mas a linha de base fica gravada', async () => {
  const { api, registro } = estado({ seenKeys: [], contentHash: null, initialized: false })
  let chamouLLM = 0
  const out = await runDefinition(definicao([passoFonte('source.rss', { windowMs: INITIAL_WINDOWS['24h'] }), passoAgente]), {
    fetchUrl: async () => ({
      body: feed([{ title: 'Antigo', guid: 'antigo', date: 'Tue, 24 Feb 2026 10:00:00 GMT' }]),
      contentType: 'application/xml',
    }),
    runAgent: async () => {
      chamouLLM++
      return { output: 'nunca' }
    },
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: api,
  })

  assert.equal(out.sourceOutcome, 'no_change')
  assert.equal(chamouLLM, 0)
  // Aqui o avanço acontece MESMO sem entrega: não há etapa nenhuma para falhar
  // depois, e sem ele o item antigo viraria "novo" na volta seguinte.
  assert.deepEqual(registro.avancos[0].avanco.novasChaves, ['antigo'])
  // E é marcado como linha de base: nada foi entregue, então isto não pode virar
  // "última novidade" na lista.
  assert.equal(registro.avancos[0].avanco.baseline, true)
})

test('depois da linha de base, o item que aparece é entregue — e só ele', () => {
  const antes = feed([{ title: 'Antigo', guid: 'antigo', date: 'Tue, 24 Feb 2026 10:00:00 GMT' }])
  const base = detectRssChange(antes, [], INITIAL_WINDOWS['24h'], agora, false)
  assert.equal(base.changed, false)

  const depois = feed([
    { title: 'Antigo', guid: 'antigo', date: 'Tue, 24 Feb 2026 10:00:00 GMT' },
    { title: 'Novo agora', guid: 'novo', date: 'Tue, 10 Mar 2026 11:30:00 GMT' },
  ])
  const r = detectRssChange(depois, base.novasChaves, INITIAL_WINDOWS['24h'], agora, true)
  assert.deepEqual(r.novos.map((i) => i.guid), ['novo'])
})

test('feed vazio de verdade inicializa: ele não fica preso na janela para sempre', async () => {
  const { api, registro } = estado({ seenKeys: [], contentHash: null, initialized: false })
  const out = await runDefinition(definicao([passoFonte('source.rss'), passoAgente]), {
    fetchUrl: async () => ({ body: '<rss><channel><title>Sem itens ainda</title></channel></rss>', contentType: 'application/xml' }),
    runAgent: async () => ({ output: 'nunca' }),
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: api,
  })
  assert.equal(out.sourceOutcome, 'no_change')
  // Zero chave, mas o avanço acontece: é ele que carimba `initialized`. Sem isso,
  // `seenKeys` vazio seria confundido com "nunca inicializado" e o primeiro item a
  // aparecer poderia cair fora da janela e sumir.
  assert.equal(registro.avancos.length, 1)
  assert.deepEqual(registro.avancos[0].avanco.novasChaves, [])
})

// --- fonte que não é fonte -------------------------------------------------------------

test('página de HTML no lugar do feed é FALHA, não "nada novo"', async () => {
  // Um servidor devolvendo login, erro ou manutenção responde 200 com zero item.
  // Chamar isso de "sem novidade" faria a rotina jurar que está tudo bem para
  // sempre — que é o pior desfecho possível para quem pediu para ser avisado.
  const { api } = estado({ seenKeys: [], contentHash: null, initialized: false })
  let chamouLLM = 0
  const out = await runDefinition(definicao([passoFonte('source.rss'), passoAgente]), {
    fetchUrl: async () => ({ body: '<html><body><h1>404 Not Found</h1></body></html>', contentType: 'text/html' }),
    runAgent: async () => {
      chamouLLM++
      return { output: 'nunca' }
    },
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: api,
  })
  assert.equal(out.status, 'failed')
  assert.notEqual(out.sourceOutcome, 'no_change')
  assert.equal(chamouLLM, 0)
})

test('pareceFeed distingue um feed vazio de uma página qualquer', () => {
  assert.equal(pareceFeed('<rss><channel></channel></rss>'), true)
  assert.equal(pareceFeed('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), true)
  assert.equal(pareceFeed('<html><body>Faça login</body></html>'), false)
  assert.equal(pareceFeed('{"erro":"not found"}'), false)
})

test('resposta que não é 2xx nunca chega a virar mudança', async () => {
  // O `requireOk` mora no safeFetch e é pedido só pelas fontes; aqui o dublê faz o
  // que ele faria — rejeitar. O que este teste garante é o efeito: falha, e a LLM
  // não roda.
  const { api, registro } = estado({ seenKeys: [], contentHash: null, initialized: true })
  let chamouLLM = 0
  for (const status of [404, 429, 500]) {
    const out = await runDefinition(definicao([passoFonte('source.http'), passoAgente]), {
      fetchUrl: async () => {
        throw new Error(`A fonte respondeu ${status}`)
      },
      runAgent: async () => {
        chamouLLM++
        return { output: 'nunca' }
      },
      deliver: async () => ({ providerMessageId: null }),
      now: () => agora,
      sourceState: api,
    })
    assert.equal(out.status, 'failed', `${status} tinha que falhar`)
    assert.equal(out.sourceOutcome, undefined, `${status} não pode virar desfecho de fonte`)
  }
  assert.equal(chamouLLM, 0)
  assert.equal(registro.avancos.length, 0, 'um erro do servidor não avança o checkpoint')
})

// --- identidade da fonte ---------------------------------------------------------------

test('trocar a URL ou o tipo muda a identidade; trocar o resto, não', () => {
  const a = sourceFingerprint('rss', 'https://exemplo.test/feed.xml')
  assert.equal(a, sourceFingerprint('rss', 'https://exemplo.test/feed.xml'), 'a mesma fonte tem a mesma identidade')
  assert.notEqual(a, sourceFingerprint('rss', 'https://exemplo.test/outro.xml'), 'outra URL é outra fonte')
  assert.notEqual(a, sourceFingerprint('http', 'https://exemplo.test/feed.xml'), 'outro tipo é outra fonte')
})

test('a identidade ignora o que não muda o que é buscado', () => {
  const base = sourceFingerprint('rss', 'https://Exemplo.test/feed.xml')
  // Maiúsculas no host e fragmento não chegam ao servidor.
  assert.equal(base, sourceFingerprint('rss', 'https://exemplo.test/feed.xml#topo'))
  assert.equal(base, sourceFingerprint('rss', '  https://exemplo.test/feed.xml  '))
  // A query string chega, então faz parte da identidade.
  assert.notEqual(base, sourceFingerprint('rss', 'https://exemplo.test/feed.xml?cat=1'))
})

test('a identidade é um hash: o token da URL não fica guardado em texto', () => {
  const fp = sourceFingerprint('rss', 'https://exemplo.test/feed.xml?api_key=SEGREDO')
  assert.doesNotMatch(fp, /SEGREDO/)
  assert.match(fp, /^[a-f0-9]{64}$/)
  // E a normalização, que é o que entra no hash, também não é exposta em lugar
  // nenhum além dele — mas se um dia for, que seja sem credencial na tela.
  assert.equal(normalizeSourceUrl('https://exemplo.test/a#b'), 'https://exemplo.test/a')
})

// --- concorrência ----------------------------------------------------------------------

test('fonte já sendo verificada por outra execução: sem LLM, sem entrega, sem erro', async () => {
  const { api, registro } = estado({ seenKeys: [], contentHash: null, initialized: true }, { leaseOcupado: true })
  let chamouLLM = 0
  let entregou = 0
  const out = await runDefinition(definicao([passoFonte('source.rss'), passoAgente]), {
    fetchUrl: async () => ({ body: feed([{ title: 'Novo', guid: 'n' }]), contentType: 'application/xml' }),
    runAgent: async () => {
      chamouLLM++
      return { output: 'resumo' }
    },
    deliver: async () => {
      entregou++
      return { providerMessageId: null }
    },
    now: () => agora,
    sourceState: api,
  })

  assert.equal(out.status, 'succeeded', 'desistir não é falhar')
  assert.equal(out.sourceOutcome, 'skipped_concurrent')
  assert.equal(chamouLLM, 0)
  assert.equal(entregou, 0)
  assert.equal(registro.avancos.length, 0, 'quem não processou não avança o checkpoint')
  assert.equal(registro.leasesLiberados, 0, 'não se libera um lease que não se tomou')
})

test('o lease é devolvido no sucesso E na falha', async () => {
  const ok = estado({ seenKeys: [], contentHash: null, initialized: true })
  await runDefinition(definicao([passoFonte('source.rss'), passoAgente]), {
    fetchUrl: async () => ({ body: feed([{ title: 'Novo', guid: 'n' }]), contentType: 'application/xml' }),
    runAgent: async () => ({ output: 'resumo' }),
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: ok.api,
  })
  assert.equal(ok.registro.leasesTomados, 1)
  assert.equal(ok.registro.leasesLiberados, 1)

  const falha = estado({ seenKeys: [], contentHash: null, initialized: true })
  await runDefinition(definicao([passoFonte('source.rss'), passoAgente]), {
    fetchUrl: async () => ({ body: feed([{ title: 'Novo', guid: 'n' }]), contentType: 'application/xml' }),
    runAgent: async () => {
      throw Object.assign(new Error('provedor fora do ar'), { kind: 'provider' })
    },
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: falha.api,
  })
  // Sem isto, uma falha travaria a rotina até o lease expirar — quinze minutos de
  // silêncio por causa de um erro que durou um segundo.
  assert.equal(falha.registro.leasesLiberados, 1, 'a falha também devolve a fonte')
})

test('não se toma lease quando não há o que processar', async () => {
  const { api, registro } = estado({ seenKeys: ['a'], contentHash: null, initialized: true })
  await runDefinition(definicao([passoFonte('source.rss'), passoAgente]), {
    fetchUrl: async () => ({ body: feed([{ title: 'Velho', guid: 'a' }]), contentType: 'application/xml' }),
    runAgent: async () => ({ output: 'x' }),
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: api,
  })
  // Verificar é barato e acontece o tempo todo; segurar a fonte para não fazer nada
  // só atrapalharia quem tem o que fazer.
  assert.equal(registro.leasesTomados, 0)
})

// --- execução que envelheceu na fila ---------------------------------------------------

test('execução da fonte anterior não busca, não processa e não toca no checkpoint', async () => {
  // A corrida real: enfileirada às 10h00 com a URL antiga, o dono troca a URL às
  // 10h01, o worker só pega às 10h02. Buscar o endereço velho já seria errado; pior
  // seria o `begin` dela redefinir para a fonte antiga o checkpoint que a fonte nova
  // acabou de criar.
  const { api, registro } = estado({ seenKeys: [], contentHash: null, initialized: true }, { fonteTrocada: true })
  let buscou = 0
  let chamouLLM = 0
  let entregou = 0
  const out = await runDefinition(definicao([passoFonte('source.rss'), passoAgente]), {
    fetchUrl: async () => {
      buscou++
      return { body: feed([{ title: 'Novo', guid: 'n' }]), contentType: 'application/xml' }
    },
    runAgent: async () => {
      chamouLLM++
      return { output: 'resumo' }
    },
    deliver: async () => {
      entregou++
      return { providerMessageId: null }
    },
    now: () => agora,
    sourceState: api,
  })

  assert.equal(out.status, 'succeeded', 'descartar uma execução obsoleta não é falha')
  assert.equal(out.sourceOutcome, 'skipped_stale')
  assert.equal(buscou, 0, 'nem chega a consultar o endereço antigo')
  assert.equal(chamouLLM, 0)
  assert.equal(entregou, 0)
  assert.equal(registro.verificacoes, 0, 'o checkpoint da fonte nova não pode ser aberto por ela')
  assert.equal(registro.avancos.length, 0)
  assert.equal(registro.leasesTomados, 0)
})

test('o mesmo vale para fonte HTTP', async () => {
  const { api, registro } = estado({ seenKeys: [], contentHash: null, initialized: true }, { fonteTrocada: true })
  let buscou = 0
  const out = await runDefinition(definicao([passoFonte('source.http'), passoAgente]), {
    fetchUrl: async () => {
      buscou++
      return { body: '<p>x</p>', contentType: 'text/html' }
    },
    runAgent: async () => ({ output: 'nunca' }),
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: api,
  })
  assert.equal(out.sourceOutcome, 'skipped_stale')
  assert.equal(buscou, 0)
  assert.equal(registro.verificacoes, 0)
})

test('rotina SEM monitoramento não pergunta nada: ela roda o snapshot dela', async () => {
  // Reprodutibilidade: uma execução que não monitora tem que rodar exatamente a
  // definição que foi capturada, sem consultar o estado atual da rotina.
  let buscou = 0
  const out = await runDefinition(definicao([passoFonte('source.rss'), passoAgente]), {
    fetchUrl: async () => {
      buscou++
      return { body: feed([{ title: 'Item', guid: 'i', date: 'Tue, 10 Mar 2026 11:00:00 GMT' }]), contentType: 'application/xml' }
    },
    runAgent: async () => ({ output: 'ok' }),
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
  })
  assert.equal(out.status, 'succeeded')
  assert.equal(out.sourceOutcome, undefined)
  assert.equal(buscou, 1)
})

// --- HTTP que chega vazio ----------------------------------------------------------------

test('página que só monta no navegador é falha dita, não silêncio', async () => {
  // 2xx, mas sem nada depois de tirar a marcação. As duas alternativas são piores:
  // comparar vazio com vazio diria "não mudou" para sempre, e mandar vazio para a
  // LLM gastaria tokens com nada.
  const { api, registro } = estado({ seenKeys: [], contentHash: null, initialized: true })
  let chamouLLM = 0
  const out = await runDefinition(definicao([passoFonte('source.http'), passoAgente]), {
    fetchUrl: async () => ({ body: '<html><head><script>montaTudo()</script></head><body></body></html>', contentType: 'text/html' }),
    runAgent: async () => {
      chamouLLM++
      return { output: 'nunca' }
    },
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: api,
  })

  assert.equal(out.status, 'failed')
  assert.equal(out.sourceOutcome, undefined, 'vazio não é "sem novidade"')
  assert.equal(chamouLLM, 0)
  assert.equal(registro.avancos.length, 0)
  // A mensagem precisa dizer o que fazer com isso.
  assert.match(out.steps[0].errorMessage, /JavaScript/i)
})

test('resposta 204, sem corpo nenhum, cai na mesma regra', async () => {
  const { api } = estado({ seenKeys: [], contentHash: null, initialized: true })
  let chamouLLM = 0
  const out = await runDefinition(definicao([passoFonte('source.http'), passoAgente]), {
    fetchUrl: async () => ({ body: '', contentType: '' }),
    runAgent: async () => {
      chamouLLM++
      return { output: 'nunca' }
    },
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: api,
  })
  assert.equal(out.status, 'failed')
  assert.equal(chamouLLM, 0)
})

test('conteúdo vazio não vira retry: a página não vai encher sozinha', async () => {
  const { api } = estado({ seenKeys: [], contentHash: null, initialized: true })
  let buscas = 0
  await runDefinition(definicao([passoFonte('source.http'), passoAgente]), {
    fetchUrl: async () => {
      buscas++
      return { body: '<html><body>   </body></html>', contentType: 'text/html' }
    },
    runAgent: async () => ({ output: 'nunca' }),
    deliver: async () => ({ providerMessageId: null }),
    now: () => agora,
    sourceState: api,
  })
  // A etapa tem maxAttempts 2, mas isto não é falha transitória.
  assert.equal(buscas, 1)
})
