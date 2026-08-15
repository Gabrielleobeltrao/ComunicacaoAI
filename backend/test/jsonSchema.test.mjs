// Tool arguments are produced by a MODEL, so validation is the boundary between
// "the model guessed" and "we called somebody's API with it". Pure — no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { validateAgainstSchema, describeErrors, isValidToolSchema } = await import('../dist/jsonSchema.js')

const ok = (schema, value) => assert.equal(validateAgainstSchema(schema, value).valid, true, describeErrors(validateAgainstSchema(schema, value).errors))
const bad = (schema, value) => {
  const r = validateAgainstSchema(schema, value)
  assert.equal(r.valid, false, `should have been rejected: ${JSON.stringify(value)}`)
  assert.ok(r.errors.length > 0)
  return r
}

const orderSchema = {
  type: 'object',
  properties: {
    numero: { type: 'string', description: 'Número do pedido' },
    incluirItens: { type: 'boolean' },
    canal: { type: 'string', enum: ['site', 'whatsapp'] },
  },
  required: ['numero'],
}

test('a valid argument object passes', () => {
  ok(orderSchema, { numero: 'A-1' })
  ok(orderSchema, { numero: 'A-1', incluirItens: true, canal: 'site' })
})

test('a missing required field is reported by name', () => {
  const r = bad(orderSchema, { incluirItens: true })
  assert.equal(r.errors[0].path, 'numero')
  assert.match(r.errors[0].message, /obrigat/)
})

test('a wrong type is reported with what was received', () => {
  const r = bad(orderSchema, { numero: 42 })
  assert.match(describeErrors(r.errors), /numero.*esperado string.*recebido (integer|number)/)
})

test('a value outside the enum is refused and the options are listed', () => {
  const r = bad(orderSchema, { numero: 'A-1', canal: 'telegrama' })
  assert.match(describeErrors(r.errors), /"site".*"whatsapp"/)
})

test('an unforeseen field is refused — a model must not invent arguments', () => {
  const r = bad(orderSchema, { numero: 'A-1', deleteEverything: true })
  assert.match(describeErrors(r.errors), /deleteEverything.*não previsto/)
})

test('additionalProperties: true allows extra fields', () => {
  ok({ ...orderSchema, additionalProperties: true }, { numero: 'A-1', extra: 1 })
})

test('integer vs number', () => {
  ok({ type: 'object', properties: { n: { type: 'integer' } } }, { n: 3 })
  bad({ type: 'object', properties: { n: { type: 'integer' } } }, { n: 3.5 })
  // An integer IS a valid number.
  ok({ type: 'object', properties: { n: { type: 'number' } } }, { n: 3 })
  ok({ type: 'object', properties: { n: { type: 'number' } } }, { n: 3.5 })
})

test('numeric bounds', () => {
  const schema = { type: 'object', properties: { q: { type: 'number', minimum: 1, maximum: 10 } } }
  ok(schema, { q: 5 })
  bad(schema, { q: 0 })
  bad(schema, { q: 11 })
})

test('string length and pattern', () => {
  const schema = { type: 'object', properties: { cep: { type: 'string', minLength: 8, maxLength: 8, pattern: '^\\d{8}$' } } }
  ok(schema, { cep: '01310100' })
  bad(schema, { cep: '0131' })
  bad(schema, { cep: 'abcdefgh' })
})

test('an invalid pattern in the SCHEMA is an error, not a crash', () => {
  const r = bad({ type: 'object', properties: { s: { type: 'string', pattern: '([' } } }, { s: 'x' })
  assert.match(describeErrors(r.errors), /padrão inválido/)
})

test('nested objects and arrays are validated element by element', () => {
  const schema = {
    type: 'object',
    properties: {
      cliente: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] },
      itens: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] }, minItems: 1 },
    },
    required: ['cliente'],
  }
  ok(schema, { cliente: { nome: 'Ana' }, itens: [{ sku: 'A' }] })

  const missing = bad(schema, { cliente: {} })
  assert.match(describeErrors(missing.errors), /cliente\.nome/)

  const badItem = bad(schema, { cliente: { nome: 'Ana' }, itens: [{ sku: 'A' }, { nope: 1 }] })
  assert.match(describeErrors(badItem.errors), /itens\[1\]/)

  bad(schema, { cliente: { nome: 'Ana' }, itens: [] }) // minItems
})

test('null is a type of its own', () => {
  ok({ type: 'object', properties: { x: { type: 'null' } } }, { x: null })
  bad({ type: 'object', properties: { x: { type: 'string' } } }, { x: null })
  // A union type accepts either.
  ok({ type: 'object', properties: { x: { type: ['string', 'null'] } } }, { x: null })
})

test('a malformed schema fails validation instead of throwing', () => {
  assert.equal(validateAgainstSchema(null, {}).valid, false)
  assert.equal(validateAgainstSchema('nope', {}).valid, false)
  assert.equal(validateAgainstSchema([], {}).valid, false)
})

test('isValidToolSchema demands an object at the root', () => {
  assert.equal(isValidToolSchema({ type: 'object', properties: {} }), true)
  assert.equal(isValidToolSchema({ type: 'string' }), false, 'providers require an object of arguments')
  assert.equal(isValidToolSchema({ type: 'object', properties: [] }), false)
  assert.equal(isValidToolSchema({ type: 'object', required: 'numero' }), false)
  assert.equal(isValidToolSchema(null), false)
})
