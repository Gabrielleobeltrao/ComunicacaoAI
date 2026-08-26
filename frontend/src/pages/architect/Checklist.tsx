import { Badge, Button, Card, Icon, ProgressBar } from '../../ui'
import type { ArchitectProject, ChecklistItem } from '../../lib/architect'
import { CHECK_LABEL } from './shared'

// A checklist e a prontidão.
//
// Obrigatório e opcional aparecem separados de propósito: somados, um monte de item
// opcional concluído faria a barra dizer "quase pronto" enquanto o cardápio, que é o
// que falta de verdade, continua ausente.

const ICONE: Record<ChecklistItem['status'], { nome: string; cor: string }> = {
  done: { nome: 'check', cor: 'var(--intent-success)' },
  ready: { nome: 'circle', cor: 'var(--text-muted)' },
  blocked: { nome: 'lock', cor: 'var(--text-faint)' },
  pending: { nome: 'circle', cor: 'var(--text-muted)' },
}

export function Checklist({
  project,
  links,
  onMarcar,
  onReconferir,
  carregando,
}: {
  project: ArchitectProject
  links: { kind: string; key: string; id: string; path: string }[]
  onMarcar: (itemId: string, done: boolean) => void
  onReconferir: () => void
  carregando: boolean
}) {
  const itens = project.checklist ?? []
  if (!itens.length) {
    return (
      <Card>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="architect-no-checklist">
          A checklist aparece junto com a proposta.
        </p>
      </Card>
    )
  }
  const r = project.readiness
  const obrigatorios = itens.filter((i) => i.required)
  const opcionais = itens.filter((i) => !i.required)

  return (
    <div className="flex flex-col gap-3" data-testid="architect-checklist">
      <Card>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong style={{ fontSize: 13 }}>Obrigatórios</strong>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }} data-testid="architect-required-progress">
              {r.requiredDone}/{r.requiredTotal}
            </span>
          </div>
          <ProgressBar value={r.requiredTotal ? (r.requiredDone / r.requiredTotal) * 100 : 0} />
          {r.optionalTotal > 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }} data-testid="architect-optional-progress">
              Opcionais: {r.optionalDone}/{r.optionalTotal}
            </p>
          )}
          <Badge tone={r.ready ? 'success' : 'warning'} data-testid="architect-ready">
            {r.ready ? '100% pronto' : 'Ainda faltam pendências obrigatórias'}
          </Badge>
        </div>
      </Card>

      {[obrigatorios, opcionais].map((grupo, n) =>
        grupo.length === 0 ? null : (
          <Card key={n}>
            <div className="flex flex-col gap-2">
              <strong style={{ fontSize: 13 }}>{n === 0 ? 'Para funcionar' : 'Quando puder'}</strong>
              {grupo.map((item) => {
                const icone = ICONE[item.status]
                const alvo = item.target && links.find((l) => l.kind === item.target!.kind && l.key === item.target!.key)
                return (
                  <div key={item.id} className="flex items-start gap-2" data-testid={`architect-check-${item.id}`}>
                    <Icon name={icone.nome} size={16} color={icone.cor} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: 'anywhere', textDecoration: item.status === 'done' ? 'line-through' : 'none' }}>
                          {item.title}
                        </span>
                        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{CHECK_LABEL[item.category]}</span>
                      </div>
                      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{item.description}</p>
                      <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 4 }}>
                        {/* Leva direto ao lugar de resolver — uma checklist que só informa
                            deixa a pessoa procurando a tela sozinha. */}
                        {(item.actionPath || alvo) && (
                          <a href={item.actionPath ?? alvo!.path} style={{ fontSize: 12.5, color: 'var(--intent-brand)' }} data-testid={`architect-check-link-${item.id}`}>
                            Abrir
                          </a>
                        )}
                        {item.completionMode === 'manual' ? (
                          <button
                            type="button"
                            data-testid={`architect-check-toggle-${item.id}`}
                            onClick={() => onMarcar(item.id, item.status !== 'done')}
                            style={{ border: 0, background: 'transparent', color: 'var(--intent-brand)', fontSize: 12.5, padding: '4px 0', minHeight: 32 }}
                          >
                            {item.status === 'done' ? 'Desmarcar' : 'Marcar como feito'}
                          </button>
                        ) : (
                          <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }} data-testid={`architect-check-auto-${item.id}`}>
                            conferido pelo sistema
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        ),
      )}

      <div>
        <Button variant="secondary" onClick={onReconferir} disabled={carregando} data-testid="architect-recheck">
          Reconferir
        </Button>
      </div>
    </div>
  )
}
