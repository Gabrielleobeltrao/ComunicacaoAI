import { useState } from 'react'
import { Badge, Button, Card, Icon, IconButton, Input, Textarea } from '../../ui'
import type { ArchitectPreview, ArchitectProject, Blueprint, BlueprintEdit, BlueprintLayer, PreviewItem } from '../../lib/architect'
import { ACTION_LABEL, KIND_LABEL } from './shared'
import { Critique } from './Critique'
import { AgentFicha } from './AgentCards'
import { Layers } from './Layers'

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

/** A ordem em que os grupos aparecem: o lugar, depois quem trabalha nele, depois o resto. */
const GRUPOS: PreviewItem['kind'][] = ['floor', 'sector', 'agent', 'routine', 'app', 'knowledge']

const GRUPO_LABEL: Record<PreviewItem['kind'], string> = {
  building: 'Prédio',
  floor: 'Andar',
  sector: 'Setores',
  agent: 'Quem trabalha',
  routine: 'Roda sozinho',
  app: 'Apps',
  knowledge: 'Conhecimento',
}

const TITULO_GRUPO = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase' as const,
  color: 'var(--text-faint)',
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
  onTrocarCamada,
}: {
  project: ArchitectProject
  preview: ArchitectPreview | null
  carregando: boolean
  /** Proposta aplicada ou arquivada não se edita — o servidor recusa, e a tela também. */
  editavel: boolean
  onEditar: (edits: BlueprintEdit[]) => Promise<void>
  onRevisar: () => void
  onAplicar: () => void
  onTrocarCamada: (layer: BlueprintLayer) => void
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

  /**
   * A lista AGRUPADA por tipo.
   *
   * Uma fileira de vinte linhas com o mesmo formato não se lê — se rola. Agrupada, a
   * pergunta "quantos agentes e quem são" tem resposta num olhar, e o rótulo do tipo
   * sai de cada linha (fica no título do grupo) em vez de se repetir vinte vezes.
   */
  const porTipo = new Map<PreviewItem['kind'], PreviewItem[]>()
  for (const item of preview?.items ?? []) porTipo.set(item.kind, [...(porTipo.get(item.kind) ?? []), item])
  const gruposComItens = GRUPOS.filter((g) => (porTipo.get(g)?.length ?? 0) > 0)

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
      {/* A faixa: quanto vai ser feito, e o que fazer a respeito — na mesma linha.
          Eram dois cartões grandes em pontas opostas da rolagem: a contagem no topo e
          os botões depois de tudo, a uma tela inteira de distância do que eles aplicam. */}
      {preview && (
        <div
          className="flex flex-wrap items-center justify-between gap-3"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 5,
            padding: '10px 14px',
            borderRadius: 'var(--radius-card)',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div className="flex flex-wrap items-center gap-2" data-testid="architect-counts">
            <Badge tone="brand">{preview.counts.create} a criar</Badge>
            {preview.counts.reuse > 0 && <Badge>{preview.counts.reuse} reaproveitados</Badge>}
            {preview.counts.update > 0 && <Badge tone="warning">{preview.counts.update} alterações</Badge>}
            {preview.counts.waitUser > 0 && <Badge tone="warning">{preview.counts.waitUser} dependem de você</Badge>}
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
      )}

      {/* Quanto aplicar agora vem primeiro: é a decisão que muda todo o resto da tela. */}
      <Layers preview={preview} atual={project.layer ?? 'complete'} editavel={editavel} carregando={carregando} onTrocar={onTrocarCamada} />

      {/* O crítico e o ensaio vêm ANTES da lista: eles decidem se vale aplicar. */}
      <Critique preview={preview} />


      {erros.length > 0 && (
        <Card>
          <div className="flex flex-col gap-2" data-testid="architect-issues">
            <strong style={{ fontSize: 13, color: 'var(--intent-danger-text)' }}>Precisa ser resolvido antes de aplicar</strong>
            {erros.map((i, n) => (
              <p key={`${i.path}-${n}`} style={{ fontSize: 13 }}>
                {i.message}
                {i.suggestedAction && <span style={{ color: 'var(--text-muted)' }}> — {i.suggestedAction}</span>}
              </p>
            ))}
          </div>
        </Card>
      )}




      {/* O DESENHO e o que comenta a proposta de um lado; a LISTA, que é o bloco
          mais alto, sozinha do outro. Empilhar desenho e lista na mesma coluna
          deixava a coluna vizinha vazia da metade da tela para baixo. */}
      {/* Leitura VERTICAL, de cima a baixo: resumo e ações, o que trava, o que
          comenta a proposta, e por fim o que vai ser feito, item a item. Em duas
          colunas, metade disso ficava fora do caminho dos olhos — e agora esta
          tela tem a largura inteira da área de trabalho para ela. */}


      {mudancas.length > 0 && (
        <Card tone="sunken">
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
        <Card tone="sunken">
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
        <Card tone="sunken">
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

      <Card>
        <div className="flex flex-col gap-4" data-testid="architect-items">
          {gruposComItens.map((grupo) => (
            <div key={grupo} className="flex flex-col gap-2">
              <span style={TITULO_GRUPO}>{GRUPO_LABEL[grupo]}</span>
              {grupo === 'agent' && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Cada um com o que entrega, quando é acionado e com o quê. O que estiver em branco precisa ser dito antes de aplicar.
                </span>
              )}
              <div
                className={grupo === 'agent' ? 'grid items-start gap-3' : 'flex flex-col gap-2'}
                style={grupo === 'agent' ? { gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' } : undefined}
              >
              {(porTipo.get(grupo) ?? []).map((item) => {
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
                    <p style={{ fontSize: 12.5, color: 'var(--intent-danger-text)' }} data-testid="architect-edit-error">
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
              <div
                key={id}
                className="flex flex-wrap items-start gap-2"
                data-testid={`architect-item-${item.kind}-${item.key}`}
                style={item.kind === 'agent' ? { padding: 10, borderRadius: 10, background: 'var(--surface-sunken)' } : undefined}
              >
                <Badge tone={TOM[item.action]}>{ACTION_LABEL[item.action]}</Badge>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span style={{ fontWeight: 600, fontSize: 13.5, overflowWrap: 'anywhere' }}>{item.label}</span>
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
                  {/* A ficha do agente vem NA linha dele: o que ele entrega, com o quê,
                      e por que é separado — sem virar uma segunda lista de agentes. */}
                  {item.kind === 'agent' && <AgentFicha agentKey={item.key} blueprint={project.blueprint} preview={preview} />}
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
            </div>
          ))}
        </div>
      </Card>


    </div>
  )
}
