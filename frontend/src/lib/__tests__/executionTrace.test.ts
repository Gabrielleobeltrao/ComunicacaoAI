import { describe, expect, it } from 'vitest'
import { duracaoTotal, filtrarEventos, formatarDuracao, novaTrilha, tokensDaTrilha } from '../executionTrace'
import type { TraceEvent } from '../executionTrace'

// As regras do painel de acompanhamento. Elas vivem fora do componente porque são regras,
// não desenho: o que cada filtro mostra, quanto a execução levou, quanto custou.

const evento = (over: Partial<TraceEvent> = {}): TraceEvent => ({
  executionId: 't1',
  timestamp: '2026-08-19T10:00:00.000Z',
  type: 'agent',
  title: 'algo aconteceu',
  ...over,
})

describe('filtros da trilha', () => {
  const eventos = [
    evento({ type: 'user_prompt' }),
    evento({ type: 'planner' }),
    evento({ type: 'agent', status: 'success' }),
    evento({ type: 'agent', status: 'error' }),
    evento({ type: 'delegation' }),
    evento({ type: 'tool', status: 'error' }),
    evento({ type: 'rag' }),
    evento({ type: 'synthesis' }),
  ]

  it('"tudo" não esconde nada', () => {
    expect(filtrarEventos(eventos, 'all')).toHaveLength(eventos.length)
  })

  it('cada filtro mostra a sua família', () => {
    expect(filtrarEventos(eventos, 'planner').map((e) => e.type)).toEqual(['planner'])
    expect(filtrarEventos(eventos, 'agents').map((e) => e.type)).toEqual(['agent', 'agent', 'delegation', 'synthesis'])
    expect(filtrarEventos(eventos, 'tools').map((e) => e.type)).toEqual(['tool'])
    expect(filtrarEventos(eventos, 'rag').map((e) => e.type)).toEqual(['rag'])
  })

  it('"erros" atravessa os tipos: o que se procura é o que deu errado', () => {
    const erros = filtrarEventos(eventos, 'errors')
    expect(erros).toHaveLength(2)
    expect(erros.map((e) => e.type)).toEqual(['agent', 'tool'])
  })
})

describe('as contas do cabeçalho', () => {
  it('a duração total sai dos extremos da própria trilha', () => {
    const eventos = [
      evento({ timestamp: '2026-08-19T10:00:00.000Z' }),
      evento({ timestamp: '2026-08-19T10:00:02.500Z' }),
    ]
    expect(duracaoTotal(eventos)).toBe(2500)
    // Um evento só não tem duração — e uma trilha vazia também não.
    expect(duracaoTotal([eventos[0]])).toBe(0)
    expect(duracaoTotal([])).toBe(0)
  })

  it('os tokens são os relatados, e nada é estimado', () => {
    const eventos = [
      evento({ metadata: { usage: { inputTokens: 10, outputTokens: 5 } } }),
      evento({ metadata: { usage: { inputTokens: 2, outputTokens: 1 } } }),
      evento({ metadata: { grounding: 'ok' } }),
    ]
    expect(tokensDaTrilha(eventos)).toBe(18)
    expect(tokensDaTrilha([evento()])).toBe(0)
  })

  it('a duração é escrita para gente ler', () => {
    expect(formatarDuracao(450)).toBe('450 ms')
    expect(formatarDuracao(2500)).toBe('2.5 s')
    expect(formatarDuracao(undefined)).toBe('')
  })
})

describe('o id da trilha', () => {
  it('é único por envio', () => {
    const ids = new Set(Array.from({ length: 50 }, () => novaTrilha()))
    expect(ids.size).toBe(50)
  })
})
