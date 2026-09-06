import { brumaDe } from './layout'
import type { Positioned } from './layout'

// O NÓ — uma ESFERA compacta, do jeito que a especificação fixou.
//
// Setor: a cor real do setor e a inicial do nome, que funciona como ícone. Agente: o
// MESMO retrato que o sistema já usa em toda tela, para ser a mesma pessoa em todo
// lugar. Documento: círculo neutro com um ícone pequeno e o estado de indexação
// discreto. Nada de card retangular dentro do grafo.
//
// O VOLUME vem de três coisas, e nenhuma delas é uma imagem: a luz de cima à esquerda
// (o lustre), o escurecimento da borda oposta (a terminação), e o contato com o plano
// (a sombra elíptica embaixo). A cor de identidade continua sendo a do círculo de baixo
// — o sombreamento passa POR CIMA dela, então um setor azul continua azul.

export const RAIO: Record<Positioned['kind'], number> = { building: 26, floor: 24, sector: 22, agent: 22, document: 16 }

const NEUTRO = 'var(--surface-card)'
const BORDA = 'var(--border-subtle)'

const INDICADOR: Record<string, { cor: string; titulo: string }> = {
  expired: { cor: 'var(--intent-danger)', titulo: 'vencido' },
  expiring_soon: { cor: 'var(--intent-warning)', titulo: 'vence em breve' },
  due_for_review: { cor: 'var(--intent-warning)', titulo: 'revisão pendente' },
  conflict: { cor: 'var(--intent-danger)', titulo: 'em conflito' },
  draft: { cor: 'var(--text-faint)', titulo: 'rascunho' },
  archived: { cor: 'var(--text-faint)', titulo: 'arquivado' },
}

export function KnowledgeNode({
  node,
  visto,
  portrait,
  selected,
  dimmed,
  onSelect,
  onOpen,
  onDragStart,
}: {
  node: Positioned
  /** Onde este nó cai na tela DESTE ângulo, e quanto ele cresceu ou encolheu na perspectiva. */
  visto: { x: number; y: number; escala: number }
  portrait: string | null
  selected: boolean
  dimmed: boolean
  onSelect: () => void
  onOpen: () => void
  onDragStart: (e: React.PointerEvent) => void
}) {
  const r = RAIO[node.kind]
  const inicial = node.label.trim().charAt(0).toUpperCase() || '?'
  const cor = node.color ?? null
  const flag = (node.flags ?? []).map((f) => INDICADOR[f]).find(Boolean)
  // A bruma da distância MULTIPLICA o apagamento da vizinhança em vez de substituí-lo:
  // são duas perguntas diferentes ("está longe" e "não tem a ver com o que eu escolhi"),
  // e o mapa precisa responder as duas ao mesmo tempo.
  const opacidade = (dimmed ? 0.25 : 1) * brumaDe(visto.escala)

  return (
    <g
      transform={`translate(${visto.x} ${visto.y}) scale(${visto.escala})`}
      data-profundidade={visto.escala}
      opacity={opacidade}
      style={{ cursor: 'pointer' }}
      tabIndex={0}
      role="button"
      // O leitor de tela anuncia O QUE é e QUAL é — um "botão" sem tipo obriga a pessoa
      // a adivinhar se aquele círculo é um agente ou um documento.
      aria-label={`${LABEL_TIPO[node.kind]}: ${node.label}${flag ? ` (${flag.titulo})` : ''}`}
      aria-pressed={selected}
      data-testid={`knode-${node.id}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onPointerDown={onDragStart}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      {/* A sombra de contato: uma elipse achatada logo abaixo. É ela que tira a bolinha
          do papel — sombreamento sozinho não convence, o olho procura o contato. Elipse,
          e não círculo, porque o plano é visto de viés. */}
      <ellipse cx={r * 0.12} cy={r * 1.08} rx={r * 0.92} ry={r * 0.26} fill="url(#k-contato)" aria-hidden="true" pointerEvents="none" />
      {selected && <circle r={r + 6} fill="none" stroke="var(--intent-brand)" strokeWidth={2} />}
      {node.kind === 'agent' && portrait ? (
        <>
          <clipPath id={`clip-${node.id}`}>
            <circle r={r} />
          </clipPath>
          <circle r={r} fill={NEUTRO} stroke={BORDA} data-testid="knode-base" />
          <image href={portrait} x={-r} y={-r} width={r * 2} height={r * 2} clipPath={`url(#clip-${node.id})`} preserveAspectRatio="xMidYMid slice" />
          <circle r={r} fill="url(#k-terminacao)" pointerEvents="none" />
          <circle r={r} fill="url(#k-lustre)" pointerEvents="none" />
          <circle r={r} fill="none" stroke={BORDA} />
        </>
      ) : (
        <>
          <circle r={r} fill={cor ?? NEUTRO} stroke={cor ?? BORDA} strokeWidth={1} data-testid="knode-base" />
          {/* A terminação escurece a borda oposta à luz; o lustre é o brilho dela. Os
              dois são translúcidos e sem cor própria, então servem para qualquer cor de
              setor sem precisar de um gradiente por cor. */}
          <circle r={r} fill="url(#k-terminacao)" pointerEvents="none" />
          <circle r={r} fill="url(#k-lustre)" pointerEvents="none" />
          {/* Setor: a inicial É o ícone. Não existe upload de ícone de setor, e inventar
              um agora seria um sistema novo para uma decisão que já está tomada. */}
          <text
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontSize: node.kind === 'document' ? 12 : 15, fontWeight: 700, fill: cor ? '#fff' : 'var(--text-muted)', pointerEvents: 'none' }}
          >
            {node.kind === 'document' ? '¶' : node.kind === 'building' ? '🏢' : node.kind === 'floor' ? '▤' : inicial}
          </text>
        </>
      )}

      {/* O estado de indexação, discreto: um ponto na borda, sem substituir a identidade. */}
      {node.kind === 'document' && node.indexStatus !== 'indexed' && (
        <circle
          cx={r * 0.7}
          cy={-r * 0.7}
          r={4}
          fill={node.indexStatus === 'error' ? 'var(--intent-danger)' : 'var(--intent-warning)'}
        >
          <title>{node.indexStatus === 'error' ? 'erro ao indexar' : 'indexando'}</title>
        </circle>
      )}
      {flag && (
        <circle cx={-r * 0.7} cy={-r * 0.7} r={4} fill={flag.cor}>
          <title>{flag.titulo}</title>
        </circle>
      )}

      {/* O nome curto embaixo; o completo fica no tooltip e no painel. */}
      <text y={r + 14} textAnchor="middle" style={{ fontSize: 11, fill: 'var(--text-muted)', pointerEvents: 'none' }}>
        {node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label}
      </text>
      <title>{node.label}</title>
    </g>
  )
}

export const LABEL_TIPO: Record<Positioned['kind'], string> = {
  building: 'Prédio',
  floor: 'Andar',
  sector: 'Setor',
  agent: 'Agente',
  document: 'Documento',
}
