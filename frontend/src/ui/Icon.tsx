import type { CSSProperties, HTMLAttributes } from 'react'

// Lucide glyphs rendered as a CSS mask so every icon inherits currentColor.
// Loaded from CDN (design stand-in) — for production we can bundle lucide.
const CDN = 'https://unpkg.com/lucide-static@0.544.0/icons/'

interface IconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  name: string
  size?: number
  color?: string
  style?: CSSProperties
}

export function Icon({ name, size = 18, color = 'currentColor', style, ...rest }: IconProps) {
  const url = `url("${CDN}${name}.svg")`
  return (
    <span
      aria-hidden="true"
      data-icon={name}
      style={{
        display: 'inline-block',
        flex: '0 0 auto',
        width: size,
        height: size,
        background: color,
        WebkitMask: `${url} center / contain no-repeat`,
        mask: `${url} center / contain no-repeat`,
        ...style,
      }}
      {...rest}
    />
  )
}
