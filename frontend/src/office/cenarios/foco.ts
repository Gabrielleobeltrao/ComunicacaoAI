import type { Cenario } from './types'

// Preset pronto — copie e ajuste x/y. Cada item referencia um objeto por nome-base;
// use objectSrc(art) (lib/officeAssets) para obter a URL do SVG.
export const foco: Cenario = {
  id: 'foco',
  nome: 'Área de foco',
  floor: 'hall',
  cols: 6.4,
  rows: 4,
  itens: [
    { x: 0.4, y: 0.5, w: 2, h: 2, art: 'baia-2x2', label: 'Baia' },
    { x: 2.4, y: 0.5, w: 2, h: 2, art: 'baia-2x2', label: 'Baia' },
    { x: 4.7, y: 0.4, w: 1.5, h: 2, art: 'cabine-1.5x2', label: 'Cabine' },
    { x: 0.8, y: 2.5, w: 2, h: 1.5, art: 'divisoria-planta-2x1.5', label: 'Divisória' },
    { x: 4.9, y: 3, w: 1, h: 1, art: 'lixeira-1x1', label: 'Lixeira' },
  ],
}
