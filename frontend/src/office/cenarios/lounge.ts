import type { Cenario } from './types'

// Preset pronto — copie e ajuste x/y. Cada item referencia um objeto por nome-base;
// use objectSrc(art) (lib/officeAssets) para obter a URL do SVG.
export const lounge: Cenario = {
  id: 'lounge',
  nome: 'Lounge · descompressão',
  floor: 'hall',
  cols: 9.6,
  rows: 5,
  itens: [
    { x: 1.95, y: 1.9, w: 2, h: 2, art: 'tapete-redondo-2x2', label: 'Tapete', shadow: false },
    { x: 1.7, y: 0.75, w: 2.5, h: 1.2, art: 'sofa-3-2.5x1.2', label: 'Sofá' },
    { x: 1.95, y: 2.45, w: 2, h: 1.2, art: 'mesa-centro-2x1.2', label: 'Mesa de centro' },
    { x: 1.95, y: 3.6, w: 2, h: 1, art: 'sofa-2-costas-2x1', label: 'Sofá 2 · costas' },
    { x: 1, y: 2.6, w: 1, h: 1, art: 'puff-1x1', label: 'Puff' },
    { x: 4, y: 2.6, w: 1, h: 1, art: 'puff-1x1', label: 'Puff' },
    { x: 0.5, y: 0.7, w: 1, h: 1.6, art: 'luminaria-pe-1x1.6', label: 'Luminária' },
    { x: 5.6, y: 3.4, w: 1.5, h: 1.5, art: 'samambaia-1.5x1.5', label: 'Samambaia' },
    { x: 6.2, y: 0.5, w: 1.5, h: 1.3, art: 'prateleira-pe-1.5x1.3', label: 'Prateleira' },
    { x: 8.2, y: 1.4, w: 1.2, h: 1.5, art: 'quadro-cavalete-1.2x1.5', label: 'Quadro' },
  ],
}
