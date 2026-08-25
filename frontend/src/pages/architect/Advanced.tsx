import { useEffect, useState } from 'react'
import { Badge, Button, Card, Select } from '../../ui'
import * as api from '../../lib/architect'
import type { ApplyStep, ArchitectProject } from '../../lib/architect'

// "Avançado": o que existe, mas não fica no caminho de quem só quer montar a operação.
//
// Provedor e modelo, os passos que a aplicação já executou, e as duas ações que
// desfazem — cada uma com o impacto escrito antes do clique.

const ROTULO_PASSO: Record<string, string> = {
  created: 'criado',
  reused: 'reaproveitado',
  updated: 'alterado',
  skipped: 'pulado',
  failed: 'falhou',
}

export function Advanced({
  project,
  steps,
  onTrocarProvedor,
  onArquivar,
  onDesfazer,
  carregando,
}: {
  project: ArchitectProject
  steps: ApplyStep[]
  onTrocarProvedor: (patch: { provider?: 'anthropic' | 'openai'; model?: string | null }) => void
  onArquivar: () => void
  onDesfazer: () => void
  carregando: boolean
}) {
  const [provedores, setProvedores] = useState<Awaited<ReturnType<typeof api.listProviders>>>([])
  const [confirmando, setConfirmando] = useState<'archive' | 'rollback' | null>(null)

  useEffect(() => {
    api.listProviders().then(setProvedores).catch(() => setProvedores([]))
  }, [])

  // Só o que a conta TEM chave para usar. Oferecer o resto seria oferecer uma recusa.
  const disponiveis = provedores.filter((p) => p.configured)
  const atual = provedores.find((p) => p.id === project.provider)
  const criados = steps.filter((s) => s.status === 'created' || s.status === 'updated').length

  return (
    <details data-testid="architect-advanced">
      <summary style={{ fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>Avançado</summary>
      <div className="flex flex-col gap-3" style={{ paddingTop: 10 }}>
        <Card>
          <div className="flex flex-col gap-2" data-testid="architect-provider">
            <strong style={{ fontSize: 13 }}>Quem pensa a proposta</strong>
            {disponiveis.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                Nenhum provedor configurado. <a href="/settings" style={{ color: 'var(--intent-brand)' }}>Abrir Configurações</a>
              </p>
            ) : (
              <>
                <Select
                  aria-label="Provedor"
                  data-testid="architect-provider-select"
                  value={project.provider ?? ''}
                  onChange={(e) => onTrocarProvedor({ provider: e.target.value as 'anthropic' | 'openai', model: null })}
                >
                  {disponiveis.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Modelo"
                  data-testid="architect-model-select"
                  value={project.model ?? ''}
                  onChange={(e) => onTrocarProvedor({ model: e.target.value || null })}
                >
                  <option value="">Padrão{atual ? ` (${atual.defaultModel})` : ''}</option>
                  {(atual?.models ?? []).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </>
            )}
          </div>
        </Card>

        {steps.length > 0 && (
          <Card>
            <div className="flex flex-col gap-1" data-testid="architect-steps">
              <strong style={{ fontSize: 13 }}>O que a aplicação fez</strong>
              {steps.map((s, i) => (
                <div key={`${s.kind}-${s.key}-${i}`} className="flex flex-wrap items-center gap-2" style={{ fontSize: 12.5 }}>
                  <Badge tone={s.status === 'failed' ? 'danger' : s.status === 'skipped' ? 'warning' : 'success'}>{ROTULO_PASSO[s.status] ?? s.status}</Badge>
                  <span style={{ overflowWrap: 'anywhere' }}>
                    {s.kind}: {s.key}
                  </span>
                  {s.message && <span style={{ color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{s.message}</span>}
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <div className="flex flex-col gap-1">
            <strong style={{ fontSize: 13 }}>A proposta, como o sistema a lê</strong>
            <pre style={{ fontSize: 11, background: 'var(--surface-sunken)', padding: 10, borderRadius: 8, overflowX: 'auto', maxHeight: 320 }}>
              {JSON.stringify(project.blueprint, null, 2)}
            </pre>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-2" data-testid="architect-danger">
            <strong style={{ fontSize: 13 }}>Encerrar este projeto</strong>
            {confirmando === null && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setConfirmando('archive')} disabled={carregando} data-testid="architect-archive">
                  Arquivar
                </Button>
                {project.status === 'applied' && (
                  <Button variant="secondary" onClick={() => setConfirmando('rollback')} disabled={carregando} data-testid="architect-rollback">
                    Desfazer o que foi criado
                  </Button>
                )}
              </div>
            )}
            {/* O impacto ANTES do clique, e diferente para cada ação: as duas encerram
                o projeto, mas só uma apaga alguma coisa. */}
            {confirmando === 'archive' && (
              <div className="flex flex-col gap-2" data-testid="architect-confirm-archive">
                <p style={{ fontSize: 13 }}>Arquivar tira o projeto da lista. Nada do que ele criou é removido: andar, agentes e setores continuam de pé e editáveis.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setConfirmando(null)}>
                    Cancelar
                  </Button>
                  <Button onClick={onArquivar} data-testid="architect-archive-confirm">
                    Arquivar
                  </Button>
                </div>
              </div>
            )}
            {confirmando === 'rollback' && (
              <div className="flex flex-col gap-2" data-testid="architect-confirm-rollback">
                <p style={{ fontSize: 13 }}>
                  Isto remove os {criados} {criados === 1 ? 'recurso criado' : 'recursos criados'} por esta aplicação. O que você editou depois, o que já existia e o que foi criado por outra
                  aplicação ficam de pé — e você vê a lista do que sobrou.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setConfirmando(null)}>
                    Cancelar
                  </Button>
                  <Button onClick={onDesfazer} data-testid="architect-rollback-confirm">
                    Desfazer
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </details>
  )
}
