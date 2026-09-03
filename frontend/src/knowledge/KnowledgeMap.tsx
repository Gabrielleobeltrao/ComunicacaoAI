import { useCallback, useMemo, useRef, useState } from 'react'
import { Button, Card } from '../ui'
import { buildCharacterResolver } from '../lib/agentAvatar'
import { useKnowledgeGraph } from './useKnowledgeGraph'
import { boundsOf, layoutGraph } from './layout'
import type { Positioned } from './layout'
import { KnowledgeNode, RAIO } from './KnowledgeNode'
import { KnowledgeFilters } from './KnowledgeFilters'
import type { FiltrosDoMapa } from './KnowledgeFilters'
import { KnowledgeInspector } from './KnowledgeInspector'
import { KnowledgeEditor } from './KnowledgeEditor'
import type { KnowledgeScopeType } from '../lib/knowledge'

// O MAPA DE CONHECIMENTO.
//
// Feito em SVG com os helpers que já existem — retrato do agente, cor do setor, tokens do
// design system. Não usa biblioteca de grafo: o que ela traria (pan, zoom, arrastar) são
// trinta linhas de ponteiro, e o que ela cobraria é uma dependência a mais no bundle, um
// nó em `div` que dificulta o foco por teclado, e uma simulação física que
// `prefers-reduced-motion` pede para não existir. O layout aqui é calculado uma vez e
// fica parado.

const ALTURA = 'clamp(320px, 58dvh, 560px)'

export function KnowledgeMap({ floorId, floorName }: { floorId: string; floorName: string }) {
  const [filtros, setFiltros] = useState<FiltrosDoMapa>({ q: '', status: '', source: '', viewAs: null })
  const { graph, loading, error, recarregar, moveNode, organizar } = useKnowledgeGraph(floorId, filtros)
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [editando, setEditando] = useState<{ documentId: string | null } | null>(null)
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement | null>(null)
  const arrastando = useRef<{ nodeId: string; dx: number; dy: number } | null>(null)
  // O arrasto do FUNDO move o mapa. Sem ele, num celular o dedo ou move um nó ou não
  // faz nada — e o mapa maior que a tela fica inalcançável.
  const arrastandoFundo = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  const posicionados = useMemo(() => (graph ? layoutGraph(graph.nodes, graph.edges) : []), [graph])
  const caixa = useMemo(() => boundsOf(posicionados), [posicionados])
  const retratos = useMemo(
    () => buildCharacterResolver(posicionados.filter((n) => n.kind === 'agent').map((n) => n.ownerId ?? n.id)),
    [posicionados],
  )
  const porId = useMemo(() => new Map(posicionados.map((n) => [n.id, n])), [posicionados])

  /**
   * A vizinhança do nó selecionado fica forte; o resto perde opacidade.
   *
   * É o que responde "o que isto alcança?" sem abrir painel nenhum — e sem esconder o
   * resto, que continuaria sendo o mapa.
   */
  const vizinhanca = useMemo(() => {
    if (!selecionado || !graph) return null
    const perto = new Set<string>([selecionado])
    for (const e of graph.edges) {
      if (e.source === selecionado) perto.add(e.target)
      if (e.target === selecionado) perto.add(e.source)
    }
    return perto
  }, [selecionado, graph])

  const emCoordenadas = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return { x: 0, y: 0 }
      const r = svg.getBoundingClientRect()
      const escalaX = caixa.width / r.width
      const escalaY = caixa.height / r.height
      return {
        x: caixa.minX + ((clientX - r.left) * escalaX) / zoom - pan.x,
        y: caixa.minY + ((clientY - r.top) * escalaY) / zoom - pan.y,
      }
    },
    [caixa, zoom, pan],
  )

  const aoMover = (e: React.PointerEvent) => {
    if (arrastando.current) {
      const p = emCoordenadas(e.clientX, e.clientY)
      moveNode(arrastando.current.nodeId, Math.round(p.x - arrastando.current.dx), Math.round(p.y - arrastando.current.dy))
      return
    }
    if (arrastandoFundo.current) {
      const escala = caixa.width / (svgRef.current?.getBoundingClientRect().width || 1)
      setPan({
        x: arrastandoFundo.current.panX + ((e.clientX - arrastandoFundo.current.x) * escala) / zoom,
        y: arrastandoFundo.current.panY + ((e.clientY - arrastandoFundo.current.y) * escala) / zoom,
      })
    }
  }

  const soltar = () => {
    arrastando.current = null
    arrastandoFundo.current = null
  }

  const iniciarArrasto = (n: Positioned) => (e: React.PointerEvent) => {
    e.stopPropagation()
    const p = emCoordenadas(e.clientX, e.clientY)
    arrastando.current = { nodeId: n.id, dx: p.x - n.x, dy: p.y - n.y }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const agentes = useMemo(() => posicionados.filter((n) => n.kind === 'agent'), [posicionados])
  const noSelecionado = selecionado ? porId.get(selecionado) : null
  const escopoDoEditor = useMemo(() => {
    const n = noSelecionado
    if (n?.ownerType && n.ownerId && n.kind !== 'document') return { scopeType: n.ownerType, scopeId: n.ownerId, label: n.label }
    if (n?.kind === 'document' && n.ownerType && n.ownerId) return { scopeType: n.ownerType, scopeId: n.ownerId, label: n.label }
    return { scopeType: 'floor' as KnowledgeScopeType, scopeId: floorId, label: floorName }
  }, [noSelecionado, floorId, floorName])

  return (
    <div className="flex flex-col gap-3" data-testid="knowledge-map">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setFiltrosAbertos((v) => !v)} data-testid="knowledge-toggle-filters">
          {filtrosAbertos ? 'Ocultar filtros' : 'Filtros'}
        </Button>
        <Button onClick={() => setEditando({ documentId: null })} data-testid="knowledge-add">
          Adicionar conhecimento
        </Button>
        <Button variant="secondary" onClick={organizar} data-testid="knowledge-auto-layout">
          Organizar automaticamente
        </Button>
        <div className="flex items-center gap-1" style={{ marginLeft: 'auto' }}>
          <Button variant="secondary" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))} aria-label="Diminuir zoom" data-testid="knowledge-zoom-out">
            −
          </Button>
          <Button variant="secondary" onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))} aria-label="Aumentar zoom" data-testid="knowledge-zoom-in">
            +
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3" style={{ display: 'grid', gridTemplateColumns: filtrosAbertos ? 'minmax(200px, 240px) 1fr' : '1fr', gap: 12, alignItems: 'start' }}>
        {filtrosAbertos && (
          <Card>
            <KnowledgeFilters filtros={filtros} agentes={agentes} onChange={setFiltros} />
          </Card>
        )}

        <div className="flex flex-col gap-3" style={{ minWidth: 0 }}>
          <Card>
            {/* Os quatro estados, distintos: um erro desenhado como mapa vazio faria a
                pessoa concluir que não há conhecimento e sair para criar o que já existe. */}
            {loading && !graph && <p style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="knowledge-loading">Carregando o mapa…</p>}
            {error && (
              <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger-text)' }} data-testid="knowledge-error">
                {error} <button type="button" onClick={recarregar} style={{ textDecoration: 'underline', background: 'none', border: 0, cursor: 'pointer', color: 'inherit' }}>Tentar de novo</button>
              </p>
            )}
            {graph && graph.nodes.length === 0 && !error && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="knowledge-empty">
                Nada neste recorte ainda. Use “Adicionar conhecimento” para começar.
              </p>
            )}

            {graph && graph.nodes.length > 0 && (
              <svg
                ref={svgRef}
                viewBox={`${caixa.minX} ${caixa.minY} ${caixa.width} ${caixa.height}`}
                style={{ width: '100%', height: ALTURA, touchAction: 'none', display: 'block' }}
                role="group"
                aria-label={`Mapa de conhecimento de ${floorName}`}
                data-testid="knowledge-svg"
                onPointerMove={aoMover}
                onPointerDown={(e) => {
                  arrastandoFundo.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
                }}
                onPointerUp={soltar}
                onPointerLeave={soltar}
              >
                <g transform={`scale(${zoom}) translate(${pan.x} ${pan.y})`}>
                  {/* As linhas são NEUTRAS: colorir a conexão com a cor do agente foi
                      descartado — a cor é identidade do nó, não do caminho. */}
                  {graph.edges.map((e) => {
                    const a = porId.get(e.source)
                    const b = porId.get(e.target)
                    if (!a || !b) return null
                    const forte = !vizinhanca || (vizinhanca.has(e.source) && vizinhanca.has(e.target))
                    return (
                      <line
                        key={e.id}
                        x1={a.x}
                        y1={a.y + RAIO[a.kind]}
                        x2={b.x}
                        y2={b.y - RAIO[b.kind]}
                        stroke="var(--border-subtle)"
                        strokeWidth={1}
                        strokeDasharray={e.kind === 'can_access' ? '4 4' : undefined}
                        opacity={forte ? 0.8 : 0.15}
                        aria-hidden="true"
                      />
                    )
                  })}
                  {posicionados.map((n) => (
                    <KnowledgeNode
                      key={n.id}
                      node={n}
                      portrait={n.kind === 'agent' ? retratos.portrait(n.ownerId ?? n.id) : null}
                      selected={selecionado === n.id}
                      dimmed={Boolean(vizinhanca && !vizinhanca.has(n.id))}
                      onSelect={() => setSelecionado(n.id)}
                      onOpen={() => n.kind === 'document' && setEditando({ documentId: n.id.split(':')[1] })}
                      onDragStart={iniciarArrasto(n)}
                    />
                  ))}
                </g>
              </svg>
            )}

            {graph && graph.truncated && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }} data-testid="knowledge-truncated">
                Mostrando {graph.nodes.filter((n) => n.kind === 'document').length} de {graph.documentTotal} documentos.
              </p>
            )}
          </Card>

          {editando && (
            <KnowledgeEditor
              documentId={editando.documentId}
              escopo={escopoDoEditor}
              onSalvo={() => {
                void recarregar()
              }}
              onFechar={() => setEditando(null)}
            />
          )}
        </div>

        {noSelecionado && !editando && (
          <div style={{ gridColumn: '1 / -1' }}>
            <KnowledgeInspector
              node={noSelecionado}
              edges={graph?.edges ?? []}
              nodes={graph?.nodes ?? []}
              onAbrir={(documentId) => setEditando({ documentId })}
              onFechar={() => setSelecionado(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
