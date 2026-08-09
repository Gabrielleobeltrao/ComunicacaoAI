// Palette for a sector's room colour on the office map — also drives the picker
// in the sector form. Values are concrete hexes (used directly as the map tint).
export const SECTOR_COLORS: { name: string; value: string }[] = [
  { name: 'Cobalto', value: '#2E5BFF' },
  { name: 'Céu', value: '#38B6F0' },
  { name: 'Menta', value: '#17B98A' },
  { name: 'Manga', value: '#FFB53D' },
  { name: 'Uva', value: '#8B5CF6' },
  { name: 'Coral', value: '#FF6A5B' },
]

export const DEFAULT_SECTOR_COLOR = SECTOR_COLORS[0].value
