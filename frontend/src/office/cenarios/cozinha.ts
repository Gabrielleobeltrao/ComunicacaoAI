import type { Cenario } from './types'

// Preset pronto — copie e ajuste x/y. Cada item referencia um objeto por nome-base;
// use objectSrc(art) (lib/officeAssets) para obter a URL do SVG.
export const cozinha: Cenario = {
  id: 'cozinha',
  nome: 'Cozinha · copa',
  floor: 'hall',
  cols: 9.6,
  rows: 5,
  itens: [
    { x: 0.5, y: 0.5, w: 2.5, h: 1.4, art: 'bancada-copa-2.5x1.4', label: 'Bancada' },
    { x: 2.81, y: 0.5, w: 1, h: 1.4, art: 'fogao-1x1.4', label: 'Fogão' },
    { x: 3.88, y: 0.2, w: 1, h: 1.7, art: 'geladeira-1x1.7', label: 'Geladeira' },
    { x: 8.3, y: 0.4, w: 1, h: 1.4, art: 'galao-agua-1x1.4', label: 'Água' },
    { x: 6.6, y: 2.2, w: 1.5, h: 1.5, art: 'mesa-cafe-1.5x1.5', label: 'Mesa de café' },
    { x: 5.7, y: 2.8, w: 1, h: 1, art: 'banqueta-1x1', label: 'Banqueta' },
    { x: 8, y: 2.8, w: 1, h: 1, art: 'banqueta-1x1', label: 'Banqueta' },
    { x: 0.6, y: 3.5, w: 1, h: 1, art: 'lixeira-1x1', label: 'Lixeira' },
  ],
}
