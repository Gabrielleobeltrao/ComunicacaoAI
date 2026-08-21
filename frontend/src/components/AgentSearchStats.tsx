import { useEffect, useState } from 'react'
import { API_URL } from '../lib/api'

// Quanto ESTE pesquisador buscou — e quanto ele deixou de buscar.
//
// O painel de Configurações mostra o gasto do servidor, que protege a fatura. Aqui a
// pergunta é outra: este agente está valendo a busca? Um agente que busca muito e acha
// pouco é um problema de configuração dele — a política errada, um objetivo vago —, e um
// número global nunca aponta para o culpado.
//
// "Evitadas" é o retorno da memória: pergunta que a base já respondia e não virou
// requisição. É o número que mostra se guardar as páginas está compensando.

interface Stats {
  searchesThisMonth: number
  searchesToday: number
  avoidedThisMonth: number
  pagesRead: number
  documentsSaved: number
  failures: number
  lastSearchAt: string | null
  lastQuery: string | null
}

export function AgentSearchStats({ agentId }: { agentId: string }) {
  const [s, setS] = useState<Stats | null>(null)

  useEffect(() => {
    let vivo = true
    fetch(`${API_URL}/api/agents/${agentId}/search-stats`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => vivo && setS(d))
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [agentId])

  if (!s) return null

  const total = s.searchesThisMonth + s.avoidedThisMonth
  const economia = total > 0 ? Math.round((s.avoidedThisMonth / total) * 100) : 0

  const numeros: { rotulo: string; valor: string; ajuda?: string }[] = [
    { rotulo: 'Buscas neste mês', valor: String(s.searchesThisMonth), ajuda: s.searchesToday > 0 ? `${s.searchesToday} hoje` : undefined },
    { rotulo: 'Evitadas pela memória', valor: String(s.avoidedThisMonth), ajuda: total > 0 ? `${economia}% das perguntas` : undefined },
    { rotulo: 'Páginas lidas', valor: String(s.pagesRead) },
    { rotulo: 'Guardadas na base', valor: String(s.documentsSaved) },
  ]

  return (
    <div className="rounded-lg border border-(--border-subtle) p-3" data-testid="agent-search-stats">
      <p className="mb-2 text-sm font-medium">Buscas deste pesquisador</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {numeros.map((n) => (
          <div key={n.rotulo}>
            <p className="text-lg font-bold text-(--text-heading)" data-testid={`search-stat-${n.rotulo.split(' ')[0].toLowerCase()}`}>
              {n.valor}
            </p>
            <p className="text-[11px] leading-tight text-(--text-faint)">{n.rotulo}</p>
            {n.ajuda && <p className="text-[11px] text-(--text-muted)">{n.ajuda}</p>}
          </div>
        ))}
      </div>

      {s.failures > 0 && (
        <p className="mt-2 text-xs text-(--coral-600)" data-testid="search-stat-failures">
          {s.failures} busca(s) falharam neste mês. O agente respondeu com o que já tinha na base.
        </p>
      )}
      {s.lastQuery && (
        <p className="mt-2 text-xs text-(--text-faint)" data-testid="search-stat-last">
          Última: “{s.lastQuery}”
          {s.lastSearchAt ? ` · ${new Date(s.lastSearchAt).toLocaleString('pt-BR')}` : ''}
        </p>
      )}
      {s.searchesThisMonth === 0 && s.avoidedThisMonth === 0 && (
        <p className="mt-2 text-xs text-(--text-faint)">Nenhuma busca ainda neste mês.</p>
      )}
    </div>
  )
}
