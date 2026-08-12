// Shared types for the office visual simulation. Everything here is purely
// visual/ephemeral — none of it is persisted or sent to the backend.

export type OfficeDirection = 'front' | 'back' | 'left' | 'right'
export type AgentVisualMode = 'normal' | 'phone'
export type AgentMotionState =
  | 'seated'
  | 'standing-up'
  | 'walking'
  | 'pausing'
  | 'waiting'
  | 'returning'
  | 'sitting-down'

export interface OfficePoint {
  x: number
  y: number
}

export interface OfficeRect {
  x: number
  y: number
  width: number
  height: number
}

// Where a seated agent lives: the exact chair it returns to.
export interface AgentHome {
  seatId: string
  seatedPoint: OfficePoint // where the sprite is drawn while seated
  exitPoint: OfficePoint // the walkable cell just outside the chair
  seatedFacing: OfficeDirection
  seatedZ: number // z-index the seated sprite uses (desk depth)
  sectorId?: string
}

export interface InteractionPoint {
  id: string
  point: OfficePoint
  facing?: OfficeDirection
  categories: string[]
  capacity: number
}

// One door per sector: an interior portal (inside the room) and an exterior one
// (in the corridor), both connected on the navigation grid.
export interface OfficeDoor {
  sectorId: string
  inner: OfficePoint
  outer: OfficePoint
}

// A seat produced by the layout: an agent sitting at a desk.
export interface OfficeSeat {
  id: string
  agentId: string
  seatedPoint: OfficePoint
  exitPoint: OfficePoint
  facing: OfficeDirection
  zIndex: number
  sectorId?: string
  chair: { near: boolean } // near = costas (front chair), far = frente
}

// A rectangular obstacle on the floor (desk, chair, big object) used to block the
// navigation grid. Coordinates are in tiles.
export interface OfficeObstacle {
  rect: OfficeRect
  kind: 'desk' | 'chair' | 'object' | 'wall'
}

// The full deterministic layout consumed by the renderer, the nav grid and the
// simulation. Coordinates are in tiles (same units the map already uses).
export interface OfficeLayout {
  cols: number
  rows: number
  rooms: LayoutRoom[]
  seats: OfficeSeat[]
  loose: { agentId: string; point: OfficePoint }[]
  doors: OfficeDoor[]
  obstacles: OfficeObstacle[]
  interactionPoints: InteractionPoint[]
}

// A placed room (sector or amenity) — kept close to what OfficeFloor already
// renders, plus its footprint cells for wall/nav computation.
export interface LayoutRoom {
  key: string
  kind: 'sector' | 'amenity'
  x: number
  y: number
  w: number
  h: number
  cells: Set<string> // normalized shape cells (see roomShape), origin at (x,y)
}

// Live per-agent simulation state (ephemeral).
export interface AgentSimulationState {
  agentId: string
  motion: AgentMotionState
  mode: AgentVisualMode
  direction: OfficeDirection
  position: OfficePoint
  route: OfficePoint[]
  frame: number
  home: AgentHome | null
  destinationId?: string
}
