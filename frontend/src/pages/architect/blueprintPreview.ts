import type { AgentSummary, SectorSummary } from '../../lib/types'
import type { Blueprint } from '../../lib/architect'

// O blueprint desenhado como escritório — antes de existir escritório nenhum.
//
// A proposta fala em `key`; o mapa fala em recurso. Aqui as duas se encontram, e o
// encontro é DESCARTÁVEL: os ids saem com o prefixo `preview:`, que nenhum recurso real
// pode ter, para que um clique perdido não navegue para uma página de nada e para que
// ninguém confunda o rascunho com o que já existe.
//
// Função pura de propósito: ela é a única coisa entre "o modelo mudou a proposta" e "o
// desenho mudou junto", e isso precisa ser exercitável sem navegador.

/** O prefixo que marca tudo o que é rascunho. Um id real nunca começa assim. */
export const PREFIXO = 'preview:'

export const previewId = (kind: 'floor' | 'agent' | 'sector', key: string): string => `${PREFIXO}${kind}:${key}`

/** `true` para id de rascunho — é o que a tela usa para NÃO navegar. */
export const isPreviewId = (id: string): boolean => String(id ?? '').startsWith(PREFIXO)

export interface OfficePreviewFloor {
  id: string
  key: string
  name: string
  agents: AgentSummary[]
  sectors: SectorSummary[]
  /** Agentes que não estão em setor nenhum: eles aparecem na área comum do mapa. */
  looseAgents: AgentSummary[]
}

export interface OfficePreview {
  floors: OfficePreviewFloor[]
  totals: { floors: number; agents: number; sectors: number }
}

/** As mesmas cores que a tela de setores usa, para o rascunho não parecer outro produto. */
const CORES = ['#2E5BFF', '#17B98A', '#FFB53D', '#8B5CF6', '#38B6F0', '#FF6A5B']

/**
 * O escritório que a proposta descreve.
 *
 * Um agente sem `floorKey` conhecido cai no primeiro andar em vez de sumir: no rascunho,
 * um agente invisível é pior que um agente no lugar errado — o segundo se corrige com
 * um clique, o primeiro ninguém percebe que faltou.
 */
export function blueprintToOfficePreview(blueprint: Blueprint | null | undefined): OfficePreview {
  const floors = blueprint?.floors ?? []
  const agents = blueprint?.agents ?? []
  const sectors = blueprint?.sectors ?? []

  const chavesDeAndar = floors.map((f) => f.key)
  const andarDoAgente = (chave: string | undefined): string | undefined =>
    chave && chavesDeAndar.includes(chave) ? chave : chavesDeAndar[0]

  const previewFloors: OfficePreviewFloor[] = floors.map((floor) => {
    const doAndar = agents.filter((a) => andarDoAgente(a.floorKey) === floor.key)
    const setoresDoAndar = sectors.filter((s) => (s.floorKey ? s.floorKey === floor.key : floor.key === chavesDeAndar[0]))
    const emSetor = new Set(setoresDoAndar.flatMap((s) => s.memberAgentKeys ?? []))

    const comoAgente = (a: (typeof agents)[number]): AgentSummary =>
      ({
        _id: previewId('agent', a.key),
        name: a.name,
        objective: a.objective ?? '',
        floorId: previewId('floor', floor.key),
      }) as unknown as AgentSummary

    return {
      id: previewId('floor', floor.key),
      key: floor.key,
      name: floor.name,
      agents: doAndar.map(comoAgente),
      looseAgents: doAndar.filter((a) => !emSetor.has(a.key)).map(comoAgente),
      sectors: setoresDoAndar.map(
        (s, i) =>
          ({
            _id: previewId('sector', s.key),
            name: s.name,
            color: CORES[i % CORES.length],
            mode: s.mode,
            floorId: previewId('floor', floor.key),
            coordinatorAgentId: s.coordinatorAgentKey ? previewId('agent', s.coordinatorAgentKey) : null,
            // Só membros que existem na proposta: uma chave solta viraria uma cadeira
            // ocupada por ninguém.
            members: (s.memberAgentKeys ?? [])
              .filter((k) => doAndar.some((a) => a.key === k))
              .map((k) => ({ agentId: previewId('agent', k) })),
          }) as unknown as SectorSummary,
      ),
    }
  })

  return {
    floors: previewFloors,
    totals: { floors: previewFloors.length, agents: agents.length, sectors: sectors.length },
  }
}

/** O andar em uma frase — para quem não enxerga o mapa, e para quem não quer contar. */
export function describeFloor(floor: OfficePreviewFloor | undefined): string {
  if (!floor) return 'Nenhum andar nesta proposta ainda.'
  const partes = [`Andar "${floor.name}" com ${floor.agents.length} ${floor.agents.length === 1 ? 'agente' : 'agentes'}`]
  if (floor.sectors.length > 0) {
    // Os NOMES de quem está em cada setor, e não só quantos.
    //
    // Quem lê esta frase em vez de ver o mapa precisa da mesma informação que o mapa
    // dá — e "Mesa de Atendimento (2)" não diz quem são os dois. Com muita gente a
    // frase fica impossível de ouvir, então os primeiros cinco nomeiam e o resto conta.
    const nomeDoAgente = new Map(floor.agents.map((a) => [a._id, a.name]))
    const membros = (s: OfficePreviewFloor['sectors'][number]): string => {
      const nomes = (s.members ?? []).map((m) => nomeDoAgente.get(m.agentId) ?? '?')
      if (nomes.length === 0) return 'sem membros'
      if (nomes.length <= 5) return nomes.join(', ')
      return `${nomes.slice(0, 5).join(', ')} e mais ${nomes.length - 5}`
    }
    partes.push(
      `em ${floor.sectors.length} ${floor.sectors.length === 1 ? 'setor' : 'setores'}: ${floor.sectors
        .map((s) => `${s.name} (${membros(s)})`)
        .join('; ')}`,
    )
  }
  if (floor.looseAgents.length > 0) {
    partes.push(`${floor.looseAgents.length} na área comum, fora de setor: ${floor.looseAgents.map((a) => a.name).join(', ')}`)
  }
  return `${partes.join('; ')}.`
}
