import { useEffect, useState } from 'react'
import { API_URL } from '../lib/api'

// Quanto da franquia gratuita de embedding já foi usado — e quanto falta.
//
// Sem esta tela, o fim da franquia é uma surpresa que chega pela fatura. Com ela, é um
// número que sobe devagar e avisa antes. Os avisos existem em três degraus porque a ação
// muda: em 80% dá para planejar, em 95% dá para decidir, e depois do corte o sistema para
// de indexar — o que é visível e reversível, ao contrário de uma cobrança.

interface Relatorio {
  provider: string
  model: string
  fallbackModel: string | null
  paidUsageEnabled: boolean
  hardLimitEnabled: boolean
  freeTokenLimit: number
  hardStopTokens: number
  usedTokens: number
  reservedTokens: number
  remainingTokens: number
  percentUsed: number
  requests: number
  tokensToday: number
  tokensThisMonth: number
  requestsToday: number
  byModel: { model: string; tokens: number; requests: number }[]
  byAgent: { agentId: string; tokens: number; requests: number }[]
  lastError: { at: string; model: string; reason: string } | null
  availableModels: string[]
  configured: boolean
}

const numero = (n: number) => n.toLocaleString('pt-BR')

/** O degrau em que o consumo está. É ele que decide a cor e a frase. */
function alerta(pct: number): { tom: string; texto: string } | null {
  if (pct >= 95) return { tom: 'var(--coral-600)', texto: 'Menos de 5% restante. A indexação vai parar em breve.' }
  if (pct >= 90) return { tom: 'var(--coral-600)', texto: '90% da franquia consumida.' }
  if (pct >= 80) return { tom: 'var(--amber-600, #b54708)', texto: '80% da franquia consumida.' }
  return null
}

export function EmbeddingUsagePanel() {
  const [r, setR] = useState<Relatorio | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    fetch(`${API_URL}/api/settings/embeddings`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((dados) => vivo && setR(dados))
      .catch(() => vivo && setErro('Não foi possível carregar o uso de embeddings.'))
    return () => {
      vivo = false
    }
  }, [])

  if (erro) return <p className="text-sm text-(--coral-600)">{erro}</p>
  if (!r) return <p className="text-sm text-(--text-muted)">Carregando…</p>

  const aviso = alerta(r.percentUsed)
  const linhas: [string, string][] = [
    ['Provedor', r.provider],
    ['Modelo', r.model],
    ['Modelo de recuo', r.fallbackModel ?? 'nenhum'],
    ['Uso pago', r.paidUsageEnabled ? 'LIGADO — chamadas podem ser cobradas' : 'DESLIGADO — o sistema para na franquia'],
    ['Teto de segurança', r.hardLimitEnabled ? `ligado, em ${numero(r.hardStopTokens)} tokens` : 'desligado'],
    ['Franquia declarada', `${numero(r.freeTokenLimit)} tokens`],
    ['Usados', numero(r.usedTokens)],
    ['Restantes', numero(r.remainingTokens)],
    ['Requisições', numero(r.requests)],
    ['Hoje', `${numero(r.tokensToday)} tokens · ${numero(r.requestsToday)} requisição(ões)`],
    ['Neste mês', `${numero(r.tokensThisMonth)} tokens`],
  ]

  return (
    <div className="space-y-3 rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4" data-testid="embedding-usage">
      {!r.configured && (
        <p className="text-sm text-(--text-muted)" data-testid="embedding-not-configured">
          Nenhuma chave de embedding configurada neste servidor. A busca por semelhança fica indisponível; a busca por texto exato continua
          funcionando.
        </p>
      )}

      <div>
        <div className="flex items-center justify-between text-sm">
          <span>Franquia consumida</span>
          <strong data-testid="embedding-percent">{r.percentUsed}%</strong>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-(--surface-sunken)">
          <div
            style={{
              width: `${Math.min(100, r.percentUsed)}%`,
              height: '100%',
              background: aviso ? aviso.tom : 'var(--intent-brand)',
              transition: 'width var(--dur-fast) var(--ease-standard)',
            }}
          />
        </div>
        {aviso && (
          <p className="mt-1 text-xs" style={{ color: aviso.tom }} data-testid="embedding-alert">
            {aviso.texto}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-(--border-subtle) pt-3 text-sm">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="contents">
            <dt className="text-(--text-faint)">{rotulo}</dt>
            <dd data-testid={`embedding-${rotulo.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{valor}</dd>
          </div>
        ))}
      </dl>

      {r.byModel.length > 0 && (
        <div className="border-t border-(--border-subtle) pt-3">
          <p className="mb-1 text-xs uppercase tracking-wide text-(--text-faint)">Por modelo</p>
          <ul className="space-y-0.5 text-sm" data-testid="embedding-by-model">
            {r.byModel.map((m) => (
              <li key={m.model}>
                {m.model}: {numero(m.tokens)} tokens · {numero(m.requests)} req.
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.lastError && (
        <p className="border-t border-(--border-subtle) pt-3 text-xs text-(--coral-600)" data-testid="embedding-last-error">
          Última falha ({new Date(r.lastError.at).toLocaleString('pt-BR')}): {r.lastError.reason}
        </p>
      )}

      <p className="text-xs text-(--text-faint)">
        Estes números são do servidor inteiro, não da sua conta: a franquia pertence à conta do provedor. As configurações vêm de variáveis de
        ambiente — quem opera o servidor as ajusta.
      </p>
    </div>
  )
}
