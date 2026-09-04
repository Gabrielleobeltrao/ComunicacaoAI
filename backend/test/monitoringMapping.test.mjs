// O EXTRATOR — dado descrevendo dado, e nenhuma linha de código do usuário.
//
// A tentação óbvia é aceitar uma expressão: "só um JSONPath completo", "só uma function de
// mapeamento". As duas viram execução de código de terceiro dentro do processo que tem o
// banco. Estes casos protegem a fronteira: caminho fechado, transformações de uma lista
// fixa, e a amostra que a tela mostra sem mostrar segredo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyMapping, applyTransforms, parseNumber, readPath, redactSample, validateMapping, MappingError } from '../dist/monitoring/mapping.js'

// --- o caminho ------------------------------------------------------------------------

test('lê caminho com ponto e índice', () => {
  const doc = { dados: { itens: [{ preco: 10 }, { preco: 20 }] } }
  assert.equal(readPath(doc, 'dados.itens[1].preco'), 20)
  assert.equal(readPath(doc, 'dados.itens[9].preco'), undefined)
  assert.equal(readPath(doc, 'nao.existe'), undefined)
})

test('o caminho NÃO alcança o protótipo', () => {
  // Aceitar `__proto__` aqui seria transformar leitura de dado em execução.
  assert.throws(() => readPath({}, '__proto__.x'), MappingError)
  assert.throws(() => readPath({}, 'constructor.prototype'), MappingError)
  assert.throws(() => readPath({}, 'a.prototype'), MappingError)
})

test('caminho com fundo demais é recusado', () => {
  assert.throws(() => readPath({}, 'a.'.repeat(20) + 'b'), /fundo demais/)
})

test('trecho que não é identificador é recusado, e não interpretado', () => {
  assert.throws(() => readPath({}, 'a["b"]'), MappingError)
  assert.throws(() => readPath({}, 'a-b'), MappingError)
  assert.throws(() => readPath({}, 'a[*]'), MappingError)
})

// --- as transformações ------------------------------------------------------------------

test('ausente NÃO vira zero', () => {
  // É o mesmo defeito que o monitor já corrigiu uma vez: `Number(null)` é 0, e um campo
  // que sumiu viraria um número que dispara alarme.
  assert.equal(applyTransforms(null, [{ op: 'number' }]), null)
  assert.equal(applyTransforms('', [{ op: 'number' }]), null)
  assert.equal(applyTransforms(undefined, [{ op: 'number' }]), null)
  assert.equal(applyTransforms('não é número', [{ op: 'number' }]), null)
})

test('número aceita o formato que a web devolve — quando ele não é ambíguo', () => {
  assert.equal(applyTransforms('R$ 1.234,56', [{ op: 'number' }]), 1234.56)
  assert.equal(applyTransforms('42', [{ op: 'number' }]), 42)
  assert.equal(applyTransforms('-3.5', [{ op: 'number' }]), -3.5)
  // E recusa o que é: ver o caso do separador ambíguo mais abaixo.
  assert.equal(applyTransforms('1.234', [{ op: 'number' }]), null)
})

test('replace é literal, nunca expressão regular', () => {
  // Uma regex vinda de fora é um travamento esperando acontecer.
  assert.equal(applyTransforms('a.b.c', [{ op: 'replace', find: '.', with: '-' }]), 'a-b-c')
  assert.equal(applyTransforms('aaa', [{ op: 'replace', find: '(a+)+$', with: 'x' }]), 'aaa')
})

test('data inválida vira null em vez de uma data errada', () => {
  assert.equal(applyTransforms('ontem', [{ op: 'date' }]), null)
  assert.equal(applyTransforms('2026-01-02T03:04:05.000Z', [{ op: 'date' }]), '2026-01-02T03:04:05.000Z')
})

test('default só preenche o que está vazio', () => {
  assert.equal(applyTransforms(null, [{ op: 'default', value: 7 }]), 7)
  assert.equal(applyTransforms(0, [{ op: 'default', value: 7 }]), 0, 'zero é um valor, não uma ausência')
})

test('a cadeia de transformações tem teto', () => {
  const muitas = Array.from({ length: 30 }, () => ({ op: 'trim' }))
  assert.equal(applyTransforms('  x  ', muitas), 'x')
})

// --- a validação do mapeamento -------------------------------------------------------------

test('mapeamento sem campo é recusado', () => {
  assert.throws(() => validateMapping({ fields: [] }), /ao menos um campo/)
})

test('nome de destino inválido é recusado', () => {
  assert.throws(() => validateMapping({ fields: [{ to: 'a-b', from: 'x' }] }), /nome de campo válido/)
  assert.throws(() => validateMapping({ fields: [{ to: '__proto__', from: 'x' }] }), /nome de campo válido/)
})

test('campo mapeado duas vezes é recusado', () => {
  assert.throws(() => validateMapping({ fields: [{ to: 'a', from: 'x' }, { to: 'a', from: 'y' }] }), /duas vezes/)
})

test('caminho inválido é pego na validação, e não na primeira leitura', () => {
  // Uma fonte que nasce quebrada e só avisa quando ninguém está olhando é pior do que uma
  // que não nasce.
  assert.throws(() => validateMapping({ fields: [{ to: 'a', from: '__proto__.x' }] }), MappingError)
})

test('a versão do mapeamento é preservada', () => {
  assert.equal(validateMapping({ version: 3, fields: [{ to: 'a', from: 'x' }] }).version, 3)
  assert.equal(validateMapping({ fields: [{ to: 'a', from: 'x' }] }).version, 1)
})

// --- aplicar --------------------------------------------------------------------------------------

test('mapeia um objeto só', () => {
  const r = applyMapping({ dados: { preco: '10,50', nome: '  ACME  ' } }, {
    version: 1,
    fields: [
      { to: 'preco', from: 'dados.preco', transforms: [{ op: 'number' }] },
      { to: 'nome', from: 'dados.nome', transforms: [{ op: 'trim' }] },
    ],
  })
  assert.deepEqual(r.rows, [{ preco: 10.5, nome: 'ACME' }])
  assert.deepEqual(r.missing, [])
})

test('mapeia uma lista pelo itemsPath', () => {
  const r = applyMapping({ items: [{ v: 1 }, { v: 2 }] }, { version: 1, itemsPath: 'items', fields: [{ to: 'valor', from: 'v' }] })
  assert.deepEqual(r.rows, [{ valor: 1 }, { valor: 2 }])
})

test('campo obrigatório que não veio é REPORTADO, e não inventado', () => {
  const r = applyMapping({ a: 1 }, { version: 1, fields: [{ to: 'b', from: 'b', required: true }] })
  assert.deepEqual(r.missing, ['b'])
  assert.equal(r.rows[0].b, null)
})

test('a versão do mapeamento viaja com o resultado', () => {
  const r = applyMapping({ a: 1 }, { version: 9, fields: [{ to: 'a', from: 'a' }] })
  assert.equal(r.mappingVersion, 9)
})

// --- a amostra redigida ------------------------------------------------------------------------------

test('a amostra oculta o que tem NOME de segredo', () => {
  const r = redactSample({ apiKey: 'abc123', Authorization: 'Bearer x', preco: 10, email: 'a@b.c' })
  assert.equal(r.apiKey, '«oculto»')
  assert.equal(r.Authorization, '«oculto»')
  assert.equal(r.email, '«oculto»')
  assert.equal(r.preco, 10, 'o que não é segredo continua visível — a amostra existe para conferir')
})

test('a amostra oculta o que PARECE credencial mesmo com nome inocente', () => {
  const r = redactSample({ valor: 'Bearer abcdefghijklmno', outro: 'sk-abcdefghijklmnop' })
  assert.equal(r.valor, '«oculto»')
  assert.equal(r.outro, '«oculto»')
})

test('a amostra corta texto longo e lista grande — ela mostra a FORMA', () => {
  const r = redactSample({ texto: 'x'.repeat(500), lista: [1, 2, 3, 4, 5] })
  assert.ok(r.texto.endsWith('…'))
  assert.equal(r.lista.length, 3)
})

test('a amostra não entra em profundidade infinita', () => {
  const fundo = { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } }
  assert.doesNotThrow(() => JSON.stringify(redactSample(fundo)))
})

// --- a lista de transformações é CONFERIDA, não só declarada ---------------------------

test('transformação desconhecida é recusada, e não ignorada em silêncio', () => {
  // Ignorar faria o mapeamento parecer que transformou quando não transformou — e o erro
  // apareceria como número estranho numa série, semanas depois.
  assert.throws(() => validateMapping({ fields: [{ to: 'a', from: 'x', transforms: [{ op: 'exec' }] }] }), /transformação desconhecida/)
  assert.throws(() => validateMapping({ fields: [{ to: 'a', from: 'x', transforms: [{}] }] }), /transformação desconhecida/)
  assert.throws(() => validateMapping({ fields: [{ to: 'a', from: 'x', transforms: 'trim' }] }), /precisam ser uma lista/)
})

test('cada transformação precisa dos parâmetros dela', () => {
  assert.throws(() => validateMapping({ fields: [{ to: 'a', from: 'x', transforms: [{ op: 'join' }] }] }), /separador/)
  assert.throws(() => validateMapping({ fields: [{ to: 'a', from: 'x', transforms: [{ op: 'replace', find: '' }] }] }), /texto a procurar/)
  assert.throws(() => validateMapping({ fields: [{ to: 'a', from: 'x', transforms: [{ op: 'default', value: { a: 1 } }] }] }), /valor simples/)
  assert.throws(() => validateMapping({ fields: [{ to: 'a', from: 'x', transforms: [{ op: 'number', locale: 'de-DE' }] }] }), /pt-BR ou en-US/)
})

test('transformações demais são recusadas', () => {
  const muitas = Array.from({ length: 20 }, () => ({ op: 'trim' }))
  assert.throws(() => validateMapping({ fields: [{ to: 'a', from: 'x', transforms: muitas }] }), /demais/)
})

test('o DESTINO é mais apertado que a origem: sem `$`', () => {
  // A chave de saída vira campo de um documento do Mongo, e `$` é lido como operador.
  assert.throws(() => validateMapping({ fields: [{ to: '$set', from: 'x' }] }), /nome de campo válido/)
  // Na ORIGEM ele é aceito: APIs usam `$id`, e ler não é escrever.
  assert.doesNotThrow(() => validateMapping({ fields: [{ to: 'id', from: '$id' }] }))
})

test('a versão do mapeamento é um inteiro positivo', () => {
  assert.throws(() => validateMapping({ version: 1.5, fields: [{ to: 'a', from: 'x' }] }), /inteiro positivo/)
  assert.throws(() => validateMapping({ version: 0, fields: [{ to: 'a', from: 'x' }] }), /inteiro positivo/)
  assert.throws(() => validateMapping({ version: -2, fields: [{ to: 'a', from: 'x' }] }), /inteiro positivo/)
  assert.equal(validateMapping({ version: 7, fields: [{ to: 'a', from: 'x' }] }).version, 7)
})

// --- o número não é adivinhado -----------------------------------------------------------

test('separador AMBÍGUO sem formato declarado é recusado, não chutado', () => {
  // "1.234" é mil em pt-BR e um-vírgula-dois em en-US. Chutar acerta metade das vezes, e a
  // metade errada vira alarme de madrugada sobre um valor mil vezes maior.
  assert.equal(parseNumber('1.234'), null)
  assert.equal(parseNumber('1,234'), null)
})

test('com o formato DITO, os dois lados funcionam', () => {
  assert.equal(parseNumber('1.234', 'pt-BR'), 1234)
  assert.equal(parseNumber('1.234', 'en-US'), 1.234)
  assert.equal(parseNumber('1.234,56', 'pt-BR'), 1234.56)
  assert.equal(parseNumber('1,234.56', 'en-US'), 1234.56)
})

test('o que NÃO é ambíguo passa sem formato declarado', () => {
  assert.equal(parseNumber('42'), 42)
  assert.equal(parseNumber('1.5'), 1.5)
  assert.equal(parseNumber('R$ 10,50'), 10.5)
  assert.equal(parseNumber('1.234.567'), 1234567, 'três pontos só podem ser milhar')
  assert.equal(parseNumber('1.234,56'), 1234.56, 'os dois separadores presentes: o último é o decimal')
})

// --- os tetos de tamanho --------------------------------------------------------------------

test('valor gigante é CORTADO, e o corte é dito', () => {
  const r = applyMapping({ texto: 'x'.repeat(20_000) }, { version: 1, fields: [{ to: 'texto', from: 'texto' }] })
  assert.equal(r.rows[0].texto.length, 8_000)
  assert.deepEqual(r.truncated, ['texto'])
})

test('objeto gigante num campo vira null, e não dez megabytes por linha', () => {
  const enorme = { lista: Array.from({ length: 5_000 }, (_, i) => ({ i, txt: 'abcdefghij' })) }
  const r = applyMapping({ campo: enorme }, { version: 1, fields: [{ to: 'campo', from: 'campo' }] })
  assert.equal(r.rows[0].campo, null)
  assert.deepEqual(r.truncated, ['campo'])
})

test('a leitura inteira tem orçamento: não são 500 linhas gigantes', () => {
  const itens = Array.from({ length: 500 }, () => ({ t: 'y'.repeat(7_000) }))
  const r = applyMapping({ itens }, { version: 1, itemsPath: 'itens', fields: [{ to: 't', from: 't' }] })
  assert.ok(r.rows.length < 500, `veio ${r.rows.length}`)
  assert.ok(r.rows.length > 0, 'o orçamento corta, não zera')
})
