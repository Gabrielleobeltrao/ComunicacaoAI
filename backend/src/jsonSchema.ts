// A focused JSON Schema validator for TOOL ARGUMENTS.
//
// Scope on purpose: the subset used to describe what a model must provide —
// object/string/number/integer/boolean/array/null, `required`, `enum`, `const`,
// nested `properties` and `items`, `additionalProperties`, plus the obvious
// bounds (minimum/maximum, minLength/maxLength, pattern, minItems/maxItems).
// That is what a tool's parameters need; anything beyond it ($ref, allOf, oneOf,
// remote schemas) is deliberately unsupported rather than half-supported.
//
// Written here instead of pulling in a validator library because the surface is
// this small and every rule below is a test. It never throws: a malformed schema
// yields a validation error, because it runs on the path where a model just
// produced arguments and the request must fail cleanly.

export interface SchemaError {
  // JSON-Pointer-ish path to the offending value ('' = the root).
  path: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: SchemaError[]
}

type Schema = Record<string, unknown>

const typeOf = (v: unknown): string => {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (Number.isInteger(v)) return 'integer' // also reported as 'number' below
  return typeof v
}

// JSON Schema treats integer as a refinement of number.
const matchesType = (value: unknown, expected: string): boolean => {
  const actual = typeOf(value)
  if (expected === 'number') return actual === 'number' || actual === 'integer'
  if (expected === 'integer') return actual === 'integer'
  return actual === expected
}

const join = (path: string, key: string | number) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key)

function validateNode(schema: Schema, value: unknown, path: string, errors: SchemaError[]): void {
  if (!schema || typeof schema !== 'object') return

  // --- type ---------------------------------------------------------------
  const declared = schema.type
  const types = typeof declared === 'string' ? [declared] : Array.isArray(declared) ? declared.filter((t): t is string => typeof t === 'string') : []
  if (types.length > 0 && !types.some((t) => matchesType(value, t))) {
    errors.push({ path, message: `esperado ${types.join(' ou ')}, recebido ${typeOf(value)}` })
    return // a wrong type makes every other check meaningless
  }

  // --- const / enum -------------------------------------------------------
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push({ path, message: `deve ser ${JSON.stringify(schema.const)}` })
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    errors.push({ path, message: `deve ser um de: ${schema.enum.map((o) => JSON.stringify(o)).join(', ')}` })
  }

  // --- string -------------------------------------------------------------
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push({ path, message: `mínimo de ${schema.minLength} caractere(s)` })
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push({ path, message: `máximo de ${schema.maxLength} caractere(s)` })
    }
    if (typeof schema.pattern === 'string') {
      let re: RegExp | null = null
      try {
        re = new RegExp(schema.pattern)
      } catch {
        errors.push({ path, message: 'padrão inválido no schema' })
      }
      if (re && !re.test(value)) errors.push({ path, message: `não corresponde ao padrão ${schema.pattern}` })
    }
  }

  // --- number -------------------------------------------------------------
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push({ path, message: `mínimo ${schema.minimum}` })
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push({ path, message: `máximo ${schema.maximum}` })
  }

  // --- array --------------------------------------------------------------
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push({ path, message: `mínimo de ${schema.minItems} item(ns)` })
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push({ path, message: `máximo de ${schema.maxItems} item(ns)` })
    const items = schema.items
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      value.forEach((entry, i) => validateNode(items as Schema, entry, join(path, i), errors))
    }
  }

  // --- object -------------------------------------------------------------
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    const properties = (schema.properties && typeof schema.properties === 'object' ? schema.properties : {}) as Record<string, Schema>

    for (const name of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof name === 'string' && !(name in obj)) errors.push({ path: join(path, name), message: 'campo obrigatório' })
    }

    for (const [name, child] of Object.entries(properties)) {
      if (name in obj) validateNode(child, obj[name], join(path, name), errors)
    }

    // Default to refusing unknown keys: a model inventing an argument should be
    // told, not silently forwarded to somebody's API.
    if (schema.additionalProperties === false || schema.additionalProperties === undefined) {
      for (const name of Object.keys(obj)) {
        if (!(name in properties)) errors.push({ path: join(path, name), message: 'campo não previsto' })
      }
    }
  }
}

export function validateAgainstSchema(schema: unknown, value: unknown): ValidationResult {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { valid: false, errors: [{ path: '', message: 'schema inválido' }] }
  }
  const errors: SchemaError[] = []
  validateNode(schema as Schema, value, '', errors)
  return { valid: errors.length === 0, errors }
}

// A one-line summary for the model: it must be able to correct itself from this.
export const describeErrors = (errors: SchemaError[]): string =>
  errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('; ')

// Is this a usable schema for tool arguments? Tools must expose an OBJECT at the
// root, because that is what every provider's function-calling API expects.
export function isValidToolSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false
  const s = schema as Schema
  if (s.type !== 'object') return false
  if (s.properties !== undefined && (typeof s.properties !== 'object' || Array.isArray(s.properties))) return false
  if (s.required !== undefined && !Array.isArray(s.required)) return false
  return true
}
