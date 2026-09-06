// O LAYOUT do mapa: orgânico, tridimensional, determinístico — e respeitando quem arrastou.
//
// Determinístico porque recarregar a página não pode embaralhar o que a pessoa acabou de
// ler; e preservando a posição salva porque reorganizar tudo quando um nó novo aparece
// joga fora o trabalho de quem organizou à mão.
//
// O que ele deixou de ser: uma pilha de cinco fileiras. A régua dizia a verdade e não
// dizia nada além dela — quem está perto de quem, o que forma aglomerado, o que ficou
// solto, nada disso aparece numa grade. Agora as posições saem de forças, e o que se pode
// exigir delas é o que as forças de fato garantem: parentes perto, estranhos longe.
import { describe, expect, it } from 'vitest'
import { boundsOf, brumaDe, desgirar, girar, layoutGraph, projetar } from '../layout'
import type { GraphEdge, GraphNode } from '../../lib/knowledge'

const no = (id: string, kind: GraphNode['kind'], label: string, position: GraphNode['position'] = null): GraphNode => ({ id, kind, label, position })

const GRAFO: GraphNode[] = [
  no('building:b', 'building', 'Prédio'),
  no('floor:f', 'floor', 'Atendimento'),
  no('sector:s', 'sector', 'Mesa'),
  no('agent:a1', 'agent', 'Marina'),
  no('agent:a2', 'agent', 'Rafael'),
  no('document:d1', 'document', 'Política'),
  no('document:d2', 'document', 'Cardápio'),
]

const ARESTAS: GraphEdge[] = [
  { id: '1', source: 'building:b', target: 'floor:f', kind: 'contains' },
  { id: '2', source: 'floor:f', target: 'sector:s', kind: 'contains' },
  { id: '3', source: 'sector:s', target: 'agent:a1', kind: 'contains' },
  { id: '4', source: 'floor:f', target: 'agent:a2', kind: 'contains' },
  { id: '5', source: 'agent:a1', target: 'document:d1', kind: 'contains' },
  { id: '6', source: 'agent:a2', target: 'document:d2', kind: 'contains' },
]

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)

describe('layout do mapa de conhecimento', () => {
  it('o mesmo grafo produz sempre as mesmas posições', () => {
    expect(layoutGraph(GRAFO, ARESTAS)).toEqual(layoutGraph(GRAFO, ARESTAS))
  })

  it('ACEITAÇÃO: o layout é TRIDIMENSIONAL — ele não nasce achatado num plano', () => {
    /**
     * Sem profundidade de verdade, girar não mostra nada: o mapa vira uma folha de papel
     * rodando, e a única coisa que o giro revela é que não havia nada para revelar.
     */
    const p = layoutGraph(GRAFO, ARESTAS)
    const zs = p.map((n) => n.z)
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(60)
  })

  it('ACEITAÇÃO: quem é LIGADO fica perto — é a ligação que forma o aglomerado', () => {
    /**
     * A comparação é entre MÉDIAS, e não entre um par escolhido a dedo: com sorte de
     * sorteio inicial, um par qualquer fica perto mesmo sem força nenhuma puxando. O que
     * só acontece com atração é o conjunto das ligações ser sistematicamente mais curto
     * que o conjunto dos não-vizinhos.
     */
    const p = layoutGraph(GRAFO, ARESTAS)
    const em = (id: string) => p.find((n) => n.id === id)!
    const ligados = new Set(ARESTAS.map((e) => `${e.source}|${e.target}`))

    const daLigacao: number[] = []
    const doResto: number[] = []
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const d = dist(p[i], p[j])
        const vizinhos = ligados.has(`${p[i].id}|${p[j].id}`) || ligados.has(`${p[j].id}|${p[i].id}`)
        ;(vizinhos ? daLigacao : doResto).push(d)
      }
    }
    const media = (v: number[]) => v.reduce((t, x) => t + x, 0) / v.length
    expect(media(daLigacao)).toBeLessThan(media(doResto) * 0.7)

    // E o caso que se lê no mapa: o documento fica junto do dono, não do vizinho dele.
    expect(dist(em('document:d1'), em('agent:a1'))).toBeLessThan(dist(em('document:d1'), em('agent:a2')))
    expect(dist(em('document:d2'), em('agent:a2'))).toBeLessThan(dist(em('document:d2'), em('agent:a1')))
  })

  it('AMEAÇA: dois nós nunca ocupam o mesmo ponto', () => {
    // Nós empilhados são um mapa que mente: ele mostra cinco coisas onde há sete.
    const p = layoutGraph(GRAFO, ARESTAS)
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        expect(dist(p[i], p[j])).toBeGreaterThan(10)
      }
    }
  })

  it('a posição ARRASTADA vence as forças, e vive no plano que o backend guarda', () => {
    const comPosicao = GRAFO.map((n) => (n.id === 'agent:a1' ? { ...n, position: { x: 999, y: 777 } } : n))
    const p = layoutGraph(comPosicao, ARESTAS)
    const marina = p.find((n) => n.id === 'agent:a1')!
    expect(marina.x).toBe(999)
    expect(marina.y).toBe(777)
    // z = 0 porque o backend guarda DUAS coordenadas: inventar uma terceira aqui seria
    // manter no cliente um dado que ele não vai receber de volta na próxima carga.
    expect(marina.z).toBe(0)
    expect(p.find((n) => n.id === 'agent:a2')!.x).not.toBe(999)
  })

  it('girar e desgirar voltam ao mesmo ponto — é isso que faz arrastar funcionar virado', () => {
    const p = { x: 120, y: -45, z: 33 }
    const volta = desgirar(girar(p, 0.7, -0.4), 0.7, -0.4)
    expect(volta.x).toBeCloseTo(p.x, 6)
    expect(volta.y).toBeCloseTo(p.y, 6)
    expect(volta.z).toBeCloseTo(p.z, 6)
  })

  it('girar MOVE o desenho — e não é um giro que não sai do lugar', () => {
    const p = { x: 100, y: 0, z: 0 }
    expect(girar(p, Math.PI / 2, 0).z).toBeCloseTo(-100, 6)
    // Meia volta devolve o ponto espelhado, não o mesmo ponto.
    expect(girar(p, Math.PI, 0).x).toBeCloseTo(-100, 6)
  })

  it('a perspectiva desenha o que está À FRENTE maior, e o que está atrás mais apagado', () => {
    const frente = projetar({ x: 0, y: 0, z: 300 })
    const fundo = projetar({ x: 0, y: 0, z: -300 })
    expect(frente.escala).toBeGreaterThan(fundo.escala)
    expect(brumaDe(fundo.escala)).toBeLessThan(brumaDe(frente.escala))
    // E nada some: mesmo o mais distante continua legível.
    expect(brumaDe(fundo.escala)).toBeGreaterThan(0.5)
  })

  it('a caixa é QUADRADA e cabe a nuvem em qualquer ângulo', () => {
    /**
     * O mapa gira. Uma caixa ajustada ao contorno de agora mudaria a cada grau, e tudo
     * pularia de tamanho enquanto a pessoa arrasta — a sensação de que o desenho está
     * escapando da mão.
     */
    const p = layoutGraph(GRAFO, ARESTAS)
    const c = boundsOf(p)
    expect(c.width).toBe(c.height)
    for (const angulo of [0, 0.8, 1.9, 3.4]) {
      for (const n of p) {
        const v = projetar(girar(n, angulo, 0.3))
        expect(v.x).toBeGreaterThanOrEqual(c.minX)
        expect(v.x).toBeLessThanOrEqual(c.minX + c.width)
        expect(v.y).toBeGreaterThanOrEqual(c.minY)
        expect(v.y).toBeLessThanOrEqual(c.minY + c.height)
      }
    }
  })

  it('grafo vazio não quebra a caixa', () => {
    const c = boundsOf([])
    expect(c.width).toBeGreaterThan(0)
    expect(c.height).toBeGreaterThan(0)
  })
})
