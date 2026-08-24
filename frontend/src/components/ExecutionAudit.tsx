import { useMemo } from 'react'
import { auditarEtapas, auditarPlanos, custoPorTipo, formatarDuracao } from '../lib/executionTrace'
import type { TraceEvent } from '../lib/executionTrace'

// A execução vista por quem INVESTIGA, e não por quem acompanha.
//
// A linha do tempo conta a história na ordem em que aconteceu — que é o que serve enquanto
// acontece. Quando algo dá errado, as perguntas são outras e sempre as mesmas: quem
// trabalhou e por quê, de onde vieram os campos de cada etapa, o que foi validado, o que
// saiu como dado e o que saiu como texto, e quanto custou cada tipo de executor.
//
// Nenhum evento novo é emitido para isto: são os MESMOS eventos, lidos de outro jeito.

const ROTULO: Record<string, string> = { llm: 'Modelo', function: 'Função', tool: 'Ferramenta' }

const Secao = ({ titulo, children, testId }: { titulo: string; children: React.ReactNode; testId: string }) => (
  <section className="border-t border-(--border-subtle) px-3 py-2 first:border-t-0" data-testid={testId}>
    <h4 className="mb-1.5 text-[10px] font-semibold tracking-wide text-(--text-faint) uppercase">{titulo}</h4>
    {children}
  </section>
)

export function ExecutionAudit({ events }: { events: TraceEvent[] }) {
  const etapas = useMemo(() => auditarEtapas(events), [events])
  const planos = useMemo(() => auditarPlanos(events), [events])
  const custos = useMemo(() => custoPorTipo(events), [events])

  if (etapas.length === 0 && planos.length === 0) return null

  return (
    <div className="min-w-0 rounded-lg border border-(--border-subtle) bg-(--surface-card)/50" data-testid="execution-audit">
      <div className="border-b border-(--border-subtle) px-3 py-2">
        <span className="text-xs font-semibold text-(--text-heading)">Auditoria</span>
      </div>

      {planos.map((plano) => (
        <Secao key={`${plano.planId}-${plano.round}`} titulo={`Plano · rodada ${plano.round} · ${plano.source}`} testId="audit-plan">
          <p className="mb-1 font-mono text-[10px] text-(--text-faint)">{plano.planId}</p>
          <ul className="space-y-1">
            {plano.steps.map((s) => (
              <li key={s.taskId} className="text-xs text-(--text-body)" data-testid="audit-plan-step">
                <span className="font-mono text-[10px] text-(--text-faint)">{s.taskId}</span> {s.name}
                <span className="text-(--text-faint)"> · {ROTULO[s.executorKind] ?? s.executorKind}</span>
                {/* A DEPENDÊNCIA é metade do plano: sem ela a lista parece um conjunto de
                    tarefas paralelas, e a ordem em que as coisas tinham que acontecer some. */}
                {s.dependsOn.length > 0 && <span className="text-(--text-faint)"> · depois de {s.dependsOn.join(', ')}</span>}
                {s.onFailure !== 'skip' && <span className="text-(--text-faint)"> · se falhar: {s.onFailure}</span>}
                {s.inputOrigins.length > 0 && (
                  <div className="mt-0.5 font-mono text-[10px] text-(--text-faint)" data-testid="audit-input-origins">
                    {s.inputOrigins.join('  ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Secao>
      ))}

      {etapas.length > 0 && (
        <Secao titulo="Etapas" testId="audit-steps">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-[11px]">
              <thead className="text-[10px] text-(--text-faint) uppercase">
                <tr>
                  <th scope="col" className="py-1 pr-2 font-medium">Etapa</th>
                  <th scope="col" className="py-1 pr-2 font-medium">Executor</th>
                  <th scope="col" className="py-1 pr-2 font-medium">Rodou</th>
                  <th scope="col" className="py-1 pr-2 font-medium">Validação</th>
                  <th scope="col" className="py-1 pr-2 font-medium">Saída</th>
                  <th scope="col" className="py-1 pr-2 font-medium">Tempo</th>
                  <th scope="col" className="py-1 font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody className="text-(--text-body)">
                {etapas.map((e) => (
                  <tr key={e.stepId} className="border-t border-(--border-subtle)" data-testid="audit-step" data-kind={e.executorKind}>
                    <td className="py-1 pr-2 font-mono text-[10px]">{e.stepId}</td>
                    <td className="py-1 pr-2">{ROTULO[e.executorKind] ?? e.executorKind}</td>
                    <td className="py-1 pr-2 font-mono text-[10px] break-all">{e.ran || '—'}</td>
                    <td className="py-1 pr-2">
                      {/* Entrada e saída SEPARADAS: "falhou" não diz se o agente recebeu
                          errado ou devolveu errado, e são dois defeitos em lugares diferentes. */}
                      <span data-testid="audit-validation">
                        {e.inputValid === false ? 'entrada ✗' : e.outputValid === false ? 'saída ✗' : e.inputValid ? 'ok' : '—'}
                      </span>
                      {e.error && (
                        <span className="block text-[10px]" style={{ color: 'var(--status-blocked)' }} data-testid="audit-error">
                          {e.error}
                          {e.field ? ` · ${e.field}` : ''}
                        </span>
                      )}
                      {e.repaired && (
                        <span className="block text-[10px] text-(--text-faint)" data-testid="audit-retry">
                          1 correção de formato
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-[10px] text-(--text-faint)">
                      {/* Dado e texto são coisas diferentes desde a fase 4. Somá-los aqui
                          desfaria a distinção justamente na tela que existe para mostrá-la. */}
                      {[e.hasStructured ? 'dados' : '', e.hasText ? 'texto' : ''].filter(Boolean).join(' + ') || '—'}
                    </td>
                    <td className="py-1 pr-2 whitespace-nowrap">{formatarDuracao(e.durationMs) || '—'}</td>
                    <td className="py-1">{e.tokens || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>
      )}

      {custos.length > 1 && (
        <Secao titulo="Custo por tipo de executor" testId="audit-cost">
          <ul className="space-y-0.5 text-xs text-(--text-body)">
            {custos.map((c) => (
              <li key={c.executorKind} data-testid="audit-cost-row" data-kind={c.executorKind}>
                {ROTULO[c.executorKind] ?? c.executorKind}: {c.etapas} etapa(s) · {c.tokens} token(s) · {formatarDuracao(c.durationMs) || '0 ms'}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-(--text-faint)">
            Uma função determinística custa zero token. É essa a diferença que decide se vale tirar um trabalho do modelo.
          </p>
        </Secao>
      )}
    </div>
  )
}
