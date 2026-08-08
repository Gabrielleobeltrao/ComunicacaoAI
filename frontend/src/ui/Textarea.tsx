import type { CSSProperties, TextareaHTMLAttributes } from 'react'

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> {
  invalid?: boolean
  style?: CSSProperties
}

export function Textarea({ rows = 4, invalid, style, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      style={{
        width: '100%',
        padding: '11px 14px',
        borderRadius: 'var(--radius-control)',
        background: 'var(--surface-card)',
        border: `1px solid ${invalid ? 'var(--intent-danger)' : 'var(--border-subtle)'}`,
        fontFamily: 'var(--font-ui)',
        fontSize: 14.5,
        lineHeight: 1.5,
        color: 'var(--text-heading)',
        outline: 'none',
        resize: 'vertical',
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-focus)'
        e.currentTarget.style.boxShadow = 'var(--ring-focus)'
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = invalid ? 'var(--intent-danger)' : 'var(--border-subtle)'
        e.currentTarget.style.boxShadow = 'none'
      }}
      {...rest}
    />
  )
}
