import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Os Apps fixados aparecem nos DOIS modos de navegação do rail.
 *
 * O rail tem um ramo para a navegação nova e outro para a antiga, e o grupo "Apps
 * fixados" vivia só no primeiro. O sintoma não era erro: era ausência. Quem estivesse
 * com a navegação antiga fixava um App, a preferência ia para o servidor, e o menu
 * continuava igual.
 *
 * Uma leitura do próprio arquivo é o teste mais direto disto — o que precisa ser
 * garantido é estrutural: o componente é usado uma vez em cada ramo.
 */
describe('rail: Apps fixados', () => {
  it('renderiza o grupo nos dois ramos da navegação', () => {
    const fonte = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8')
    const usos = fonte.match(/<PinnedAppsNav\s/g) ?? []
    expect(usos.length, 'um uso em cada ramo do rail (navegação nova e antiga)').toBe(2)
  })
})
