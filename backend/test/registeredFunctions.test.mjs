// As funções registradas: cada uma existe porque a resposta precisa ser EXATA.
//
// Um modelo calculando margem ou conferindo um dígito de CNPJ acerta quase sempre — e
// "quase sempre" numa conta é o pior resultado possível, porque o erro sai com a mesma
// cara do acerto. Estes testes são os casos em que ele erraria.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { executeRegisteredFunction } = await import('../dist/executors/functionExecutor.js')
const { listPublicFunctions } = await import('../dist/executors/functionRegistry.js')

const rodar = async (functionName, input, config) => {
  const r = await executeRegisteredFunction({ kind: 'function', functionName, ...(config ? { config } : {}) }, input)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  return r.structured.data
}
const falha = async (functionName, input, config) => {
  const r = await executeRegisteredFunction({ kind: 'function', functionName, ...(config ? { config } : {}) }, input)
  assert.equal(r.ok, false, 'deveria falhar')
  return r.error.message
}

// --- documentos ---------------------------------------------------------------------------------

test('CPF: o dígito verificador é o ponto — não o formato', async () => {
  // Um modelo aceita isto porque PARECE um CPF. A conta não aceita.
  assert.equal((await rodar('br.cpf', { cpf: '111.111.111-11' })).valido, false)
  assert.equal((await rodar('br.cpf', { cpf: '529.982.247-25' })).valido, true)
  // Um dígito trocado no fim: passa em qualquer olhar, falha na conta.
  assert.equal((await rodar('br.cpf', { cpf: '529.982.247-26' })).valido, false)
})

test('CPF: aceita com ou sem pontuação, e devolve formatado', async () => {
  const ok = await rodar('br.cpf', { cpf: '52998224725' })
  assert.equal(ok.valido, true)
  assert.equal(ok.formatado, '529.982.247-25')
  assert.equal(ok.limpo, '52998224725')
})

test('CNPJ: mesma regra, pesos diferentes', async () => {
  assert.equal((await rodar('br.cnpj', { cnpj: '11.222.333/0001-81' })).valido, true)
  assert.equal((await rodar('br.cnpj', { cnpj: '11.222.333/0001-82' })).valido, false)
  assert.equal((await rodar('br.cnpj', { cnpj: '11.111.111/1111-11' })).motivo, 'todos os dígitos iguais')
  assert.equal((await rodar('br.cnpj', { cnpj: '123' })).motivo, 'esperava 14 dígitos, veio 3')
})

test('CEP: promete FORMATO, e diz que não consulta endereço', async () => {
  // Sem dígito verificador não dá para saber se ele existe. Prometer isso seria mentir; a
  // consulta aos Correios é rede, e rede é assunto de Ferramenta.
  const d = await rodar('br.cep', { cep: '01310100' })
  assert.equal(d.valido, true)
  assert.equal(d.formatado, '01310-100')
  assert.equal(listPublicFunctions().find((f) => f.functionName === 'br.cep').description.includes('Não consulta'), true)
})

test('telefone: separa celular de fixo, e recusa o que não existe', async () => {
  const cel = await rodar('br.telefone', { telefone: '11987654321' })
  assert.deepEqual([cel.valido, cel.celular, cel.formatado], [true, true, '(11) 98765-4321'])

  const fixo = await rodar('br.telefone', { telefone: '(11) 3456-7890' })
  assert.deepEqual([fixo.valido, fixo.celular, fixo.formatado], [true, false, '(11) 3456-7890'])

  // Com o país na frente, que é como um formulário costuma receber.
  assert.equal((await rodar('br.telefone', { telefone: '+55 11 98765-4321' })).valido, true)
  // 11 dígitos que não começam com 9 não são celular brasileiro.
  assert.equal((await rodar('br.telefone', { telefone: '11887654321' })).valido, false)
  assert.equal((await rodar('br.telefone', { telefone: '0987654321' })).motivo, 'DDD inválido: 09')
})

// --- dinheiro ------------------------------------------------------------------------------------

test('margem: lucro e percentual, com arredondamento controlado', async () => {
  const d = await rodar('financeiro.margem', { receita: 200000, custo: 140000 })
  assert.deepEqual(d, { lucro: 60000, margemPercentual: 30 })

  // 1/3 não fecha em decimal. Sem arredondamento explícito, sobra dízima na nota.
  const t = await rodar('financeiro.margem', { receita: 3, custo: 2 })
  assert.equal(t.margemPercentual, 33.33)
  assert.equal((await rodar('financeiro.margem', { receita: 3, custo: 2 }, { casas: 4 })).margemPercentual, 33.3333)
})

test('margem: receita zero é erro, não zero', async () => {
  // Devolver 0 ou 100 seria inventar um número que alguém usaria para decidir.
  assert.match(await falha('financeiro.margem', { receita: 0, custo: 10 }), /não é definida/)
})

test('percentual: calcular, acrescentar e descontar são três coisas', async () => {
  assert.deepEqual(await rodar('financeiro.percentual', { valor: 1000, percentual: 8 }), { parte: 80, total: 80 })
  assert.deepEqual(await rodar('financeiro.percentual', { valor: 1000, percentual: 8, operacao: 'acrescentar' }), { parte: 80, total: 1080 })
  assert.deepEqual(await rodar('financeiro.percentual', { valor: 1000, percentual: 8, operacao: 'descontar' }), { parte: 80, total: 920 })
})

test('percentual: o centavo do arredondamento aparece na conciliação', async () => {
  // 19.99 * 3% = 0.5997. Duas casas: 0.60 — e não 0.59 nem 0.5997.
  assert.equal((await rodar('financeiro.percentual', { valor: 19.99, percentual: 3 })).parte, 0.6)
})

test('conversão: a taxa vem de fora, e zero é recusado', async () => {
  assert.deepEqual(await rodar('financeiro.converter', { valor: 100, taxa: 5.43 }), { convertido: 543 })
  assert.match(await falha('financeiro.converter', { valor: 100, taxa: 0 }), /maior que zero/)
})

// --- faixas ---------------------------------------------------------------------------------------

test('faixa: a regra fica no agente, e a resposta é a mesma toda vez', async () => {
  const cfg = { faixas: '0:baixo, 500:medio, 1000:alto' }
  assert.equal((await rodar('regra.faixa', { valor: 120 }, cfg)).faixa, 'baixo')
  assert.equal((await rodar('regra.faixa', { valor: 500 }, cfg)).faixa, 'medio')
  assert.equal((await rodar('regra.faixa', { valor: 9999 }, cfg)).faixa, 'alto')
  // O corte que decidiu volta junto: sem ele, "medio" não diz por quê.
  assert.equal((await rodar('regra.faixa', { valor: 700 }, cfg)).corte, 500)
})

test('faixa: fora do previsto é erro, e não um rótulo de conveniência', async () => {
  // Quem configurou não previu este caso. Escolher o menor rótulo seria decidir por ele.
  assert.match(await falha('regra.faixa', { valor: -5 }, { faixas: '0:baixo, 500:alto' }), /abaixo do menor corte/)
  assert.match(await falha('regra.faixa', { valor: 1 }, { faixas: 'sem dois pontos' }), /faixa inválida/)
  assert.match(await falha('regra.faixa', { valor: 1 }), /configure as faixas/)
})

test('faixa: a ordem em que foi escrita não importa', async () => {
  assert.equal((await rodar('regra.faixa', { valor: 700 }, { faixas: '1000:alto, 0:baixo, 500:medio' })).faixa, 'medio')
})

// --- datas -------------------------------------------------------------------------------------------

test('diferença: dias entre datas, e se já venceu', async () => {
  const d = await rodar('data.diferenca', { de: '2026-08-01', ate: '2026-08-24' })
  assert.deepEqual([d.dias, d.vencido], [23, false])
  const v = await rodar('data.diferenca', { de: '2026-08-24', ate: '2026-08-01' })
  assert.deepEqual([v.dias, v.vencido], [-23, true])
})

test('as duas escritas de data são aceitas, e a inexistente é recusada', async () => {
  assert.equal((await rodar('data.diferenca', { de: '01/08/2026', ate: '2026-08-24' })).dias, 23)
  // 31 de fevereiro vira 3 de março em silêncio no JavaScript. Aqui não passa.
  assert.match(await falha('data.diferenca', { de: '2026-02-31', ate: '2026-03-01' }), /inexistente/)
  assert.match(await falha('data.diferenca', { de: '24 de agosto', ate: '2026-03-01' }), /AAAA-MM-DD/)
})

test('somar dias: corridos e úteis são contas diferentes', async () => {
  // 2026-08-21 é uma sexta.
  assert.equal((await rodar('data.somar', { data: '2026-08-21', dias: 3 })).data, '2026-08-24')
  const uteis = await rodar('data.somar', { data: '2026-08-21', dias: 3, apenasUteis: true })
  assert.equal(uteis.data, '2026-08-26')
  assert.equal(uteis.diaDaSemana, 'quarta')
})

test('somar dias úteis nunca cai em fim de semana', async () => {
  for (let d = 1; d <= 20; d += 1) {
    const r = await rodar('data.somar', { data: '2026-08-21', dias: d, apenasUteis: true })
    assert.ok(!['sábado', 'domingo'].includes(r.diaDaSemana), `${d} dias úteis caiu em ${r.diaDaSemana}`)
  }
})

test('idade: a referência é OBRIGATÓRIA — a função não lê o relógio', async () => {
  // Sem ela, a mesma entrada daria resposta diferente amanhã, e o determinismo é o motivo
  // de tudo isto existir.
  assert.match(await falha('data.idade', { nascimento: '1990-05-20' }), /referencia/)
  assert.equal((await rodar('data.idade', { nascimento: '1990-05-20', referencia: '2026-05-19' })).anos, 35)
  assert.equal((await rodar('data.idade', { nascimento: '1990-05-20', referencia: '2026-05-20' })).anos, 36)
})

// --- o catálogo inteiro ------------------------------------------------------------------------------

test('nenhuma função lê relógio, rede ou disco', async () => {
  const { readFileSync } = await import('node:fs')
  const fonte = readFileSync('src/executors/functionRegistry.ts', 'utf8')
  for (const proibido of ['Date.now', 'new Date()', 'Math.random', 'fetch(', 'require(']) {
    assert.ok(!fonte.includes(proibido), `o registro não pode conter ${proibido}`)
  }
})

test('toda função tem contrato, teto de tempo e descrição honesta', async () => {
  const funcoes = listPublicFunctions()
  assert.ok(funcoes.length >= 12)
  for (const f of funcoes) {
    assert.equal(f.inputSchema.type, 'object', f.functionName)
    assert.equal(f.outputSchema.type, 'object', f.functionName)
    assert.ok(f.timeoutMs > 0 && f.timeoutMs <= 10_000, f.functionName)
    assert.ok(f.description.length > 10, f.functionName)
    assert.ok(f.capabilities.length > 0, f.functionName)
    assert.equal(f.handler, undefined, 'o código nunca sai para o cliente')
  }
})
