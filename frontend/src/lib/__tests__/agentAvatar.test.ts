import { describe, expect, it } from 'vitest'
import { assignCharacters, elencoPara, generoDoNome } from '../agentAvatar'

const so = (ids: string[]) => ids.map((id) => ({ id }))

describe('assignCharacters', () => {
  it('is deterministic and does not repeat a face while faces remain', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const m1 = assignCharacters(so(ids))
    const m2 = assignCharacters(so(ids))
    expect([...m1.entries()]).toEqual([...m2.entries()]) // deterministic
    expect(new Set(m1.values()).size).toBe(ids.length) // no repeats (<= cast size)
  })

  it('keeps every existing agent when a new one is added', () => {
    const ids = ['dev-2', 'sup-1', 'mkt-9', 'fin-4']
    const first = assignCharacters(so(ids))
    const withNew = assignCharacters(so([...ids, 'brand-new']), first)
    for (const id of ids) expect(withNew.get(id)).toBe(first.get(id)) // nobody reshuffles
    expect(withNew.get('brand-new')).toBeTruthy()
  })

  it('reuses the least-used face once the cast is exhausted', () => {
    const ids = Array.from({ length: 14 }, (_, i) => `agent-${i}`)
    const m = assignCharacters(so(ids))
    const counts = new Map<string, number>()
    for (const c of m.values()) counts.set(c, (counts.get(c) ?? 0) + 1)
    // 14 agents over 10 faces → each face used once or twice, none three times
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(2)
  })
})

describe('a face não contradiz o nome', () => {
  /**
   * O retrato saía do id e mais nada: uma agente chamada Marina aparecia com a cara do
   * Bruno. Quem olha a tela lê a imagem antes do nome — e os dois diziam coisas diferentes.
   */
  const FEMININAS = ['lia', 'nina', 'iris', 'duda', 'noah']
  const MASCULINAS = ['bruno', 'teo', 'rafa', 'caio']

  it('nome feminino recebe retrato feminino, em qualquer id', () => {
    for (const nome of ['Marina', 'Tereza', 'Helena', 'Alice', 'Lívia', 'Sofia', 'Clara', 'Nina']) {
      const m = assignCharacters(Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, name: nome })))
      for (const face of m.values()) expect(FEMININAS).toContain(face)
    }
  })

  it('nome masculino recebe retrato masculino, em qualquer id', () => {
    for (const nome of ['Rafael', 'Bruno', 'Caio', 'Otávio', 'Gustavo', 'Daniel', 'Renato', 'Vitor']) {
      const m = assignCharacters(Array.from({ length: 8 }, (_, i) => ({ id: `y${i}`, name: nome })))
      for (const face of m.values()) expect(MASCULINAS).toContain(face)
    }
  })

  it('uma face guardada que contradiz o nome é trocada — o erro antigo não vira permanente', () => {
    const antigo = new Map([['a1', 'bruno']])
    const m = assignCharacters([{ id: 'a1', name: 'Marina' }], antigo)
    expect(FEMININAS).toContain(m.get('a1'))
  })

  it('nome que a língua não decide fica com o elenco inteiro — sem palpite', () => {
    expect(generoDoNome('Alex')).toBeNull()
    expect(generoDoNome('Kim')).toBeNull()
    expect(elencoPara('Alex')).toHaveLength(10)
    expect(elencoPara(undefined)).toHaveLength(10)
  })

  it('sem contradizer o nome, dois agentes do mesmo gênero ainda recebem faces diferentes', () => {
    const m = assignCharacters([
      { id: 'p1', name: 'Marina' },
      { id: 'p2', name: 'Helena' },
      { id: 'p3', name: 'Clara' },
    ])
    expect(new Set(m.values()).size).toBe(3)
  })
})
