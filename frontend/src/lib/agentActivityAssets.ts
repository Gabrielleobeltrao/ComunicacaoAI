// The one place that maps an operational state to what is drawn for it.
//
// Ported from the ComunicaçãoAI Design System (`components/office/ActionBubble.jsx`,
// specimen `guidelines/illustration-baloes.card.html`). The design keys are in
// Portuguese; the runtime enum — the backend's `AgentBubbleState` — is the contract,
// so the table below is keyed by the runtime state and carries the design key beside
// it. If the two ever drift, the mismatch is visible here rather than hidden in a
// component.
//
// The glyphs are the design's Lucide names, VERSIONED IN THIS REPO under
// public/illustrations/agent-activity/ (lucide-static 0.544.0, sanitized: no script,
// no event handler, no external reference). Nothing here reaches the network at
// runtime, so the office map keeps working offline and in the production build.

const ICONS = '/illustrations/agent-activity'

// Every state the backend can report (backend/src/agentLiveState.ts).
export type AgentBubbleState =
  | 'queued'
  | 'thinking'
  | 'researching'
  | 'reading_knowledge'
  | 'using_tool'
  | 'delegating_agent'
  | 'delegating_sector'
  | 'waiting_external'
  | 'waiting_input'
  | 'responding'
  | 'generating_output'
  | 'validating_output'
  | 'delivering'
  | 'retrying'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'canceled'

// Three reads, exactly as the design defines them:
//   ongoing   · icon + three animated dots. Work is in flight.
//   waiting   · static icon, no dots. Stalled on a person, so it must not look busy.
//   transient · tinted capsule, removed after TRANSIENT_MS. An outcome, not a state.
export type BubbleTier = 'ongoing' | 'waiting' | 'transient'

// Comic convention: `thought` (capsule + rising dot trail) for internal work,
// `speech` (capsule + solid tail) for anything the outside world would notice.
export type BubbleKind = 'thought' | 'speech'

export interface BubbleAsset {
  /** The design system's own key, for traceability against the specimen card. */
  designKey: string
  /** Versioned local file — never a CDN. */
  icon: string
  kind: BubbleKind
  tier: BubbleTier
  /** A design token, never a literal colour. */
  color: string
  /** Only transient outcomes are tinted. */
  tint?: string
  /** Human label for the tooltip and the aria-label. Says the KIND of work, never its content. */
  label: string
}

export const AGENT_ACTIVITY_ASSETS: Record<AgentBubbleState, BubbleAsset> = {
  // ── ongoing ─────────────────────────────────────────────────────────────────
  queued: { designKey: 'na_fila', icon: `${ICONS}/list-ordered.svg`, kind: 'thought', tier: 'ongoing', color: 'var(--text-faint)', label: 'Na fila' },
  thinking: { designKey: 'pensando', icon: `${ICONS}/brain.svg`, kind: 'thought', tier: 'ongoing', color: 'var(--status-thinking)', label: 'Pensando' },
  researching: { designKey: 'pesquisando', icon: `${ICONS}/search.svg`, kind: 'thought', tier: 'ongoing', color: 'var(--sky-500)', label: 'Pesquisando' },
  reading_knowledge: { designKey: 'consultando', icon: `${ICONS}/database.svg`, kind: 'thought', tier: 'ongoing', color: 'var(--cobalt-500)', label: 'Consultando memória' },
  using_tool: { designKey: 'ferramenta', icon: `${ICONS}/wrench.svg`, kind: 'speech', tier: 'ongoing', color: 'var(--mango-500)', label: 'Usando ferramenta' },
  waiting_external: { designKey: 'aguardando_sistema', icon: `${ICONS}/cloud.svg`, kind: 'thought', tier: 'ongoing', color: 'var(--sky-500)', label: 'Aguardando sistema' },
  delegating_agent: { designKey: 'chamando_agente', icon: `${ICONS}/user-round.svg`, kind: 'speech', tier: 'ongoing', color: 'var(--grape-500)', label: 'Chamando agente' },
  delegating_sector: { designKey: 'chamando_setor', icon: `${ICONS}/building-2.svg`, kind: 'speech', tier: 'ongoing', color: 'var(--grape-500)', label: 'Chamando setor' },
  responding: { designKey: 'respondendo', icon: `${ICONS}/message-circle.svg`, kind: 'speech', tier: 'ongoing', color: 'var(--status-working)', label: 'Respondendo' },
  generating_output: { designKey: 'gerando', icon: `${ICONS}/sparkles.svg`, kind: 'speech', tier: 'ongoing', color: 'var(--status-working)', label: 'Gerando resultado' },
  validating_output: { designKey: 'validando', icon: `${ICONS}/shield-check.svg`, kind: 'thought', tier: 'ongoing', color: 'var(--cobalt-500)', label: 'Validando' },
  delivering: { designKey: 'entregando', icon: `${ICONS}/send.svg`, kind: 'speech', tier: 'ongoing', color: 'var(--mint-500)', label: 'Entregando' },
  retrying: { designKey: 'tentando_novamente', icon: `${ICONS}/rotate-cw.svg`, kind: 'speech', tier: 'ongoing', color: 'var(--mango-500)', label: 'Tentando novamente' },
  // ── waiting on a person ─────────────────────────────────────────────────────
  waiting_input: { designKey: 'aguardando_info', icon: `${ICONS}/hourglass.svg`, kind: 'speech', tier: 'waiting', color: 'var(--mango-500)', label: 'Aguardando informação' },
  blocked: { designKey: 'bloqueado', icon: `${ICONS}/alert-triangle.svg`, kind: 'speech', tier: 'waiting', color: 'var(--status-blocked)', label: 'Bloqueado' },
  // ── transient outcomes ──────────────────────────────────────────────────────
  completed: { designKey: 'concluido', icon: `${ICONS}/check.svg`, kind: 'speech', tier: 'transient', color: 'var(--status-working)', tint: 'var(--mint-50)', label: 'Concluído' },
  failed: { designKey: 'falhou', icon: `${ICONS}/x.svg`, kind: 'speech', tier: 'transient', color: 'var(--status-blocked)', tint: 'var(--coral-50)', label: 'Falhou' },
  canceled: { designKey: 'cancelado', icon: `${ICONS}/ban.svg`, kind: 'speech', tier: 'transient', color: 'var(--text-faint)', tint: 'var(--surface-sunken)', label: 'Cancelado' },
}

export const AGENT_BUBBLE_STATES = Object.keys(AGENT_ACTIVITY_ASSETS) as AgentBubbleState[]

/** How long a transient outcome stays on screen before it is dropped. */
export const TRANSIENT_MS = 3000

/** Minimum time any bubble stays visible, so a fast step never flickers. */
export const MIN_VISIBLE_MS = 700

/** An intermediate state must last this long before it is worth drawing. */
export const DEBOUNCE_MS = 300

export const bubbleAssetFor = (state: string): BubbleAsset | null =>
  (AGENT_ACTIVITY_ASSETS as Record<string, BubbleAsset>)[state] ?? null

// The wire carries a string, and a state this build does not know about must not be
// drawn. This is the ONE place that turns one into the other, so an unknown value
// stops here instead of travelling as a type lie.
export const isBubbleState = (state: string): state is AgentBubbleState => state in AGENT_ACTIVITY_ASSETS

/**
 * The tooltip/aria text. It names the agent and the KIND of work — never the
 * objective, the query, a URL, a phone number or a result.
 */
export function bubbleLabel(agentName: string, state: string, safeDetail?: { actionLabel?: string; targetType?: string }): string {
  const asset = bubbleAssetFor(state)
  if (!asset) return agentName
  // `safeDetail.actionLabel` is built by the backend from an allowlist (a public App
  // action name). Anything else is ignored here as well.
  const detail = asset.tier === 'ongoing' && safeDetail?.actionLabel ? `: ${safeDetail.actionLabel}` : ''
  return `${agentName}: ${asset.label.toLowerCase()}${detail}`
}

// --- placement ------------------------------------------------------------------
// Two characters seated side by side are about one tile apart, and a bubble is wider
// than that gap — so drawn at the same height they cover each other and the one
// behind is unreadable. Bubbles are therefore staggered into two lanes by column
// parity: neighbours always land at different heights, and both stay legible.
//
// Parity is derived from the agent's own grid position, so it is stable per agent and
// needs no knowledge of who is next door.
// ponytail: parity heuristic, not a label-collision solver — if the map ever gets
// free-form placement, this becomes a real de-overlap pass.
// Measured, not guessed (see the e2e that asserts it against the rendered box):
// the small capsule is 22px tall and a thought tail hangs 14px below it.
export const BUBBLE_CAPSULE_HEIGHT = 22
export const BUBBLE_TAIL_HEIGHT = 14

// The raised lane has to clear the lower capsule COMPLETELY — including its own tail,
// which hangs down towards its character and would otherwise cross the neighbour's
// bubble. Anything smaller leaves the lower one partly hidden, which is the bug this
// exists to fix.

/**
 * Distância entre o topo do personagem e a base do balão, como PORCENTAGEM da caixa
 * do agente.
 *
 * Porcentagem porque a caixa do agente é dimensionada em tiles e o personagem
 * preenche ela: assim o afastamento encolhe junto com a cabeça, em qualquer mapa. Em
 * px fixo, o recorte do setor — que reduz o palco inteiro por `transform` — colocava
 * o balão dentro da cabeça.
 */
const HEAD_CLEARANCE_PCT = 15

/**
 * Onde o balão fica: rente à cabeça do dono, sempre.
 *
 * Existiu aqui um sistema de duas faixas, que levantava um dos balões quando dois
 * personagens ficavam lado a lado. Ele resolvia a sobreposição e criava um problema
 * pior: o balão levantado ficava com a cauda longe da cabeça, boiando, sem deixar
 * claro de quem era. Sobrepor é o menor dos dois males — o dono ficou explícito.
 */
export function bubblePlacement(x: number, headTop: string): { bottom: string; marginBottom: number; zIndex: number; nameMarginBottom: number } {
  void x
  return {
    bottom: `calc(${headTop} + ${HEAD_CLEARANCE_PCT}%)`,
    marginBottom: 0,
    zIndex: 6,
    // No hover, o nome sobe acima do balão para os dois não se cruzarem.
    nameMarginBottom: 32,
  }
}
