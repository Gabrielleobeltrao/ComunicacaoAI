import { useMemo, useState } from 'react'

// O contrato de um agente, escrito à mão — com a rede embaixo.
//
// Um JSON Schema digitado numa área de texto falha de três jeitos, e os três eram
// invisíveis até alguém salvar: vírgula sobrando, chave errada e — o pior — um schema
// sintaticamente perfeito que descreve outra coisa. O terceiro não dá erro nenhum; ele
// só faz o agente recusar entradas boas em produção.
//
// Por isso a caixa faz três coisas além de guardar texto: valida enquanto se escreve e
// diz ONDE, formata (que é como se enxerga um aninhamento errado), e mostra o schema de
// volta em português — "cnpj, texto, obrigatório". Ler a frase é o que denuncia o schema
// que está certo e descreve o contrato errado.

/** Os tipos que o validador do servidor entende. Oferecer mais aqui seria prometer demais. */
const TIPOS = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']

const TEMPLATES: { nome: string; schema: unknown }[] = [
  {
    nome: 'Campos simples',
    schema: {
      type: 'object',
      properties: { titulo: { type: 'string' }, quantidade: { type: 'number' } },
      required: ['titulo'],
    },
  },
  {
    nome: 'Lista de itens',
    schema: {
      type: 'object',
      properties: { itens: { type: 'array', items: { type: 'object', properties: { nome: { type: 'string' } } } } },
      required: ['itens'],
    },
  },
  {
    nome: 'Resultado com fonte',
    schema: {
      type: 'object',
      properties: { valor: { type: 'number' }, unidade: { type: 'string' }, fonte: { type: 'string' }, data: { type: 'string' } },
      required: ['valor', 'fonte'],
    },
  },
]

export interface SchemaProblem {
  path: string
  message: string
}

/**
 * O que há de errado com este schema — pelo CAMINHO, não "está inválido".
 *
 * O mesmo subconjunto que o validador do servidor implementa. Aceitar aqui o que ele
 * recusa lá seria deixar o dono salvar um contrato que nunca vai valer.
 */
export function checkSchema(texto: string): { problems: SchemaProblem[]; parsed: Record<string, unknown> | null } {
  const limpo = texto.trim()
  if (!limpo) return { problems: [], parsed: null }
  let bruto: unknown
  try {
    bruto = JSON.parse(limpo)
  } catch (erro) {
    return { problems: [{ path: '', message: erro instanceof Error ? erro.message : 'não é JSON válido' }], parsed: null }
  }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return { problems: [{ path: '', message: 'o schema precisa ser um objeto' }], parsed: null }
  }
  const s = bruto as Record<string, unknown>
  const problems: SchemaProblem[] = []
  // Raiz do tipo `object`: é o que todo provedor de function calling espera, e é o que o
  // validador do servidor exige. Um schema com raiz `array` passa aqui e falha lá.
  if (s.type !== 'object') problems.push({ path: 'type', message: 'a raiz precisa ser "object"' })
  const props = s.properties
  if (props !== undefined && (typeof props !== 'object' || props === null || Array.isArray(props))) {
    problems.push({ path: 'properties', message: 'properties precisa ser um objeto' })
  }
  const campos = props && typeof props === 'object' && !Array.isArray(props) ? (props as Record<string, unknown>) : {}
  for (const [nome, def] of Object.entries(campos)) {
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
      problems.push({ path: `properties.${nome}`, message: 'cada campo precisa ser um objeto' })
      continue
    }
    const tipo = (def as { type?: unknown }).type
    if (tipo === undefined) problems.push({ path: `properties.${nome}`, message: 'falta o "type"' })
    else if (typeof tipo !== 'string' || !TIPOS.includes(tipo)) {
      problems.push({ path: `properties.${nome}.type`, message: `tipo desconhecido; use ${TIPOS.join(', ')}` })
    }
  }
  const required = s.required
  if (required !== undefined) {
    if (!Array.isArray(required)) problems.push({ path: 'required', message: 'required precisa ser uma lista de nomes' })
    else {
      for (const nome of required) {
        if (typeof nome !== 'string') {
          problems.push({ path: 'required', message: 'cada obrigatório é o NOME de um campo' })
          continue
        }
        // O erro que passa despercebido: exigir um campo que não existe em `properties`.
        // O schema é válido, e nenhuma entrada jamais o satisfaz.
        if (!(nome in campos)) problems.push({ path: `required.${nome}`, message: `"${nome}" é exigido e não está em properties` })
      }
    }
  }
  return { problems, parsed: problems.length === 0 ? s : null }
}

/** O schema em português. Ler isto é o que denuncia o contrato certo na sintaxe e errado no conteúdo. */
export function describeSchema(schema: Record<string, unknown> | null): { campo: string; tipo: string; obrigatorio: boolean }[] {
  const props = schema?.properties
  if (!props || typeof props !== 'object' || Array.isArray(props)) return []
  const required = new Set(Array.isArray(schema?.required) ? (schema!.required as unknown[]).filter((x): x is string => typeof x === 'string') : [])
  return Object.entries(props as Record<string, unknown>).map(([campo, def]) => ({
    campo,
    tipo: String((def as { type?: unknown })?.type ?? '?'),
    obrigatorio: required.has(campo),
  }))
}

export function JsonSchemaEditor({
  label,
  hint,
  value,
  onChange,
  testId,
  readOnly,
  readOnlyReason,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  testId: string
  /**
   * O contrato de uma FUNÇÃO não se edita aqui.
   *
   * Ele vem do registro do servidor, que é quem executa. Deixar editar criaria duas
   * verdades sobre o que a função aceita: a do formulário e a do código que roda. Elas
   * começam iguais e divergem na primeira mudança — e a errada é descoberta em produção.
   */
  readOnly?: boolean
  readOnlyReason?: string
}) {
  const [aberto, setAberto] = useState(false)
  const { problems, parsed } = useMemo(() => checkSchema(value), [value])
  const resumo = useMemo(() => describeSchema(parsed), [parsed])

  const formatar = () => {
    try {
      onChange(JSON.stringify(JSON.parse(value), null, 2))
    } catch {
      // Formatar um texto que não é JSON não tem o que fazer — e o erro já está na tela.
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm text-(--text-muted)" htmlFor={testId}>
          {label}
        </label>
        <div className={`flex flex-wrap gap-2 ${readOnly ? 'hidden' : ''}`}>
          <button
            type="button"
            onClick={formatar}
            disabled={!value.trim()}
            className="rounded-md border border-(--border-subtle) px-2 py-1 text-xs text-(--text-muted) disabled:opacity-40"
            data-testid={`${testId}-format`}
          >
            Formatar
          </button>
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            className="rounded-md border border-(--border-subtle) px-2 py-1 text-xs text-(--text-muted)"
            aria-expanded={aberto}
            data-testid={`${testId}-templates`}
          >
            Modelos
          </button>
        </div>
      </div>
      {aberto && (
        <div className="flex flex-wrap gap-2" data-testid={`${testId}-template-list`}>
          {TEMPLATES.map((t) => (
            <button
              key={t.nome}
              type="button"
              onClick={() => {
                onChange(JSON.stringify(t.schema, null, 2))
                setAberto(false)
              }}
              className="rounded-md border border-(--border-subtle) px-2 py-1 text-xs text-(--text-muted) hover:border-(--border-strong)"
            >
              {t.nome}
            </button>
          ))}
        </div>
      )}
      <textarea
        id={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        rows={7}
        spellCheck={false}
        aria-readonly={readOnly}
        aria-invalid={!readOnly && problems.length > 0}
        aria-describedby={problems.length > 0 ? `${testId}-erros` : undefined}
        placeholder={'{\n  "type": "object",\n  "properties": { "cnpj": { "type": "string" } },\n  "required": ["cnpj"]\n}'}
        className={`w-full rounded-lg border border-(--border-strong) px-3 py-2 font-mono text-xs outline-none focus:border-(--border-focus) ${
          readOnly ? 'bg-(--surface-sunken) text-(--text-muted)' : 'bg-(--surface-card)'
        }`}
        data-testid={testId}
      />
      {readOnly && readOnlyReason ? (
        <p className="text-xs text-(--text-faint)" data-testid={`${testId}-readonly`}>
          {readOnlyReason}
        </p>
      ) : problems.length > 0 ? (
        <ul id={`${testId}-erros`} className="space-y-1 text-xs" style={{ color: 'var(--status-blocked)' }} data-testid={`${testId}-errors`}>
          {problems.map((p, i) => (
            <li key={`${p.path}-${i}`}>{p.path ? `${p.path}: ${p.message}` : p.message}</li>
          ))}
        </ul>
      ) : resumo.length > 0 ? (
        <div className="rounded-lg border border-(--border-subtle) p-2" data-testid={`${testId}-summary`}>
          <p className="mb-1 text-xs text-(--text-faint)">Este contrato pede:</p>
          <ul className="space-y-0.5 text-xs text-(--text-muted)">
            {resumo.map((c) => (
              <li key={c.campo}>
                <span className="font-mono">{c.campo}</span> · {c.tipo}
                {c.obrigatorio ? ' · obrigatório' : ' · opcional'}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-(--text-faint)">{hint}</p>
      )}
    </div>
  )
}
