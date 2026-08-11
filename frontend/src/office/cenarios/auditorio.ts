import type { Cenario } from './types'

// Preset pronto — copie e ajuste x/y. Cada item referencia um objeto por nome-base;
// use objectSrc(art) (lib/officeAssets) para obter a URL do SVG.
export const auditorio: Cenario = {
  id: 'auditorio',
  nome: 'Auditório',
  floor: 'meeting',
  cols: 9.2,
  rows: 5.8,
  itens: [
    { x: 1.2, y: 0.2, w: 2, h: 1.6, art: 'tv-suporte-2x1.6', label: 'Tela' },
    { x: 4, y: 0.6, w: 1, h: 1.4, art: 'podio-1x1.4', label: 'Púlpito' },
    { x: 5.6, y: 0.3, w: 1.2, h: 1.7, art: 'flipchart-1.2x1.7', label: 'Flipchart' },
    { x: 0.6, y: 2.3, w: 2, h: 1, art: 'banco-espera-2x1', label: 'Banco' },
    { x: 2.8, y: 2.3, w: 2, h: 1, art: 'banco-espera-2x1', label: 'Banco' },
    { x: 5, y: 2.3, w: 2, h: 1, art: 'banco-espera-2x1', label: 'Banco' },
    { x: 1.7, y: 3.4, w: 2, h: 1, art: 'banco-espera-2x1', label: 'Banco' },
    { x: 3.9, y: 3.4, w: 2, h: 1, art: 'banco-espera-2x1', label: 'Banco' },
    { x: 0.6, y: 4.5, w: 2, h: 1, art: 'banco-espera-2x1', label: 'Banco' },
    { x: 2.8, y: 4.5, w: 2, h: 1, art: 'banco-espera-2x1', label: 'Banco' },
    { x: 5, y: 4.5, w: 2, h: 1, art: 'banco-espera-2x1', label: 'Banco' },
    { x: 7.6, y: 1, w: 1.5, h: 2, art: 'planta-grande-1.5x2', label: 'Planta' },
    { x: 7.8, y: 3.6, w: 1, h: 1, art: 'lixeira-1x1', label: 'Lixeira' },
    { x: 7.5, y: 4.5, w: 1, h: 1, art: 'extintor-1x1', label: 'Extintor' },
  ],
}
