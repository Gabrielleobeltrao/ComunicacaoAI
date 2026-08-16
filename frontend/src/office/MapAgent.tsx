import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Illustration } from './Illustration'
import { AgentActivityBubble } from '../components/AgentActivityBubble'
import { bubblePlacement } from '../lib/agentActivityAssets'
import { NamePill } from './NamePill'
import { characterSrc } from '../lib/officeAssets'
import type { CharacterView } from '../lib/officeAssets'
import type { AgentStatus } from '../ui'

interface MapAgentProps {
  x: number
  y: number
  name?: string
  status?: AgentStatus
  facing?: 'frente' | 'costas'
  pose?: 'parado' | 'ligacao'
  agent?: string
  art?: string
  seated?: boolean
  scale?: number
  department?: string
  speaking?: boolean
  // The operational state the RUNTIME reported, for the static fallback map. Same
  // rule as the animated one: no execution, no bubble.
  opState?: string
  opDetail?: { appKey?: string; actionLabel?: string; targetType?: string }
  showName?: 'hover' | 'always' | 'never'
  hoverLift?: boolean
  onOpen?: () => void
  style?: CSSProperties
}

// An agent standing/sitting on the office floor: a character sprite with a
// contact shadow, a floating name pill and a speech bubble when it's thinking.
export function MapAgent({
  x,
  y,
  name,
  status = 'idle',
  facing = 'frente',
  pose = 'parado',
  agent,
  art,
  seated,
  scale = 1.25,
  department = 'var(--dept-dev)',
  speaking,
  opState,
  opDetail,
  showName = 'hover',
  hoverLift = true,
  onOpen,
  style,
}: MapAgentProps) {
  const [hovered, setHovered] = useState(false)
  const placement = bubblePlacement(x)
  const view = facing === 'costas' ? 'costas' : 'frente'
  const variant = `${view}${seated ? '-sentado' : ''}${pose === 'ligacao' ? '-ligacao' : ''}` as CharacterView
  const src = art || (agent ? characterSrc(agent, variant) : undefined)
  const bottomAnchor = !!seated
  const w = scale
  const h = 1.5 * scale
  const dx = (w - 1) / 2
  const dy = h - 1.5
  const headTop = seated ? '78.6%' : '100%'
  return (
    <button
      onClick={onOpen}
      onMouseEnter={(e) => {
        setHovered(true)
        if (hoverLift) e.currentTarget.style.transform = 'translateY(-3px)'
      }}
      onMouseLeave={(e) => {
        setHovered(false)
        if (hoverLift) e.currentTarget.style.transform = 'none'
      }}
      style={{
        position: 'absolute',
        left: `calc(var(--tile) * ${x - dx})`,
        top: `calc(var(--tile) * ${y - dy})`,
        width: `calc(var(--tile) * ${w})`,
        height: `calc(var(--tile) * ${h})`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        border: 0,
        background: 'transparent',
        padding: 0,
        cursor: 'pointer',
        transition: 'transform var(--dur-base) var(--ease-bounce)',
        ...style,
        // While hovered, lift the whole agent (sprite + name pill) above the desks
        // and chairs so the name is never covered.
        ...(hovered ? { zIndex: 40 } : null),
      }}
    >
      {name && (showName === 'always' || (showName === 'hover' && hovered)) ? (
        <NamePill
          name={name}
          status={status}
          // The name rises above the bubble when both are on screen.
          style={{ position: 'absolute', bottom: headTop, marginBottom: opState ? placement.nameMarginBottom : 4, zIndex: 20, whiteSpace: 'nowrap', pointerEvents: 'none' }}
        />
      ) : null}
      {/* Lane by column parity, so a neighbour's bubble never sits at the same
          height and hides this one. */}
      {opState ? (
        <span style={{ position: 'absolute', bottom: headTop, marginBottom: placement.marginBottom, zIndex: placement.zIndex, pointerEvents: 'none' }}>
          <AgentActivityBubble state={opState} agentName={name ?? ''} safeDetail={opDetail} size="sm" />
        </span>
      ) : null}
      {speaking ? (
        <span
          style={{
            position: 'absolute',
            left: '78%',
            bottom: '82%',
            zIndex: 4,
            display: 'inline-flex',
            gap: 3,
            padding: '5px 8px',
            borderRadius: 'var(--radius-full)',
            background: '#fff',
            boxShadow: '0 2px 6px rgba(22,24,31,.2)',
          }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 4,
                height: 4,
                borderRadius: 99,
                background: 'var(--ink-4)',
                animation: `ds-pulse var(--dur-ambient) var(--ease-standard) ${i * 0.25}s infinite`,
              }}
            />
          ))}
        </span>
      ) : null}
      <span style={{ position: 'absolute', bottom: 4, width: '58%', height: 8, borderRadius: '50%', background: 'var(--map-shadow)', filter: 'blur(2px)' }} />
      <Illustration
        src={src}
        alt={name}
        fit="contain"
        radius={6}
        objectPosition={bottomAnchor ? '50% 100%' : '50% 50%'}
        placeholder={name}
        style={{
          position: 'relative',
          zIndex: 2,
          width: '100%',
          height: '100%',
          outline: src ? undefined : `2px dashed color-mix(in oklab, ${department} 60%, transparent)`,
          outlineOffset: -2,
        }}
      />
    </button>
  )
}
