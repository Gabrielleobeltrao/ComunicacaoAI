import type { Cenario } from './types'

// Preset pronto — copie e ajuste x/y. Cada item referencia um objeto por nome-base;
// use objectSrc(art) (lib/officeAssets) para obter a URL do SVG.
export const servidorPequeno: Cenario = {
  id: 'servidor-pequeno',
  nome: 'Sala do servidor · pequena',
  floor: 'hall',
  cols: 4.4,
  rows: 3.2,
  itens: [
    { x: 0.7, y: 0.5, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 1.55, y: 0.5, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 2.4, y: 0.5, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 3.25, y: 0.5, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 0.4, y: 2.2, w: 1, h: 1, art: 'caixas-1x1', label: 'Caixas' },
    { x: 3.4, y: 2.2, w: 1, h: 1, art: 'extintor-1x1', label: 'Extintor' },
  ],
}
