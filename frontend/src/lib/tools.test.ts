import { describe, expect, it } from 'vitest'
import { paramsToSchema, schemaToParams } from './tools'

// The form edits fields; the wire format is JSON Schema. A mistake in this mapping
// means the model is told the wrong thing about a tool, so the round trip is
// pinned in both directions.
describe('paramsToSchema', () => {
  it('builds an object schema with required and enum', () => {
    const schema = paramsToSchema([
      { name: 'numero', type: 'string', description: 'Número do pedido', required: true },
      { name: 'canal', type: 'string', description: '', required: false, options: ['site', 'whatsapp'] },
    ])
    expect(schema).toEqual({
      type: 'object',
      properties: {
        numero: { type: 'string', description: 'Número do pedido' },
        canal: { type: 'string', enum: ['site', 'whatsapp'] },
      },
      required: ['numero'],
      additionalProperties: false,
    })
  })

  it('unnamed fields are dropped rather than producing an invalid schema', () => {
    const schema = paramsToSchema([{ name: '  ', type: 'string', description: '', required: true }])
    expect(schema.properties).toEqual({})
    expect(schema.required).toEqual([])
  })

  it('refuses extra properties by default — a model must not invent arguments', () => {
    expect(paramsToSchema([]).additionalProperties).toBe(false)
  })
})

describe('schemaToParams', () => {
  it('round-trips', () => {
    const params = [
      { name: 'numero', type: 'string' as const, description: 'Número', required: true, options: undefined },
      { name: 'qtd', type: 'integer' as const, description: '', required: false, options: undefined },
    ]
    expect(schemaToParams(paramsToSchema(params))).toEqual(params)
  })

  it('an unknown type falls back to string instead of breaking the form', () => {
    const params = schemaToParams({ type: 'object', properties: { x: { type: 'array' } } })
    expect(params[0].type).toBe('string')
  })

  it('an absent or empty schema yields no fields', () => {
    expect(schemaToParams(undefined)).toEqual([])
    expect(schemaToParams({ type: 'object' })).toEqual([])
  })
})
