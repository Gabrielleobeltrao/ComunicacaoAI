import type { Cenario } from './types'

// Preset pronto — copie e ajuste x/y. Cada item referencia um objeto por nome-base;
// use objectSrc(art) (lib/officeAssets) para obter a URL do SVG.
export const refeitorio: Cenario = {
  id: 'refeitorio',
  nome: 'Cozinha · refeitório',
  floor: 'hall',
  cols: 12,
  rows: 6.4,
  zoom: 0.92,
  itens: [
    { x: 0.5, y: 0.4, w: 2.5, h: 1.4, art: 'bancada-copa-2.5x1.4', label: 'Bancada' },
    { x: 2.81, y: 0.4, w: 1, h: 1.4, art: 'fogao-1x1.4', label: 'Fogão' },
    { x: 3.88, y: 0.1, w: 1, h: 1.7, art: 'geladeira-1x1.7', label: 'Geladeira' },
    { x: 5.3, y: 0.4, w: 1.5, h: 1.4, art: 'cafeteira-bancada-1.5x1.4', label: 'Café' },
    { x: 6.5, y: 0.5, w: 1, h: 1.3, art: 'microondas-suporte-1x1.3', label: 'Micro-ondas' },
    { x: 10.6, y: 0.3, w: 1, h: 1.4, art: 'galao-agua-1x1.4', label: 'Água' },
    { x: 1, y: 2.3, w: 1.5, h: 1.5, art: 'mesa-cafe-1.5x1.5', label: 'Mesa' },
    { x: 0.1, y: 2.9, w: 1, h: 1, art: 'banqueta-1x1', label: 'Banqueta' },
    { x: 2.4, y: 2.9, w: 1, h: 1, art: 'banqueta-1x1', label: 'Banqueta' },
    { x: 4.3, y: 2.3, w: 1.5, h: 1.5, art: 'mesa-cafe-1.5x1.5', label: 'Mesa' },
    { x: 3.4, y: 2.9, w: 1, h: 1, art: 'banqueta-1x1', label: 'Banqueta' },
    { x: 5.7, y: 2.9, w: 1, h: 1, art: 'banqueta-1x1', label: 'Banqueta' },
    { x: 7.6, y: 2.3, w: 1.5, h: 1.5, art: 'mesa-cafe-1.5x1.5', label: 'Mesa' },
    { x: 6.7, y: 2.9, w: 1, h: 1, art: 'banqueta-1x1', label: 'Banqueta' },
    { x: 9, y: 2.9, w: 1, h: 1, art: 'banqueta-1x1', label: 'Banqueta' },
    { x: 1.2, y: 4.5, w: 1.5, h: 1.5, art: 'mesa-cafe-1.5x1.5', label: 'Mesa' },
    { x: 0.3, y: 5.1, w: 1, h: 1, art: 'banqueta-1x1', label: 'Banqueta' },
    { x: 2.6, y: 5.1, w: 1, h: 1, art: 'banqueta-1x1', label: 'Banqueta' },
    { x: 5, y: 4.5, w: 1.5, h: 1.5, art: 'mesa-cafe-1.5x1.5', label: 'Mesa' },
    { x: 4.1, y: 5.1, w: 1, h: 1, art: 'banqueta-1x1', label: 'Banqueta' },
    { x: 6.4, y: 5.1, w: 1, h: 1, art: 'banqueta-1x1', label: 'Banqueta' },
    { x: 10.3, y: 2.2, w: 1.5, h: 2, art: 'planta-grande-1.5x2', label: 'Planta' },
    { x: 10.6, y: 5, w: 1, h: 1, art: 'lixeira-1x1', label: 'Lixeira' },
    { x: 9.4, y: 4.3, w: 1, h: 1.4, art: 'relogio-parede-1x1.4', label: 'Relógio' },
  ],
}
