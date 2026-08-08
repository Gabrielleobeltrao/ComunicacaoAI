import { useNavigate } from 'react-router'
import { Badge, Brand, Button, Card, Icon, StatusPill } from '../ui'
import type { AgentStatus } from '../ui'

const DEMO: { name: string; dept: string; color: string; status: AgentStatus }[] = [
  { name: 'Lia', dept: 'Vendas', color: 'var(--dept-vendas)', status: 'working' },
  { name: 'Bruno', dept: 'Suporte', color: 'var(--dept-suporte)', status: 'thinking' },
  { name: 'Nina', dept: 'Marketing', color: 'var(--dept-marketing)', status: 'idle' },
  { name: 'Téo', dept: 'Financeiro', color: 'var(--dept-financeiro)', status: 'working' },
]

const FEATURES: [string, string][] = [
  ['users-round', 'Agentes como colegas'],
  ['brain', 'Memória por agente'],
  ['wallet', 'Custo por tarefa'],
]

const VALUES: [string, string, string][] = [
  ['brain', 'Memória que fica', 'Cada agente lembra do que aprendeu com o time e com os seus clientes.'],
  ['wrench', 'Ferramentas reais', 'WhatsApp, HubSpot, Stripe, Google Agenda — o agente usa o que a sua equipe já usa.'],
  ['wallet', 'Custo transparente', 'Tokens, custo e desempenho por agente, como uma folha de pagamento.'],
]

export function Home() {
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-app)' }}>
      <header className="flex items-center gap-4" style={{ padding: '18px var(--gutter-screen)' }}>
        <Brand />
        <div style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={() => navigate('/login')}>
          Entrar
        </Button>
        <Button size="sm" onClick={() => navigate('/register')}>
          Criar conta
        </Button>
      </header>

      <section
        className="mx-auto grid items-center gap-10 lg:grid-cols-2"
        style={{ maxWidth: 1180, padding: '40px var(--gutter-screen) 56px' }}
      >
        <div className="flex flex-col items-start gap-4">
          <Badge tone="brand" icon="sparkles">
            Sua equipe de IA, com mesa própria
          </Badge>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-display-size)',
              lineHeight: 'var(--text-display-lh)',
              letterSpacing: 'var(--text-display-ls)',
              fontWeight: 800,
              color: 'var(--text-heading)',
            }}
          >
            Gerencie agentes de comunicação com um objetivo
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: 'var(--text-muted)', maxWidth: 480 }}>
            Conecte agentes em conversas, defina um objetivo e acompanhe as perguntas e respostas até chegar
            ao resultado que você precisa.
          </p>
          <div className="flex flex-wrap gap-3" style={{ marginTop: 4 }}>
            <Button size="lg" iconRight="arrow-right" onClick={() => navigate('/register')}>
              Começar agora
            </Button>
            <Button size="lg" variant="secondary" icon="play" onClick={() => navigate('/login')}>
              Ver o escritório
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2" style={{ marginTop: 8 }}>
            {FEATURES.map(([i, t]) => (
              <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--text-muted)' }}>
                <Icon name={i} size={16} color="var(--intent-brand)" />
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Office preview — real illustrations arrive in Phase 4 */}
        <div className="flex flex-col gap-3.5">
          <div
            style={{
              borderRadius: 22,
              padding: 20,
              background: 'var(--surface-floor)',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-raised)',
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              {DEMO.map((a) => (
                <div
                  key={a.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 12,
                    borderRadius: 14,
                    background: 'var(--surface-card)',
                    boxShadow: 'var(--shadow-flat)',
                  }}
                >
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--surface-sunken)',
                      border: `2px solid ${a.color}`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: 'var(--font-display)',
                      fontWeight: 800,
                      fontSize: 14,
                      color: a.color,
                    }}
                  >
                    {a.name[0]}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)' }}>{a.name}</p>
                    <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{a.dept}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Card padding="16px" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusPill status="working" label="3 trabalhando" />
            <span style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1 }}>
              Seu time já sentado, esperando o primeiro objetivo.
            </span>
          </Card>
        </div>
      </section>

      <section
        className="mx-auto grid gap-4 md:grid-cols-3"
        style={{ maxWidth: 1180, padding: '0 var(--gutter-screen) 64px' }}
      >
        {VALUES.map(([icon, t, b]) => (
          <Card key={t} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 48,
                height: 48,
                borderRadius: 14,
                background: 'var(--intent-brand-soft)',
              }}
            >
              <Icon name={icon} size={24} color="var(--intent-brand)" />
            </span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: 'var(--text-heading)' }}>
              {t}
            </span>
            <span style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>{b}</span>
          </Card>
        ))}
      </section>
    </div>
  )
}
