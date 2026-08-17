import { describe, expect, it } from 'vitest'
import { capabilitiesFor, cleanRunConfig } from './runConfig'

// A matriz existe nas duas pontas: o servidor para nunca ENVIAR um parâmetro não
// suportado, a tela para nunca OFERECER um. Divergir é o defeito real — a interface
// mostraria um campo descartado em silêncio, e o dono ajustaria a criatividade de um
// modelo que não tem criatividade.
//
// O espelho é conferido por caso, contra os mesmos valores do teste de backend.

describe('matriz de capacidades', () => {
  it('modelo de raciocínio não aceita temperatura, e expõe esforço', () => {
    const caps = capabilitiesFor('openai', 'o3-mini')
    expect(caps.temperature).toBe(false)
    expect(caps.reasoningEffort).toBe(true)
  })

  it('modelo comum aceita temperatura e não expõe esforço', () => {
    const caps = capabilitiesFor('openai', 'gpt-4o-mini')
    expect(caps.temperature).toBe(true)
    expect(caps.reasoningEffort).toBe(false)
  })

  it('provedor desconhecido cai no conjunto conservador', () => {
    const caps = capabilitiesFor('provedor-novo', 'modelo-x')
    expect(caps.temperature).toBe(true)
    expect(caps.reasoningEffort).toBe(false)
  })

  it('nulo não quebra', () => {
    expect(capabilitiesFor(null, null).temperature).toBe(true)
  })
})

describe('limpeza antes de enviar', () => {
  it('campo vazio é AUSÊNCIA, não nulo', () => {
    // Ausente diz "padrão do sistema". Mandar null diria outra coisa.
    expect(cleanRunConfig({ temperature: undefined, retries: 2 })).toEqual({ retries: 2 })
  })

  it('zero e false sobrevivem: são escolhas', () => {
    // Temperatura 0 é "sempre igual", não "sem preferência".
    expect(cleanRunConfig({ temperature: 0, parallelTools: false })).toEqual({ temperature: 0, parallelTools: false })
  })

  it('config vazia continua vazia', () => {
    expect(cleanRunConfig({})).toEqual({})
  })
})
