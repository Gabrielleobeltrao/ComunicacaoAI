// Sprite manifest: the single place that maps a character + visual mode +
// direction + motion + frame to an asset file, with a fallback chain. The design
// has no side profile, so left/right reuse the front sprite (left is mirrored).
import { characterAsset } from '../lib/officeAssets'
import type { AgentMotionState, AgentVisualMode, OfficeDirection } from './officeTypes'

export interface ResolvedSprite {
  src: string
  mirror: boolean
}

/** Which drawn facing (frente/costas) and mirror a logical direction maps to. */
export function directionBase(direction: OfficeDirection): { facing: 'frente' | 'costas'; mirror: boolean } {
  if (direction === 'back') return { facing: 'costas', mirror: false }
  if (direction === 'left') return { facing: 'frente', mirror: true }
  return { facing: 'frente', mirror: false } // front, right
}

/** The view name (file base) for a state. Moving → 4-frame walk cycle; seated →
 *  the -sentado crop; anything else → the standing idle. */
export function agentSpriteView(mode: AgentVisualMode, direction: OfficeDirection, motion: AgentMotionState, frame: number): { view: string; mirror: boolean } {
  const { facing, mirror } = directionBase(direction)
  const phone = mode === 'phone' ? '-ligacao' : ''
  let view: string
  if (motion === 'seated') {
    view = `${facing}-sentado${phone}`
  } else if (motion === 'walking' || motion === 'returning' || motion === 'standing-up' || motion === 'sitting-down') {
    const n = (((frame % 4) + 4) % 4) + 1
    view = `${facing}-andando${n}${phone}`
  } else {
    view = `${facing}${phone}` // pausing, waiting
  }
  return { view, mirror }
}

/** Resolve the sprite src (+ mirror) for a full state. */
export function agentSprite(character: string, mode: AgentVisualMode, direction: OfficeDirection, motion: AgentMotionState, frame: number): ResolvedSprite {
  const { view, mirror } = agentSpriteView(mode, direction, motion, frame)
  return { src: characterAsset(character, view), mirror }
}

/** Fallback chain if the resolved file is missing: idle of that facing → the
 *  legacy static front sprite. Always resolves to something drawable. */
export function spriteFallbacks(character: string, mode: AgentVisualMode, direction: OfficeDirection): string[] {
  const { facing } = directionBase(direction)
  const phone = mode === 'phone' ? '-ligacao' : ''
  return [characterAsset(character, `${facing}${phone}`), characterAsset(character, facing), characterAsset(character, 'frente')]
}

/** Preload the idle + walk frames for the given characters so frame swaps never
 *  flash. Safe no-op outside the browser. */
export function preloadAgentSprites(characters: string[]): void {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return
  const seen = new Set<string>()
  for (const c of characters) {
    for (const facing of ['frente', 'costas']) {
      for (const phone of ['', '-ligacao']) {
        const views = [`${facing}${phone}`, `${facing}-sentado${phone}`, `${facing}-andando1${phone}`, `${facing}-andando2${phone}`, `${facing}-andando3${phone}`, `${facing}-andando4${phone}`]
        for (const v of views) {
          const url = characterAsset(c, v)
          if (seen.has(url)) continue
          seen.add(url)
          const img = new Image()
          img.src = url
        }
      }
    }
  }
}
