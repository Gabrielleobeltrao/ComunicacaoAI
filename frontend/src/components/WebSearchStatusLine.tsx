import { useEffect, useState } from 'react'
import { API_URL } from '../lib/api'

// O estado da busca na web, do lado do SERVIDOR.
//
// Existe para a tela não prometer o que o servidor não faz. Um interruptor ligado com
// nenhum buscador configurado é uma promessa vazia: o agente não vai procurar nada, e
// quem ligou vai concluir que a função está quebrada.
//
// Os números são desta instalação. Se a mesma chave for usada em outro lugar, aquelas
// chamadas não passam por aqui — e o contador não as conhece. Dizer isso é a diferença
// entre um número e um número confiável.

interface Status {
  configured: boolean
  provider: string
  used: number
  limit: number
  remaining: number
  period: string
  resetAt: string
  paidUsageEnabled: boolean
}

export function WebSearchStatusLine() {
  const [s, setS] = useState<Status | null>(null)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    let vivo = true
    fetch(`${API_URL}/api/settings/web-search`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => vivo && setS(d))
      .catch(() => vivo && setFalhou(true))
    return () => {
      vivo = false
    }
  }, [])

  if (falhou || !s) return null

  const esgotou = s.remaining <= 0
  const renovaEm = new Date(s.resetAt).toLocaleDateString('pt-BR')
  const tom = !s.configured || esgotou ? 'var(--coral-600)' : 'var(--text-muted)'

  return (
    <div className="rounded-lg border border-(--border-subtle) p-2 text-xs" style={{ color: tom }} data-testid="web-search-status">
      {!s.configured ? (
        <p>
          <strong>Nenhum buscador configurado neste servidor.</strong> Ativar a opção abaixo não faz o agente procurar nada até que a
          configuração exista.
        </p>
      ) : esgotou ? (
        <p>
          <strong>A franquia mensal acabou</strong> ({s.used} de {s.limit} no período {s.period}). O agente continua respondendo com o que já
          está na base. Renova em {renovaEm}.
        </p>
      ) : (
        <p>
          Buscador: <strong>{s.provider}</strong> · {s.used} de {s.limit} buscas usadas neste mês · {s.remaining} restantes · renova em{' '}
          {renovaEm}
          {s.paidUsageEnabled && ' · uso pago LIGADO'}
        </p>
      )}
      <p className="mt-1 text-(--text-faint)">
        A contagem é deste servidor. Buscas feitas fora dele com a mesma chave não são conhecidas aqui.
      </p>
    </div>
  )
}
