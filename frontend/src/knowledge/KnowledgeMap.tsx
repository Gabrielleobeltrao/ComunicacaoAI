import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button, Card } from '../ui'
import { buildCharacterResolver } from '../lib/agentAvatar'
import { useKnowledgeGraph } from './useKnowledgeGraph'
import { boundsOf, brumaDe, centroDe, daTela, layoutGraph, normalizacaoDe, paraTela, raioDe, relativoAo } from './layout'
import type { Camera } from './layout'
import type { Positioned } from './layout'
import { KnowledgeNode, RAIO } from './KnowledgeNode'
import { KnowledgeFilters } from './KnowledgeFilters'
import type { FiltrosDoMapa } from './KnowledgeFilters'
import { KnowledgeInspector } from './KnowledgeInspector'
import { KnowledgeEditor } from './KnowledgeEditor'
import type { KnowledgeScopeType } from '../lib/knowledge'

// O MAPA DE CONHECIMENTO — uma nuvem que GIRA.
//
// Feito em SVG com os helpers que já existem — retrato do agente, cor do setor, tokens do
// design system. Não usa biblioteca de grafo: o que ela traria (girar, zoom, arrastar) são
// algumas dezenas de linhas de ponteiro, e o que ela cobraria é uma dependência a mais no
// bundle e um nó em `div` que dificulta o foco por teclado.
//
// O layout é 3D e continua sendo calculado UMA VEZ (ver `layout.ts`). Girar não recalcula
// nada: só muda o ângulo de onde se olha para as mesmas posições. Por isso arrastar o
// fundo é barato mesmo num mapa cheio, e por isso nada se move sozinho — não existe
// animação em curso para `prefers-reduced-motion` reclamar.

const ALTURA = 'clamp(360px, 64dvh, 620px)'

export function KnowledgeMap({ floorId, floorName }: { floorId: string; floorName: string }) {
  /**
   * A VISÃO — 3D ou plana — mora na URL, como as outras escolhas de tela deste projeto.
   *
   * Num mapa grande a perspectiva atrapalha mais do que ajuda: ela sobrepõe o que está
   * atrás e faz tamanhos diferentes significarem distância em vez de tipo. O plano mostra
   * tudo do mesmo tamanho, sem nada escondido atrás de nada.
   */
  const [paramsDaTela, setParamsDaTela] = useSearchParams()
  const plano = paramsDaTela.get('mapa') === '2d'
  const trocarVisao = () => {
    const p = new URLSearchParams(paramsDaTela)
    if (plano) p.delete('mapa')
    else p.set('mapa', '2d')
    setParamsDaTela(p, { replace: true })
  }

  const [filtros, setFiltros] = useState<FiltrosDoMapa>({ q: '', status: '', source: '', viewAs: null })
  const { graph, loading, error, recarregar, moveNode, organizar } = useKnowledgeGraph(floorId, filtros)
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [editando, setEditando] = useState<{ documentId: string | null } | null>(null)
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [zoom, setZoom] = useState(1)
  /**
   * O ÂNGULO de onde se olha. Começa levemente inclinado para cima: de frente e reto, uma
   * nuvem 3D é indistinguível de um desenho chapado, e a profundidade só aparece quando
   * alguém gira — o que ninguém faz sem antes desconfiar de que dá.
   */
  const [angulo, setAngulo] = useState({ giro: -0.35, inclinacao: 0.22 })
  /** Só a visão plana desloca o quadro: no 3D o gesto do fundo é girar. */
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement | null>(null)
  const arrastando = useRef<{ nodeId: string; dx: number; dy: number } | null>(null)
  // O arrasto do FUNDO GIRA o mapa, como se gira um globo. É o que transforma a nuvem de
  // pontos num objeto: parado, o olho não tem como saber o que está na frente do quê.
  const arrastandoFundo = useRef<{ x: number; y: number; giro: number; inclinacao: number; panX: number; panY: number } | null>(null)

  const camera: Camera = useMemo(() => ({ ...angulo, zoom, pan, plano }), [angulo, zoom, pan, plano])

  /**
   * A simulação roda quando a ESTRUTURA muda — e só então.
   *
   * Arrastar um nó reescreve `graph.nodes`, e refazer as forças a cada quadro do arrasto
   * significaria recalcular o mapa inteiro sessenta vezes por segundo: caro, e pior que
   * caro — o conjunto escorrega debaixo do dedo enquanto a pessoa tenta mirar. A chave
   * abaixo é a forma do grafo; as posições entram depois, por cima.
   */
  const forma = graph ? `${graph.nodes.map((n) => n.id).join(',')}|${graph.edges.map((e) => e.id).join(',')}` : ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base = useMemo(() => (graph ? layoutGraph(graph.nodes, graph.edges, plano) : []), [forma, plano])
  const posicionados = useMemo(() => {
    const salvas = new Map((graph?.nodes ?? []).filter((n) => n.position).map((n) => [n.id, n.position!]))
    return base.map((n) => {
      const p = salvas.get(n.id)
      return p ? { ...n, x: p.x, y: p.y, z: 0 } : n
    })
  }, [base, graph])
  /**
   * O ENQUADRAMENTO fica parado enquanto alguém arrasta.
   *
   * Ele é calculado a partir das posições, e a posição do nó arrastado é justamente o que
   * está mudando: puxar um nó para fora aumentava a caixa, a caixa afastava a câmera,
   * tudo encolhia — e o nó nunca alcançava o ponteiro, sempre uns 30% atrás. Um laço de
   * realimentação que parece "arrasto travado" e é, na verdade, o quadro fugindo junto.
   */
  const alvo = useMemo(() => {
    const centro = centroDe(posicionados)
    return { centro, normal: normalizacaoDe(raioDe(posicionados, centro)), caixa: boundsOf(posicionados) }
  }, [posicionados])
  const [enquadramento, setEnquadramento] = useState(alvo)
  useEffect(() => {
    if (!arrastando.current) setEnquadramento(alvo)
  }, [alvo])
  const { centro, normal, caixa } = enquadramento

  /** Do sistema em que a posição está gravada para o sistema em que o mapa é desenhado. */
  const paraODesenho = useCallback((p: { x: number; y: number; z: number }) => {
    const r = relativoAo(p, centro)
    return { x: r.x * normal, y: r.y * normal, z: r.z * normal }
  }, [centro, normal])
  const retratos = useMemo(
    () => buildCharacterResolver(posicionados.filter((n) => n.kind === 'agent').map((n) => n.ownerId ?? n.id)),
    [posicionados],
  )
  const porId = useMemo(() => new Map(posicionados.map((n) => [n.id, n])), [posicionados])

  /**
   * Cada nó, visto DESTE ângulo: onde ele cai na tela, e quanto ele cresce ou encolhe.
   *
   * A conta roda a cada quadro do arrasto, e é só isto — girar não recalcula o layout,
   * que continua sendo o mesmo trabalho feito uma vez ao carregar.
   */
  const vistos = useMemo(() => {
    const fora = new Map<string, { x: number; y: number; escala: number; z: number }>()
    for (const n of posicionados) fora.set(n.id, paraTela(paraODesenho(n), camera))
    return fora
    // `centro` NA LISTA. Sem ele, o enquadramento passava a usar o centro novo e a
    // projeção continuava com o antigo: a caixa crescia para caber uma nuvem que estava
    // sendo desenhada em outro lugar, e quatro nós ficavam fora da tela.
  }, [posicionados, camera, paraODesenho])

  /**
   * A ordem do PINTOR: o que está longe é desenhado primeiro, e o que está perto cobre.
   *
   * Sem isso, um nó da frente sai por baixo do que está atrás dele, e a profundidade se
   * desmonta no primeiro cruzamento — que é justamente onde o olho procura a prova de que
   * ela existe. E como a ordem depende do ÂNGULO, ela é refeita a cada giro.
   */
  const pintura = useMemo(
    () => [...posicionados].sort((a, b) => (vistos.get(a.id)?.z ?? 0) - (vistos.get(b.id)?.z ?? 0)),
    [posicionados, vistos],
  )

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
      // O SVG usa `meet`: ele cabe a viewBox inteira dentro do elemento e sobra margem no
      // lado mais largo. Ignorar essa margem faz o ponteiro chegar deslocado — que é o
      // arrasto "escapando" do cursor.
      const escala = Math.max(escalaX, escalaY)
      const sobraX = (r.width - caixa.width / escala) / 2
      const sobraY = (r.height - caixa.height / escala) / 2
      return {
        x: caixa.minX + (clientX - r.left - sobraX) * escala,
        y: caixa.minY + (clientY - r.top - sobraY) * escala,
      }
    },
    [caixa],
  )

  /**
   * Onde o ponteiro está NO MUNDO, para um nó que está sendo arrastado.
   *
   * Arrastar prende o nó no plano `z = 0` — o backend guarda posição em duas coordenadas,
   * e é nesse plano que ela volta a significar alguma coisa na próxima carga. Desfazer o
   * giro é o que permite arrastar com o mapa virado: sem isso, empurrar para a direita
   * mandaria o nó para uma diagonal qualquer.
   */
  const noMundo = useCallback(
    (clientX: number, clientY: number) => {
      // A conta acontece em torno do centro da nuvem; a posição gravada é absoluta. Somar
      // o centro de volta é o que liga os dois sistemas.
      // O caminho de volta, na ordem inversa: desprojeta, desfaz a normalização e soma o
      // centro. Pular a normalização faz o nó andar na escala errada — e quanto mais
      // espalhado o mapa salvo, mais longe do dedo ele para.
      const p = daTela(emCoordenadas(clientX, clientY), camera)
      return { x: p.x / normal + centro.x, y: p.y / normal + centro.y, z: 0 }
    },
    [emCoordenadas, camera, centro, normal],
  )

  const aoMover = (e: React.PointerEvent) => {
    if (arrastando.current) {
      const p = noMundo(e.clientX, e.clientY)
      moveNode(arrastando.current.nodeId, Math.round(p.x - arrastando.current.dx), Math.round(p.y - arrastando.current.dy))
      return
    }
    if (arrastandoFundo.current) {
      const de = arrastandoFundo.current
      if (plano) {
        // No plano não há o que girar: o gesto do fundo passa a ser deslocar o quadro, que
        // é como se percorre um mapa grande depois de aproximar o zoom.
        const escala = caixa.width / (svgRef.current?.getBoundingClientRect().width || 1)
        setPan({ x: de.panX + (e.clientX - de.x) * escala, y: de.panY + (e.clientY - de.y) * escala })
        return
      }
      /**
       * Um terço de grau por pixel.
       *
       * Uma tela larga ainda dá mais de uma volta inteira, e o gesto continua respondendo
       * na hora — mas sem que trezentos pixels joguem o mapa para perto dos 90°, onde o
       * eixo X do mundo aponta para dentro da tela e arrastar um nó deixa de ter resposta
       * única. Rápido demais, o controle passa reto pela faixa em que ele funciona.
       */
      setAngulo({
        giro: de.giro + (e.clientX - de.x) * 0.005,
        // A inclinação PARA: passar de 80° coloca a nuvem de canto, onde ela deixa de ser
        // um mapa e vira uma linha.
        inclinacao: Math.max(-1.1, Math.min(1.1, de.inclinacao + (e.clientY - de.y) * 0.005)),
      })
    }
  }

  const soltar = () => {
    const arrastava = Boolean(arrastando.current)
    arrastando.current = null
    arrastandoFundo.current = null
    // Solto o nó, o quadro volta a acompanhar — inclusive para caber onde ele foi parar.
    if (arrastava) {
      const c = centroDe(posicionados)
      setEnquadramento({ centro: c, normal: normalizacaoDe(raioDe(posicionados, c)), caixa: boundsOf(posicionados) })
    }
  }

  const iniciarArrasto = (n: Positioned) => (e: React.PointerEvent) => {
    e.stopPropagation()
    const p = noMundo(e.clientX, e.clientY)
    /**
     * A referência do agarre vem de ONDE O NÓ ESTÁ NA TELA, e não da posição dele no mundo.
     *
     * As duas coisas não são a mesma quando o nó está fora do plano `z = 0`: o ponteiro é
     * convertido nesse plano, e subtrair dele uma posição de outra profundidade mistura
     * dois sistemas de coordenadas. O nó parava a algumas dezenas de pixels do dedo — e
     * quanto mais girado o mapa, mais longe.
     */
    const v = vistos.get(n.id)
    // A referência do agarre passa pelo MESMO caminho de volta que o ponteiro: desprojeta,
    // desfaz a normalização, soma o centro. Parar no meio do caminho mistura o espaço do
    // desenho com o espaço em que a posição é gravada, e o nó sai andando na escala errada.
    const doDesenho = v ? daTela(v, camera) : null
    const naTela = doDesenho ? { x: doDesenho.x / normal + centro.x, y: doDesenho.y / normal + centro.y } : n
    arrastando.current = { nodeId: n.id, dx: p.x - naTela.x, dy: p.y - naTela.y }
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
        <Button
          variant="secondary"
          onClick={trocarVisao}
          aria-pressed={plano}
          data-testid="knowledge-toggle-2d"
          title={plano ? 'Voltar para a visão com profundidade' : 'Ver tudo do mesmo tamanho, sem nada atrás de nada'}
        >
          {plano ? 'Ver em 3D' : 'Ver em 2D'}
        </Button>
        <div className="flex items-center gap-1" style={{ marginLeft: 'auto' }}>
          <Button variant="secondary" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))} aria-label="Diminuir zoom" data-testid="knowledge-zoom-out">
            −
          </Button>
          <Button variant="secondary" onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))} aria-label="Aumentar zoom" data-testid="knowledge-zoom-in">
            +
          </Button>
          {/* Girar é fácil de fazer e fácil de exagerar: sem uma volta ao ponto de
              partida, quem virou o mapa de cabeça para baixo tem de recarregar a página. */}
          <Button
            variant="secondary"
            onClick={() => {
              setAngulo({ giro: -0.35, inclinacao: 0.22 })
              setZoom(1)
              setPan({ x: 0, y: 0 })
            }}
            aria-label="Voltar ao enquadramento inicial"
            data-testid="knowledge-reset-view"
          >
            Endireitar
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
                style={{
                  width: '100%',
                  height: ALTURA,
                  touchAction: 'none',
                  display: 'block',
                  // Arrastar para girar não pode selecionar os nomes: a tela ficava
                  // pintada de azul a cada volta, e o "arrastar" virava "marcar texto".
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  cursor: 'grab',
                  borderRadius: 'var(--radius-md, 12px)',
                  /**
                   * O CHÃO — no elemento, e não num `<rect>` da viewBox.
                   *
                   * Um retângulo em coordenadas do desenho só cobre a viewBox, e a viewBox
                   * de um mapa mais alto que largo fica com tarja nos dois lados: o chão
                   * virava uma faixa vertical no meio do cartão. Como fundo do SVG ele
                   * preenche o elemento inteiro, em qualquer proporção.
                   *
                   * Claro ao fundo, rebaixado à frente: é a perspectiva atmosférica, a
                   * mesma razão pela qual a serra distante parece mais clara que a da
                   * frente.
                   */
                  background: 'linear-gradient(to bottom, var(--surface-card) 0%, var(--surface-app) 62%, var(--surface-sunken) 100%)',
                }}
                role="group"
                aria-label={`Mapa de conhecimento de ${floorName}. Arraste o fundo para ${plano ? 'deslocar' : 'girar'}.`}
                data-testid="knowledge-svg"
                onPointerMove={aoMover}
                onPointerDown={(e) => {
                  arrastandoFundo.current = { x: e.clientX, y: e.clientY, giro: angulo.giro, inclinacao: angulo.inclinacao, panX: pan.x, panY: pan.y }
                  // A captura segue o ponteiro para fora do quadro: girar até a borda e
                  // continuar girando é o gesto natural, e sem isso ele morre no caminho.
                  e.currentTarget.setPointerCapture?.(e.pointerId)
                }}
                onPointerUp={soltar}
                /**
                 * `pointerleave` NÃO encerra o arrasto.
                 *
                 * Ele encerrava — e a captura do ponteiro dispara justamente um `leave` no
                 * elemento de origem assim que a captura começa. O arrasto morria no meio,
                 * o enquadramento voltava a acompanhar as posições, e o nó ficava eternamente
                 * uns trinta por cento atrás do dedo. Quem fecha o gesto é soltar o botão
                 * (ou o navegador cancelar), que é o que o gesto de fato significa.
                 */
                onPointerCancel={soltar}
              >
                <defs>
                  {/* A LUZ, uma só, vindo de cima à esquerda — como em todo o resto da
                      interface. Duas fontes de luz num mesmo desenho é o que faz um
                      volume parecer adesivo em vez de esfera. */}
                  <radialGradient id="k-lustre" cx="0.34" cy="0.26" r="0.72">
                    <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
                    <stop offset="0.45" stopColor="#fff" stopOpacity="0.12" />
                    <stop offset="0.8" stopColor="#fff" stopOpacity="0" />
                  </radialGradient>
                  {/* A terminação: a borda oposta à luz escurece. Translúcida e sem cor
                      própria, então vale para a cor de qualquer setor. */}
                  <radialGradient id="k-terminacao" cx="0.36" cy="0.3" r="0.98">
                    <stop offset="0.5" stopColor="var(--ink-1)" stopOpacity="0" />
                    <stop offset="0.82" stopColor="var(--ink-1)" stopOpacity="0.14" />
                    <stop offset="1" stopColor="var(--ink-1)" stopOpacity="0.34" />
                  </radialGradient>
                  {/* O contato com o plano. É a sombra que diz "isto está APOIADO ali". */}
                  <radialGradient id="k-contato" cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0" stopColor="var(--ink-1)" stopOpacity="0.2" />
                    <stop offset="1" stopColor="var(--ink-1)" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <g>
                  {/* As linhas são NEUTRAS: colorir a conexão com a cor do agente foi
                      descartado — a cor é identidade do nó, não do caminho. */}
                  {graph.edges.map((e) => {
                    const a = vistos.get(e.source)
                    const b = vistos.get(e.target)
                    const na = porId.get(e.source)
                    const nb = porId.get(e.target)
                    if (!a || !b || !na || !nb) return null
                    const forte = !vizinhanca || (vizinhanca.has(e.source) && vizinhanca.has(e.target))
                    /**
                     * A linha começa na BORDA da esfera, não no centro dela.
                     *
                     * De centro a centro, com os nós próximos como ficam num layout por
                     * forças, o traço inteiro desaparece atrás das duas bolas — e o mapa
                     * perde justamente o que mostra que aquilo é um grafo.
                     */
                    const dx = b.x - a.x
                    const dy = b.y - a.y
                    const comp = Math.hypot(dx, dy) || 1
                    const ra = RAIO[na.kind] * a.escala + 2
                    const rb = RAIO[nb.kind] * b.escala + 2
                    if (comp <= ra + rb) return null
                    return (
                      <line
                        key={e.id}
                        x1={a.x + (dx / comp) * ra}
                        y1={a.y + (dy / comp) * ra}
                        x2={b.x - (dx / comp) * rb}
                        y2={b.y - (dy / comp) * rb}
                        stroke="var(--border-strong)"
                        strokeWidth={1}
                        strokeDasharray={e.kind === 'can_access' ? '4 4' : undefined}
                        // A ligação também recua: ela some na bruma junto com a ponta mais
                        // distante que segura. Uma linha de contraste igual em toda a
                        // profundidade desfaz o que as esferas acabaram de construir.
                        opacity={(forte ? 0.65 : 0.12) * brumaDe(Math.min(a.escala, b.escala))}
                        aria-hidden="true"
                      />
                    )
                  })}
                  {pintura.map((n) => (
                    <KnowledgeNode
                      key={n.id}
                      node={n}
                      visto={vistos.get(n.id)!}
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
