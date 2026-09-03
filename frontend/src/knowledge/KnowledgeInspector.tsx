import { useEffect, useState } from 'react'
import { Badge, Button, Card } from '../ui'
import * as api from '../lib/knowledge'
import type { DocumentImpact, GraphEdge, GraphNode, KnowledgeDoc } from '../lib/knowledge'
import { LABEL_TIPO } from './KnowledgeNode'

// O PAINEL do nó selecionado.
//
// A distinção que ele existe para fazer: `Pode acessar` é permissão; `Usou em execuções`
// é evidência. Escrever "3 agentes usam este documento" com a permissão na mão é a frase
// mais fácil de produzir e a mais fácil de estar errada.

export function KnowledgeInspector({
  node,
  edges,
  nodes,
  onAbrir,
  onFechar,
}: {
  node: GraphNode
  edges: GraphEdge[]
  nodes: GraphNode[]
  onAbrir: (documentId: string) => void
  onFechar: () => void
}) {
  const [doc, setDoc] = useState<KnowledgeDoc | null>(null)
  const [impacto, setImpacto] = useState<DocumentImpact | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const documentId = node.kind === 'document' ? node.id.split(':')[1] : null

  useEffect(() => {
    if (!documentId) {
      setDoc(null)
      setImpacto(null)
      return
    }
    let vivo = true
    setCarregando(true)
    setErro(null)
    Promise.all([api.getDocument(documentId), api.getImpact(documentId).catch(() => null)])
      .then(([d, i]) => {
        if (!vivo) return
        setDoc(d)
        setImpacto(i)
      })
      .catch((e) => vivo && setErro((e as Error).message))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [documentId])

  const nomeDe = (id: string) => nodes.find((n) => n.id === id)?.label ?? id
  // As conexões também como LISTA: para quem usa leitor de tela, a linha do grafo é
  // decorativa e não existe.
  const conexoes = edges.filter((e) => e.source === node.id || e.target === node.id)

  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="knowledge-inspector">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div style={{ minWidth: 0 }}>
            <span style={rotulo}>{LABEL_TIPO[node.kind]}</span>
            <strong style={{ fontSize: 15, display: 'block', overflowWrap: 'anywhere' }}>{node.label}</strong>
          </div>
          <Button variant="secondary" onClick={onFechar} data-testid="knowledge-inspector-close">
            Fechar
          </Button>
        </div>

        {node.kind === 'document' && (
          <>
            {carregando && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Carregando documento…</p>}
            {erro && (
              <p style={{ fontSize: 13, color: 'var(--intent-danger-text)' }} role="alert">
                {erro}
              </p>
            )}
            {doc && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{api.AUTHORITY_LABEL[doc.authority]}</Badge>
                  <Badge tone={doc.lifecycleStatus === 'approved' ? 'success' : 'warning'}>{api.LIFECYCLE_LABEL[doc.lifecycleStatus]}</Badge>
                  {doc.indexStatus !== 'indexed' && (
                    <Badge tone={doc.indexStatus === 'error' ? 'danger' : 'warning'}>{doc.indexStatus === 'error' ? 'erro ao indexar' : 'indexando'}</Badge>
                  )}
                </div>
                {doc.indexError && (
                  <p style={{ fontSize: 12.5, color: 'var(--intent-danger-text)' }} data-testid="knowledge-index-error">
                    {doc.indexError}
                  </p>
                )}
                <Campo label="Validade">
                  {doc.validUntil ? `até ${new Date(doc.validUntil).toLocaleDateString('pt-BR')}` : 'sem validade declarada'}
                </Campo>
                <Campo label="Última verificação">
                  {doc.verifiedAt ? new Date(doc.verifiedAt).toLocaleDateString('pt-BR') : 'nunca verificado'}
                  {doc.reviewIntervalDays ? ` · revisar a cada ${doc.reviewIntervalDays} dias` : ''}
                </Campo>
                <Campo label="Origem">{doc.source ?? 'manual'}</Campo>
                <div>
                  <Button onClick={() => onAbrir(documentId!)} data-testid="knowledge-open-editor">
                    Abrir
                  </Button>
                </div>
              </>
            )}

            {impacto && (
              <div className="flex flex-col gap-2" data-testid="knowledge-impact">
                {/* As duas contagens, com nomes diferentes — de propósito. */}
                <Campo label="Pode acessar" testid="knowledge-accessible-by">
                  {impacto.accessibleBy.length === 0 ? 'nenhum agente' : impacto.accessibleBy.map((a) => a.name).join(', ')}
                </Campo>
                <Campo label="Usou em execuções" testid="knowledge-used-by">
                  {impacto.usedCount === 0
                    ? 'nenhuma execução registrada'
                    : `${impacto.usedCount} ${impacto.usedCount === 1 ? 'execução' : 'execuções'}`}
                </Campo>
                {impacto.openConflicts.length > 0 && (
                  <Campo label="Em conflito">{impacto.openConflicts.map((c) => c.subject).join(', ')}</Campo>
                )}
                {impacto.resolvedGaps.length > 0 && <Campo label="Resolveu lacunas">{impacto.resolvedGaps.map((g) => g.subject).join(' · ')}</Campo>}
                {impacto.linkedFrom.length > 0 && <Campo label="Citado por">{impacto.linkedFrom.map((l) => l.title).join(', ')}</Campo>}
              </div>
            )}
          </>
        )}

        {node.kind === 'agent' && <AcessoDoAgente agentId={node.ownerId!} />}

        <div className="flex flex-col gap-1">
          <span style={rotulo}>Conexões</span>
          {conexoes.length === 0 ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>nenhuma</span>
          ) : (
            <ul style={{ fontSize: 12.5, color: 'var(--text-muted)', paddingLeft: 16, margin: 0 }} data-testid="knowledge-connections">
              {conexoes.slice(0, 20).map((e) => (
                <li key={e.id}>
                  {e.source === node.id ? `→ ${nomeDe(e.target)}` : `← ${nomeDe(e.source)}`} <span style={{ color: 'var(--text-faint)' }}>({LIGACAO[e.kind]})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}

const LIGACAO: Record<GraphEdge['kind'], string> = { contains: 'contém', references: 'cita', can_access: 'pode acessar' }

/** O que ESTE agente alcança — pela mesma resolução que a execução usa. */
function AcessoDoAgente({ agentId }: { agentId: string }) {
  const [dados, setDados] = useState<api.ResolvedAccess | null>(null)
  useEffect(() => {
    let vivo = true
    api
      .getResolvedAccess(agentId)
      .then((r) => vivo && setDados(r))
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [agentId])
  if (!dados) return null
  return (
    <div className="flex flex-col gap-1" data-testid="knowledge-agent-access">
      <span style={rotulo}>Pode ler</span>
      {dados.owners.length === 0 ? (
        <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>nenhuma base</span>
      ) : (
        <ul style={{ fontSize: 12.5, color: 'var(--text-muted)', paddingLeft: 16, margin: 0 }}>
          {dados.owners.map((o) => (
            <li key={`${o.ownerType}:${o.ownerId}`}>
              {api.SCOPE_LABEL[o.ownerType]} {o.name ? `“${o.name}”` : ''} <span style={{ color: 'var(--text-faint)' }}>({MOTIVO[o.reason] ?? o.reason})</span>
            </li>
          ))}
        </ul>
      )}
      {!dados.policy.configured && (
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Usando o padrão do sistema — ninguém escolheu isto ainda.</span>
      )}
    </div>
  )
}

const MOTIVO: Record<string, string> = {
  own: 'base própria',
  floor: 'andar',
  building: 'prédio',
  execution_sector: 'setor da execução',
  home_sector: 'setor de casa',
  selected_sector: 'setor escolhido',
}

const rotulo = { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: 'var(--text-faint)' }

function Campo({ label, children, testid }: { label: string; children: React.ReactNode; testid?: string }) {
  return (
    <div className="flex flex-col" data-testid={testid}>
      <span style={rotulo}>{label}</span>
      <span style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}
