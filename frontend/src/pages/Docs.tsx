import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import { CascaPublica } from '../components/CascaPublica'
import { Card, Input } from '../ui'
import { SECOES, TODAS, buscar, paginaPorSlug } from '../docs/indice'

// A DOCUMENTAÇÃO — dentro do app, e não num site à parte.
//
// Um gerador de site estático seria uma segunda cadeia de build para manter e um segundo
// sistema de design para divergir. Aqui o conteúdo é markdown versionado ao lado do
// código que ele descreve, o índice é uma lista só, e o build escreve o HTML de cada
// página com os metadados dela — o mesmo caminho da landing.

/**
 * Um título vira ÂNCORA.
 *
 * Sem isso não existe link para um trecho, e documentação sem link para o trecho é
 * documentação que se cita por captura de tela.
 */
const ancora = (texto: string) =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const soTexto = (n: unknown): string =>
  typeof n === 'string' ? n : Array.isArray(n) ? n.map(soTexto).join('') : ''

const COMPONENTES: Components = {
  h1: ({ children }) => (
    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, color: 'var(--text-heading)', margin: '0 0 14px' }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 id={ancora(soTexto(children))} style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: 'var(--text-heading)', margin: '30px 0 10px', scrollMarginTop: 80 }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 id={ancora(soTexto(children))} style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-heading)', margin: '22px 0 8px', scrollMarginTop: 80 }}>{children}</h3>
  ),
  p: ({ children }) => <p style={{ margin: '0 0 12px', fontSize: 15, lineHeight: 1.65, color: 'var(--text-body)' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 15, lineHeight: 1.65, color: 'var(--text-body)' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 15, lineHeight: 1.65, color: 'var(--text-body)' }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '0 0 4px' }}>{children}</li>,
  strong: ({ children }) => <strong style={{ color: 'var(--text-heading)' }}>{children}</strong>,
  code: ({ children }) => (
    <code style={{ background: 'var(--surface-sunken)', borderRadius: 4, padding: '1px 5px', fontSize: '0.88em', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{children}</code>
  ),
  // Bloco de código e tabela rolam DENTRO do próprio bloco: numa tela estreita, uma
  // linha longa de exemplo empurraria a página inteira para o lado.
  pre: ({ children }) => (
    <pre style={{ margin: '0 0 14px', padding: 14, background: 'var(--surface-sunken)', borderRadius: 10, overflowX: 'auto', fontSize: 13, lineHeight: 1.5 }}>{children}</pre>
  ),
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '0 0 14px' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border-strong)', color: 'var(--text-heading)', whiteSpace: 'nowrap' }}>{children}</th>
  ),
  td: ({ children }) => <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-body)' }}>{children}</td>,
  a: ({ children, href }) =>
    href?.startsWith('/') ? (
      <Link to={href} style={{ color: 'var(--text-link)' }}>
        {children}
      </Link>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-link)' }}>
        {children}
      </a>
    ),
}

function Indice({ atual }: { atual?: string }) {
  return (
    <nav aria-label="Seções da documentação" data-testid="docs-indice" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {SECOES.map((secao) => (
        <div key={secao.titulo} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>{secao.titulo}</span>
          {secao.paginas.map((p) => (
            <Link
              key={p.slug}
              to={`/docs/${p.slug}`}
              data-testid={`docs-link-${p.slug}`}
              aria-current={atual === p.slug ? 'page' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                minHeight: 36,
                padding: '0 8px',
                borderRadius: 8,
                fontSize: 14,
                textDecoration: 'none',
                background: atual === p.slug ? 'var(--surface-sunken)' : 'transparent',
                color: atual === p.slug ? 'var(--text-heading)' : 'var(--text-muted)',
                fontWeight: atual === p.slug ? 700 : 400,
              }}
            >
              {p.titulo}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  )
}

export function Docs() {
  const { slug } = useParams<{ slug: string }>()
  const [termo, setTermo] = useState('')
  const resultados = useMemo(() => buscar(termo), [termo])
  const pagina = slug ? paginaPorSlug(slug) : undefined

  // Um endereço que não existe é dito, e não desenhado como página vazia.
  if (slug && !pagina) {
    return (
      <CascaPublica>
        <div style={{ maxWidth: 700, margin: '0 auto', padding: '48px var(--gutter-screen)' }}>
          <Card>
            <p style={{ fontSize: 15 }} data-testid="docs-nao-encontrada">
              Esta página da documentação não existe. <Link to="/docs" style={{ color: 'var(--text-link)' }}>Ver o índice</Link>.
            </p>
          </Card>
        </div>
      </CascaPublica>
    )
  }

  const posicao = pagina ? TODAS.findIndex((p) => p.slug === pagina.slug) : -1
  const anterior = posicao > 0 ? TODAS[posicao - 1] : null
  const proxima = posicao >= 0 && posicao < TODAS.length - 1 ? TODAS[posicao + 1] : null

  return (
    <CascaPublica>
      {/* As colunas vêm da CLASSE, e não do estilo em linha: um `gridTemplateColumns`
          embutido vence a classe responsiva, e o menu lateral nunca ganharia a coluna
          dele — ficaria empilhado acima do texto em qualquer largura. */}
      <div
        style={{ maxWidth: 1180, margin: '0 auto', padding: '28px var(--gutter-screen) 56px', gap: 28 }}
        className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]"
        data-testid="docs"
      >
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar na documentação"
            aria-label="Buscar na documentação"
            data-testid="docs-busca"
          />
          {termo.trim().length >= 2 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="docs-resultados">
              {resultados.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }} data-testid="docs-sem-resultado">
                  Nada com esse termo.
                </p>
              ) : (
                resultados.map((r) => (
                  <Link key={r.pagina.slug} to={`/docs/${r.pagina.slug}`} data-testid={`docs-resultado-${r.pagina.slug}`} style={{ textDecoration: 'none' }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text-heading)' }}>{r.pagina.titulo}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>…{r.trecho}…</span>
                  </Link>
                ))
              )}
            </div>
          ) : (
            <Indice atual={pagina?.slug} />
          )}
        </aside>

        <div style={{ minWidth: 0 }}>
          {pagina ? (
            <>
              <article data-testid="docs-conteudo">
                <ReactMarkdown components={COMPONENTES}>{pagina.markdown}</ReactMarkdown>
              </article>
              <div className="flex flex-wrap justify-between gap-3" style={{ marginTop: 36, paddingTop: 18, borderTop: '1px solid var(--border-subtle)' }}>
                {anterior ? (
                  <Link to={`/docs/${anterior.slug}`} data-testid="docs-anterior" style={{ fontSize: 14, color: 'var(--text-link)' }}>
                    ← {anterior.titulo}
                  </Link>
                ) : (
                  <span />
                )}
                {proxima ? (
                  <Link to={`/docs/${proxima.slug}`} data-testid="docs-proxima" style={{ fontSize: 14, color: 'var(--text-link)' }}>
                    {proxima.titulo} →
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            </>
          ) : (
            <div data-testid="docs-inicio" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 800, color: 'var(--text-heading)', margin: '0 0 6px' }}>Documentação</h1>
                <p style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>Como o sistema funciona, com exemplos e as partes técnicas por inteiro.</p>
              </div>
              {SECOES.map((secao) => (
                <div key={secao.titulo} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.04em', color: 'var(--text-faint)', textTransform: 'uppercase', margin: 0 }}>{secao.titulo}</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 12 }}>
                    {secao.paginas.map((p) => (
                      <Link key={p.slug} to={`/docs/${p.slug}`} data-testid={`docs-cartao-${p.slug}`} style={{ textDecoration: 'none' }}>
                        <Card padding="16px" style={{ display: 'grid', gap: 6, height: '100%' }}>
                          <strong style={{ fontSize: 15, color: 'var(--text-heading)' }}>{p.titulo}</strong>
                          <span style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{p.resumo}</span>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </CascaPublica>
  )
}
