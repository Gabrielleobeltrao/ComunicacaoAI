// O LAYOUT do mapa: determinístico, e respeitando quem arrastou.
//
// Determinístico porque recarregar a página não pode embaralhar o que a pessoa acabou de
// ler; e preservando a posição salva porque reorganizar tudo quando um nó novo aparece
// joga fora o trabalho de quem organizou à mão.
import { describe, expect, it } from 'vitest'
import { boundsOf, layoutGraph } from '../layout'
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

describe('layout do mapa de conhecimento', () => {
  it('o mesmo grafo produz sempre as mesmas posições', () => {
    expect(layoutGraph(GRAFO, ARESTAS)).toEqual(layoutGraph(GRAFO, ARESTAS))
  })

  it('empilha por hierarquia: prédio acima, documentos abaixo', () => {
    const p = layoutGraph(GRAFO, ARESTAS)
    const y = (id: string) => p.find((n) => n.id === id)!.y
    expect(y('building:b')).toBeLessThan(y('floor:f'))
    expect(y('floor:f')).toBeLessThan(y('sector:s'))
    expect(y('sector:s')).toBeLessThan(y('agent:a1'))
    expect(y('agent:a1')).toBeLessThan(y('document:d1'))
  })

  it('agrupa por pai: documentos do mesmo dono ficam vizinhos', () => {
    const muitos: GraphNode[] = [...GRAFO, no('document:d3', 'document', 'Zebra'), no('document:d4', 'document', 'Abacaxi')]
    const arestas: GraphEdge[] = [
      ...ARESTAS,
      { id: '7', source: 'agent:a1', target: 'document:d3', kind: 'contains' },
      { id: '8', source: 'agent:a1', target: 'document:d4', kind: 'contains' },
    ]
    const docs = layoutGraph(muitos, arestas)
      .filter((n) => n.kind === 'document')
      .sort((a, b) => a.x - b.x)
    const donos = docs.map((d) => (['document:d1', 'document:d3', 'document:d4'].includes(d.id) ? 'a1' : 'a2'))
    // Contíguos: o último do primeiro dono vem antes do primeiro do segundo. Uma fileira
    // alfabética misturaria os donos, e o mapa perderia os grupos.
    const trocas = donos.filter((d, i) => i > 0 && d !== donos[i - 1]).length
    expect(trocas).toBe(1)
  })

  it('a posição ARRASTADA vence o layout automático', () => {
    const comPosicao = GRAFO.map((n) => (n.id === 'agent:a1' ? { ...n, position: { x: 999, y: 777 } } : n))
    const p = layoutGraph(comPosicao, ARESTAS)
    const marina = p.find((n) => n.id === 'agent:a1')!
    expect(marina.x).toBe(999)
    expect(marina.y).toBe(777)
    expect(p.find((n) => n.id === 'agent:a2')!.x).not.toBe(999)
  })

  it('a caixa cobre todos os nós, com folga', () => {
    const p = layoutGraph(GRAFO, ARESTAS)
    const c = boundsOf(p)
    for (const n of p) {
      expect(n.x).toBeGreaterThanOrEqual(c.minX)
      expect(n.y).toBeGreaterThanOrEqual(c.minY)
      expect(n.x).toBeLessThanOrEqual(c.minX + c.width)
      expect(n.y).toBeLessThanOrEqual(c.minY + c.height)
    }
  })

  it('grafo vazio não quebra a caixa', () => {
    const c = boundsOf([])
    expect(c.width).toBeGreaterThan(0)
    expect(c.height).toBeGreaterThan(0)
  })
})
