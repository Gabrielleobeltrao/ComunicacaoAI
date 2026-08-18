import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { API_URL } from '../lib/api'
import type { AgentSummary } from '../lib/types'
import { Button, Card, Input } from '../ui'

// As competências pelas quais OUTROS agentes encontram este.
//
// O campo existia desde sempre e nenhuma tela o editava: era gravado uma vez, na
// contratação, a partir do catálogo do modelo-base. Na prática todo pesquisador da conta
// ficava com as mesmas duas etiquetas, e três pesquisadores de assuntos diferentes eram
// indistinguíveis para o coordenador que precisa escolher um.
//
// É isto que `list_available_agents(capability: …)` procura, e é o que
// `get_agent_capabilities` mostra ao agente que está decidindo a quem delegar.

/** Uma etiqueta por vez, sem repetição e sem espaço sobrando. */
export function normalizeTags(brutas: string[]): string[] {
  const vistas = new Set<string>()
  const saida: string[] = []
  for (const bruta of brutas) {
    // Vírgula e ponto-e-vírgula separam: quem cola uma lista pronta não deve virar uma
    // etiqueta gigante.
    for (const parte of bruta.split(/[,;]/)) {
      const limpa = parte.trim().slice(0, 40)
      if (!limpa) continue
      const chave = limpa.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      if (vistas.has(chave)) continue
      vistas.add(chave)
      saida.push(limpa)
    }
  }
  return saida.slice(0, 20)
}

export function AgentCapabilities({ agent, onSaved }: { agent: AgentSummary; onSaved: () => Promise<void> | void }) {
  const [tags, setTags] = useState<string[]>(agent.capabilities ?? [])
  const [rascunho, setRascunho] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; message: string } | null>(null)

  const adicionar = () => {
    const proximas = normalizeTags([...tags, rascunho])
    if (proximas.length === tags.length) {
      setRascunho('')
      return
    }
    setTags(proximas)
    setRascunho('')
    setResultado(null)
  }

  const remover = (tag: string) => {
    setTags((antes) => antes.filter((t) => t !== tag))
    setResultado(null)
  }

  const noTeclado = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    adicionar()
  }

  const salvar = async () => {
    setSalvando(true)
    setResultado(null)
    try {
      const res = await fetch(`${API_URL}/api/agents/${agent._id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilities: normalizeTags(tags) }),
      })
      if (!res.ok) {
        const corpo = await res.json().catch(() => ({}))
        setResultado({ ok: false, message: (corpo as { error?: string }).error ?? `HTTP ${res.status}` })
        return
      }
      setResultado({ ok: true, message: 'Salvo' })
      await onSaved()
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Card padding="16px" style={{ display: 'grid', gap: 10 }} data-testid="agent-capabilities">
      <div>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>
          Competências
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
          É por aqui que <strong>outro agente encontra este</strong> quando precisa de ajuda. Um coordenador procura por
          competência antes de delegar — “jurídico”, “mercado financeiro”, “nota fiscal”. Quanto mais específico, menos ele
          escolhe o agente errado.
        </p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} data-testid="agent-capabilities-list">
        {tags.length === 0 && (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="agent-capabilities-empty">
            Sem competências. Outros agentes só encontram este pelo nome e pelo objetivo.
          </span>
        )}
        {tags.map((tag) => (
          <span
            key={tag}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              borderRadius: 999,
              border: '1px solid var(--border-strong)',
              fontSize: 12.5,
            }}
            data-testid="agent-capability-tag"
          >
            {tag}
            <button
              type="button"
              onClick={() => remover(tag)}
              aria-label={`Remover ${tag}`}
              style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 14, lineHeight: 1 }}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          onKeyDown={noTeclado}
          placeholder="mercado financeiro"
          aria-label="Nova competência"
          data-testid="agent-capability-input"
        />
        <Button variant="secondary" size="sm" onClick={adicionar} disabled={!rascunho.trim()} data-testid="agent-capability-add">
          Adicionar
        </Button>
        <Button onClick={() => void salvar()} disabled={salvando} data-testid="agent-capabilities-save">
          {salvando ? 'Salvando…' : 'Salvar'}
        </Button>
        {resultado && (
          <span
            style={{ fontSize: 13, color: resultado.ok ? 'var(--emerald-700, #067647)' : 'var(--coral-600, #d92d20)' }}
            data-testid="agent-capabilities-result"
          >
            {resultado.message}
          </span>
        )}
      </div>
    </Card>
  )
}
