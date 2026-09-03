import { Link } from 'react-router'
import { useActiveFloorId } from '../contexts/BuildingContext'
import { floorAgent } from '../lib/floorRoutes'
import { normalizeSectorMode } from '../lib/sectors'
import type { AgentSummary, SectorSummary } from '../lib/types'

// The team's flow, drawn: what comes in, who touches it, what comes out.
//   organization → no Entrada/Saída at all: the group does not execute.
//   orchestrated → Entrada ↓ coordenador ↓ grupo de especialistas ↓ Saída
//   pipeline     → Entrada ↓ etapa 1 ↓ etapa 2 ↓ … ↓ Saída
//
// It reads TOP DOWN. Growing sideways forced a horizontal scrollbar on anything
// longer than three steps and made the whole page scroll on a phone; a vertical
// column uses the width it is given and long names simply wrap.

/**
 * A responsabilidade de um agente, ou a AUSÊNCIA dela — dita.
 *
 * `null` significa "ninguém escreveu", e é diferente de `undefined`: o segundo some da tela,
 * o primeiro aparece como pendência acionável. Um quadrado vazio no fluxo não é uma
 * informação a menos; é uma pergunta que a tela deixa de fazer.
 */
type Responsabilidade = { texto: string; legado: boolean } | null

function Node({
  title,
  subtitle,
  meta,
  to,
  tone = 'plain',
  pendencia,
}: {
  title: string
  subtitle?: string
  /** Uma terceira linha, mais fraca: o porquê, quando o dono escreveu um. */
  meta?: string
  to?: string
  tone?: 'plain' | 'edge' | 'lead'
  /** Quando presente, a linha de baixo vira um aviso acionável em vez de espaço vazio. */
  pendencia?: string
}) {
  const body = (
    <>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)', overflowWrap: 'anywhere' }}>{title}</span>
      {subtitle ? (
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, overflowWrap: 'anywhere' }}>{subtitle}</span>
      ) : null}
      {/* A pendência é uma linha PRÓPRIA, e não um substituto do subtítulo: o coordenador
          já tem "coordena" escrito ali, e a falta da função dele continuaria invisível. */}
      {pendencia ? (
        <span
          style={{ display: 'block', fontSize: 11.5, color: 'var(--intent-danger-text)', marginTop: 2, overflowWrap: 'anywhere', fontWeight: 600 }}
          data-testid="flow-pendencia"
        >
          {pendencia}
        </span>
      ) : null}
      {meta ? (
        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)', marginTop: 2, overflowWrap: 'anywhere' }}>{meta}</span>
      ) : null}
    </>
  )
  const style: React.CSSProperties = {
    display: 'block',
    // Full width on a phone; a readable ceiling on a wide screen.
    width: '100%',
    minWidth: 0,
    maxWidth: 420,
    padding: '10px 14px',
    borderRadius: 10,
    textDecoration: 'none',
    textAlign: 'left',
    border: `1px solid ${tone === 'lead' ? 'var(--intent-brand)' : 'var(--border-subtle)'}`,
    background: tone === 'edge' ? 'var(--surface-sunken)' : 'var(--surface-card)',
  }
  return to ? (
    <Link to={to} style={style}>
      {body}
    </Link>
  ) : (
    <div style={style}>{body}</div>
  )
}

/**
 * A ARESTA, com o nome da relação.
 *
 * A seta sozinha diz que existe caminho e não diz qual: "recebe" e "delega" desenham igual,
 * e quem lê o fluxo não descobre se o coordenador manda ou se o especialista responde. O
 * texto é o que separa as cinco relações que o produto tem.
 *
 * A seta continua decorativa para leitor de tela — a direção já está na ordem de leitura —,
 * mas o RÓTULO não: ele é a informação.
 */
const Arrow = ({ label }: { label?: string }) => (
  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
    <span aria-hidden data-testid="flow-arrow" style={{ color: 'var(--text-faint)', fontSize: 16, lineHeight: 1 }}>
      ↓
    </span>
    {label ? (
      <span data-testid="flow-edge-label" style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'lowercase' }}>
        {label}
      </span>
    ) : null}
  </span>
)

const column: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minWidth: 0,
}

export function SectorFlow({ sector, agents }: { sector: SectorSummary; agents: AgentSummary[] }) {
  const fid = useActiveFloorId()
  const byId = new Map(agents.map((a) => [a._id, a]))
  const href = (agentId: string) => (fid ? floorAgent(fid, agentId) : `/agents/${agentId}`)
  const nameOf = (agentId: string) => byId.get(agentId)?.name ?? 'Agente removido'

  /**
   * O QUE ESTE AGENTE É, em uma linha.
   *
   * O desenho do fluxo mostrava só o nome — e um nome não diz se aquele quadrado é o
   * analista ou o redator. O cartão ao lado já dizia; o fluxo, não, e é nele que se olha
   * para entender o caminho do trabalho.
   *
   * A função vem do bloco "Função" da definição. Sem ela, o objetivo serve: é o que o
   * dono escreveu sobre o que o agente faz.
   */
  const funcaoDe = (agentId: string): Responsabilidade => {
    const a = byId.get(agentId)
    if (!a) return null
    const corta = (t: string) => (t.length > 90 ? `${t.slice(0, 90)}…` : t)

    const escrita = a.role?.trim()
    if (escrita) return { texto: corta(escrita), legado: false }
    /**
     * O objetivo é FALLBACK de dado legado, e não uma segunda fonte de verdade.
     *
     * Agente criado antes de o campo "Função" existir só tem objetivo. Mostrá-lo é melhor
     * que mostrar nada — mas ele é marcado, porque "entrega relatórios" não responde
     * "quando este agente entra".
     */
    const objetivo = a.objective?.trim()
    if (objetivo) return { texto: corta(objetivo), legado: true }
    // Ninguém escreveu nada. Isso é uma pendência, não um espaço em branco.
    return null
  }

  /** O que a ficha mostra: o texto, ou o aviso que leva a quem pode escrevê-lo. */
  const fichaDe = (agentId: string) => {
    const r = funcaoDe(agentId)
    if (!r) return { pendencia: 'função não definida — abra o agente e escreva o que ele faz' }
    return { subtitle: r.legado ? `${r.texto} (do objetivo)` : r.texto }
  }
  const mode = normalizeSectorMode(sector.mode)

  // A group that does not execute gets no Entrada and no Saída — inventing them would
  // describe a flow that does not exist.
  if (mode === 'organization') {
    return (
      <div data-testid="sector-flow" style={column}>
        {sector.members.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Nenhum agente neste grupo ainda.</p>
        ) : (
          sector.members.map((m) => (
            <Node key={m.agentId} title={nameOf(m.agentId)} {...fichaDe(m.agentId)} to={href(m.agentId)} />
          ))
        )}
      </div>
    )
  }

  const stages = sector.stages ?? []
  const coordinatorId = sector.coordinatorAgentId
  const specialists = sector.members.filter((m) => m.agentId !== coordinatorId)

  return (
    <div data-testid="sector-flow" style={column}>
      <Node title="Entrada" subtitle={sector.inputContract || 'o pedido que chega'} tone="edge" />
      <Arrow label="recebe" />

      {mode === 'pipeline' ? (
        stages.length === 0 ? (
          <Node title="Sem etapas" subtitle="a equipe ainda não faz nada" />
        ) : (
          stages.map((s, i) => (
            <span key={s.id || `s${i}`} style={{ display: 'contents' }}>
              {i > 0 ? <Arrow label="depende da etapa anterior" /> : null}
              <Node
                title={`${i + 1}. ${s.name || 'Etapa'}`}
                subtitle={nameOf(s.agentId)}
                meta={funcaoDe(s.agentId)?.texto}
                {...(funcaoDe(s.agentId) ? {} : { pendencia: 'função não definida — abra o agente e escreva o que ele faz' })}
                to={s.agentId ? href(s.agentId) : undefined}
              />
            </span>
          ))
        )
      ) : coordinatorId ? (
        <>
          <Node
            title={nameOf(coordinatorId)}
            subtitle="coordena"
            meta={funcaoDe(coordinatorId)?.texto}
            {...(funcaoDe(coordinatorId) ? {} : { pendencia: 'função não definida — abra o agente e escreva o que ele faz' })}
            to={href(coordinatorId)}
            tone="lead"
          />
          {specialists.length > 0 ? (
            <>
              <Arrow label="delega" />
              {/* The specialists are a GROUP the coordinator reaches as needed. They
                  are drawn side by side, without arrows between them, so nobody reads
                  them as a mandatory sequence. */}
              <div style={{ width: '100%', maxWidth: 420, minWidth: 0 }}>
                <p style={{ margin: '0 0 6px', fontSize: 11.5, color: 'var(--text-muted)' }} data-testid="specialists-note">
                  Especialistas acionados conforme a necessidade — em paralelo, não em sequência
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {specialists.map((m) => (
                    <div key={m.agentId} style={{ flex: '1 1 180px', minWidth: 0 }}>
                      <Node
                        title={nameOf(m.agentId)}
                        {...fichaDe(m.agentId)}
                        meta={m.routingDescription || undefined}
                        to={href(m.agentId)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : (
        <Node title="Sem coordenador" subtitle="a equipe ainda não tem quem receba o pedido" />
      )}

      <Arrow label="entrega" />
      <Node title="Saída" subtitle={sector.outputContract || 'o que a equipe entrega'} tone="edge" />
    </div>
  )
}
