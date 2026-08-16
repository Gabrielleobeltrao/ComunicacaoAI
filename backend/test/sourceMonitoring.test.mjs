// Monitoramento de fonte: quando a rotina roda e quando ela NÃO roda.
//
// A regra que este arquivo existe para proteger é a mais cara de errar: a LLM só é
// chamada quando há conteúdo novo. Errar para um lado gasta tokens do usuário a
// cada 5 minutos; errar para o outro perde a notícia que ele pediu para vigiar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectHttpChange, detectRssChange, normalizeHttpContent, chaveDoItem, INITIAL_WINDOWS } from '../dist/automations/sourceChange.js'
import { runDefinition, NoChange } from '../dist/automations/runner.js'
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
  const r = detectRssChange(xml, [], INITIAL_WINDOWS['24h'], agora)
  assert.equal(r.primeiraVolta, true)
  assert.deepEqual(r.novos.map((i) => i.title), ['De hoje'])
})

test('janela maior traz o que a menor deixou de fora', () => {
  const xml = feed([{ title: 'Três dias atrás', guid: 'c', date: 'Sat, 07 Mar 2026 10:00:00 GMT' }])
  assert.equal(detectRssChange(xml, [], INITIAL_WINDOWS['24h'], agora).novos.length, 0)
  assert.equal(detectRssChange(xml, [], INITIAL_WINDOWS['7d'], agora).novos.length, 1)
})

test('a segunda volta entrega só o que ainda não foi visto', () => {
  const xml = feed([
    { title: 'Velho', guid: 'a' },
    { title: 'Novo', guid: 'b' },
  ])
  const r = detectRssChange(xml, ['a'], INITIAL_WINDOWS['24h'], agora)
  assert.equal(r.primeiraVolta, false)
  assert.deepEqual(r.novos.map((i) => i.title), ['Novo'])
  assert.deepEqual(r.novasChaves, ['b'])
})

test('nada novo é nada novo — e isso não é erro', () => {
  const xml = feed([{ title: 'Velho', guid: 'a' }])
  const r = detectRssChange(xml, ['a'], INITIAL_WINDOWS['24h'], agora)
  assert.equal(r.changed, false)
  assert.equal(r.novos.length, 0)
})

test('depois da primeira volta a janela deixa de filtrar', () => {
  // Um item com data antiga (ou sem data) publicado agora não pode ser descartado
  // para sempre só porque não cabe na janela inicial.
  const xml = feed([{ title: 'Data velha, publicado agora', guid: 'z', date: 'Mon, 01 Jan 2020 10:00:00 GMT' }])
  assert.equal(detectRssChange(xml, [], INITIAL_WINDOWS['24h'], agora).novos.length, 0)
  assert.equal(detectRssChange(xml, ['outro'], INITIAL_WINDOWS['24h'], agora).novos.length, 1)
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
  const r = detectRssChange(atom, [], INITIAL_WINDOWS['24h'], agora)
  assert.equal(r.novos.length, 1)
  assert.equal(r.novos[0].title, 'Do Atom')
  assert.equal(r.novos[0].url, 'https://exemplo.test/1')
})

test('feed quebrado não derruba a rotina: rende menos itens, não uma exceção', () => {
  const r = detectRssChange('<rss><channel><item><title>Sem fim', [], INITIAL_WINDOWS['24h'], agora)
  assert.equal(r.changed, false)
})

// --- HTTP -----------------------------------------------------------------------------

test('a primeira verificação HTTP é sempre mudança: é a linha de base', () => {
  const r = detectHttpChange('<p>oi</p>', 'text/html', null)
  assert.equal(r.primeiraVolta, true)
  assert.equal(r.changed, true)
})

test('mesmo conteúdo com espaçamento diferente NÃO é mudança', () => {
  const primeiro = detectHttpChange('<p>Preço:  R$ 10</p>', 'text/html', null)
  const segundo = detectHttpChange(`<p>Preço:

   R$ 10</p>
`, 'text/html', primeiro.contentHash)
  assert.equal(segundo.changed, false, 'reformatação não pode acordar a LLM')
})

test('script e style mudando não contam como mudança de conteúdo', () => {
  const antes = detectHttpChange('<html><script>var t=1</script><p>Estável</p></html>', 'text/html', null)
  const depois = detectHttpChange('<html><script>var t=999</script><p>Estável</p></html>', 'text/html', antes.contentHash)
  assert.equal(depois.changed, false)
})

test('conteúdo de verdade diferente É mudança', () => {
  const antes = detectHttpChange('<p>R$ 10</p>', 'text/html', null)
  const depois = detectHttpChange('<p>R$ 12</p>', 'text/html', antes.contentHash)
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

function estado(inicial = { seenKeys: [], contentHash: null }) {
  const registro = { avancos: [], verificacoes: 0, atual: inicial }
  return {
    api: {
      read: async () => registro.atual,
      checked: async () => {
        registro.verificacoes++
      },
      advance: async (stepId, avanco) => {
        registro.avancos.push({ stepId, avanco })
      },
    },
    registro,
  }
}

test('sem novidade: nenhuma inferência, nenhuma entrega, zero token', async () => {
  const { api, registro } = estado({ seenKeys: ['a'], contentHash: null })
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
  assert.equal(out.noChange, true)
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
  const { api, registro } = estado({ seenKeys: ['a'], contentHash: null })
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
  assert.notEqual(out.noChange, true)
  assert.equal(chamouLLM, 1)
  assert.deepEqual(registro.avancos, [{ stepId: 'fonte', avanco: { novasChaves: ['b'] } }])
})

test('HTTP sem mudança não chama a LLM; alterado chama uma vez', async () => {
  const semMudanca = estado({ seenKeys: [], contentHash: null })
  const primeiro = detectHttpChange('<p>estável</p>', 'text/html', null)
  semMudanca.registro.atual = { seenKeys: [], contentHash: primeiro.contentHash }

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
  assert.equal(igual.noChange, true)
  assert.equal(chamadas, 0)

  const diferente = await rodar('<p>mudou</p>', semMudanca.api)
  assert.equal(diferente.noChange, undefined)
  assert.equal(chamadas, 1, 'conteúdo alterado dispara exatamente uma execução')
})

test('se a LLM falhar, o checkpoint NÃO avança', async () => {
  const { api, registro } = estado({ seenKeys: [], contentHash: null })
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
  const { api, registro } = estado({ seenKeys: [], contentHash: null })
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
  const { api } = estado({ seenKeys: ['a'], contentHash: null })
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
  assert.equal(out.noChange, true)
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
  assert.equal(out.noChange, undefined)
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
  assert.equal(out.noChange, undefined)
  assert.equal(out.steps[0].output.length, 1)
})

test('NoChange é reconhecível de fora, para quem precisar distinguir', () => {
  const n = new NoChange('motivo')
  assert.ok(n instanceof NoChange)
  assert.equal(n.reason, 'motivo')
})
