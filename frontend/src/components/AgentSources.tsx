import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { API_URL } from '../lib/api'
import { useActiveFloorId } from '../contexts/BuildingContext'
import { floorAgent } from '../lib/floorRoutes'
import { Button, Card, Field, Input, Select } from '../ui'

// Sites que este agente consulta QUANDO É CHAMADO.
//
// A rotina já respondia "verifique de hora em hora". Faltava o outro caso, que é o mais
// comum: "quando alguém perguntar, olhe aqui". Sem horário, sem checkpoint e sem custo
// enquanto ninguém pergunta — o agente consulta com a ferramenta `verificar_fonte`, e só
// quando a pergunta pedir.
//
// As fontes que vêm de rotinas aparecem juntas, como leitura: elas também podem ser
// consultadas sob demanda, mas quem manda nelas é a rotina, e editá-las aqui seria mexer
// no horário de outra coisa sem dizer.

export interface AgentSource {
  routineId: string | null
  origem: 'agente' | 'rotina'
  name: string
  kind: 'rss' | 'http'
  host: string | null
  url?: string
}

interface Linha {
  id: string
  name: string
  kind: 'rss' | 'http'
  url: string
}

const MAX = 5

export function AgentSources({ agentId }: { agentId: string }) {
  const [proprias, setProprias] = useState<Linha[]>([])
  const [deRotinas, setDeRotinas] = useState<AgentSource[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)
  const fid = useActiveFloorId()

  useEffect(() => {
    let vivo = true
    fetch(`${API_URL}/api/agents/${agentId}/sources`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: AgentSource[]) => {
        if (!vivo) return
        setProprias(
          lista
            .filter((s) => s.origem === 'agente')
            .map((s, i) => ({ id: `${i}`, name: s.name, kind: s.kind, url: s.url ?? '' })),
        )
        setDeRotinas(lista.filter((s) => s.origem === 'rotina'))
        setCarregando(false)
      })
      .catch(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [agentId])

  const alterar = (id: string, patch: Partial<Linha>) => {
    setSalvo(false)
    setProprias((antes) => antes.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch(`${API_URL}/api/agents/${agentId}/sources`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources: proprias
            .filter((l) => l.url.trim())
            .map((l) => ({ name: l.name.trim(), kind: l.kind, url: l.url.trim() })),
        }),
      })
      if (!res.ok) {
        const corpo = await res.json().catch(() => null)
        setErro(corpo?.error ?? 'Não foi possível salvar.')
        return
      }
      setSalvo(true)
    } finally {
      setSalvando(false)
    }
  }

  const fluxos = fid ? floorAgent(fid, agentId, 'fluxos') : `/agents/${agentId}/fluxos`

  return (
    <Card padding="16px" style={{ display: 'grid', gap: 12 }} data-testid="agent-sources">
      <div>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>
          Consultar um site
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
          Endereços que o agente pode olhar <strong>quando for acionado</strong> — numa conversa, num canal ou dentro de um
          setor. Não tem horário: ele consulta quando a pergunta pedir. Buscar não gasta tokens; o que custa é ele ler e
          responder.
        </p>
      </div>

      {carregando ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)' }}>Carregando…</p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }} data-testid="agent-sources-list">
          {proprias.length === 0 && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }} data-testid="agent-sources-empty">
              Nenhum endereço ainda. Adicione um e o agente passa a poder consultá-lo durante o atendimento.
            </p>
          )}
          {proprias.map((linha) => (
            <div key={linha.id} style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr auto', alignItems: 'end' }}>
              <Field label="Nome">
                <Input
                  value={linha.name}
                  onChange={(e) => alterar(linha.id, { name: e.target.value })}
                  placeholder="Blog da empresa"
                  data-testid="agent-source-name"
                />
              </Field>
              <Field label="Endereço">
                <Input
                  value={linha.url}
                  onChange={(e) => alterar(linha.id, { url: e.target.value })}
                  placeholder={linha.kind === 'rss' ? 'https://exemplo.com/feed.xml' : 'https://exemplo.com/pagina'}
                  data-testid="agent-source-url"
                />
              </Field>
              <div style={{ display: 'flex', gap: 6, alignItems: 'end' }}>
                <Select
                  value={linha.kind}
                  onChange={(e) => alterar(linha.id, { kind: e.target.value as 'rss' | 'http' })}
                  data-testid="agent-source-kind"
                  aria-label="Tipo"
                  options={[
                    { value: 'http', label: 'Página' },
                    { value: 'rss', label: 'Feed' },
                  ]}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSalvo(false)
                    setProprias((antes) => antes.filter((l) => l.id !== linha.id))
                  }}
                  data-testid="agent-source-remove"
                >
                  Remover
                </Button>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              disabled={proprias.length >= MAX}
              onClick={() => {
                setSalvo(false)
                setProprias((antes) => [...antes, { id: `novo-${antes.length}-${Date.now()}`, name: '', kind: 'http', url: '' }])
              }}
              data-testid="agent-source-add"
            >
              Adicionar endereço
            </Button>
            <Button onClick={() => void salvar()} disabled={salvando} data-testid="agent-sources-save">
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
            {salvo && (
              <span style={{ fontSize: 13, color: 'var(--emerald-700, #067647)' }} data-testid="agent-sources-saved">
                Salvo
              </span>
            )}
            {erro && (
              <span style={{ fontSize: 13, color: 'var(--coral-600, #d92d20)' }} data-testid="agent-sources-error">
                {erro}
              </span>
            )}
            {proprias.length >= MAX && (
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Máximo de {MAX}.</span>
            )}
          </div>
        </div>
      )}

      {deRotinas.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }} data-testid="agent-sources-routines">
          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
            Vindos de rotinas — o agente também pode consultá-los sob demanda
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
            {deRotinas.map((s) => (
              <li key={s.routineId} style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
                {s.name} <span>· {s.kind === 'rss' ? 'feed' : 'página'}{s.host ? ` · ${s.host}` : ''}</span>
              </li>
            ))}
          </ul>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
            O horário deles fica em <Link to={fluxos} style={{ color: 'var(--intent-brand)' }}>Fluxos</Link>. Consultar aqui
            não consome o alerta da rotina.
          </p>
        </div>
      )}
    </Card>
  )
}
