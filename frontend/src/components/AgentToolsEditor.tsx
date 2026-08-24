import type { AgentTool, ToolMethod, ToolParamType } from '../lib/types'

const inputClass =
  'w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)'
const miniInput =
  'min-w-0 rounded border border-(--border-strong) bg-(--surface-card) px-2 py-1 text-xs outline-none focus:border-(--border-focus)'

// Controlled editor for an agent's custom HTTP tools.
export function AgentToolsEditor({
  value,
  onChange,
}: {
  value: AgentTool[]
  onChange: (tools: AgentTool[]) => void
}) {
  const update = (index: number, patch: Partial<AgentTool>) =>
    onChange(value.map((t, i) => (i === index ? { ...t, ...patch } : t)))

  const addTool = () =>
    onChange([...value, { name: '', description: '', method: 'POST', url: '', headers: [], parameters: [] }])

  return (
    <div className="space-y-3">
      {/* A seção "O que ele aciona" já diz que isto é o que ele pode chamar. O que falta
          é o que só vale aqui: o modelo escolhe sozinho, pelo nome e pela descrição. */}
      <p className="text-sm text-(--text-muted)">
        Uma API sua, que o modelo decide chamar sozinho — pelo nome e pela descrição que você der.
      </p>

      {value.length === 0 && <p className="text-sm text-(--text-faint)">Nenhuma ferramenta ainda.</p>}

      {value.map((tool, ti) => (
        <div key={ti} className="space-y-2 rounded-lg border border-(--border-subtle) p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Ferramenta {ti + 1}</p>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, i) => i !== ti))}
              className="text-xs text-(--coral-600) underline transition hover:text-(--coral-600)"
            >
              Remover
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_7rem]">
            <input
              value={tool.name}
              onChange={(e) => update(ti, { name: e.target.value })}
              placeholder="checar_disponibilidade"
              className={inputClass}
            />
            <select
              value={tool.method}
              onChange={(e) => update(ti, { method: e.target.value as ToolMethod })}
              className={inputClass}
            >
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </select>
          </div>
          <input
            value={tool.url}
            onChange={(e) => update(ti, { url: e.target.value })}
            placeholder="https://sua-api.com/endpoint"
            className={inputClass}
          />
          <textarea
            value={tool.description}
            onChange={(e) => update(ti, { description: e.target.value })}
            rows={2}
            placeholder="O que a ferramenta faz e quando usá-la (o modelo lê isto)"
            className={inputClass}
          />

          <div className="rounded-lg border border-(--border-subtle)/70 bg-(--surface-card)/40 p-2">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-(--text-faint)">
              Parâmetros{' '}
              <span className="normal-case tracking-normal text-(--text-faint)">
                ({tool.method === 'GET' ? 'viram query na URL' : 'vão no corpo JSON'})
              </span>
            </p>
            {tool.parameters.length === 0 && <p className="text-xs text-(--text-faint)">Sem parâmetros.</p>}
            <div className="space-y-1.5">
              {tool.parameters.map((p, pi) => (
                <div key={pi} className="flex flex-wrap items-center gap-1.5">
                  <input
                    value={p.name}
                    onChange={(e) =>
                      update(ti, {
                        parameters: tool.parameters.map((x, i) => (i === pi ? { ...x, name: e.target.value } : x)),
                      })
                    }
                    placeholder="nome"
                    className={`${miniInput} w-24 flex-1`}
                  />
                  <select
                    value={p.type}
                    onChange={(e) =>
                      update(ti, {
                        parameters: tool.parameters.map((x, i) =>
                          i === pi ? { ...x, type: e.target.value as ToolParamType } : x,
                        ),
                      })
                    }
                    className={miniInput}
                  >
                    <option value="string">texto</option>
                    <option value="number">número</option>
                    <option value="boolean">sim/não</option>
                  </select>
                  <input
                    value={p.description}
                    onChange={(e) =>
                      update(ti, {
                        parameters: tool.parameters.map((x, i) =>
                          i === pi ? { ...x, description: e.target.value } : x,
                        ),
                      })
                    }
                    placeholder="descrição"
                    className={`${miniInput} w-32 flex-[2]`}
                  />
                  <label className="flex items-center gap-1 text-xs text-(--text-muted)">
                    <input
                      type="checkbox"
                      checked={p.required}
                      onChange={(e) =>
                        update(ti, {
                          parameters: tool.parameters.map((x, i) =>
                            i === pi ? { ...x, required: e.target.checked } : x,
                          ),
                        })
                      }
                    />
                    obrig.
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      update(ti, { parameters: tool.parameters.filter((_, i) => i !== pi) })
                    }
                    className="px-1 text-sm text-(--coral-600) transition hover:text-(--coral-600)"
                    aria-label="Remover parâmetro"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                update(ti, {
                  parameters: [...tool.parameters, { name: '', type: 'string', description: '', required: false }],
                })
              }
              className="mt-1 text-xs text-(--text-muted) underline transition hover:text-(--text-heading)"
            >
              + parâmetro
            </button>
          </div>

          <div className="rounded-lg border border-(--border-subtle)/70 bg-(--surface-card)/40 p-2">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-(--text-faint)">
              Headers (opcional)
            </p>
            {tool.headers.map((h, hi) => (
              <div key={hi} className="mb-1.5 flex items-center gap-1.5">
                <input
                  value={h.key}
                  onChange={(e) =>
                    update(ti, { headers: tool.headers.map((x, i) => (i === hi ? { ...x, key: e.target.value } : x)) })
                  }
                  placeholder="Authorization"
                  className={`${miniInput} flex-1`}
                />
                {/* The API never returns a stored header value — it arrives masked.
                    Leaving the mask untouched keeps what is saved; typing replaces it. */}
                <input
                  value={h.value}
                  onChange={(e) =>
                    update(ti, {
                      headers: tool.headers.map((x, i) => (i === hi ? { ...x, value: e.target.value } : x)),
                    })
                  }
                  onFocus={(e) => {
                    if (e.target.value === '***') e.target.select()
                  }}
                  placeholder="Bearer ..."
                  title={h.value === '***' ? 'Valor guardado. Digite para substituir.' : undefined}
                  className={`${miniInput} flex-1`}
                  data-testid="legacy-header-value"
                />
                <button
                  type="button"
                  onClick={() => update(ti, { headers: tool.headers.filter((_, i) => i !== hi) })}
                  className="px-1 text-sm text-(--coral-600) transition hover:text-(--coral-600)"
                  aria-label="Remover header"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => update(ti, { headers: [...tool.headers, { key: '', value: '' }] })}
              className="text-xs text-(--text-muted) underline transition hover:text-(--text-heading)"
            >
              + header
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addTool}
        className="rounded-lg border border-(--border-strong) px-3 py-1.5 text-sm transition hover:bg-(--surface-sunken)"
      >
        + Adicionar ferramenta
      </button>
    </div>
  )
}
