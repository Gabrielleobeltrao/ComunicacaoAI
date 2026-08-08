import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Brand, Icon } from '../ui'

const CHIPS = ['Vendas', 'Suporte', 'Marketing', 'Financeiro', 'Dev']

// The Tavorium auth split-screen: brand + form on the left, a cobalt panel with
// the office pitch on the right (hidden on narrow screens).
export function AuthScaffold({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2" style={{ background: 'var(--surface-app)' }}>
      <div className="flex flex-col justify-center gap-5 px-6 py-12 lg:px-[60px]">
        <Brand />
        <div>
          <h1 style={{ fontSize: 'var(--text-title-size)', letterSpacing: 'var(--text-title-ls)', fontWeight: 800, margin: '0 0 6px' }}>
            {title}
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14.5 }}>{subtitle}</p>
        </div>
        {children}
        <Link
          to="/"
          style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}
        >
          <Icon name="arrow-left" size={14} /> Voltar
        </Link>
      </div>
      <div className="hidden items-center justify-center p-10 lg:flex" style={{ background: 'var(--cobalt-500)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 400, color: '#fff' }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: '-.02em',
              lineHeight: 1.15,
            }}
          >
            Seus colegas de IA já estão sentados, esperando o primeiro objetivo.
          </span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {CHIPS.map((c) => (
              <span
                key={c}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(255,255,255,.16)',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 99, background: '#fff' }} />
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
