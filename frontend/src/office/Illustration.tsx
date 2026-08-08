import type { CSSProperties } from 'react'

interface IllustrationProps {
  src?: string
  alt?: string
  ratio?: string
  radius?: number
  fit?: 'contain' | 'cover'
  objectPosition?: string
  placeholder?: string
  height?: number
  style?: CSSProperties
}

// A framed illustration: renders the art when a src is given, else a labelled
// dashed placeholder (real art lands in public/illustrations/).
export function Illustration({
  src,
  alt = '',
  ratio = '3 / 2',
  radius = 18,
  fit = 'contain',
  objectPosition = '50% 50%',
  placeholder = '',
  height,
  style,
}: IllustrationProps) {
  const box: CSSProperties = {
    position: 'relative',
    width: '100%',
    aspectRatio: height ? undefined : ratio,
    height,
    borderRadius: radius,
    overflow: 'hidden',
    ...style,
  }
  if (src) {
    return (
      <span style={box}>
        <img
          src={src}
          alt={alt}
          style={{ width: '100%', height: '100%', objectFit: fit === 'cover' ? 'cover' : 'contain', objectPosition, display: 'block' }}
        />
      </span>
    )
  }
  return (
    <span
      style={{
        ...box,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface-sunken)',
        border: '1px dashed var(--border-strong)',
      }}
    >
      {placeholder ? (
        <span style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', padding: 4 }}>{placeholder}</span>
      ) : null}
    </span>
  )
}
