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
  /** 0 ao fundo, 1 à frente. Vem do tipo, e não da posição: arrastar não muda o que a coisa é. */
  profundidade: number
}

const CAMADA: Record<GraphNode['kind'], number> = { building: 0, floor: 1, sector: 2, agent: 3, document: 4 }

/**
 * O vão entre camadas — encurtado de 150.
 *
 * Com 150, cinco camadas dão 600 de altura contra ~400 de largura: o SVG cabia pela
 * ALTURA e encolhia tudo para 60%, e a essa escala o volume das esferas simplesmente não
 * aparecia. A hierarquia continua legível porque quem a separa agora é também a
 * perspectiva — tamanho, bruma e o arco da fileira —, e não só a distância vertical.
 */
export const LAYER_GAP = 118
export const NODE_GAP = 110

/**
 * A PROFUNDIDADE de cada tipo: 0 é o fundo, 1 é a frente.
 *
 * O mapa já empilha a hierarquia de cima para baixo. Dar a ela um eixo de profundidade
 * não é enfeite: é a mesma informação lida por um segundo canal — o que contém fica ao
 * fundo, o que é contido vem à frente. E é o que faz as bolinhas pararem de flutuar num
 * plano chapado.
 */
export const PROFUNDIDADE: Record<GraphNode['kind'], number> = { building: 0, floor: 0.25, sector: 0.5, agent: 0.75, document: 1 }

/**
 * A escala da perspectiva — projeção de um ponto, com a câmera a `FOCO` do plano da frente.
 *
 * Não é uma curva inventada: `f / (f + d)` é a divisão por profundidade de verdade. Com
 * FOCO alto ela fica suave de propósito — o suficiente para o olho ler distância, longe
 * de achatar a diferença entre um prédio (r 26) e um documento (r 16), que é o que diz
 * QUE COISA cada bolinha é.
 */
const FOCO = 7
export const escalaDe = (profundidade: number): number => Number((FOCO / (FOCO + (1 - profundidade) * 2)).toFixed(4))

/** A bruma da distância: o que está longe perde contraste, como perde no ar. */
export const brumaDe = (profundidade: number): number => Number((0.78 + profundidade * 0.22).toFixed(4))

/** O quanto uma camada se espalha: a de trás é mais estreita, e é isso que abre a fuga. */
const espalhamentoDe = (profundidade: number): number => 0.78 + profundidade * 0.34

/** A curvatura da fileira: as pontas recuam, então cada camada lê como um plano, não uma régua. */
const ARCO = 16

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
    const kind = ordenados[0]?.kind ?? 'document'
    const profundidade = PROFUNDIDADE[kind] ?? 1
    const passo = NODE_GAP * espalhamentoDe(profundidade)
    const largura = (ordenados.length - 1) * passo
    ordenados.forEach((n, i) => {
      // As pontas da fileira recuam um pouco. Sem isso, cada camada é uma régua — e
      // cinco réguas empilhadas continuam sendo um desenho chapado, por mais sombra que
      // se ponha em cima.
      const t = ordenados.length > 1 ? i / (ordenados.length - 1) : 0.5
      const recuo = ARCO * Math.abs(t - 0.5) * 2
      fora.push({
        ...n,
        x: n.position ? n.position.x : i * passo - largura / 2,
        y: n.position ? n.position.y : camada * LAYER_GAP - recuo,
        profundidade,
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
  const folga = 56
  const minX = Math.min(...xs) - folga
  const minY = Math.min(...ys) - folga
  return { minX, minY, width: Math.max(Math.max(...xs) - minX + folga, 320), height: Math.max(Math.max(...ys) - minY + folga, 240) }
}
