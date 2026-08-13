// Deterministic decoration catalog. Each entry describes a real object asset
// (from public/illustrations/objetos) with enough metadata to place it safely
// and, when relevant, to expose it as an interaction point. Nothing here is
// persisted or sent to the backend — it only drives the visual scene.

// Bumping this string reshuffles every deterministic placement on purpose.
export const CATALOG_VERSION = 'v1'

export type OfficeCategory =
  | 'work'
  | 'meeting'
  | 'lounge'
  | 'marketing'
  | 'sales'
  | 'support'
  | 'finance'
  | 'decoration'
  | 'outdoor'

export type OfficeZone = 'room' | 'hall' | 'outdoor'

// A relative interaction spot: where an agent stands (offset from the object's
// top-left, in tiles) and which way it then faces. `capacity` is how many agents
// may occupy the spot at once.
export interface CatalogInteraction {
  dx: number
  dy: number
  facing: 'front' | 'back' | 'left' | 'right'
  capacity: number
}

export interface OfficeObjectDefinition {
  id: string
  asset: string // object base name — resolve with objectSrc(asset)
  width: number
  height: number
  categories: OfficeCategory[]
  allowedZones: OfficeZone[]
  interactions: CatalogInteraction[]
  placementWeight: number
  maximumPerRoom: number
  blocksNavigation: boolean
}

// Approach a wall-hugging object from directly in front (below it) by default.
const frontApproach = (w: number, h: number, capacity = 1): CatalogInteraction[] => [{ dx: w / 2, dy: h + 0.6, facing: 'back', capacity }]

export const OFFICE_OBJECT_CATALOG: OfficeObjectDefinition[] = [
  // Plants & greenery — pure decoration / contemplation.
  { id: 'planta', asset: 'planta-1x1', width: 1, height: 1, categories: ['decoration', 'outdoor'], allowedZones: ['room', 'hall', 'outdoor'], interactions: frontApproach(1, 1), placementWeight: 5, maximumPerRoom: 2, blocksNavigation: true },
  { id: 'vaso', asset: 'vaso-1x1', width: 1, height: 1, categories: ['decoration'], allowedZones: ['room', 'hall'], interactions: [], placementWeight: 4, maximumPerRoom: 2, blocksNavigation: true },
  { id: 'cactos', asset: 'cactos-1x1', width: 1, height: 1, categories: ['decoration', 'outdoor'], allowedZones: ['room', 'hall', 'outdoor'], interactions: [], placementWeight: 3, maximumPerRoom: 1, blocksNavigation: true },
  { id: 'samambaia', asset: 'samambaia-1.5x1.5', width: 1.5, height: 1.5, categories: ['decoration', 'lounge'], allowedZones: ['room', 'hall'], interactions: frontApproach(1.5, 1.5), placementWeight: 3, maximumPerRoom: 1, blocksNavigation: true },
  { id: 'planta-grande', asset: 'planta-grande-1.5x2', width: 1.5, height: 2, categories: ['decoration', 'outdoor'], allowedZones: ['room', 'hall', 'outdoor'], interactions: frontApproach(1.5, 2), placementWeight: 3, maximumPerRoom: 1, blocksNavigation: true },

  // Shelving & storage — work / finance flavour.
  { id: 'estante', asset: 'estante-2x1', width: 2, height: 1, categories: ['work', 'decoration'], allowedZones: ['room'], interactions: [], placementWeight: 3, maximumPerRoom: 1, blocksNavigation: true },
  { id: 'estante-alta', asset: 'estante-alta-1.5x2', width: 1.5, height: 2, categories: ['work', 'finance'], allowedZones: ['room'], interactions: [], placementWeight: 2, maximumPerRoom: 1, blocksNavigation: true },
  { id: 'prateleira', asset: 'prateleira-pe-1.5x1.3', width: 1.5, height: 1.3, categories: ['decoration', 'lounge'], allowedZones: ['room', 'hall'], interactions: [], placementWeight: 3, maximumPerRoom: 1, blocksNavigation: true },
  { id: 'arquivo', asset: 'arquivo-1x1.5', width: 1, height: 1.5, categories: ['finance', 'work'], allowedZones: ['room'], interactions: [], placementWeight: 3, maximumPerRoom: 2, blocksNavigation: true },
  { id: 'gaveteiro', asset: 'gaveteiro-1x1', width: 1, height: 1, categories: ['finance', 'work'], allowedZones: ['room'], interactions: [], placementWeight: 2, maximumPerRoom: 1, blocksNavigation: true },

  // Boards — interactive standing spots (meeting / marketing / dev).
  { id: 'quadro-cavalete', asset: 'quadro-cavalete-1.2x1.5', width: 1.2, height: 1.5, categories: ['marketing', 'meeting'], allowedZones: ['room', 'hall'], interactions: frontApproach(1.2, 1.5), placementWeight: 3, maximumPerRoom: 1, blocksNavigation: true },
  { id: 'lousa', asset: 'lousa-1.5x1.6', width: 1.5, height: 1.6, categories: ['work', 'meeting'], allowedZones: ['room'], interactions: frontApproach(1.5, 1.6), placementWeight: 3, maximumPerRoom: 1, blocksNavigation: true },
  { id: 'flipchart', asset: 'flipchart-1.2x1.7', width: 1.2, height: 1.7, categories: ['meeting', 'marketing'], allowedZones: ['room', 'hall'], interactions: frontApproach(1.2, 1.7), placementWeight: 2, maximumPerRoom: 1, blocksNavigation: true },
  { id: 'mural', asset: 'mural-recados-1.5x1.4', width: 1.5, height: 1.4, categories: ['support', 'marketing'], allowedZones: ['room', 'hall'], interactions: frontApproach(1.5, 1.4), placementWeight: 2, maximumPerRoom: 1, blocksNavigation: true },

  // Lounge seating — interactive "sit" spots (no bespoke sit sprite, agent idles).
  { id: 'poltrona', asset: 'poltrona-1.5x1.5', width: 1.5, height: 1.5, categories: ['lounge'], allowedZones: ['room', 'hall'], interactions: frontApproach(1.5, 1.5), placementWeight: 2, maximumPerRoom: 1, blocksNavigation: true },
  { id: 'puff', asset: 'puff-1x1', width: 1, height: 1, categories: ['lounge'], allowedZones: ['room', 'hall'], interactions: frontApproach(1, 1), placementWeight: 2, maximumPerRoom: 2, blocksNavigation: true },

  // Small amenities.
  { id: 'bebedouro', asset: 'bebedouro-1x1', width: 1, height: 1, categories: ['support', 'work'], allowedZones: ['room', 'hall'], interactions: frontApproach(1, 1), placementWeight: 2, maximumPerRoom: 1, blocksNavigation: true },
  { id: 'lixeira', asset: 'lixeira-1x1', width: 1, height: 1, categories: ['decoration'], allowedZones: ['room', 'hall'], interactions: [], placementWeight: 2, maximumPerRoom: 1, blocksNavigation: true },
  { id: 'luminaria', asset: 'luminaria-pe-1x1.6', width: 1, height: 1.6, categories: ['lounge', 'decoration'], allowedZones: ['room', 'hall'], interactions: [], placementWeight: 2, maximumPerRoom: 1, blocksNavigation: true },
  { id: 'pilha-livros', asset: 'pilha-livros-1x1', width: 1, height: 1, categories: ['finance', 'decoration'], allowedZones: ['room'], interactions: [], placementWeight: 1, maximumPerRoom: 1, blocksNavigation: true },
]

// Which categories a sector prefers, matched loosely by its (Portuguese) name.
export function themeForSector(name: string): OfficeCategory[] {
  const n = name.toLowerCase()
  if (/(marketing|cria|mídia|midia|social)/.test(n)) return ['marketing', 'decoration', 'lounge']
  if (/(vend|comercial|sales)/.test(n)) return ['sales', 'meeting', 'work']
  if (/(suporte|support|atendimento|sac|help)/.test(n)) return ['support', 'work', 'decoration']
  if (/(financ|conta|fiscal|admin)/.test(n)) return ['finance', 'work', 'decoration']
  if (/(desenvolv|dev|tech|engenh|produto|ti\b|dados|data)/.test(n)) return ['work', 'meeting', 'decoration']
  if (/(rh|pessoas|people|gente|recursos)/.test(n)) return ['meeting', 'lounge', 'decoration']
  return ['decoration', 'work']
}

// Existing amenity/furniture arts that make good interaction destinations, so the
// ready-made presets (lounge, reunião, cozinha…) also draw agents to them.
const INTERACTIVE_FAMILIES = new Set(['sofa', 'poltrona', 'poltrona-costas', 'puff', 'banco-espera', 'banqueta', 'mesa-reuniao', 'mesa-reuniao-grande', 'mesa-redonda', 'mesa-cafe', 'mesa-centro', 'mesa-alta', 'bancada-copa', 'geladeira', 'quadro-cavalete', 'lousa', 'flipchart', 'mural-recados', 'planta-grande', 'samambaia', 'bebedouro', 'galao-agua'])

export function familyOf(art: string): string {
  return art.replace(/-\d.*$/, '') || art
}
export function isInteractiveFamily(art: string): boolean {
  return INTERACTIVE_FAMILIES.has(familyOf(art))
}

export function categoriesForFamily(art: string): string[] {
  const f = familyOf(art)
  if (/sofa|poltrona|puff|banco/.test(f)) return ['lounge']
  if (/mesa-reuniao|mesa-redonda|flipchart|lousa/.test(f)) return ['meeting']
  if (/quadro|mural/.test(f)) return ['marketing']
  if (/planta|samambaia/.test(f)) return ['decoration']
  return ['work']
}
