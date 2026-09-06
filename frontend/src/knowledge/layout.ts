import type { GraphEdge, GraphNode } from '../lib/knowledge'

// O LAYOUT — orgânico, em três dimensões, calculado UMA VEZ e congelado.
//
// Antes era uma pilha de cinco fileiras: a hierarquia lida só pela posição vertical. Ela
// dizia a verdade e não dizia nada além dela — quem está perto de quem, o que forma um
// aglomerado, o que ficou solto na borda, nada disso aparece numa régua.
//
// Agora as posições saem de forças: cada nó empurra todos os outros, cada ligação puxa as
// duas pontas, e uma gravidade fraca segura o conjunto perto da origem. Os aglomerados
// aparecem sozinhos porque eles EXISTEM no grafo, e não porque alguém os desenhou. A
// hierarquia continua legível — `contains` é a ligação que mais puxa —, só que agora ela
// é uma consequência, e não uma grade.
//
// O que NÃO mudou, e é o ponto: continua sendo uma conta que roda UMA VEZ. Nada de
// simulação contínua consumindo CPU para sempre, que é o que `prefers-reduced-motion`
// pede para não existir. Determinística também — a semente vem do id do nó, nunca de
// `Math.random` —, então recarregar a página não embaralha o que a pessoa acabou de ler.

export interface Ponto3 {
  x: number
  y: number
  z: number
}

export interface Positioned extends GraphNode, Ponto3 {}

/**
 * A distância que as forças consideram confortável entre dois nós.
 *
 * Não é a escala do desenho — é a DENSIDADE. Dobrar isto afasta os nós, mas o raio deles
 * não dobra junto, e o enquadramento acompanha a nuvem: o efeito visível é só o de um mapa
 * mais vazio. 68 deixa cerca de dois diâmetros de ar entre vizinhos, que é o suficiente
 * para ler os nomes sem que o conjunto pareça um punhado de pontos perdidos.
 */
const K = 68

/**
 * A câmera. Quanto MENOR, mais violenta a perspectiva.
 *
 * Perto demais e o nó da frente dobra de tamanho: some com o resto do mapa e o
 * enquadramento tem de abrir para caber esse gigante, encolhendo todos os outros. 1600
 * dá volume claro sem esse preço.
 */
export const DISTANCIA_DA_CAMERA = 1600

/**
 * Uma semente estável a partir do id — FNV-1a.
 *
 * O sorteio inicial precisa ser sempre o mesmo: `Math.random` faria cada recarga produzir
 * um mapa diferente, e um mapa que muda sozinho não é um mapa, é um caleidoscópio.
 */
function semente(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/**
 * O peso de cada tipo de ligação.
 *
 * `contains` puxa mais forte porque é a relação que EXISTE na estrutura — um documento
 * pertence a um agente. `can_access` é permissão: aproxima, mas não define vizinhança,
 * senão um agente com acesso a tudo colapsaria o mapa em torno dele.
 */
const PESO: Record<string, number> = { contains: 1, can_access: 0.35 }

const ITERACOES = 320

/**
 * As posições, resolvidas por forças.
 *
 * As forças rodam sobre a ESTRUTURA — quem existe e quem se liga a quem — e ignoram as
 * posições salvas. Só no fim quem foi arrastado é posto de volta onde alguém o deixou.
 *
 * Essa separação é o que torna arrastar previsível: se a posição salva entrasse na
 * simulação, mexer num nó recalcularia o mapa inteiro a cada quadro do arrasto, e o
 * conjunto escorregaria debaixo do dedo enquanto a pessoa tenta mirar. Cada gesto move
 * exatamente uma coisa: a que foi agarrada.
 *
 * Um nó preso vive no plano `z = 0` — o backend guarda posição em DUAS coordenadas, e
 * inventar uma terceira aqui seria manter no cliente um dado que ele não vai receber de
 * volta na próxima carga.
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], plano = false): Positioned[] {
  const n = nodes.length
  if (n === 0) return []

  const pontos: Ponto3[] = nodes.map((no) => {
    // Sorteio inicial sobre uma esfera: começar todo mundo no mesmo ponto faria as forças
    // explodirem, e começar num plano faria o resultado nascer chato.
    const a = semente(no.id) * Math.PI * 2
    const r = K * (0.6 + semente(`${no.id}#r`) * 1.4)
    // No plano o sorteio é num CÍRCULO, e não numa esfera: começar com profundidade para
    // depois achatá-la empilha nós que a simulação já tinha separado.
    if (plano) return { x: r * Math.cos(a), y: r * Math.sin(a), z: 0 }
    const b = Math.acos(2 * semente(`${no.id}#b`) - 1)
    return { x: r * Math.sin(b) * Math.cos(a), y: r * Math.sin(b) * Math.sin(a), z: r * Math.cos(b) }
  })

  const indice = new Map(nodes.map((no, i) => [no.id, i]))
  const ligacoes = edges
    .map((e) => ({ a: indice.get(e.source), b: indice.get(e.target), peso: PESO[e.kind] ?? 0.5 }))
    .filter((l): l is { a: number; b: number; peso: number } => l.a !== undefined && l.b !== undefined)

  // Grafos grandes recebem menos passos: o custo é O(n² · passos), e a diferença entre 320
  // e 160 passos num mapa denso é invisível — a diferença no tempo de abrir, não.
  const passos = n > 120 ? 160 : ITERACOES
  const desloc: Ponto3[] = pontos.map(() => ({ x: 0, y: 0, z: 0 }))

  for (let passo = 0; passo < passos; passo++) {
    // O resfriamento: os primeiros passos reorganizam de verdade, os últimos só acomodam.
    // Sem ele o desenho fica oscilando entre dois arranjos e nunca assenta.
    const temperatura = K * 0.55 * (1 - passo / passos) ** 1.4 + 0.5
    for (const d of desloc) {
      d.x = 0
      d.y = 0
      d.z = 0
    }

    // Repulsão: todo mundo empurra todo mundo, senão os nós sem ligação se empilham.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pontos[i].x - pontos[j].x
        let dy = pontos[i].y - pontos[j].y
        let dz = pontos[i].z - pontos[j].z
        let dist2 = dx * dx + dy * dy + dz * dz
        if (dist2 < 1e-6) {
          // Dois nós exatamente no mesmo ponto não têm direção para se separar. O
          // desempate vem da semente, e não de um sorteio: o resultado tem de repetir.
          dx = semente(`${i}:${j}:x`) - 0.5
          dy = semente(`${i}:${j}:y`) - 0.5
          dz = semente(`${i}:${j}:z`) - 0.5
          dist2 = dx * dx + dy * dy + dz * dz + 1e-6
        }
        const dist = Math.sqrt(dist2)
        // K²/d, e não K²/d². A lei do inverso do quadrado decai rápido demais: a repulsão
        // some antes de equilibrar a atração, e a nuvem inteira desaba para o centro com
        // os nós sobrepostos — foi exatamente o que aconteceu na primeira versão.
        const forca = (K * K) / dist
        const ux = (dx / dist) * forca
        const uy = (dy / dist) * forca
        const uz = (dz / dist) * forca
        desloc[i].x += ux
        desloc[i].y += uy
        desloc[i].z += uz
        desloc[j].x -= ux
        desloc[j].y -= uy
        desloc[j].z -= uz
      }
    }

    // Atração: cada ligação encurta a distância entre as duas pontas.
    for (const l of ligacoes) {
      const dx = pontos[l.a].x - pontos[l.b].x
      const dy = pontos[l.a].y - pontos[l.b].y
      const dz = pontos[l.a].z - pontos[l.b].z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-3
      const forca = ((dist * dist) / K) * l.peso
      const ux = (dx / dist) * forca
      const uy = (dy / dist) * forca
      const uz = (dz / dist) * forca
      desloc[l.a].x -= ux
      desloc[l.a].y -= uy
      desloc[l.a].z -= uz
      desloc[l.b].x += ux
      desloc[l.b].y += uy
      desloc[l.b].z += uz
    }

    for (let i = 0; i < n; i++) {
      // Gravidade fraca para a origem: sem ela um nó solto sai empurrado para longe e leva
      // o enquadramento junto.
      desloc[i].x -= pontos[i].x * 0.006
      desloc[i].y -= pontos[i].y * 0.006
      desloc[i].z -= pontos[i].z * 0.006

      const m = Math.sqrt(desloc[i].x ** 2 + desloc[i].y ** 2 + desloc[i].z ** 2) || 1e-6
      const limite = Math.min(m, temperatura) / m
      pontos[i].x += desloc[i].x * limite
      pontos[i].y += desloc[i].y * limite
      // Sem guarda para o plano: com todo mundo semeado em `z = 0`, as forças em z se
      // cancelam por simetria e ele fica zero sozinho. Uma guarda aqui não mudaria nada —
      // e escondia o fato de que quem define a dimensão é a SEMENTE, não este passo.
      pontos[i].z += desloc[i].z * limite
    }
  }

  /**
   * A nuvem é CENTRADA no que ela tem, e não na origem.
   *
   * A gravidade puxa para a origem mas não chega lá: sobra um deslocamento, e o
   * enquadramento — que é um quadrado em torno da origem — nasce torto, com o mapa
   * encostado num canto e o lado oposto vazio. Só os nós livres entram na conta: mover o
   * que alguém fixou seria desfazer o que essa pessoa fez.
   */
  const centro = {
    x: pontos.reduce((t, p) => t + p.x, 0) / n,
    y: pontos.reduce((t, p) => t + p.y, 0) / n,
    z: pontos.reduce((t, p) => t + p.z, 0) / n,
  }

  // Arredondar fecha a porta para diferenças de ponto flutuante entre execuções: o mesmo
  // grafo tem de dar exatamente as mesmas posições, e "quase iguais" não é igual.
  const red = (v: number) => Math.round(v * 100) / 100
  return nodes.map((no, i) => ({
    ...no,
    x: no.position ? no.position.x : red(pontos[i].x - centro.x),
    y: no.position ? no.position.y : red(pontos[i].y - centro.y),
    z: no.position || plano ? 0 : red(pontos[i].z - centro.z),
  }))
}

/**
 * GIRAR o conjunto — primeiro em torno do eixo vertical, depois inclinando.
 *
 * Nesta ordem, e não na inversa: girar depois de inclinar faz o mapa cambalear em
 * diagonal, que é a sensação de mexer num modelo torto em vez de girar um globo.
 */
export function girar(p: Ponto3, giro: number, inclinacao: number): Ponto3 {
  const cg = Math.cos(giro)
  const sg = Math.sin(giro)
  const x = p.x * cg + p.z * sg
  const z = -p.x * sg + p.z * cg
  const ci = Math.cos(inclinacao)
  const si = Math.sin(inclinacao)
  return { x, y: p.y * ci - z * si, z: p.y * si + z * ci }
}

/** O caminho de volta: da tela para o mundo. É o que faz arrastar continuar funcionando girado. */
export function desgirar(p: Ponto3, giro: number, inclinacao: number): Ponto3 {
  const ci = Math.cos(-inclinacao)
  const si = Math.sin(-inclinacao)
  const y = p.y * ci - p.z * si
  const z0 = p.y * si + p.z * ci
  const cg = Math.cos(-giro)
  const sg = Math.sin(-giro)
  return { x: p.x * cg + z0 * sg, y, z: -p.x * sg + z0 * cg }
}

/**
 * A projeção em perspectiva: divisão por profundidade, e não uma curva inventada.
 *
 * O que está mais perto da câmera cresce; o que está atrás encolhe. É a conta de qualquer
 * câmera, e é ela que faz o giro parecer um objeto girando em vez de pontos escorregando
 * na tela.
 */
export function projetar(p: Ponto3, zoom = 1): { x: number; y: number; escala: number; z: number } {
  const escala = (DISTANCIA_DA_CAMERA / Math.max(DISTANCIA_DA_CAMERA - p.z, DISTANCIA_DA_CAMERA * 0.35)) * zoom
  return { x: p.x * escala, y: p.y * escala, escala, z: p.z }
}

/**
 * O caminho INVERSO completo: de um ponto na tela para o ponto do mundo, no plano `z = 0`.
 *
 * `desgirar` sozinho não serve aqui, e essa foi a armadilha: a projeção encolhe cada ponto
 * por um fator que depende da profundidade DELE, e a profundidade de um ponto do plano
 * `z = 0` depende de onde ele está nesse plano — girado, o plano tem perto e longe. Dividir
 * por uma escala fixa devolvia um ponto deslocado, e o nó arrastado parava a dezenas de
 * pixels do dedo.
 *
 * A conta: escrever a projeção como um sistema 2×2 em (X, Y) e resolvê-lo, iterando a
 * escala — que converge em três passos porque a dependência é fraca.
 */
export function noPlanoDoMundo(tela: { x: number; y: number }, giro: number, inclinacao: number, zoom = 1): Ponto3 {
  const cg = Math.cos(giro)
  const ci = Math.cos(inclinacao)
  const sg = Math.sin(giro)
  const si = Math.sin(inclinacao)
  /**
   * Perto de 90° o eixo X do mundo aponta PARA DENTRO da tela: mover o ponteiro na
   * horizontal deixa de ter um X correspondente, e a conta explode. O piso mantém o
   * arrasto operável nesse ângulo — arisco, e não quebrado.
   */
  const piso = (v: number) => (Math.abs(v) < 0.18 ? Math.sign(v || 1) * 0.18 : v)

  // O chute inicial, resolvendo o sistema como se a escala fosse a do centro.
  let ponto: Ponto3 = { x: tela.x / zoom / piso(cg), y: 0, z: 0 }
  ponto.y = (tela.y / zoom - ponto.x * sg * si) / piso(ci)

  /**
   * E então NEWTON, usando a projeção de verdade.
   *
   * O chute acima é uma inversa algébrica, e uma inversa algébrica escrita à mão é
   * exatamente o tipo de coisa que fica quase certa: o nó parava a algumas dezenas de
   * pixels do dedo e a conta parecia impecável. Aqui a correção mede o erro pela MESMA
   * função que desenha, então ela não pode discordar do que está na tela — se o ponto
   * ainda não cai onde deve, o próximo passo corrige. Converge em dois ou três.
   */
  for (let i = 0; i < 6; i++) {
    const s = projetar(girar(ponto, giro, inclinacao), zoom)
    const ex = tela.x - s.x
    const ey = tela.y - s.y
    if (Math.abs(ex) + Math.abs(ey) < 1e-5) break
    const h = 1
    const dx = projetar(girar({ x: ponto.x + h, y: ponto.y, z: 0 }, giro, inclinacao), zoom)
    const dy = projetar(girar({ x: ponto.x, y: ponto.y + h, z: 0 }, giro, inclinacao), zoom)
    const a = (dx.x - s.x) / h
    const b = (dy.x - s.x) / h
    const c = (dx.y - s.y) / h
    const d = (dy.y - s.y) / h
    const det = a * d - b * c
    if (Math.abs(det) < 1e-9) break
    ponto = { x: ponto.x + (d * ex - b * ey) / det, y: ponto.y + (-c * ex + a * ey) / det, z: 0 }
  }
  return ponto
}

/**
 * A CÂMERA — de onde se olha, nas duas visões.
 *
 * Uma só, com a ida e a volta escritas lado a lado. A alternativa era um caminho de
 * projeção por visão, e o histórico deste arquivo diz o que acontece com isso: três dos
 * defeitos que chegaram à tela foram uma inversa que discordava da ida em algum ponto.
 * Aqui não há como uma discordar da outra sem que o teste de ida e volta perceba.
 */
export interface Camera {
  giro: number
  inclinacao: number
  zoom: number
  /** Deslocamento do quadro. Só a visão plana usa: no 3D o gesto do fundo é girar. */
  pan: { x: number; y: number }
  /** Plano: sem giro e sem divisão por profundidade — tudo do mesmo tamanho. */
  plano: boolean
}

/** Do espaço do desenho para a tela. */
export function paraTela(p: Ponto3, c: Camera): { x: number; y: number; escala: number; z: number } {
  if (c.plano) return { x: p.x * c.zoom + c.pan.x, y: p.y * c.zoom + c.pan.y, escala: c.zoom, z: 0 }
  const v = girar(p, c.giro, c.inclinacao)
  const e = projetar(v, c.zoom)
  return { x: e.x + c.pan.x, y: e.y + c.pan.y, escala: e.escala, z: v.z }
}

/** Da tela de volta para o espaço do desenho, no plano `z = 0`. */
export function daTela(tela: { x: number; y: number }, c: Camera): Ponto3 {
  const t = { x: tela.x - c.pan.x, y: tela.y - c.pan.y }
  if (c.plano) return { x: t.x / c.zoom, y: t.y / c.zoom, z: 0 }
  return noPlanoDoMundo(t, c.giro, c.inclinacao, c.zoom)
}

/**
 * A bruma da distância, a partir da escala projetada.
 *
 * O que está longe perde contraste, como perde no ar. Nunca até sumir: o mais distante
 * ainda precisa ser lido, senão o mapa esconde metade do que tem.
 */
export const brumaDe = (escala: number): number => Math.max(0.55, Math.min(1, 0.32 + escala * 0.7))

/**
 * O CENTRO da nuvem — o ponto em torno do qual ela gira e é enquadrada.
 *
 * Não é a origem. As forças centram o que elas mesmas resolvem, mas as posições SALVAS
 * entram por cima, cruas, no sistema de coordenadas em que foram gravadas — inclusive as
 * do layout antigo, em fileiras, que descem centenas de unidades. Com o centro fixo na
 * origem, uma conta que já tinha organizado o mapa à mão via tudo pendurado num canto,
 * metade do quadro vazio, e o conjunto balançando em torno de um ponto que não é o dele.
 * Medido: a nuvem inteira a 381 unidades abaixo do centro do quadro.
 */
/**
 * O RAIO padrão em que a nuvem é desenhada — e por que ela é NORMALIZADA para ele.
 *
 * As posições podem chegar em qualquer escala: as forças produzem umas centenas de
 * unidades, mas uma posição salva vem no sistema em que foi gravada. O layout antigo
 * espalhava documentos de 110 em 110 numa fileira só — duzentos documentos são vinte e
 * dois mil de largura.
 *
 * Com a câmera a uma distância FIXA, uma nuvem desse tamanho encosta nela: a ampliação da
 * perspectiva dispara, o quadro vai a dez mil unidades e a bolinha do setor sai com cinco
 * pixels. Medido. Normalizar resolve os três de uma vez — a perspectiva volta a ser suave,
 * o quadro fica do mesmo tamanho para toda conta, e o raio do nó (uma constante em
 * unidades do mundo) volta a significar o mesmo na tela.
 */
export const RAIO_DE_DESENHO = 260

/** O quanto multiplicar as posições para a nuvem caber no raio de desenho. */
export const normalizacaoDe = (raio: number): number => RAIO_DE_DESENHO / Math.max(raio, 1)

/** O raio da nuvem a partir do seu centro — o que a normalização precisa saber. */
export function raioDe(nodes: Positioned[], centro: Ponto3): number {
  if (nodes.length === 0) return RAIO_DE_DESENHO
  return Math.max(
    ...nodes.map((n) => {
      const r = relativoAo(n, centro)
      return Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z)
    }),
    1,
  )
}

export function centroDe(nodes: Positioned[]): Ponto3 {
  if (nodes.length === 0) return { x: 0, y: 0, z: 0 }
  return {
    x: nodes.reduce((t, n) => t + n.x, 0) / nodes.length,
    y: nodes.reduce((t, n) => t + n.y, 0) / nodes.length,
    z: nodes.reduce((t, n) => t + n.z, 0) / nodes.length,
  }
}

/** Um ponto visto a partir do centro da nuvem: é nessas coordenadas que se gira e projeta. */
export const relativoAo = (p: Ponto3, centro: Ponto3): Ponto3 => ({ x: p.x - centro.x, y: p.y - centro.y, z: p.z - centro.z })

/**
 * A caixa do desenho — quadrada e do tamanho do RAIO do conjunto, medido do centro dele.
 *
 * Quadrada de propósito: o mapa gira, e uma caixa ajustada ao contorno de agora mudaria a
 * cada grau, fazendo tudo pular de tamanho enquanto a pessoa arrasta. Um quadrado que
 * contém a nuvem em qualquer ângulo é o único enquadramento que fica parado.
 */
export function boundsOf(nodes: Positioned[]): { minX: number; minY: number; width: number; height: number } {
  if (nodes.length === 0) return { minX: -200, minY: -150, width: 400, height: 300 }
  // A nuvem é normalizada antes de ser desenhada, então o raio aqui é sempre o mesmo — e o
  // quadro, por consequência, também. Contas diferentes veem o mapa do mesmo tamanho.
  const raio = RAIO_DE_DESENHO
  // O nó mais à frente é também o mais AMPLIADO: a caixa tem de caber o raio já projetado
  // pela escala máxima, mais o corpo da esfera e o nome embaixo dela. Folga a mais aqui
  // não é segurança — é o mapa inteiro desenhado menor do que precisava.
  const ampliacao = DISTANCIA_DA_CAMERA / (DISTANCIA_DA_CAMERA - raio)
  const lado = (raio * ampliacao + 54) * 2
  return { minX: -lado / 2, minY: -lado / 2, width: lado, height: lado }
}
