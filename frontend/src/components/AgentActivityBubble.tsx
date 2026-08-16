import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import { AGENT_ACTIVITY_ASSETS, bubbleAssetFor, bubbleLabel } from '../lib/agentActivityAssets'
import type { AgentBubbleState } from '../lib/agentActivityAssets'

// The operational bubble over a character's head.
//
// Ported from the design system's `ActionBubble` (components/office/ActionBubble.jsx)
// with its own keyframes, tail geometry and dot timings preserved. Two things are
// deliberately NOT its business:
//
//   · it never decides the state — the runtime does, and an idle agent, or one merely
//     waiting for a schedule, gets no bubble at all;
//   · it never captures a click, joins collision, or affects z-index of furniture.
//
// It also never carries content: the caption says the KIND of work, never a customer
// name, a message body, a URL or a record id.

const CSS = `@keyframes ds-bubble-in{from{opacity:0;transform:translateY(3px) scale(.9)}to{opacity:1;transform:none}}
@keyframes ds-bubble-dot{0%,60%,100%{opacity:.28;transform:translateY(0)}30%{opacity:1;transform:translateY(-2px)}}
@keyframes ds-bubble-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
@keyframes ds-bubble-rise{0%,100%{opacity:.35;transform:scale(.7)}45%{opacity:1;transform:scale(1)}}
/* Reduced motion removes the movement, never the meaning: the icon, the dots and the
   tail all stay, they simply stop animating. */
@media (prefers-reduced-motion: reduce){
  [data-agent-bubble] *,[data-agent-bubble]{animation:none !important}
}`

function useBubbleCSS() {
  useEffect(() => {
    if (document.getElementById('ds-bubble-css')) return
    const el = document.createElement('style')
    el.id = 'ds-bubble-css'
    el.textContent = CSS
    document.head.appendChild(el)
  }, [])
}

// A vendored SVG drawn as a mask, so the glyph takes the token colour and nothing is
// fetched at runtime.
function Glyph({ src, size, color }: { src: string; size: number; color: string }) {
  const url = `url("${src}")`
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        flex: '0 0 auto',
        width: size,
        height: size,
        background: color,
        WebkitMask: `${url} center / contain no-repeat`,
        mask: `${url} center / contain no-repeat`,
      }}
    />
  )
}

export function AgentActivityBubble({
  state,
  agentName,
  safeDetail,
  size = 'md',
  showLabel = false,
  float = true,
  style,
}: {
  state: AgentBubbleState | string
  agentName: string
  safeDetail?: { appKey?: string; actionLabel?: string; targetType?: string }
  size?: 'sm' | 'md'
  showLabel?: boolean
  float?: boolean
  style?: CSSProperties
}) {
  useBubbleCSS()
  const asset = bubbleAssetFor(state)
  // No state, no bubble. An unknown key draws nothing rather than a fallback that
  // would claim work is happening.
  if (!asset) return null

  const sm = size === 'sm'
  const bg = asset.tint ?? '#fff'
  // Only `ongoing` animates. A waiting state that pulses reads as busy — exactly the
  // wrong signal when someone needs to act — and an outcome is already over.
  const dots = asset.tier === 'ongoing'

  // The tail is centred and points straight down: a directed tail has to agree with
  // the figure's actual side, which callers get wrong far more often than it helps.
  const tail =
    asset.kind === 'thought' ? (
      // DIVERGENCE FROM THE DESIGN, on purpose: the specimen draws three dots, and
      // the third (smallest, lowest) lands on the character's head with this app's
      // sprite geometry. Two dots still read as a thought bubble and clear the head.
      <span style={{ position: 'absolute', top: 'calc(100% - 2px)', left: '50%', width: 0, height: 14, pointerEvents: 'none' }}>
        {([[5, 0], [3.5, 1]] as [number, number][]).map(([d, i]) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              top: 2 + i * 5.5,
              left: -d / 2,
              width: d,
              height: d,
              borderRadius: '50%',
              background: bg,
              // These dots are the ONLY thing separating a thought bubble from a
              // speech one, so they carry the capsule's own border.
              border: '1px solid var(--line-1)',
              boxShadow: i === 0 ? 'var(--shadow-card)' : undefined,
              animation: dots ? `ds-bubble-rise 1.6s var(--ease-standard) ${0.5 - i * 0.16}s infinite` : undefined,
            }}
          />
        ))}
      </span>
    ) : (
      <span
        style={{
          position: 'absolute',
          top: 'calc(100% - 1px)',
          left: '50%',
          marginLeft: -5,
          width: 0,
          height: 0,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: `8px solid ${bg}`,
          filter: 'drop-shadow(0 1px 1px rgba(31,26,20,.14))',
        }}
      />
    )

  const label = bubbleLabel(agentName, state, safeDetail)

  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      data-agent-bubble={state}
      data-testid="agent-activity-bubble"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: showLabel ? 5 : 4,
        padding: sm ? '4px 7px' : '6px 9px',
        borderRadius: 'var(--radius-full)',
        background: bg,
        boxShadow: 'var(--shadow-raised)',
        border: '1px solid var(--line-1)',
        fontFamily: 'var(--font-ui)',
        fontSize: sm ? 10.5 : 11.5,
        fontWeight: 600,
        color: 'var(--text-body)',
        whiteSpace: 'nowrap',
        lineHeight: 1,
        // The bubble is decoration over the map: it must never eat a click meant for
        // the agent underneath.
        pointerEvents: 'none',
        animation: `ds-bubble-in .18s var(--ease-out-soft)${float && asset.tier === 'ongoing' ? ', ds-bubble-float 2.4s var(--ease-standard) .18s infinite' : ''}`,
        ...style,
      }}
    >
      <Glyph src={asset.icon} size={sm ? 12 : 14} color={asset.color} />
      {showLabel ? <span>{asset.label}</span> : null}
      {dots && !showLabel ? (
        <span style={{ display: 'inline-flex', gap: 2, marginLeft: 1 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: sm ? 2.5 : 3,
                height: sm ? 2.5 : 3,
                borderRadius: '50%',
                background: asset.color,
                animation: `ds-bubble-dot 1.1s ease-in-out ${i * 0.16}s infinite`,
              }}
            />
          ))}
        </span>
      ) : null}
      {tail}
    </span>
  )
}

export { AGENT_ACTIVITY_ASSETS }
