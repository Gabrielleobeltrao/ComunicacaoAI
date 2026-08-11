import type { Cenario } from './types'

// Preset pronto — copie e ajuste x/y. Cada item referencia um objeto por nome-base;
// use objectSrc(art) (lib/officeAssets) para obter a URL do SVG.
export const arquivo: Cenario = {
  id: 'arquivo',
  nome: 'Arquivo',
  floor: 'hall',
  cols: 7.6,
  rows: 4.6,
  itens: [
    { x: 0.4, y: 0.5, w: 1.5, h: 2, art: 'estante-alta-1.5x2', label: 'Estante' },
    { x: 1.95, y: 0.5, w: 1.5, h: 2, art: 'estante-alta-1.5x2', label: 'Estante' },
    { x: 3.7, y: 0.9, w: 1, h: 1.5, art: 'arquivo-1x1.5', label: 'Arquivo' },
    { x: 4.6, y: 0.9, w: 1, h: 1.5, art: 'arquivo-1x1.5', label: 'Arquivo' },
    { x: 6, y: 1, w: 1, h: 1.4, art: 'impressora-suporte-1x1.4', label: 'Impressora' },
    { x: 0.6, y: 3, w: 1, h: 1, art: 'gaveteiro-1x1', label: 'Gaveteiro' },
    { x: 1.9, y: 3.1, w: 1, h: 1, art: 'caixas-1x1', label: 'Caixas' },
    { x: 2.8, y: 3.4, w: 1, h: 1, art: 'caixas-1x1', label: 'Caixas' },
    { x: 4.3, y: 3.2, w: 1.5, h: 1.3, art: 'prateleira-pe-1.5x1.3', label: 'Prateleira' },
    { x: 6.2, y: 3.4, w: 1, h: 1, art: 'extintor-1x1', label: 'Extintor' },
  ],
}
