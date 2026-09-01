import { LAYERS } from '../../lib/architect'
import type { ArchitectPreview, BlueprintLayer } from '../../lib/architect'

// ESSENCIAL, RECOMENDADO E COMPLETO — três recortes do MESMO plano.
//
// Não são três propostas concorrentes: são o mesmo desenho com mais ou menos coisa. O
// essencial é o caminho mínimo até a primeira resposta; o completo é tudo o que foi
// entendido. Trocar aqui muda o que vai ser criado — e por isso muda o hash e devolve a
// proposta para revisão, em vez de ser um filtro de visualização.

export function Layers({
  preview,
  atual,
  editavel,
  carregando,
  onTrocar,
}: {
  preview: ArchitectPreview | null
  atual: BlueprintLayer
  editavel: boolean
  carregando: boolean
  onTrocar: (layer: BlueprintLayer) => void
}) {
  const contagens = preview?.layerCounts
  if (!contagens) return null

  return (
    <div className="flex flex-col gap-2" data-testid="architect-layers">
      <div>
        <strong style={{ fontSize: 13 }}>Quanto aplicar agora</strong>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>O mesmo plano, em três tamanhos. Dá para começar pequeno e voltar aqui depois.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Quanto aplicar agora">
        {LAYERS.map((c) => {
          const n = contagens[c.key]
          const ativa = c.key === atual
          return (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={ativa}
              disabled={!editavel || carregando || ativa}
              onClick={() => onTrocar(c.key)}
              data-testid={`architect-layer-${c.key}`}
              className="flex flex-col gap-1"
              style={{
                flex: '1 1 200px',
                minWidth: 0,
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 'var(--radius-card)',
                border: `1px solid ${ativa ? 'var(--intent-brand)' : 'var(--border-subtle)'}`,
                background: ativa ? 'color-mix(in srgb, var(--intent-brand) 8%, transparent)' : 'var(--surface-card)',
                cursor: !editavel || ativa ? 'default' : 'pointer',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.hint}</span>
              {/* A contagem é o que torna a escolha comparável: "3 agentes" e "1 agente"
                  dizem mais do que "recomendado" e "essencial". */}
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                {[
                  `${n.agents} ${n.agents === 1 ? 'agente' : 'agentes'}`,
                  n.sectors > 0 && `${n.sectors} ${n.sectors === 1 ? 'setor' : 'setores'}`,
                  n.routines > 0 && `${n.routines} ${n.routines === 1 ? 'rotina' : 'rotinas'}`,
                  n.apps > 0 && `${n.apps} ${n.apps === 1 ? 'App' : 'Apps'}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
