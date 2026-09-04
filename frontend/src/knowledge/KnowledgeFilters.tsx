import { Input } from '../ui'
import type { GraphNode } from '../lib/knowledge'

// Os filtros do mapa. Um por pergunta: o que estou procurando, em que estado está, de
// onde veio, e — a mais importante — o que UM agente específico alcança.

export interface FiltrosDoMapa {
  q: string
  status: string
  source: string
  viewAs: string | null
}

const STATUS = [
  { value: '', label: 'Qualquer estado' },
  { value: 'indexed', label: 'Indexado' },
  { value: 'pending', label: 'Indexando' },
  { value: 'error', label: 'Erro ao indexar' },
]

const ORIGEM = [
  { value: '', label: 'Qualquer origem' },
  { value: 'manual', label: 'Escrito à mão' },
  { value: 'web', label: 'Site' },
  { value: 'architect', label: 'Montar operação' },
  { value: 'proposal', label: 'Proposta aprovada' },
  { value: 'run', label: 'Execução' },
]

export function KnowledgeFilters({
  filtros,
  agentes,
  onChange,
}: {
  filtros: FiltrosDoMapa
  agentes: GraphNode[]
  onChange: (f: FiltrosDoMapa) => void
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="knowledge-filters">
      <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Buscar por título
        <Input
          value={filtros.q}
          placeholder="política de troca…"
          onChange={(e) => onChange({ ...filtros, q: e.target.value })}
          data-testid="knowledge-search"
        />
      </label>

      <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Estado
        <select
          value={filtros.status}
          onChange={(e) => onChange({ ...filtros, status: e.target.value })}
          data-testid="knowledge-filter-status"
          style={selectStyle}
        >
          {STATUS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Origem
        <select value={filtros.source} onChange={(e) => onChange({ ...filtros, source: e.target.value })} data-testid="knowledge-filter-source" style={selectStyle}>
          {ORIGEM.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Ver como
        {/* Não é um filtro visual: o servidor REMOVE do resultado o que aquele agente não
            pode ler. É a resposta para "o que ele enxerga daqui?". */}
        <select value={filtros.viewAs ?? ''} onChange={(e) => onChange({ ...filtros, viewAs: e.target.value || null })} data-testid="knowledge-view-as" style={selectStyle}>
          <option value="">O andar inteiro</option>
          {agentes.map((a) => (
            <option key={a.id} value={a.ownerId}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  minHeight: 40,
  padding: '0 10px',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-card)',
  color: 'var(--text-strong, inherit)',
  fontSize: 13,
}
