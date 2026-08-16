import { describe, expect, it } from 'vitest'
import { cozinha, lounge, reuniao } from '../cenarios'
import { buildOfficeLayout } from '../buildOfficeLayout'
import type { LayoutInput } from '../buildOfficeLayout'

function sampleInput(): LayoutInput {
  const mk = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ _id: `${prefix}-${i}` }))
  const dev = mk(4, 'dev')
  const sales = mk(2, 'sales')
  const loose = mk(3, 'loose')
  return {
    agents: [...dev, ...sales, ...loose],
    sectors: [
      { _id: 'sector-dev', name: 'Desenvolvimento', color: '#2E5BFF', members: dev.map((a) => ({ agentId: a._id })) },
      { _id: 'sector-sales', name: 'Vendas', color: '#17B98A', members: sales.map((a) => ({ agentId: a._id })) },
    ],
    aspect: 2,
    amenities: [reuniao, cozinha, lounge],
    amenityTint: { reuniao: '#38B6F0', cozinha: '#FFB53D', lounge: '#8B5CF6' },
    decorArts: ['planta-grande-1.5x2', 'samambaia-1.5x1.5'],
  }
}

// Compare only the numeric/string shape (Sets don't serialize) so two runs match.
function digest(l: ReturnType<typeof buildOfficeLayout>) {
  return {
    cols: l.cols,
    rows: l.rows,
    rooms: l.rooms.map((r) => ({ key: r.key, kind: r.kind, x: r.x, y: r.y, w: r.w, h: r.h })),
    seats: l.seats.map((s) => ({ id: s.id, agentId: s.agentId, seated: s.seatedPoint, exit: s.exitPoint, facing: s.facing, z: s.zIndex, near: s.chair.near })),
    loose: l.loose,
    desks: l.desks,
    obstacles: l.obstacles.length,
  }
}

describe('buildOfficeLayout', () => {
  it('is deterministic for the same inputs', () => {
    expect(digest(buildOfficeLayout(sampleInput()))).toEqual(digest(buildOfficeLayout(sampleInput())))
  })

  it('assigns every sector member exactly one stable seat', () => {
    const l = buildOfficeLayout(sampleInput())
    const seated = l.seats.map((s) => s.agentId)
    expect(new Set(seated).size).toBe(6) // 4 dev + 2 sales
    for (const id of ['dev-0', 'dev-3', 'sales-1']) expect(seated).toContain(id)
    // loose agents are not seated
    expect(seated).not.toContain('loose-0')
    expect(l.loose.map((o) => o.agentId).sort()).toEqual(['loose-0', 'loose-1', 'loose-2'])
  })

  it('gives each seat a distinct exit point in the room interior', () => {
    for (const s of buildOfficeLayout(sampleInput()).seats) {
      expect(s.exitPoint).not.toEqual(s.seatedPoint)
      expect(Number.isFinite(s.exitPoint.x)).toBe(true)
      expect(Number.isFinite(s.exitPoint.y)).toBe(true)
    }
  })

  it('marks front/back facing consistently with the chair side', () => {
    for (const s of buildOfficeLayout(sampleInput()).seats) {
      expect(s.facing).toBe(s.chair.near ? 'back' : 'front')
      expect(s.zIndex).toBe(s.chair.near ? 3 : 1)
    }
  })

  it('produces desk + object obstacles for collision', () => {
    const l = buildOfficeLayout(sampleInput())
    expect(l.obstacles.some((o) => o.kind === 'desk')).toBe(true)
    // amenity furniture contributes object obstacles
    expect(l.obstacles.filter((o) => o.kind === 'object').length).toBeGreaterThan(0)
  })
})

// A regressão real: "Marcos" estava listado em dois setores da conta. Cada setor
// ganhava um assento para ele, então o mapa desenhava a MESMA pessoa duas vezes —
// dois balões sobre uma cabeça só, e duas simulações registradas com o mesmo id
// brigando pelo mesmo registro de movimento. O personagem travava.
describe('um agente ocupa um assento só', () => {
  const doisSetores = (): LayoutInput => ({
    agents: [{ _id: 'a1' }, { _id: 'a2' }],
    sectors: [
      { _id: 's1', name: 'Atendimento', color: '#2E5BFF', members: [{ agentId: 'a1' }, { agentId: 'a2' }] },
      // a1 aparece de novo aqui: dado antigo, de antes da regra de pertencer a um só.
      { _id: 's2', name: 'Equipe do Salão', color: '#17B98A', members: [{ agentId: 'a1' }] },
    ],
    aspect: 2,
    amenities: [],
    amenityTint: {},
    decorArts: [],
  })

  it('o agente listado em dois setores é assentado uma vez', () => {
    const l = buildOfficeLayout(doisSetores())
    const doA1 = l.seats.filter((s) => s.agentId === 'a1')
    expect(doA1).toHaveLength(1)
    // E é o primeiro setor da lista que fica com ele.
    const sala1 = l.rooms.find((r) => r.key === 's1')
    expect(l.seats.find((s) => s.agentId === 'a1')?.sectorId).toBe(sala1?.key)
  })

  it('membro repetido dentro do MESMO setor também vira um assento só', () => {
    const input = doisSetores()
    input.sectors = [{ _id: 's1', name: 'Atendimento', color: '#2E5BFF', members: [{ agentId: 'a1' }, { agentId: 'a1' }, { agentId: 'a2' }] }]
    const l = buildOfficeLayout(input)
    expect(l.seats.filter((s) => s.agentId === 'a1')).toHaveLength(1)
  })

  it('ninguém é desenhado duas vezes: assentos e soltos são conjuntos disjuntos', () => {
    const l = buildOfficeLayout(doisSetores())
    const ids = [...l.seats.map((s) => s.agentId), ...l.loose.map((o) => o.agentId)]
    expect(new Set(ids).size).toBe(ids.length)
  })
})
