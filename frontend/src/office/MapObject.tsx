import type { CSSProperties } from 'react'
import { Illustration } from './Illustration'

interface MapObjectProps {
  x: number
  y: number
  w?: number
  h?: number
  art?: string
  label?: string
  shadow?: boolean
  style?: CSSProperties
}

export function MapObject({ x, y, w = 1, h = 1, art, label, shadow = true, style }: MapObjectProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `calc(var(--tile) * ${x})`,
        top: `calc(var(--tile) * ${y})`,
        width: `calc(var(--tile) * ${w})`,
        height: `calc(var(--tile) * ${h})`,
        filter: shadow ? 'drop-shadow(0 3px 3px var(--map-shadow))' : undefined,
        ...style,
      }}
    >
      <Illustration src={art} alt={label} fit="contain" radius={8} placeholder={label} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
