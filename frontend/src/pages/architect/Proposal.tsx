import { Badge, Button, Card, Icon } from '../../ui'
import type { ArchitectPreview, ArchitectProject } from '../../lib/architect'
import { ACTION_LABEL, KIND_LABEL } from './shared'

// A proposta, do jeito que se lê: o que vai ser criado, o que já existe e o que
// depende de você. O JSON fica em "Avançado", e não no caminho principal.

const TOM: Record<string, 'neutral' | 'brand' | 'success' | 'warning'> = {
  create: 'brand',
  reuse: 'neutral',
  update: 'warning',
  wait_user: 'warning',
}

export function Proposal({
  project,
  preview,
  carregando,
  onRevisar,
  onAplicar,
}: {
  project: ArchitectProject
  preview: ArchitectPreview | null
  carregando: boolean
  onRevisar: () => void
  onAplicar: () => void
}) {
  if (!project.hasBlueprint) {
    return (
      <Card>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="architect-no-proposal">
          A proposta aparece aqui quando o Arquiteto tiver o suficiente. Responda as perguntas ao lado, ou peça uma primeira proposta agora.
        </p>
      </Card>
    )
  }

  const erros = (preview?.issues ?? []).filter((i) => i.severity === 'error')
  const avisos = (preview?.issues ?? []).filter((i) => i.severity === 'warning')

  return (
    <div className="flex flex-col gap-3" data-testid="architect-proposal">
      {preview && (
        <Card>
          <div className="flex flex-wrap items-center gap-2" data-testid="architect-counts">
            <Badge tone="brand">{preview.counts.create} a criar</Badge>
            {preview.counts.reuse > 0 && <Badge>{preview.counts.reuse} reaproveitados</Badge>}
            {preview.counts.update > 0 && <Badge tone="warning">{preview.counts.update} alterações</Badge>}
            {preview.counts.waitUser > 0 && <Badge tone="warning">{preview.counts.waitUser} dependem de você</Badge>}
          </div>
        </Card>
      )}

      {erros.length > 0 && (
        <Card>
          <div className="flex flex-col gap-2" data-testid="architect-issues">
            <strong style={{ fontSize: 13, color: 'var(--intent-danger)' }}>Precisa ser resolvido antes de aplicar</strong>
            {erros.map((i, n) => (
              <p key={`${i.path}-${n}`} style={{ fontSize: 13 }}>
                {i.message}
                {i.suggestedAction && <span style={{ color: 'var(--text-muted)' }}> — {i.suggestedAction}</span>}
              </p>
            ))}
          </div>
        </Card>
      )}

      {avisos.length > 0 && (
        <Card>
          <div className="flex flex-col gap-1" data-testid="architect-warnings">
            <strong style={{ fontSize: 13 }}>Vale saber</strong>
            {avisos.map((i, n) => (
              <p key={`${i.path}-${n}`} style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {i.message}
              </p>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-2" data-testid="architect-items">
          {(preview?.items ?? []).map((item) => (
            <div key={`${item.kind}-${item.key}`} className="flex flex-wrap items-start gap-2" data-testid={`architect-item-${item.kind}-${item.key}`}>
              <Badge tone={TOM[item.action]}>{ACTION_LABEL[item.action]}</Badge>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span style={{ fontWeight: 600, fontSize: 13.5, overflowWrap: 'anywhere' }}>{item.label}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{KIND_LABEL[item.kind]}</span>
                  {/* Custo não se esconde: uma etapa que chama o modelo é dita como tal. */}
                  {item.usesLlm && (
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'inline-flex', gap: 4, alignItems: 'center' }} data-testid="architect-uses-llm">
                      <Icon name="sparkles" size={12} /> usa IA
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {(project.assumptions?.length ?? 0) > 0 && (
        <Card>
          <div className="flex flex-col gap-1" data-testid="architect-assumptions">
            <strong style={{ fontSize: 13 }}>O que eu assumi</strong>
            {project.assumptions!.map((a) => (
              <p key={a.key} style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {a.text}
              </p>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onRevisar} disabled={carregando} data-testid="architect-review">
          Revisar mudanças
        </Button>
        <Button onClick={onAplicar} disabled={carregando || !preview?.valid} data-testid="architect-apply">
          Aplicar
        </Button>
      </div>


    </div>
  )
}
