// A LISTA de páginas públicas, e o servidor que precisa saber entregá-las.
//
// O build escreve `dist/login/index.html`; se o nginx não resolver `$uri/`, esse arquivo
// existe e ninguém o recebe — a rota cai no SPA e a prévia do link volta a ser a genérica.
// O arquivo e o servidor são dois elos da mesma corrente, e um teste que só olha o
// primeiro deixa passar exatamente a metade que falha em produção.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import lista from '../paginasPublicas.json'

const nginx = readFileSync(new URL('../../../nginx.conf', import.meta.url), 'utf8')

describe('páginas públicas', () => {
  it('toda página tem rota, título e descrição', () => {
    expect(lista.paginas.length).toBeGreaterThan(0)
    for (const p of lista.paginas) {
      expect(p.rota.startsWith('/'), `rota estranha: ${p.rota}`).toBe(true)
      // Uma descrição vazia não é "sem descrição": é uma prévia com um espaço em branco
      // no lugar onde a pessoa decidiria clicar.
      expect(p.titulo.length, `${p.rota} sem título`).toBeGreaterThan(8)
      expect(p.descricao.length, `${p.rota} sem descrição`).toBeGreaterThan(40)
      // O limite prático do que Google e redes sociais mostram. Passar disso não quebra —
      // só corta a frase no meio, e a frase cortada costuma ser a que convencia.
      expect(p.descricao.length, `${p.rota} com descrição longa demais`).toBeLessThan(200)
    }
  })

  it('nenhuma rota e nenhum título se repetem', () => {
    expect(new Set(lista.paginas.map((p) => p.rota)).size).toBe(lista.paginas.length)
    expect(new Set(lista.paginas.map((p) => p.titulo)).size).toBe(lista.paginas.length)
  })

  it('AMEAÇA: nada que exija sessão entra na lista', () => {
    /**
     * Uma rota do escritório aqui vira um convite para o buscador indexar uma tela de
     * login — e um resultado de busca que não leva a lugar nenhum.
     */
    const privadas = ['/apps', '/databases', '/floors', '/settings', '/monitoring', '/executions', '/activity']
    for (const p of lista.paginas) {
      expect(privadas.some((r) => p.rota.startsWith(r)), `${p.rota} exige sessão`).toBe(false)
    }
  })

  it('o nginx serve o HTML de cada diretório, e não só o SPA', () => {
    // `index index.html` mais `$uri/` no `try_files`: é o par que faz `/login` chegar em
    // `dist/login/index.html`. Sem um dos dois, o arquivo gerado no build é inalcançável.
    expect(nginx).toMatch(/index\s+index\.html;/)
    expect(nginx).toMatch(/try_files\s+\$uri\s+\$uri\/\s+\/index\.html;/)
  })
})
