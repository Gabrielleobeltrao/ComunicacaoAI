import type { Cenario } from './types'

// Preset pronto — copie e ajuste x/y. Cada item referencia um objeto por nome-base;
// use objectSrc(art) (lib/officeAssets) para obter a URL do SVG.
export const reuniao: Cenario = {
  id: 'reuniao',
  nome: 'Sala de reunião',
  floor: 'meeting',
  cols: 9.6,
  rows: 5,
  itens: [
    { x: 3.84, y: 1.5, w: 1, h: 1, art: 'cadeira-longe-1x1', label: 'Cadeira' },
    { x: 4.76, y: 1.5, w: 1, h: 1, art: 'cadeira-longe-1x1', label: 'Cadeira' },
    { x: 3.3, y: 2, w: 3, h: 2, art: 'mesa-reuniao-3x2', label: 'Mesa de reunião' },
    { x: 3.84, y: 3.26, w: 1, h: 1.15, art: 'cadeira-perto-1x1.15', label: 'Cadeira' },
    { x: 4.76, y: 3.26, w: 1, h: 1.15, art: 'cadeira-perto-1x1.15', label: 'Cadeira' },
    { x: 0.5, y: 0.8, w: 1.5, h: 1.4, art: 'mural-recados-1.5x1.4', label: 'Mural' },
    { x: 0.6, y: 2.6, w: 1.5, h: 2, art: 'planta-grande-1.5x2', label: 'Planta' },
    { x: 7, y: 0.6, w: 1.2, h: 1.7, art: 'flipchart-1.2x1.7', label: 'Flipchart' },
    { x: 7.9, y: 2.5, w: 1.5, h: 2, art: 'planta-grande-1.5x2', label: 'Planta' },
  ],
}
