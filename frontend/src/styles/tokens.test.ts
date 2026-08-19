import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Um token que não existe não pinta nada — e falha em silêncio.
//
// `var(--accent-500)` era usado em quatro componentes e nunca foi definido em lugar
// nenhum (nem aqui, nem no design system). O CSS trata isso como declaração inválida:
// a propriedade inteira some. Na prática, o passo atual do assistente de contratação
// ficava invisível e o cartão selecionado perdia a borda sem ganhar cor — parecia bug
// de layout, era um nome de token errado.
//
// Não há aviso de compilação para isso: `var()` aceita qualquer nome. Este teste é o
// aviso.

const raiz = join(import.meta.dirname, '..')

function arquivos(dir: string, extensoes: string[]): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho, extensoes))
    else if (extensoes.some((e) => nome.endsWith(e))) saida.push(caminho)
  }
  return saida
}

const definidos = new Set(
  arquivos(raiz, ['.css']).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1])),
)

describe('tokens de cor', () => {
  it('todo var(--token) sem fallback aponta para um token que existe', () => {
    const orfaos: string[] = []
    for (const arquivo of arquivos(raiz, ['.tsx', '.ts'])) {
      if (arquivo.endsWith('tokens.test.ts')) continue
      const fonte = readFileSync(arquivo, 'utf8')
      // Variáveis que o próprio componente declara inline (posição, tamanho de tile) não
      // são tokens do sistema — e podem ser declaradas linhas abaixo de onde são usadas.
      const proprias = new Set([...fonte.matchAll(/'(--[a-z0-9-]+)':/g)].map((m) => m[1]))
      fonte
        .split('\n')
        .forEach((linha, i) => {
          const usos = [
            // var(--x) sem fallback — com fallback o navegador tem para onde ir.
            ...[...linha.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)].map((m) => m[1]),
            // A sintaxe do Tailwind 4 — text-(--x), bg-(--x) — que não aceita fallback.
            ...[...linha.matchAll(/[a-z-]+-\((--[a-z0-9-]+)\)/g)].map((m) => m[1]),
          ]
          for (const token of usos) {
            // Variáveis definidas no próprio elemento (posição, tamanho) não são tokens.
            if (definidos.has(token) || proprias.has(token)) continue
            orfaos.push(`${arquivo.replace(raiz, 'src')}:${i + 1} → ${token}`)
          }
        })
    }
    expect(orfaos, 'tokens usados que ninguém define').toEqual([])
  })
})
