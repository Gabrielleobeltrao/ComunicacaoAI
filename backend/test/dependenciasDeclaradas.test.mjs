// O backend só pode importar o que ELE declara.
//
// Este teste existe por causa de um deploy que quebrou três vezes seguidas sem que nada
// aqui ficasse vermelho. A causa: `src/browserRenderer.ts` importava `playwright`, que
// não é dependência do backend. No desenvolvimento funcionava — o pacote está na raiz do
// monorepo, içado pelo workspace do frontend, e a resolução do Node sobe até lá. A imagem
// do backend instala só o `package.json` deste diretório, e lá ele não existe: o `tsc`
// falhava na imagem, e só nela.
//
// Rodar `tsc` na máquina de quem desenvolve NÃO prova que a imagem compila. Isto prova.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'))
const declaradas = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])
const nativos = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])

const arquivos = (dir) =>
  readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) return arquivos(caminho)
    return /\.tsx?$/.test(nome) ? [caminho] : []
  })

/**
 * O código, sem os comentários.
 *
 * Um verificador que lê comentário mente nos dois sentidos: acusa o exemplo escrito numa
 * explicação e deixa passar o import de verdade escrito logo abaixo. Só o código conta.
 */
const semComentarios = (codigo) =>
  codigo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** O nome do PACOTE num especificador: `@escopo/nome/sub` → `@escopo/nome`. */
const pacoteDe = (especificador) => {
  const partes = especificador.split('/')
  return especificador.startsWith('@') ? partes.slice(0, 2).join('/') : partes[0]
}

test('todo pacote importado pelo backend está declarado no package.json dele', () => {
  const faltando = new Map()
  for (const arquivo of arquivos(join(raiz, 'src'))) {
    const codigo = semComentarios(readFileSync(arquivo, 'utf8'))
    // `import ... from 'x'`, `import 'x'`, `export ... from 'x'` e `import('x')` literal.
    const especificadores = [
      ...codigo.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s+['"]([^'"]+)['"]/g),
      ...codigo.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g),
      ...codigo.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1])

    for (const especificador of especificadores) {
      // Caminho relativo é código nosso; nativo do Node vem com a plataforma.
      if (especificador.startsWith('.') || especificador.startsWith('/')) continue
      const pacote = pacoteDe(especificador)
      if (nativos.has(pacote) || nativos.has(especificador)) continue
      if (declaradas.has(pacote)) continue
      const onde = faltando.get(pacote) ?? []
      onde.push(arquivo.replace(`${raiz}/`, ''))
      faltando.set(pacote, onde)
    }
  }

  assert.deepEqual(
    [...faltando.entries()].map(([p, onde]) => `${p} (em ${onde.join(', ')})`),
    [],
    'estes pacotes compilam aqui porque existem na raiz do monorepo, e NÃO existem na imagem do backend',
  )
})

test('o renderizador de navegador continua sem exigir o pacote para compilar', () => {
  // Se alguém trocar o nome montado por um literal, o `tsc` volta a exigir o Playwright
  // na imagem — e o deploy volta a quebrar, com o build passando na máquina de todo mundo.
  const codigo = semComentarios(readFileSync(join(raiz, 'src/browserRenderer.ts'), 'utf8'))
  assert.ok(!/import\s*\(\s*['"]playwright['"]\s*\)/.test(codigo), 'especificador literal faria o build exigir o pacote')
  assert.match(codigo, /await import\(nome\)/)
})
