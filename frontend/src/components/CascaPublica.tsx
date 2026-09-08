import { Link, useNavigate } from 'react-router'
import type { ReactNode } from 'react'
import { Brand, Button } from '../ui'

// A CASCA das páginas sem sessão — landing e documentação.
//
// Ela existe porque as duas precisam do mesmo cabeçalho, e dois cabeçalhos divergem no
// primeiro ajuste: um ganha o link para a documentação, o outro não, e a pessoa que
// chegou pela documentação perde o caminho de volta. Uma casca só, e o miolo é o que
// muda entre elas.
//
// Sem `AppLayout`: aquele desenha a barra lateral do escritório, que pressupõe sessão,
// prédio e andar ativo. Aqui não há nenhum dos três.

const NAVEGACAO: { rotulo: string; para: string }[] = [{ rotulo: 'Documentação', para: '/docs' }]

export function CascaPublica({ children, rodape = true }: { children: ReactNode; rodape?: boolean }) {
  const navigate = useNavigate()
  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-app)', display: 'flex', flexDirection: 'column' }}>
      {/* `flex-wrap`: o cabeçalho ganhou um link de navegação e deixou de caber em 320 px —
          marca, link e dois botões numa linha só empurravam a página inteira para o lado.
          Quebrar é o comportamento certo; encolher a fonte seria esconder o problema. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2" style={{ padding: '18px var(--gutter-screen)' }}>
        {/* `ds-hit` cresce o alvo só sob ponteiro grosso: no desktop a marca continua do
            tamanho que é, no celular ela vira um alvo que o polegar acerta. */}
        <Link to="/" className="ds-hit flex items-center" style={{ textDecoration: 'none' }} aria-label="Início">
          <Brand />
        </Link>
        <nav className="flex items-center gap-1" aria-label="Navegação do site">
          {NAVEGACAO.map((item) => (
            <Link
              key={item.para}
              to={item.para}
              data-testid={`publico-nav-${item.para.replace(/\//g, '') || 'inicio'}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 'var(--hit-min, 44px)',
                padding: '0 10px',
                fontSize: 14,
                color: 'var(--text-muted)',
                textDecoration: 'none',
              }}
            >
              {item.rotulo}
            </Link>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={() => navigate('/login')} data-testid="publico-entrar">
          Entrar
        </Button>
        <Button size="sm" onClick={() => navigate('/register')} data-testid="publico-criar-conta">
          Criar conta
        </Button>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      {rodape && (
        <footer
          className="flex flex-wrap items-center gap-4"
          style={{ padding: '24px var(--gutter-screen)', borderTop: '1px solid var(--border-subtle)', fontSize: 13, color: 'var(--text-muted)' }}
          data-testid="publico-rodape"
        >
          <span>© {new Date().getFullYear()} Tavorium</span>
          {/* Links de rodapé são controles isolados, e não links no meio de uma frase:
              eles precisam do alvo inteiro. */}
          <Link to="/docs" className="ds-hit inline-flex items-center" style={{ color: 'inherit' }}>
            Documentação
          </Link>
          <Link to="/login" className="ds-hit inline-flex items-center" style={{ color: 'inherit' }}>
            Entrar
          </Link>
        </footer>
      )}
    </div>
  )
}
