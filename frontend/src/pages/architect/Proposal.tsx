import { useState } from 'react'
import { Badge, Button, Card, Icon, IconButton, Input, Textarea } from '../../ui'
import type { ArchitectPreview, ArchitectProject, Blueprint, BlueprintEdit, PreviewItem } from '../../lib/architect'
import { ACTION_LABEL, KIND_LABEL } from './shared'
import { Flow } from './Flow'

// A proposta, do jeito que se lê: o que vai ser criado, o que já existe e o que
// depende de você. O JSON fica em "Avançado", e não no caminho principal.

const TOM: Record<string, 'neutral' | 'brand' | 'success' | 'warning'> = {
  create: 'brand',
  reuse: 'neutral',
  update: 'warning',
  wait_user: 'warning',
}

/**
 * O que dá para corrigir aqui — texto, e só.
 *
 * Trocar o nome de um agente não deveria custar uma inferência e uma torcida: pedir ao
 * modelo devolve uma proposta inteira nova, e junto com o nome muda o que ninguém pediu
 * para mudar. O que decide ESTRUTURA (em que andar o agente fica, se o item cria ou
 * altera recurso existente) continua vindo do plano e da tela de ligações.
 */
const CAMPOS: Partial<Record<PreviewItem['kind'], { nome: string; label: string; linhas?: number; hint?: string }[]>> = {
  floor: [
    { nome: 'name', label: 'Nome' },
    { nome: 'mission', label: 'Missão', linhas: 2 },
  ],
  agent: [
    { nome: 'name', label: 'Nome' },
    { nome: 'objective', label: 'Objetivo', linhas: 2 },
    { nome: 'instructions', label: 'Instruções', linhas: 3 },
  ],
  sector: [
    { nome: 'name', label: 'Nome' },
    { nome: 'instruction', label: 'Instrução', linhas: 2 },
  ],
  routine: [
    { nome: 'name', label: 'Nome' },
    { nome: 'description', label: 'Descrição', linhas: 2 },
  ],
  app: [{ nome: 'reason', label: 'Por que este App', linhas: 2 }],
  knowledge: [
    { nome: 'title', label: 'Título' },
    { nome: 'description', label: 'Descrição', linhas: 2 },
    // O conteúdo, quando a pessoa JÁ o tem em mãos. Enquanto ele não vem, o item
    // segue pendente — o que nunca acontece é o texto ser inventado para preencher.
    {
      nome: 'content',
      label: 'Conteúdo (se você já tem)',
      linhas: 6,
      hint: 'Cole aqui o texto — cardápio, política, tabela. Ele vira um documento na base ao aplicar. Deixando vazio, o item continua pendente e nada é inventado.',
    },
  ],
}

const LISTA: Partial<Record<PreviewItem['kind'], keyof Blueprint>> = {
  floor: 'floors',
  agent: 'agents',
  sector: 'sectors',
  routine: 'routines',
  app: 'appRequirements',
  knowledge: 'knowledgeRequirements',
}

const MUDANCA: Record<string, { label: string; tone: 'brand' | 'warning' | 'danger' }> = {
  added: { label: 'Novo', tone: 'brand' },
  removed: { label: 'Saiu', tone: 'danger' },
  changed: { label: 'Mudou', tone: 'warning' },
}

/** Os valores atuais do item, para o formulário abrir preenchido. */
function valoresDe(blueprint: Blueprint | null | undefined, item: PreviewItem): Record<string, string> {
  const lista = LISTA[item.kind]
  if (!blueprint || !lista) return {}
  const fonte = (blueprint[lista] as { key: string }[] | undefined)?.find((i) => i.key === item.key) as Record<string, unknown> | undefined
  const fora: Record<string, string> = {}
  for (const campo of CAMPOS[item.kind] ?? []) fora[campo.nome] = typeof fonte?.[campo.nome] === 'string' ? (fonte[campo.nome] as string) : ''
  return fora
}

export function Proposal({
  project,
  preview,
  carregando,
  editavel,
  onEditar,
  onRevisar,
  onAplicar,
}: {
  project: ArchitectProject
  preview: ArchitectPreview | null
  carregando: boolean
  /** Proposta aplicada ou arquivada não se edita — o servidor recusa, e a tela também. */
  editavel: boolean
  onEditar: (edits: BlueprintEdit[]) => Promise<void>
  onRevisar: () => void
  onAplicar: () => void
}) {
  const [editando, setEditando] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)
  const [erroEdicao, setErroEdicao] = useState<string | null>(null)

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
  const mudancas = project.changes ?? []

  const abrir = (item: PreviewItem) => {
    setErroEdicao(null)
    setRascunho(valoresDe(project.blueprint, item))
    setEditando(`${item.kind}:${item.key}`)
  }

  const fechar = () => {
    setEditando(null)
    setRascunho({})
    setErroEdicao(null)
  }

  const salvar = async (edit: BlueprintEdit) => {
    setSalvando(true)
    setErroEdicao(null)
    try {
      await onEditar([edit])
      fechar()
    } catch (e) {
      // A recusa do servidor é o texto que importa: ela diz QUEM depende do item que a
      // pessoa tentou remover. Trocar por "não foi possível" apagaria a única pista.
      setErroEdicao((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

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




      {/* Duas colunas quando há espaço: o DESENHO e a LISTA de um lado, o que comenta
          a proposta do outro. `items-start` importa — sem ele o cartão curto estica até
          a altura do vizinho e vira um retângulo vazio do tamanho da tela. */}
      <div className="grid items-start gap-3 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
      {/* O desenho antes da lista: é ele que responde "quem aciona quem". */}
      <Flow blueprint={project.blueprint} />
      <Card>
        <div className="flex flex-col gap-2" data-testid="architect-items">
          {(preview?.items ?? []).map((item) => {
            const id = `${item.kind}:${item.key}`
            const campos = CAMPOS[item.kind]
            const podeEditar = editavel && Boolean(campos)

            if (editando === id && campos) {
              return (
                <div key={id} className="flex flex-col gap-2" data-testid={`architect-edit-${item.kind}-${item.key}`} style={{ padding: 10, borderRadius: 10, background: 'var(--surface-sunken)' }}>
                  {campos.map((campo) => (
                    <label key={campo.nome} className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {campo.label}
                      {campo.hint && <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{campo.hint}</span>}
                      {campo.linhas ? (
                        <Textarea
                          rows={campo.linhas}
                          value={rascunho[campo.nome] ?? ''}
                          onChange={(e) => setRascunho((r) => ({ ...r, [campo.nome]: e.target.value }))}
                          data-testid={`architect-edit-field-${campo.nome}`}
                        />
                      ) : (
                        <Input
                          value={rascunho[campo.nome] ?? ''}
                          onChange={(e) => setRascunho((r) => ({ ...r, [campo.nome]: e.target.value }))}
                          data-testid={`architect-edit-field-${campo.nome}`}
                        />
                      )}
                    </label>
                  ))}
                  {erroEdicao && (
                    <p style={{ fontSize: 12.5, color: 'var(--intent-danger)' }} data-testid="architect-edit-error">
                      {erroEdicao}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => salvar({ kind: item.kind, key: item.key, fields: rascunho })} disabled={salvando} data-testid="architect-edit-save">
                      Salvar
                    </Button>
                    <Button variant="secondary" onClick={fechar} disabled={salvando}>
                      Cancelar
                    </Button>
                    {/* Remove da PROPOSTA. Nada foi criado ainda, e o que sair aparece
                        em "o que mudou" — some do plano, não do escritório. */}
                    <Button variant="secondary" onClick={() => salvar({ kind: item.kind, key: item.key, remove: true })} disabled={salvando} data-testid="architect-edit-remove">
                      Tirar da proposta
                    </Button>
                  </div>
                </div>
              )
            }

            return (
              <div key={id} className="flex flex-wrap items-start gap-2" data-testid={`architect-item-${item.kind}-${item.key}`}>
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
                  {/* O porquê foi escrito pelo modelo e pago em token. Escondê-lo era
                      jogar fora a única explicação que a proposta traz. */}
                  {item.rationale && (
                    <p style={{ fontSize: 12.5, color: 'var(--text-muted)', overflowWrap: 'anywhere' }} data-testid={`architect-rationale-${item.kind}-${item.key}`}>
                      <span style={{ fontWeight: 600 }}>Por quê:</span> {item.rationale}
                    </p>
                  )}
                </div>
                {podeEditar && (
                  <IconButton
                    icon="pencil"
                    size="sm"
                    label={`Editar ${item.label}`}
                    onClick={() => abrir(item)}
                    disabled={carregando}
                    data-testid={`architect-item-edit-${item.kind}-${item.key}`}
                  />
                )}
              </div>
            )
          })}
        </div>
      </Card>

        </div>
        <div className="flex min-w-0 flex-col gap-3">
      {mudancas.length > 0 && (
        <Card>
          <div className="flex flex-col gap-2" data-testid="architect-changes">
            <div>
              <strong style={{ fontSize: 13 }}>O que mudou na última revisão</strong>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Comparado com a versão anterior desta proposta.</p>
            </div>
            {mudancas.map((m) => (
              <div key={`${m.kind}-${m.key}-${m.change}`} className="flex flex-wrap items-center gap-2" style={{ fontSize: 12.5 }}>
                <Badge tone={MUDANCA[m.change]?.tone ?? 'neutral'}>{MUDANCA[m.change]?.label ?? m.change}</Badge>
                <span style={{ color: 'var(--text-muted)' }}>{KIND_LABEL[m.kind]}</span>
                <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{m.label}</span>
                {m.fields.length > 0 && <span style={{ color: 'var(--text-muted)' }}>— {m.fields.join(', ')}</span>}
              </div>
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

        </div>
      </div>

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
