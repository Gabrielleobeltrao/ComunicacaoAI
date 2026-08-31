import { useEffect, useRef, useState } from 'react'
import { Button, Icon } from '../../ui'
import type { ArchitectMessage, ArchitectQuestion } from '../../lib/architect'

// A conversa. Uma coluna, mensagens simples e um campo fixo embaixo.
//
// Sem JSON, sem schema e sem termo técnico: quem está aqui está descrevendo um
// negócio, não configurando um sistema.

const BOLHA = (role: ArchitectMessage['role']) => ({
  alignSelf: role === 'user' ? ('flex-end' as const) : ('flex-start' as const),
  maxWidth: 'min(88%, 560px)',
  borderRadius: 14,
  padding: '10px 14px',
  fontSize: 14,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap' as const,
  overflowWrap: 'anywhere' as const,
  background: role === 'user' ? 'var(--intent-brand)' : role === 'system_notice' ? 'var(--intent-warning-soft)' : 'var(--surface-card)',
  color: role === 'user' ? '#fff' : 'var(--text-body)',
  border: role === 'user' ? 'none' : '1px solid var(--border-subtle)',
})

export function Conversation({
  messages,
  question,
  pending,
  disabled,
  onSend,
  onGenerate,
}: {
  messages: ArchitectMessage[]
  question: ArchitectQuestion | null
  pending: boolean
  disabled: boolean
  onSend: (texto: string) => void
  onGenerate: () => void
}) {
  const [texto, setTexto] = useState('')
  const [segundos, setSegundos] = useState(0)
  const fim = useRef<HTMLDivElement>(null)

  // Quanto tempo já se passou. Um "Pensando…" parado por trinta segundos é
  // indistinguível de uma tela travada — e a pessoa recarrega no meio da rodada, que é
  // justamente o que faz o trabalho parecer perdido.
  useEffect(() => {
    if (!pending) return setSegundos(0)
    const inicio = Date.now()
    const t = setInterval(() => setSegundos(Math.round((Date.now() - inicio) / 1000)), 1000)
    return () => clearInterval(t)
  }, [pending])

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, pending])

  const enviar = (valor?: string) => {
    const conteudo = (valor ?? texto).trim()
    if (!conteudo || pending || disabled) return
    setTexto('')
    onSend(conteudo)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="architect-conversation">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" style={{ paddingBottom: 12 }}>
        {messages.map((m) => {
          // Uma falha já resolvida fica no histórico, mas perde o vermelho: depois de a
          // pessoa configurar a chave, o aviso de ontem continuava na tela com a mesma
          // cara do de agora.
          const resolvido = m.role === 'system_notice' && m.failure === true && m.resolved === true
          return (
            <div
              key={m.id}
              style={resolvido ? { ...BOLHA('assistant'), color: 'var(--text-faint)' } : BOLHA(m.role)}
              data-testid={`architect-message-${m.role}`}
              data-resolved={resolvido ? 'sim' : undefined}
            >
              {m.role === 'system_notice' && <Icon name={resolvido ? 'check' : 'shield'} size={14} />} {m.content}
              {resolvido && <span style={{ fontSize: 11.5 }}> — já resolvido; a rodada seguinte funcionou.</span>}
            </div>
          )
        })}
        {pending && (
          <div style={{ ...BOLHA('assistant'), color: 'var(--text-muted)' }} data-testid="architect-thinking" role="status" aria-live="polite">
            {segundos >= 20 ? `Ainda trabalhando… ${segundos}s. Montar uma proposta inteira leva mais tempo.` : segundos >= 3 ? `Pensando… ${segundos}s` : 'Pensando…'}
          </div>
        )}
        <div ref={fim} />
      </div>

      {question && !pending && (
        <div className="flex flex-col gap-2" style={{ paddingBottom: 10 }} data-testid="architect-question">
          {question.why && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{question.why}</p>}
          <div className="flex flex-wrap gap-2">
            {(question.choices ?? []).map((c) => (
              <button
                key={c.value}
                type="button"
                data-testid={`architect-choice-${c.value}`}
                onClick={() => enviar(c.label)}
                style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)', borderRadius: 999, padding: '8px 14px', fontSize: 13, minHeight: 40 }}
              >
                {c.label}
              </button>
            ))}
            {question.allowUnknown && (
              <button
                type="button"
                data-testid="architect-unknown"
                onClick={() => enviar('Não sei ainda')}
                style={{ border: '1px dashed var(--border-subtle)', background: 'transparent', color: 'var(--text-muted)', borderRadius: 999, padding: '8px 14px', fontSize: 13, minHeight: 40 }}
              >
                Não sei ainda
              </button>
            )}
          </div>
        </div>
      )}

      {/* A barra de resposta fica presa embaixo. `sticky` + fundo próprio: no celular o
          teclado sobe e um composer solto some atrás dele. */}
      <div
        className="flex items-end gap-2"
        style={{ position: 'sticky', bottom: 0, background: 'var(--surface-app)', paddingTop: 8, paddingBottom: 'max(8px, var(--safe-bottom))' }}
      >
        <label className="sr-only" htmlFor="architect-reply">
          Sua resposta
        </label>
        <textarea
          id="architect-reply"
          data-testid="architect-input"
          rows={1}
          value={texto}
          disabled={disabled}
          placeholder={disabled ? 'Este projeto já foi aplicado.' : 'Escreva sua resposta'}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              enviar()
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 44,
            maxHeight: 140,
            resize: 'none',
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            background: 'var(--surface-card)',
            padding: '11px 12px',
            fontSize: 14,
            fontFamily: 'inherit',
          }}
        />
        <Button onClick={() => enviar()} disabled={!texto.trim() || pending || disabled} data-testid="architect-send">
          Enviar
        </Button>
      </div>

      {!disabled && (
        <button
          type="button"
          data-testid="architect-generate"
          onClick={onGenerate}
          disabled={pending}
          style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', color: 'var(--intent-brand)', fontSize: 12.5, padding: '6px 0', minHeight: 32 }}
        >
          Gerar uma primeira proposta agora
        </button>
      )}
    </div>
  )
}
