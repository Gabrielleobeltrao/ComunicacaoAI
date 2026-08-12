import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { agentSprite, spriteFallbacks } from './officeSprites'
import type { AgentMotionState, AgentVisualMode, OfficeDirection } from './officeTypes'

interface AgentSpriteProps {
  character: string
  mode: AgentVisualMode
  direction: OfficeDirection
  motion: AgentMotionState
  frame: number
  alt?: string
  style?: CSSProperties
}

// Renders the correct character frame for a state. Walks the fallback chain on a
// load error so it always shows something valid, and mirrors the front sprite
// for the `left` direction (the design has no side profile).
export function AgentSprite({ character, mode, direction, motion, frame, alt, style }: AgentSpriteProps) {
  const { src, mirror } = agentSprite(character, mode, direction, motion, frame)
  const fallbacks = useMemo(() => spriteFallbacks(character, mode, direction), [character, mode, direction])
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const chain = [src, ...fallbacks]
  const chosen = chain.find((s) => !failed.has(s)) ?? chain[chain.length - 1]
  return (
    <img
      src={chosen}
      alt={alt ?? ''}
      draggable={false}
      onError={() => setFailed((f) => new Set(f).add(chosen))}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        objectPosition: '50% 100%',
        transform: mirror ? 'scaleX(-1)' : undefined,
        ...style,
      }}
    />
  )
}
