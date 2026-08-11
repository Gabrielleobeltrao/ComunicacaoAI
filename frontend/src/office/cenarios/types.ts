export type CenarioFloor = 'hall' | 'room' | 'meeting' | 'rug' | 'outdoor'

export interface CenarioItem {
  x: number
  y: number
  w: number
  h: number
  /** Object base name (no extension), e.g. 'mesa-reuniao-3x2'. Resolve with objectSrc(art). */
  art: string
  label: string
  shadow?: boolean
}

/** A ready-made room preset: a floor + a list of object placements on the tile grid. */
export interface Cenario {
  id: string
  nome: string
  floor: CenarioFloor
  cols: number
  rows: number
  zoom?: number
  itens: CenarioItem[]
}
