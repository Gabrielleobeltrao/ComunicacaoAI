// Toda flag declarada tem que ser lida por alguém.
//
// Havia seis no frontend e seis no backend. Metade nunca foi consultada em lugar
// nenhum, e o exemplo de produção combinava `VITE_AI_BUILDING_ENABLED=true` com
// `VITE_AI_FLOORS_ENABLED=false` — o que parecia uma contradição perigosa e era só
// uma chave que não abria porta nenhuma.
//
// O problema de uma flag morta não é o byte que ela ocupa: é alguém desligar uma
// coisa achando que desligou outra, e o comportamento não mudar. Este teste lê a
// fonte e falha quando uma flag é declarada sem consumidor — e também quando o
// exemplo documenta uma variável que o código não conhece mais.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = new URL('../..', import.meta.url).pathname

function fontes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === 'node_modules' || entrada === 'dist') continue
    const cheio = join(dir, entrada)
    if (statSync(cheio).isDirectory()) fontes(cheio, acc)
    else if (/\.tsx?$/.test(entrada)) acc.push(cheio)
  }
  return acc
}

const declaracao = readFileSync(join(RAIZ, 'src/featureFlags.ts'), 'utf8')
const declaradas = [...declaracao.matchAll(/^ {2}(\w+): on\(/gm)].map((m) => m[1])

// Todo o código EXCETO a declaração e este teste.
const codigo = fontes(join(RAIZ, 'src'))
  .filter((f) => !f.endsWith('featureFlags.ts') && !f.includes('__tests__/featureFlags'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')
  // Comentários fora: mencionar uma flag numa explicação não é consumi-la, e foi
  // assim que `aiFloors` pareceu viva por tanto tempo.
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('feature flags', () => {
  it('há flags declaradas', () => {
    expect(declaradas.length).toBeGreaterThan(0)
  })

  it('toda flag declarada é lida em algum lugar', () => {
    for (const flag of declaradas) {
      expect(codigo, `featureFlags.${flag} está declarada e ninguém a lê`).toContain(`featureFlags.${flag}`)
    }
  })

  it('o exemplo e o template de produção documentam exatamente as flags que existem', () => {
    const emUso = new Set(
      declaradas.map((f) => `VITE_${f.replace(/([A-Z])/g, '_$1').toUpperCase()}_ENABLED`.replace('VITE_AI_', 'VITE_AI_')),
    )
    for (const arquivo of ['.env.example', '.env.production.example']) {
      const texto = readFileSync(join(RAIZ, arquivo), 'utf8')
      const documentadas = [...texto.matchAll(/^(VITE_AI_\w+)=/gm)].map((m) => m[1])
      for (const nome of documentadas) {
        expect(emUso.has(nome), `${arquivo} documenta ${nome}, que o código não lê`).toBe(true)
      }
      for (const nome of emUso) {
        expect(documentadas, `${arquivo} não documenta ${nome}`).toContain(nome)
      }
    }
  })
})
