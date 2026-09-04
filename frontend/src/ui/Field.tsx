import { Children, cloneElement, isValidElement, useId } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { Input } from './Input'
import { Select } from './Select'
import { Textarea } from './Textarea'

interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  htmlFor?: string
  children?: ReactNode
  style?: CSSProperties
}

/**
 * Os tipos que um rótulo pode apontar — e nada além deles.
 *
 * `label[for]` só significa alguma coisa quando aponta para um controle de formulário.
 * Apontar para um `div` que agrupa outros campos não é neutro: o leitor de tela anuncia um
 * rótulo que não pertence a campo nenhum, e quem depende dele fica pior do que sem.
 */
const CONTROLES = new Set<unknown>([Input, Select, Textarea, 'input', 'select', 'textarea'])

export function Field({ label, hint, error, htmlFor, children, style }: FieldProps) {
  const gerado = useId()

  /**
   * O rótulo é LIGADO ao campo — sem exigir que cada chamada invente um id.
   *
   * Antes, `htmlFor` era opcional e quase nunca passado: dezenas de campos tinham um texto
   * em negrito por cima e nada que dissesse a um leitor de tela que aquele texto nomeia
   * aquele campo. Quem navega por teclado ouvia "caixa de combinação", sem mais.
   *
   * Ligar aqui conserta todos de uma vez, e respeita o id que a chamada já tiver dado.
   */
  let alvo = htmlFor
  const filhos = Children.map(children, (filho) => {
    if (alvo || !isValidElement(filho) || !CONTROLES.has(filho.type)) return filho
    const props = filho.props as { id?: string }
    alvo = props.id ?? gerado
    return props.id ? filho : cloneElement(filho as ReactElement<{ id?: string }>, { id: alvo })
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label ? (
        <label
          htmlFor={alvo}
          style={{ fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 700, color: 'var(--text-heading)', letterSpacing: '-.005em' }}
        >
          {label}
        </label>
      ) : null}
      {filhos}
      {error ? (
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--coral-600)' }}>{error}</span>
      ) : hint ? (
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{hint}</span>
      ) : null}
    </div>
  )
}
