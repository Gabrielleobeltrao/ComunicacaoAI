import type { Cenario } from './types'

// Preset pronto — copie e ajuste x/y. Cada item referencia um objeto por nome-base;
// use objectSrc(art) (lib/officeAssets) para obter a URL do SVG.
export const reuniaoGrande: Cenario = {
  id: 'reuniao-grande',
  nome: 'Sala de reunião · grande',
  floor: 'meeting',
  cols: 12,
  rows: 5.6,
  zoom: 0.92,
  itens: [
    { x: 4.4, y: 0, w: 1.5, h: 1.6, art: 'lousa-1.5x1.6', label: 'Lousa' },
    { x: 2.77, y: 1.15, w: 1, h: 1, art: 'cadeira-longe-1x1', label: 'Cadeira' },
    { x: 3.95, y: 1.15, w: 1, h: 1, art: 'cadeira-longe-1x1', label: 'Cadeira' },
    { x: 5.38, y: 1.15, w: 1, h: 1, art: 'cadeira-longe-1x1', label: 'Cadeira' },
    { x: 6.55, y: 1.15, w: 1, h: 1, art: 'cadeira-longe-1x1', label: 'Cadeira' },
    { x: 2.5, y: 1.65, w: 5, h: 2, art: 'mesa-reuniao-grande-5x2', label: 'Mesa de reunião' },
    { x: 2.77, y: 2.95, w: 1, h: 1.15, art: 'cadeira-perto-1x1.15', label: 'Cadeira' },
    { x: 3.95, y: 2.95, w: 1, h: 1.15, art: 'cadeira-perto-1x1.15', label: 'Cadeira' },
    { x: 5.38, y: 2.95, w: 1, h: 1.15, art: 'cadeira-perto-1x1.15', label: 'Cadeira' },
    { x: 6.55, y: 2.95, w: 1, h: 1.15, art: 'cadeira-perto-1x1.15', label: 'Cadeira' },
    { x: 0.4, y: 0.5, w: 1.5, h: 1.4, art: 'mural-recados-1.5x1.4', label: 'Mural' },
    { x: 0.5, y: 2.3, w: 1.5, h: 2, art: 'planta-grande-1.5x2', label: 'Planta' },
    { x: 9, y: 0.4, w: 1.2, h: 1.7, art: 'flipchart-1.2x1.7', label: 'Flipchart' },
    { x: 10.4, y: 2, w: 1.5, h: 2, art: 'planta-grande-1.5x2', label: 'Planta' },
    { x: 9.3, y: 4.2, w: 2, h: 1, art: 'banco-espera-2x1', label: 'Banco' },
    { x: 0.6, y: 4.4, w: 1, h: 1, art: 'cactos-1x1', label: 'Cactos' },
  ],
}
