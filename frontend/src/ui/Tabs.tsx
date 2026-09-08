import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Dialog } from './Dialog'
import { Icon } from './Icon'
import { usePonteiroGrosso } from './usePonteiroGrosso'

type Tab = string | { value: string; label: string }

interface TabsProps {
  tabs?: Tab[]
  value?: string
  onChange?: (value: string) => void
  style?: CSSProperties
  /** Como a lista se chama quando vira popup: rótulo do botão e miolo do título. */
  rotulo?: string
}

const chaveDe = (t: Tab) => (typeof t === 'string' ? t : t.value)
const textoDe = (t: Tab) => (typeof t === 'string' ? t : t.label)

/**
 * AS ABAS.
 *
 * Numa tela larga são uma fileira. Sob o dedo, a partir de QUATRO, viram um botão que
 * abre a lista inteira.
 *
 * Por que quatro: cinco abas somam 453 px de rótulo, e a tela do telefone tem 358 de
 * coluna. A fileira já rolava para o lado — mas rolagem lateral escondida é a pior forma
 * de esconder alguma coisa: quem não sabe que existe uma quinta aba nunca arrasta para
 * procurá-la. Três cabem com folga e não ganham nada em virar popup; o corte fica onde
 * a conta muda.
 */
export function Tabs({ tabs = [], value, onChange, style, rotulo = 'Seção' }: TabsProps) {
  const dedo = usePonteiroGrosso()
  const [aberto, setAberto] = useState(false)

  if (dedo && tabs.length >= 4) {
    const atual = tabs.find((t) => chaveDe(t) === value)
    return (
      <>
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="ds-hit"
          aria-haspopup="dialog"
          aria-expanded={aberto}
          data-testid="tabs-compacto"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            width: '100%',
            height: 46,
            padding: '0 14px',
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--surface-card)',
            fontFamily: 'var(--font-ui)',
            fontSize: 14.5,
            fontWeight: 700,
            color: 'var(--text-heading)',
            cursor: 'pointer',
            ...style,
          }}
        >
          {/* O rótulo da lista fica ACIMA do valor, pequeno: sem ele o botão diz "Fontes"
              e não diz de quê — e num popup fechado o contexto é a única pista. */}
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '.04em', textTransform: 'uppercase' }}>{rotulo}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
              {atual ? textoDe(atual) : textoDe(tabs[0])}
            </span>
          </span>
          <Icon name="chevron-down" size={18} color="var(--text-muted)" />
        </button>

        <Dialog open={aberto} title={`Escolher ${rotulo.toLowerCase()}`} width={360} onClose={() => setAberto(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="tabs-popup">
            {tabs.map((t) => {
              const chave = chaveDe(t)
              const ativa = chave === value
              return (
                <button
                  key={chave}
                  type="button"
                  aria-current={ativa ? 'true' : undefined}
                  onClick={() => {
                    onChange?.(chave)
                    setAberto(false)
                  }}
                  className="ds-hit"
                  data-testid={`tabs-opcao-${chave}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    // Cada opção ocupa a linha inteira: no popup não há disputa por espaço,
                    // e é justamente essa folga que a fileira apertada não tinha.
                    width: '100%',
                    minHeight: 48,
                    padding: '0 14px',
                    borderRadius: 'var(--radius-control)',
                    border: 0,
                    textAlign: 'left',
                    background: ativa ? 'var(--surface-sunken)' : 'transparent',
                    fontFamily: 'var(--font-ui)',
                    fontSize: 15,
                    fontWeight: ativa ? 800 : 500,
                    color: ativa ? 'var(--text-heading)' : 'var(--text-body)',
                    cursor: 'pointer',
                  }}
                >
                  {textoDe(t)}
                </button>
              )
            })}
          </div>
        </Dialog>
      </>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: 4,
        borderRadius: 'var(--radius-control)',
        background: 'var(--surface-sunken)',
        // Com mouse e muitas abas a fileira ainda pode passar da caixa: aí ela rola,
        // em vez de transbordar por baixo do que vier depois.
        overflowX: 'auto',
        minWidth: 0,
        ...style,
      }}
    >
      {tabs.map((t) => {
        const chave = chaveDe(t)
        const ativa = chave === value
        return (
          <button
            key={chave}
            onClick={() => onChange?.(chave)}
            // `ds-hit` só vale sob ponteiro grosso, e `min-height` vence `height`: no
            // desktop a aba continua com 32, no celular vira alvo de 44.
            className="ds-hit"
            style={{
              height: 32,
              // `overflow-x` no pai não adianta se o filho ENCOLHE: sem estes dois o flex
              // espremia cada aba abaixo do próprio texto e "Histórico" virava "Histó" —
              // dentro da tela, sem rolagem nenhuma, e ilegível.
              whiteSpace: 'nowrap',
              flex: '0 0 auto',
              padding: '0 14px',
              borderRadius: 'var(--radius-xs)',
              border: 0,
              background: ativa ? 'var(--surface-card)' : 'transparent',
              boxShadow: ativa ? 'var(--shadow-flat)' : 'none',
              color: ativa ? 'var(--text-heading)' : 'var(--text-muted)',
              fontFamily: 'var(--font-ui)',
              fontSize: 13.5,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all var(--dur-fast) var(--ease-standard)',
            }}
          >
            {textoDe(t)}
          </button>
        )
      })}
    </div>
  )
}
