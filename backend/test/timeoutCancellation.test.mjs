// Timeout que CANCELA, e não apenas desiste de esperar.
//
// O defeito: `withTimeout` rejeitava a promessa e a chamada continuava viva. O modelo
// respondia depois, o laço de ferramentas seguia rodando, e uma ESCRITA acontecia quando
// ninguém mais esperava por ela. Com retry ligado, a mesma escrita saía duas vezes — o
// segundo e-mail, a segunda cobrança, o segundo pedido.
//
// A prova aqui é por CONTAGEM: uma ferramenta de escrita que tentaria rodar depois do
// prazo. Ela pode ter executado zero ou uma vez. Duas é o defeito.
import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

// --- um provedor lento, controlável --------------------------------------------------

let comportamento = { atrasoMs: 0, pedeFerramenta: null, respostas: 0 }

class AnthropicFalso {
  messages = {
    create: async (_body, opcoes) => {
      comportamento.respostas += 1
      // O SDK real rejeita quando o sinal aborta; o dublê faz o mesmo, senão testaria
      // um comportamento que a produção não tem.
      if (comportamento.atrasoMs > 0) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, comportamento.atrasoMs)
          opcoes?.signal?.addEventListener?.('abort', () => {
            clearTimeout(t)
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        })
      }
      if (comportamento.pedeFerramenta && comportamento.respostas === 1) {
        return {
          content: [{ type: 'tool_use', id: 't1', name: comportamento.pedeFerramenta, input: {} }],
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: 'tool_use',
        }
      }
      return { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
    },
  }
  models = { list: async () => ({ data: [] }) }
}

mock.module('@anthropic-ai/sdk', { defaultExport: AnthropicFalso })

const { executeAgentTask } = await import('../dist/agentRuntime.js')

beforeEach(() => {
  comportamento = { atrasoMs: 0, pedeFerramenta: null, respostas: 0 }
})

// Uma ferramenta que CONTA quantas vezes executou. É a única testemunha que importa.
const contadora = (name, risk, atrasoMs = 0) => {
  const estado = { execucoes: 0 }
  return {
    tool: {
      name,
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      risk,
      run: async () => {
        estado.execucoes += 1
        if (atrasoMs) await espera(atrasoMs)
        return { ok: true, result: '{}' }
      },
    },
    estado,
  }
}

const rodar = (over = {}) =>
  executeAgentTask({
    objective: 'x',
    instructions: '',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    apiKey: 'k',
    input: 'entrada',
    ...over,
  })

// --- a garantia central ----------------------------------------------------------------

test('escrita que tentaria rodar DEPOIS do timeout executa no máximo uma vez', async () => {
  // O provedor demora MAIS que o prazo — 300 ms contra 100 ms — e, quando responder,
  // pede uma escrita. Com o prazo em 5 s, como estava antes, o timeout nunca disparava e
  // o teste passava sem exercitar nada: media a ausência do problema, não a correção.
  const { tool, estado } = contadora('cobrar', 'write')
  comportamento = { atrasoMs: 300, pedeFerramenta: 'cobrar', respostas: 0 }

  await rodar({ tools: [tool], runConfig: { timeoutMs: 100, retries: 2 } }).catch(() => undefined)
  // Espaço para uma chamada abandonada terminar e tentar executar.
  await espera(500)

  assert.ok(estado.execucoes <= 1, `a escrita executou ${estado.execucoes} vezes`)
})

test('depois do prazo, a tentativa cancelada não inicia ferramenta nenhuma', async () => {
  const { tool, estado } = contadora('cobrar', 'write')
  comportamento = { atrasoMs: 400, pedeFerramenta: 'cobrar', respostas: 0 }

  await rodar({ tools: [tool], runConfig: { timeoutMs: 100, retries: 0 } }).catch(() => undefined)
  await espera(600)

  assert.equal(estado.execucoes, 0, 'a chamada abandonada não pode executar a escrita')
})

test('o erro devolvido é timeout, e não outra coisa', async () => {
  comportamento = { atrasoMs: 400, pedeFerramenta: null, respostas: 0 }
  await assert.rejects(() => rodar({ runConfig: { timeoutMs: 100, retries: 0 } }), (e) => {
    assert.equal(e.kind, 'timeout')
    return true
  })
})

// --- retry depois de uma escrita ------------------------------------------------------------

test('uma vez que a ESCRITA começou, não há nova tentativa', async () => {
  // Nem em timeout — que é justamente quando não se sabe se ela completou do outro lado.
  const { tool, estado } = contadora('cobrar', 'write', 400)
  comportamento = { atrasoMs: 0, pedeFerramenta: 'cobrar', respostas: 0 }

  await rodar({ tools: [tool], runConfig: { timeoutMs: 100, retries: 3 } }).catch(() => undefined)
  await espera(600)

  assert.equal(estado.execucoes, 1, 'a escrita começou uma vez e não pode ser repetida')
})

test('ação de risco alto segue a mesma regra da escrita', async () => {
  const { tool, estado } = contadora('transferir', 'high_risk', 400)
  comportamento = { atrasoMs: 0, pedeFerramenta: 'transferir', respostas: 0 }

  await rodar({ tools: [tool], runConfig: { timeoutMs: 100, retries: 3 } }).catch(() => undefined)
  await espera(600)

  assert.equal(estado.execucoes, 1)
})

test('ferramenta sem risco declarado é tratada como escrita', async () => {
  // Falhar para o lado conservador: quem não disse o que faz não ganha nova tentativa.
  const { tool, estado } = contadora('desconhecida', undefined, 400)
  comportamento = { atrasoMs: 0, pedeFerramenta: 'desconhecida', respostas: 0 }

  await rodar({ tools: [tool], runConfig: { timeoutMs: 100, retries: 3 } }).catch(() => undefined)
  await espera(600)

  assert.equal(estado.execucoes, 1)
})

// --- leitura pode repetir ---------------------------------------------------------------------

test('uma LEITURA não impede nova tentativa: repetir uma consulta não muda nada', async () => {
  const { tool } = contadora('consultar', 'read')
  // O provedor falha com um erro transitório depois de a leitura ter rodado.
  let chamadas = 0
  comportamento = { atrasoMs: 0, pedeFerramenta: null, respostas: 0 }
  const falho = {
    ...tool,
    run: async () => ({ ok: true, result: '{}' }),
  }
  const replyFalho = async () => {
    chamadas += 1
    if (chamadas === 1) throw Object.assign(new Error('sobrecarga'), { status: 503 })
    return { text: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
  }

  const r = await executeAgentTask(
    { objective: 'x', instructions: '', provider: 'anthropic', model: 'm', apiKey: 'k', tools: [falho], runConfig: { retries: 1 } },
    replyFalho,
  )
  assert.equal(chamadas, 2, 'o 503 é transitório e a tentativa seguinte acontece')
  assert.equal(r.output, 'ok')
})

test('sem prazo configurado, nada é cancelado — o comportamento de antes', async () => {
  const { tool, estado } = contadora('consultar', 'read')
  comportamento = { atrasoMs: 50, pedeFerramenta: 'consultar', respostas: 0 }

  const r = await rodar({ tools: [tool] })
  assert.equal(estado.execucoes, 1)
  assert.equal(r.output, 'ok')
})
