import { Badge, Card, Icon } from '../../ui'
import type { ArchitectPreview, ArchitectureScore } from '../../lib/architect'

// O que a validação estrutural NÃO vê.
//
// Ela dizia que as referências fecham e os campos existem. Não dizia nada sobre o
// gerente sem equipe, o operador sem ferramenta, o agente que ninguém aciona ou o
// cálculo entregue a um modelo de linguagem. Todos passam pela aplicação e falham
// depois — na conta de quem aprovou.
//
// Aqui eles aparecem antes, em português, com o conserto ao lado. Um achado sem
// conserto é só um incômodo.

const ORIGEM: Record<string, string> = {
  responsibility: 'papel',
  executor: 'executor',
  architecture: 'forma',
  llm: 'leitura do modelo',
}

type NotaChave = Exclude<keyof ArchitectureScore, 'facts'>

const NOTA: { chave: NotaChave; label: string }[] = [
  { chave: 'coverage', label: 'entrega declarada' },
  { chave: 'cohesion', label: 'foco de cada agente' },
  { chave: 'executorFit', label: 'executor coerente' },
  { chave: 'permissionSafety', label: 'saída para uma pessoa' },
  { chave: 'setupCompleteness', label: 'pronto para rodar' },
  { chave: 'handoffSimplicity', label: 'simplicidade dos repasses' },
]

export function Critique({ preview }: { preview: ArchitectPreview | null }) {
  const critica = preview?.critique
  const ensaio = preview?.simulation
  if (!critica && !ensaio) return null

  return (
    <div className="flex flex-col gap-3" data-testid="architect-critique">
      {critica && critica.findings.length > 0 && (
        <Card>
          <div className="flex flex-col gap-2">
            <div>
              <strong style={{ fontSize: 13 }}>O que revisar antes de aplicar</strong>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Problemas que a estrutura não pega: eles passam pela aplicação e aparecem depois, em uso.
              </p>
            </div>
            {critica.findings.map((f, i) => (
              <div key={`${f.code}-${i}`} className="flex flex-wrap items-start gap-2" data-testid={`architect-finding-${f.code}`}>
                <Badge tone={f.severity === 'error' ? 'danger' : 'warning'}>{f.severity === 'error' ? 'Trava' : 'Vale ver'}</Badge>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{f.message}</p>
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    <span style={{ fontWeight: 600 }}>O que fazer:</span> {f.fix}
                  </p>
                  {f.evidence.length > 0 && (
                    <p style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                      {ORIGEM[f.source] ?? f.source} · {f.evidence.join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {critica && (
        <Card tone="sunken">
          <div className="flex flex-col gap-2" data-testid="architect-score">
            <div>
              <strong style={{ fontSize: 13 }}>Leitura da operação</strong>
              {/* Não é nota da IA nem previsão de qualidade: é contagem do que dá para
                  contar. Serve para orientar a revisão, não para substituí-la. */}
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Contagens do próprio desenho — cada uma com o fato que a formou.</p>
            </div>
            {NOTA.map(({ chave, label }) => (
              <div key={chave} className="flex flex-wrap items-baseline gap-2" style={{ fontSize: 12.5 }}>
                <span style={{ fontWeight: 600, minWidth: 170 }}>{label}</span>
                <span>{critica.score[chave]}%</span>
                <span style={{ color: 'var(--text-muted)' }}>{critica.score.facts[chave]?.join('; ')}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {ensaio && ensaio.results.length > 0 && (
        <Card>
          <div className="flex flex-col gap-2" data-testid="architect-simulation">
            <div>
              <strong style={{ fontSize: 13 }}>Ensaio: {ensaio.passed} de {ensaio.results.length} cenários passaram</strong>
              {/* A garantia que mais importa: nada sai daqui. */}
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Percorrido sem executar nada — as ferramentas foram chamadas em dublê, e nenhuma mensagem, cobrança ou alteração aconteceu.
              </p>
            </div>
            {ensaio.results.map((r) => {
              const caso = ensaio.cases.find((c) => c.id === r.caseId)
              return (
                <div key={r.caseId} className="flex flex-col gap-1" data-testid={`architect-scenario-${r.caseId}`}>
                  <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 12.5 }}>
                    <Icon name={r.problems.length === 0 ? 'check' : 'alert-triangle'} size={13} color={r.problems.length === 0 ? 'var(--intent-success)' : 'var(--intent-warning)'} />
                    <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{caso?.input ?? r.caseId}</span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: 19 }}>
                    {r.observedRoute.length ? `caminho: ${r.observedRoute.join(' → ')}` : 'ninguém recebe'}
                    {r.sideEffectsAvoided.length ? ` · em dublê: ${r.sideEffectsAvoided.join(', ')}` : ''}
                  </span>
                  {r.problems.map((p, i) => (
                    <span key={i} style={{ fontSize: 12, color: 'var(--intent-warning)', paddingLeft: 19 }}>
                      {p.message} — {p.fix}
                    </span>
                  ))}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {critica && critica.mergeSplit.length > 0 && (
        <Card tone="sunken">
          <div className="flex flex-col gap-1" data-testid="architect-mergesplit">
            <strong style={{ fontSize: 13 }}>Por que cada agente existe</strong>
            {critica.mergeSplit.map((d) => (
              <p key={d.agentKey} style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-body)' }}>{d.agentName}</span>: {d.rationale}
              </p>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
