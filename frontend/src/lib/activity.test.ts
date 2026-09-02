import { describe, expect, it } from 'vitest'
import { cadeia, duracao } from './activity'
import type { ActivityItem } from './activity'

// As regras da tela, testadas sem montar tela: o que a frase da correlação diz, e o que
// ela NÃO diz quando a projeção não sabe.

const base: ActivityItem = {
  executionKey: 'run:1',
  status: 'succeeded',
  source: 'manual',
  environment: 'production',
  createdAt: new Date(0).toISOString(),
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  origin: null,
  flow: null,
  steps: [],
  deliveries: 0,
  usage: { inputTokens: 0, outputTokens: 0 },
  errorKind: null,
}

describe('a frase da correlação', () => {
  it('vai do monitor até a entrega', () => {
    expect(
      cadeia({
        ...base,
        origin: { kind: 'monitor', id: 'm1', name: 'RSI sobrevendido', eventId: 'e1' },
        flow: { id: 'f1', name: 'Avisar', version: 2, triggerType: 'internal_event' },
        steps: [{ stepId: 's1', stepType: 'agent.execute', status: 'succeeded', durationMs: 10 }],
        deliveries: 1,
      }),
    ).toEqual(['monitor RSI sobrevendido', 'Avisar v2', '1 etapa', '1 entrega'])
  })

  it('diz menos em vez de inventar quando não há monitor nem Flow', () => {
    expect(cadeia(base)).toEqual(['manual'])
  })

  it('não conta entrega que não houve', () => {
    expect(cadeia({ ...base, deliveries: 0 }).some((p) => p.includes('entrega'))).toBe(false)
  })
})

describe('a duração', () => {
  it('não inventa um número quando a execução não terminou', () => {
    expect(duracao(null)).toBe('—')
  })
  it('lê como gente', () => {
    expect(duracao(450)).toBe('450 ms')
    expect(duracao(1500)).toBe('1.5 s')
    expect(duracao(125_000)).toBe('2 min 5 s')
  })
})
