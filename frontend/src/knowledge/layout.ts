import type { GraphEdge, GraphNode } from '../lib/knowledge'

// O LAYOUT AUTOMÁTICO — determinístico, calculado uma vez, estático depois.
//
// Nada de simulação física contínua: ela consome CPU para sempre, nunca chega a um
// estado final e é exatamente o que `prefers-reduced-motion` pede para não existir. Aqui
// o mapa é calculado por camadas (prédio, andar, setores e agentes, documentos) e fica
// parado — o mesmo grafo produz sempre as mesmas posições, e por isso recarregar a
// página não embaralha o que a pessoa acabou de ler.

export interface Positioned extends GraphNode {
  x: number
  y: number
}

const CAMADA: Record<GraphNode['kind'], number> = { building: 0, floor: 1, sector: 2, agent: 3, document: 4 }

export const LAYER_GAP = 150
export const NODE_GAP = 110

/**
 * As posições de cada nó.
 *
 * Quem foi ARRASTADO mantém a posição salva; o resto entra na grade da sua camada. Os
 * dois convivem de propósito: reorganizar tudo porque um nó novo apareceu jogaria fora o
 * trabalho de quem organizou o mapa à mão.
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): Positioned[] {
  const porCamada = new Map<number, GraphNode[]>()
  for (const n of nodes) {
    const c = CAMADA[n.kind] ?? 4
    porCamada.set(c, [...(porCamada.get(c) ?? []), n])
  }

  // Dentro da camada, a ordem vem do PAI: documentos do mesmo agente ficam juntos, e o
  // mapa passa a ter grupos legíveis em vez de uma fileira alfabética sem sentido.
  const paiDe = new Map<string, string>()
  for (const e of edges) if (e.kind === 'contains') paiDe.set(e.target, e.source)

  const fora: Positioned[] = []
  for (const [camada, itens] of [...porCamada.entries()].sort((a, b) => a[0] - b[0])) {
    const ordenados = [...itens].sort((a, b) => {
      const pa = paiDe.get(a.id) ?? ''
      const pb = paiDe.get(b.id) ?? ''
      return pa === pb ? a.label.localeCompare(b.label) : pa.localeCompare(pb)
    })
    const largura = (ordenados.length - 1) * NODE_GAP
    ordenados.forEach((n, i) => {
      fora.push({
        ...n,
        x: n.position ? n.position.x : i * NODE_GAP - largura / 2,
        y: n.position ? n.position.y : camada * LAYER_GAP,
      })
    })
  }
  return fora
}

/** A caixa que contém tudo, com folga — é o que o "caber na tela" usa. */
export function boundsOf(nodes: Positioned[]): { minX: number; minY: number; width: number; height: number } {
  if (nodes.length === 0) return { minX: 0, minY: 0, width: 400, height: 300 }
  const xs = nodes.map((n) => n.x)
  const ys = nodes.map((n) => n.y)
  const folga = 80
  const minX = Math.min(...xs) - folga
  const minY = Math.min(...ys) - folga
  return { minX, minY, width: Math.max(Math.max(...xs) - minX + folga, 320), height: Math.max(Math.max(...ys) - minY + folga, 240) }
}
