import { useState } from 'react'
import type { CSSProperties } from 'react'
import { AgentSprite } from './AgentSprite'
import { AgentActivityBubble } from '../components/AgentActivityBubble'
import { NamePill } from './NamePill'
import type { SimView } from './useOfficeSimulation'
import type { AgentStatus } from '../ui'

const W = 1.25
const H = 1.875

interface SimAgentProps {
  agentId: string
  name: string
  character: string
  status: AgentStatus
  view: SimView
  initialX: number
  initialY: number
  register: (id: string, el: HTMLElement | null) => void
  setHovered: (id: string | null) => void
  onOpen: () => void
  // Live-map overlay: the operational state the RUNTIME reported. When set, the
  // activity bubble is drawn above the head. It never drives position or
  // pathfinding, and pausing the simulation does not pause or fake it.
  opState?: string
  // Allowlisted caption detail from the backend (public App action name, target
  // kind). Never an objective, a URL, an argument or a result.
  opDetail?: { appKey?: string; actionLabel?: string; targetType?: string }
}

// A simulated agent: a clickable wrapper whose position is driven by the sim via
// the --ax/--ay CSS vars (so it scales with zoom/pan for free), containing the
// animated AgentSprite, a contact shadow and a hover name pill.
export function SimAgent({ agentId, name, character, status, view, initialX, initialY, register, setHovered, onOpen, opState, opDetail }: SimAgentProps) {
  const [hover, setHover] = useState(false)
  const seated = view.motion === 'seated'
  const headTop = seated ? '78.6%' : '100%'
  return (
    <button
      ref={(el) => register(agentId, el)}
      onClick={onOpen}
      onMouseEnter={() => {
        setHover(true)
        setHovered(agentId)
      }}
      onMouseLeave={() => {
        setHover(false)
        setHovered(null)
      }}
      style={
        {
          position: 'absolute',
          left: 0,
          top: 0,
          width: `calc(var(--tile) * ${W})`,
          height: `calc(var(--tile) * ${H})`,
          transform: 'translate3d(calc(var(--tile) * (var(--ax) - 0.125)), calc(var(--tile) * (var(--ay) - 0.375)), 0)',
          '--ax': initialX,
          '--ay': initialY,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          border: 0,
          background: 'transparent',
          padding: 0,
          cursor: 'pointer',
          willChange: 'transform',
        } as CSSProperties
      }
    >
      {/* On hover the NAME rises above the bubble, so the two never overlap. */}
      {hover ? (
        <NamePill
          name={name}
          status={status}
          style={{ position: 'absolute', bottom: headTop, marginBottom: opState ? 40 : 4, zIndex: 7, whiteSpace: 'nowrap', pointerEvents: 'none' }}
        />
      ) : null}
      {/* Anchored to the real top of the sprite, so it follows the lower head of a
          seated crop with nothing to adjust — and it rides zoom/pan for free because
          the whole wrapper is positioned by the sim. */}
      {opState ? (
        <span style={{ position: 'absolute', bottom: headTop, marginBottom: 8, zIndex: 6, pointerEvents: 'none' }}>
          <AgentActivityBubble state={opState} agentName={name} safeDetail={opDetail} size="sm" />
        </span>
      ) : null}
      <span style={{ position: 'absolute', bottom: 4, width: '58%', height: 8, borderRadius: '50%', background: 'var(--map-shadow)', filter: 'blur(2px)' }} />
      <AgentSprite character={character} mode={view.mode} direction={view.direction} motion={view.motion} frame={view.frame} alt={name} style={{ position: 'relative', zIndex: 2 }} />
    </button>
  )
}
