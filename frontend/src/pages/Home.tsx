import { Link, useNavigate } from 'react-router'
import { Badge, Button, Card, Icon, StatusPill } from '../ui'
import { CascaPublica } from '../components/CascaPublica'
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

/**
 * COMO FUNCIONA, em três passos.
 *
 * A landing dizia o que o produto É e pulava direto para os valores. Quem chega sem
 * conhecer a categoria não sabe o que vai FAZER depois de criar a conta — e a dúvida
 * "quanto trabalho isso dá?" é a que decide a maioria das visitas.
 */
const PASSOS: [string, string, string][] = [
  ['message-square', 'Descreva a operação', 'Em português, para o Assistente: quem atende o quê, com base em qual política, e quando você quer ser avisado.'],
  ['eye', 'Leia a prévia', 'Ele monta setores, agentes, conhecimento e monitores — e mostra tudo antes de criar. Nada acontece sem a sua confirmação.'],
  ['activity', 'Veja rodando', 'A Atividade mostra a cadeia inteira de cada resposta: quem falou com quem, o que foi lido e quanto custou.'],
]

/**
 * AS CAPTURAS — tiradas do produto por `npm run capturas`, e não desenhadas.
 *
 * Ícone e caixa de exemplo não provam nada: quem chega querendo saber como a coisa se
 * parece continua sem saber. E nenhuma delas é editada à mão — no dia em que a tela
 * mudar, a captura antiga vira uma promessa que o produto não cumpre mais, e a defesa
 * contra isso é ela ser barata de refazer.
 */
export const CAPTURAS: { arquivo: string; largura: number; altura: number; titulo: string; texto: string; alt: string }[] = [
  {
    arquivo: '/capturas/escritorio.png',
    largura: 1280,
    altura: 820,
    titulo: 'O escritório, com quem trabalha nele',
    texto:
      'Cada agente tem mesa, setor e um estado visível: pensando, trabalhando, parado. Clicar num deles abre o que ele sabe, o que pode usar e o que já fez — sem ler log.',
    alt: 'Tela do andar Atendimento, com agentes sentados em setores e os números da operação acima do mapa',
  },
  {
    arquivo: '/capturas/conhecimento.png',
    largura: 826,
    altura: 696,
    titulo: 'O mesmo andar, pelo que se sabe nele',
    texto:
      'Uma nuvem que gira: documentos, agentes e setores ligados por quem contém e quem alcança. Selecionar um nó acende a vizinhança dele e responde “o que isto atinge?” sem abrir painel.',
    alt: 'Mapa de conhecimento em três dimensões, com esferas ligadas representando documentos, agentes e setores',
  },
  {
    arquivo: '/capturas/atividade.png',
    largura: 1280,
    altura: 700,
    titulo: 'A cadeia inteira de uma resposta',
    texto:
      'De onde partiu (um monitor, uma rotina, uma mensagem), por quais etapas passou, o que foi entregue, quanto demorou e quanto consumiu. Uma linha por execução, e nenhum conteúdo sensível.',
    alt: 'Tela de Atividade listando execuções com origem, etapas, duração e consumo',
  },
]

/**
 * As quatro coisas que este produto tem e as ferramentas de automação genéricas não.
 *
 * Elas são afirmações VERIFICÁVEIS — cada uma tem uma página na documentação que a
 * explica. Uma landing que promete o que a documentação não sustenta é a landing que
 * produz o cancelamento no segundo mês.
 */
/**
 * Os três mecanismos de dados, do jeito que a documentação os separa.
 *
 * É o detalhe que distingue este produto de um assistente com base de arquivos: cada um
 * responde uma pergunta diferente, e juntá-los produz um sistema que responde rápido e
 * erra devagar — a resposta parece certa, e a origem dela é impossível de auditar.
 */
const MECANISMOS: [string, string, string][] = [
  ['Conhecimento', 'O que a empresa DIZ', 'A política de trocas, o cardápio, o manual. Tem dono e validade: vencido, aparece marcado em vez de sumir.'],
  ['Memória', 'O que o agente LEMBRA', 'Este cliente já reclamou disto no mês passado. É do agente, e não vira verdade da empresa por repetição.'],
  ['Database', 'O que ACONTECEU', '1.482 pedidos, com valor, data e situação. Consultado com filtro e limite — nunca um console de banco solto.'],
]

const DIFERENCAS: [string, string, string][] = [
  ['book-open-check', 'Conhecimento com dono e validade', 'Um documento pertence ao andar, ao setor ou ao agente, e pode vencer. Vencido, ele aparece marcado — não some, porque sumir esconderia que alguém precisa revisá-lo.'],
  ['radar', 'Monitor parado não gasta token', 'Enquanto o valor não cruza a condição, não existe chamada de modelo. Nem uma. Perguntar de minuto em minuto se algo mudou é uma conta que cresce sozinha enquanto nada acontece.'],
  ['wallet', 'Custo por tarefa, e não por mês', 'Cada execução registra o que consumiu. Dá para saber qual agente custa caro, e por quê.'],
  ['shield-check', 'Toda ação tem prévia e trilha', 'Plano, diferença, impacto, confirmação explícita e auditoria. Reexecutar não duplica.'],
]

export function Home() {
  const navigate = useNavigate()

  return (
    <CascaPublica>

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

      <section className="mx-auto" style={{ maxWidth: 1180, padding: '0 var(--gutter-screen) 64px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-heading)', margin: '0 0 6px' }}>Como funciona</h2>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 20px' }}>Três passos, e o segundo é onde você decide se o que ele montou está certo.</p>
        <div className="grid gap-4 md:grid-cols-3" data-testid="home-passos">
          {PASSOS.map(([icon, t, b], i) => (
            <Card key={t} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span className="flex items-center gap-2">
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 26,
                    height: 26,
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--intent-brand)',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                >
                  {i + 1}
                </span>
                <Icon name={icon} size={18} color="var(--intent-brand)" />
              </span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: 'var(--text-heading)' }}>{t}</span>
              <span style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>{b}</span>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto" style={{ maxWidth: 1180, padding: '0 var(--gutter-screen) 64px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-heading)', margin: '0 0 6px' }}>O que muda em relação a automatizar do jeito comum</h2>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 20px' }}>
          Cada uma destas está explicada por inteiro na{' '}
          <Link to="/docs" style={{ color: 'var(--text-link)' }}>
            documentação
          </Link>
          .
        </p>
        <div className="grid gap-4 md:grid-cols-2" data-testid="home-diferencas">
          {DIFERENCAS.map(([icon, t, b]) => (
            <Card key={t} style={{ display: 'flex', gap: 12 }}>
              <Icon name={icon} size={22} color="var(--intent-brand)" style={{ marginTop: 2, flex: '0 0 auto' }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: 'var(--text-heading)', marginBottom: 4 }}>{t}</span>
                <span style={{ display: 'block', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>{b}</span>
              </span>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto" style={{ maxWidth: 1180, padding: '0 var(--gutter-screen) 64px' }} data-testid="home-capturas">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-heading)', margin: '0 0 6px' }}>Veja por dentro</h2>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 20px' }}>Telas do produto, com dados de exemplo.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
          {CAPTURAS.map((c, i) => (
            <div key={c.arquivo} className="grid items-center gap-6 md:grid-cols-2">
              {/* A alternância é do DESKTOP, onde há duas colunas. Como `order` inline vale
                  em qualquer largura, no celular ela jogava a imagem para ANTES do próprio
                  título — e a pessoa via a tela antes de saber que tela era. */}
              <div className={i % 2 === 1 ? 'md:order-2' : undefined} style={{ minWidth: 0 }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800, color: 'var(--text-heading)', margin: '0 0 8px' }}>{c.titulo}</h3>
                <p style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>{c.texto}</p>
              </div>
              <img
                src={c.arquivo}
                alt={c.alt}
                // `lazy` porque estas ficam abaixo da dobra: baixá-las no primeiro quadro
                // atrasaria justamente o que a pessoa veio ver.
                loading="lazy"
                // As MEDIDAS DE VERDADE de cada arquivo, e não um par repetido: é delas que
                // o navegador tira a proporção para reservar o espaço antes de baixar a
                // imagem. Erradas, a página salta quando cada uma chega — e no celular o
                // salto acontece justamente sob o dedo. `capturas.test.ts` compara os dois
                // números com o cabeçalho do PNG.
                width={c.largura}
                height={c.altura}
                data-testid={`home-captura-${i}`}
                style={{ width: '100%', height: 'auto', borderRadius: 14, border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-raised)', background: 'var(--surface-card)' }}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto" style={{ maxWidth: 1180, padding: '0 var(--gutter-screen) 64px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-heading)', margin: '0 0 6px' }}>Três coisas que a maioria dos sistemas mistura</h2>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', margin: '0 0 20px' }}>
          Separá-las é o que permite auditar de onde veio uma resposta. Explicadas em{' '}
          <Link to="/docs/conceitos" style={{ color: 'var(--text-link)' }}>
            Conceitos
          </Link>
          .
        </p>
        <div className="grid gap-4 md:grid-cols-3" data-testid="home-mecanismos">
          {MECANISMOS.map(([t, pergunta, exemplo]) => (
            <Card key={t} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: 'var(--text-heading)' }}>{t}</span>
              <span style={{ fontSize: 14, color: 'var(--text-heading)' }}>{pergunta}</span>
              <span style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{exemplo}</span>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto flex flex-wrap items-center gap-4" style={{ maxWidth: 1180, padding: '0 var(--gutter-screen) 72px' }}>
        <div style={{ minWidth: 0, flex: '1 1 280px' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-heading)', margin: '0 0 4px' }}>Comece pelo primeiro andar</h2>
          <p style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>Um andar, um agente, uma política. O resto cresce depois.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button size="lg" iconRight="arrow-right" onClick={() => navigate('/register')} data-testid="home-cta-final">
            Criar conta
          </Button>
          {/* Quem é técnico decide lendo, e não pelo herói. */}
          <Button size="lg" variant="secondary" onClick={() => navigate('/docs')} data-testid="home-cta-docs">
            Ler a documentação
          </Button>
        </div>
      </section>
    </CascaPublica>
  )
}
