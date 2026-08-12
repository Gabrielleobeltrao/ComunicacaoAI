import { describe, expect, it } from 'vitest'
import { agentSprite, agentSpriteView, directionBase, spriteFallbacks } from '../officeSprites'

describe('sprite manifest', () => {
  it('maps directions to the drawn facing, mirroring only left', () => {
    expect(directionBase('front')).toEqual({ facing: 'frente', mirror: false })
    expect(directionBase('back')).toEqual({ facing: 'costas', mirror: false })
    expect(directionBase('right')).toEqual({ facing: 'frente', mirror: false })
    expect(directionBase('left')).toEqual({ facing: 'frente', mirror: true })
  })

  it('uses the seated crop when seated', () => {
    expect(agentSpriteView('normal', 'front', 'seated', 0).view).toBe('frente-sentado')
    expect(agentSpriteView('phone', 'back', 'seated', 3).view).toBe('costas-sentado-ligacao')
  })

  it('cycles four walk frames while moving', () => {
    const frames = [0, 1, 2, 3, 4, 5].map((f) => agentSpriteView('normal', 'front', 'walking', f).view)
    expect(frames).toEqual(['frente-andando1', 'frente-andando2', 'frente-andando3', 'frente-andando4', 'frente-andando1', 'frente-andando2'])
  })

  it('handles negative frame indices safely', () => {
    expect(agentSpriteView('normal', 'back', 'returning', -1).view).toBe('costas-andando4')
  })

  it('uses standing idle when paused', () => {
    expect(agentSpriteView('normal', 'front', 'pausing', 2).view).toBe('frente')
    expect(agentSpriteView('phone', 'front', 'waiting', 2).view).toBe('frente-ligacao')
  })

  it('resolves a full sprite path with mirror flag', () => {
    const s = agentSprite('lia', 'normal', 'left', 'walking', 1)
    expect(s.src).toBe('/illustrations/characters/lia/frente-andando2.svg')
    expect(s.mirror).toBe(true)
  })

  it('always offers a drawable fallback ending in the legacy front sprite', () => {
    const chain = spriteFallbacks('teo', 'phone', 'back')
    expect(chain[chain.length - 1]).toBe('/illustrations/characters/teo/frente.svg')
    expect(chain).toContain('/illustrations/characters/teo/costas-ligacao.svg')
  })
})
