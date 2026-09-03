// O VERMELHO QUE NINGUÉM CONSEGUE LER.
//
// `--intent-danger` é `--coral-500` (#FF6A5B): uma cor de PREENCHIMENTO. Usada como cor de
// texto sobre fundo claro ela dá 2,81:1 — abaixo dos 4,5:1 que um texto de 13px precisa. E o
// texto vermelho é exatamente o que alguém lê às três da manhã, com pressa.
//
// O token de texto existe: `--intent-danger-text` (`--coral-700`, #B8321F, 5,98:1). Este caso
// existe para o defeito não voltar arquivo por arquivo — ele é barato, roda sem navegador, e
// falha nomeando o lugar.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = new URL('../', import.meta.url).pathname

function arquivos(dir: string): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho))
    else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(caminho)
  }
  return saida
}

describe('o token de perigo', () => {
  it('nunca pinta TEXTO com a cor de preenchimento', () => {
    // Só `color:` — `background`, `border` e `fill` continuam usando o token de
    // preenchimento, que é para o que ele existe.
    const padrao = /color:\s*(?:[^,;\n]*\?\s*)?'?var\(--intent-danger\)/
    const culpados: string[] = []
    for (const caminho of arquivos(RAIZ)) {
      for (const [i, linha] of readFileSync(caminho, 'utf8').split('\n').entries()) {
        if (padrao.test(linha)) culpados.push(`${caminho.replace(RAIZ, '')}:${i + 1}`)
      }
    }
    expect(culpados, 'use var(--intent-danger-text) para texto').toEqual([])
  })

  it('o token de texto está declarado', () => {
    const css = readFileSync(join(RAIZ, 'styles/tokens/colors.css'), 'utf8')
    expect(css).toContain('--intent-danger-text')
  })
})
