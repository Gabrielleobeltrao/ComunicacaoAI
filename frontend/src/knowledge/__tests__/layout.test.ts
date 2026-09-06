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
import { boundsOf, brumaDe, centroDe, desgirar, girar, layoutGraph, normalizacaoDe, projetar, raioDe, relativoAo } from '../layout'
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

/**
 * Do sistema em que a posição está gravada para o sistema em que o mapa é desenhado —
 * a mesma conta que a tela faz: centrar e normalizar.
 */
const paraODesenho = (p: ReturnType<typeof layoutGraph>) => {
  const centro = centroDe(p)
  const normal = normalizacaoDe(raioDe(p, centro))
  return (n: (typeof p)[number]) => {
    const r = relativoAo(n, centro)
    return { x: r.x * normal, y: r.y * normal, z: r.z * normal }
  }
}

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
    const desenhar = paraODesenho(p)
    const c = boundsOf(p)
    expect(c.width).toBe(c.height)
    for (const angulo of [0, 0.8, 1.9, 3.4]) {
      for (const n of p) {
        const v = projetar(girar(desenhar(n), angulo, 0.3))
        expect(v.x).toBeGreaterThanOrEqual(c.minX)
        expect(v.x).toBeLessThanOrEqual(c.minX + c.width)
        expect(v.y).toBeGreaterThanOrEqual(c.minY)
        expect(v.y).toBeLessThanOrEqual(c.minY + c.height)
      }
    }
  })

  it('AMEAÇA: com posições SALVAS fora do centro, o mapa continua enquadrado', () => {
    /**
     * As forças centram o que elas resolvem, mas a posição salva entra crua, no sistema em
     * que foi gravada — inclusive a do layout antigo, em fileiras, que desce centenas de
     * unidades. Com o centro preso na origem, uma conta que já tinha organizado o mapa à
     * mão via tudo pendurado num canto, metade do quadro vazio e o conjunto balançando em
     * torno de um ponto que não é o dele. Medido antes da correção: a nuvem inteira a 381
     * unidades abaixo do centro do quadro.
     */
    const antigo = GRAFO.map((n, i) => ({ ...n, position: { x: (i % 2) * 220 - 110, y: i * 150 } }))
    const p = layoutGraph(antigo, ARESTAS)
    const desenhar = paraODesenho(p)
    const c = boundsOf(p)

    for (const angulo of [0, 0.9, 2.1, 3.6, 5.2]) {
      const vistos = p.map((n) => projetar(girar(desenhar(n), angulo, 0.22)))
      for (const v of vistos) {
        expect(v.x).toBeGreaterThanOrEqual(c.minX)
        expect(v.x).toBeLessThanOrEqual(c.minX + c.width)
        expect(v.y).toBeGreaterThanOrEqual(c.minY)
        expect(v.y).toBeLessThanOrEqual(c.minY + c.height)
      }
      // E o conjunto fica NO MEIO do quadro, não pendurado num canto: o centro visual
      // nunca se afasta do centro da caixa mais que um décimo do lado dela.
      const meio = {
        x: vistos.reduce((t, v) => t + v.x, 0) / vistos.length,
        y: vistos.reduce((t, v) => t + v.y, 0) / vistos.length,
      }
      expect(Math.abs(meio.x)).toBeLessThan(c.width * 0.1)
      expect(Math.abs(meio.y)).toBeLessThan(c.height * 0.1)

      /**
       * E o quadro é APERTADO no conjunto.
       *
       * Uma caixa medida da origem, com a nuvem longe dela, fica enorme para alcançar um
       * ponto que nem é o mais distante do grupo — e o mapa inteiro é desenhado pequeno
       * dentro dela. "Não consigo mais ver as bolinhas" é isto: elas estão todas lá,
       * desenhadas a metade do tamanho que caberia.
       */
      const maisLonge = Math.max(...vistos.map((v) => Math.max(Math.abs(v.x), Math.abs(v.y))))
      expect(maisLonge).toBeGreaterThan(c.width * 0.28)
    }
  })

  it('AMEAÇA: o mapa tem o MESMO tamanho, seja qual for a escala das coordenadas salvas', () => {
    /**
     * As posições chegam no sistema em que foram gravadas. O layout antigo espalhava
     * documentos de 110 em 110 numa fileira só — duzentos documentos são vinte e dois mil
     * de largura. Com a câmera a uma distância fixa, uma nuvem desse tamanho encosta nela:
     * a ampliação da perspectiva dispara, o quadro vai a dez mil unidades e a bolinha do
     * setor sai com CINCO pixels. Medido no navegador, e é o "não consigo mais ver as
     * bolinhas".
     */
    const espalhado = GRAFO.map((n, i) => ({ ...n, position: { x: (i % 2) * 800 - 400, y: i * 500 } }))
    const apertado = GRAFO.map((n, i) => ({ ...n, position: { x: (i % 2) * 40 - 20, y: i * 25 } }))

    const quadro = (ns: typeof GRAFO) => boundsOf(layoutGraph(ns, ARESTAS)).width
    // O quadro é o mesmo nas duas pontas: é a NUVEM que é normalizada para ele, e não o
    // quadro que corre atrás da nuvem.
    expect(quadro(espalhado)).toBe(quadro(apertado))
    expect(quadro(espalhado)).toBe(quadro(GRAFO))

    // E o desenho ocupa o quadro nas duas: ninguém fica do tamanho de um ponto.
    for (const ns of [espalhado, apertado]) {
      const p = layoutGraph(ns, ARESTAS)
      const desenhar = paraODesenho(p)
      const maisLonge = Math.max(...p.map((n) => {
        const v = projetar(girar(desenhar(n), 0.4, 0.22))
        return Math.max(Math.abs(v.x), Math.abs(v.y))
      }))
      expect(maisLonge).toBeGreaterThan(boundsOf(p).width * 0.28)
    }
  })

  it('grafo vazio não quebra a caixa', () => {
    const c = boundsOf([])
    expect(c.width).toBeGreaterThan(0)
    expect(c.height).toBeGreaterThan(0)
  })
})
