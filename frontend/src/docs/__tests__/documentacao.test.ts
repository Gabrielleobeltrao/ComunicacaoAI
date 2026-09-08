// A TRAVA que impede a documentação de mentir.
//
// Documentação apodrece de um jeito específico: ela diz `POST /api/monitors`, alguém
// renomeia a rota, e a página continua afirmando o que já não é verdade. Nada quebra —
// documentação não entra no build — e ninguém percebe até alguém tentar seguir o exemplo.
//
// A disciplina deste repositório é outra: o que importa tem um caso que morde. Então as
// rotas citadas são conferidas contra os roteadores DE VERDADE, lidos do backend.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import indice from '../indice.json'

const conteudoDir = new URL('../conteudo/', import.meta.url)
const backendDir = new URL('../../../../backend/src/', import.meta.url)

const paginas = (indice as { secoes: { paginas: { slug: string; titulo: string; resumo: string }[] }[] }).secoes.flatMap((s) => s.paginas)
const markdownDe = (slug: string) => readFileSync(new URL(`${slug}.md`, conteudoDir), 'utf8')

/**
 * As rotas que o backend REALMENTE monta.
 *
 * Lido do fonte, e não de uma lista escrita à mão: uma lista à mão é a mesma coisa que a
 * documentação, e conferir documentação contra documentação não confere nada. Duas peças
 * formam a rota — o prefixo em `app.use('/api/...', router)` e o caminho em
 * `router.get('/...')` — e é a junção das duas que a página cita.
 */
function rotasDoBackend(): Set<string> {
  const index = readFileSync(new URL('index.ts', backendDir), 'utf8')
  const prefixos = [...index.matchAll(/app\.use\('(\/api\/[^']*)'/g)].map((m) => m[1])
  // As rotas declaradas direto no index (health, ready) contam também.
  const soltas = [...index.matchAll(/app\.(get|post|put|delete|patch)\('(\/api\/[^']*)'/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`)

  const fora = new Set<string>(soltas)
  const arquivos = readdirSync(new URL('routes/', backendDir)).filter((f) => f.endsWith('.ts'))
  for (const arquivo of arquivos) {
    const texto = readFileSync(new URL(`routes/${arquivo}`, backendDir), 'utf8')
    for (const m of texto.matchAll(/(\w+)\.(get|post|put|delete|patch)\('([^']*)'/g)) {
      const metodo = m[2].toUpperCase()
      const caminho = m[3] === '/' ? '' : m[3]
      // O prefixo de um roteador não está no arquivo dele: cada prefixo conhecido gera uma
      // candidata, e a página só precisa casar com uma delas.
      for (const prefixo of prefixos) fora.add(`${metodo} ${prefixo}${caminho}`)
    }
  }
  return fora
}

/** `/api/floors/:floorId` e `/api/floors/:id` são a mesma rota para quem lê. */
const normalizar = (rota: string) => rota.replace(/:[A-Za-z0-9_]+/g, ':x').replace(/\/$/, '')

describe('documentação', () => {
  it('toda página do índice tem conteúdo, e todo conteúdo está no índice', () => {
    const arquivos = readdirSync(conteudoDir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
    // Conteúdo órfão é trabalho escrito que ninguém alcança; entrada sem conteúdo é um
    // item de menu que abre uma página em branco.
    expect(paginas.map((p) => p.slug).sort()).toEqual(arquivos.sort())
    for (const p of paginas) expect(markdownDe(p.slug).length, `${p.slug} vazia`).toBeGreaterThan(200)
  })

  it('toda página começa por um título de primeiro nível', () => {
    for (const p of paginas) expect(markdownDe(p.slug).trimStart().startsWith('# '), `${p.slug} sem <h1>`).toBe(true)
  })

  it('ACEITAÇÃO: toda rota citada na documentação existe no backend', () => {
    const reais = new Set([...rotasDoBackend()].map(normalizar))
    const citadas: string[] = []
    for (const p of paginas) {
      for (const m of markdownDe(p.slug).matchAll(/\b(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/[A-Za-z0-9/_:.-]*)/g)) {
        citadas.push(`${m[1]} ${m[2]}`)
      }
    }
    // Uma documentação técnica que não cita rota nenhuma passaria neste caso sem dizer
    // nada — o piso impede que ela passe por estar vazia.
    expect(citadas.length, 'a referência técnica não cita nenhuma rota').toBeGreaterThan(8)
    const fantasmas = citadas.filter((r) => !reais.has(normalizar(r)))
    expect(fantasmas, `rotas citadas que não existem: ${fantasmas.join(', ')}`).toEqual([])
  })

  it('AMEAÇA: todo link interno aponta para uma página que existe', () => {
    const validos = new Set(['/docs', '/login', '/register', '/', ...paginas.map((p) => `/docs/${p.slug}`)])
    for (const p of paginas) {
      for (const m of markdownDe(p.slug).matchAll(/\]\((\/[^)]*)\)/g)) {
        const destino = m[1].split('#')[0]
        expect(validos.has(destino), `${p.slug} aponta para ${destino}, que não existe`).toBe(true)
      }
    }
  })

  it('nenhuma página vaza segredo de exemplo', () => {
    // Um exemplo com uma chave de aparência real é copiado e colado com a chave junto.
    for (const p of paginas) {
      const texto = markdownDe(p.slug)
      expect(texto, `${p.slug} tem uma chave de aparência real`).not.toMatch(/sk-[A-Za-z0-9]{16,}/)
      expect(texto, `${p.slug} tem um Bearer de exemplo`).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/)
    }
  })
})
