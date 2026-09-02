import { useEffect, useState } from 'react'
import { Badge, Card } from '../ui'
import * as api from '../lib/resources'
import type { AccessRow, ResourceKind } from '../lib/resources'

// A MATRIZ DE ACESSO do agente — o que ele alcança, e por quê.
//
// A pergunta que ela responde não é "o que ele tem": é "por que ele não consegue usar
// aquilo?". Por isso o NEGADO aparece, com o motivo. Uma matriz que lista só o permitido
// deixa quem configura procurando um recurso que simplesmente não está na tela — e a
// resposta ("não está atribuída", "a conexão precisa ser reconectada") é justamente o que
// ele foi procurar.
//
// Pendência tem cara própria: uma conexão pausada não é acesso funcional, e mostrá-la
// como permitida é como alguém passa uma tarde procurando o erro no lugar errado.

const ORDEM: ResourceKind[] = ['knowledge', 'app', 'tool', 'database']

export function ResourceAccessMatrix({ agentId }: { agentId: string }) {
  const [linhas, setLinhas] = useState<AccessRow[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [mostrarNegados, setMostrarNegados] = useState(true)

  useEffect(() => {
    let vivo = true
    api
      .getAgentResourceAccess(agentId)
      .then((r) => vivo && setLinhas(r.items))
      .catch((e) => vivo && setErro((e as Error).message))
    return () => {
      vivo = false
    }
  }, [agentId])

  if (erro) {
    return (
      <Card>
        <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger)' }} data-testid="access-matrix-error">
          Não foi possível carregar o acesso deste agente: {erro}
        </p>
      </Card>
    )
  }
  if (!linhas) return null

  const visiveis = mostrarNegados ? linhas : linhas.filter((l) => l.allowed)
  const porTipo = ORDEM.map((kind) => ({ kind, itens: visiveis.filter((l) => l.kind === kind) })).filter((g) => g.itens.length > 0)
  const permitidos = linhas.filter((l) => l.allowed).length
  const pendentes = linhas.filter((l) => l.pending).length

  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="access-matrix">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 14 }}>Acesso</strong>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              O que este agente consegue usar de fato — e o motivo de cada recusa.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">{permitidos} liberado(s)</Badge>
            {pendentes > 0 && <Badge tone="warning">{pendentes} pendência(s)</Badge>}
          </div>
        </div>

        <label className="flex items-center gap-2" style={{ fontSize: 12.5, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={mostrarNegados}
            onChange={() => setMostrarNegados((v) => !v)}
            data-testid="access-matrix-show-denied"
            style={{ width: 16, height: 16 }}
          />
          Mostrar o que ele NÃO alcança
        </label>

        {porTipo.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="access-matrix-empty">
            Nada para mostrar aqui ainda.
          </p>
        )}

        {porTipo.map((grupo) => (
          <div key={grupo.kind} className="flex flex-col gap-1">
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
              {api.KIND_LABEL[grupo.kind]}
            </span>
            {grupo.itens.map((l) => (
              <div
                key={`${l.kind}:${l.resourceId}`}
                className="flex flex-wrap items-start gap-2"
                data-testid={`access-row-${l.kind}-${l.resourceId}`}
                style={{ padding: '6px 8px', borderRadius: 8, background: l.allowed ? 'transparent' : 'var(--surface-sunken)' }}
              >
                <Badge tone={l.allowed ? 'success' : l.pending ? 'warning' : 'neutral'}>
                  {l.allowed ? 'Pode usar' : l.pending ? 'Pendência' : 'Sem acesso'}
                </Badge>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{l.name}</span>
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                    {l.reason}
                    {l.allowed && (
                      <span style={{ color: 'var(--text-faint)' }}> · origem: {api.ORIGIN_LABEL[l.origin]}</span>
                    )}
                  </p>
                  {/* A pendência traz a AÇÃO. Sem ela, "não funciona" não tem endereço. */}
                  {l.pending && (
                    <p style={{ fontSize: 12.5, color: 'var(--intent-warning)' }} data-testid={`access-pending-${l.resourceId}`}>
                      {l.pending.message}
                    </p>
                  )}
                  {l.allowed && l.capabilities.length > 0 && (
                    <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{l.capabilities.join(' · ')}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  )
}
