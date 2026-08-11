import type { Cenario } from './types'

// Preset pronto — copie e ajuste x/y. Cada item referencia um objeto por nome-base;
// use objectSrc(art) (lib/officeAssets) para obter a URL do SVG.
export const servidorGrande: Cenario = {
  id: 'servidor-grande',
  nome: 'Sala do servidor · grande',
  floor: 'hall',
  cols: 7.2,
  rows: 4,
  itens: [
    { x: 1.5, y: 0.5, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 2.35, y: 0.5, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 3.2, y: 0.5, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 4.05, y: 0.5, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 4.9, y: 0.5, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 5.75, y: 0.5, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 1.1, y: 1.15, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 1.95, y: 1.15, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 2.8, y: 1.15, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 3.65, y: 1.15, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 4.5, y: 1.15, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 5.35, y: 1.15, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 6.2, y: 1.15, w: 1, h: 1.7, art: 'rack-servidor-1x1.7', label: 'Rack' },
    { x: 0.3, y: 2.8, w: 1, h: 1, art: 'caixas-1x1', label: 'Caixas' },
    { x: 5.2, y: 2.6, w: 1, h: 1, art: 'caixas-1x1', label: 'Caixas' },
    { x: 5.4, y: 3, w: 1, h: 1, art: 'caixas-1x1', label: 'Caixas' },
    { x: 6.2, y: 3, w: 1, h: 1, art: 'extintor-1x1', label: 'Extintor' },
  ],
}
