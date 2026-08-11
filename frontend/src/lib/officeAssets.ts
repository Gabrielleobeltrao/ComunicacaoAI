// Asset path helpers for the office illustrations.
//
// Everything lives under public/illustrations/ in a folder-per-item layout:
//   characters/<nome>/{retrato,frente,costas,frente-sentado,costas-sentado}.svg
//   objetos/<família>/<objeto>-<w>x<h>.svg      (família = nome sem o sufixo de tamanho)
const CHARACTERS = '/illustrations/characters'
const OBJETOS = '/illustrations/objetos'

export type CharacterView =
  | 'retrato'
  | 'frente'
  | 'costas'
  | 'frente-sentado'
  | 'costas-sentado'
  | 'frente-ligacao'
  | 'costas-ligacao'
  | 'frente-sentado-ligacao'
  | 'costas-sentado-ligacao'

/** Path to one of a character's five versions. */
export function characterSrc(name: string, view: CharacterView): string {
  return `${CHARACTERS}/${name}/${view}.svg`
}

/** Object family = the name with its trailing `-<size>` stripped (mesa-4-3x3 → mesa). */
export function objectFamily(name: string): string {
  return name.replace(/-\d.*$/, '') || name
}

/** Path to an object sprite from its base name (no extension), e.g. `mesa-4-3x3`. */
export function objectSrc(name: string): string {
  return `${OBJETOS}/${objectFamily(name)}/${name}.svg`
}
