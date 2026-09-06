import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { CustomToolsPanel } from './Tools'
import { PrivateAppsPanel } from '../components/PrivateAppsPanel'
import { AppLogo } from '../components/AppLogo'
import { AppDetailDialog } from '../components/AppDetailDialog'
import { ExtensionDialog, carregarComunidade, juntarComunidade } from '../components/ExtensionDialog'
import type { ItemDeComunidade } from '../components/ExtensionDialog'
import { KIND_LABEL, STATUS_LABEL as STATUS_PACOTE } from '../lib/extensions'
import { StreamCTA, StreamPanel } from '../components/StreamPanel'
import { TradingPolicyPanel } from '../components/TradingPolicyPanel'
import { listStreams } from '../lib/streams'
import type { MarketStream } from '../lib/streams'
import {
  disconnectInstallation,
  listAppCatalog,
  listInstallations,
  reconnectInstallation,
  patchInstallation,
  testInstallation,
  RISK_LABEL,
  STATUS_LABEL,
} from '../lib/apps'
import type { AppCatalogEntry, AppInstallation } from '../lib/apps'
import { API_URL } from '../lib/api'
import { useAppNavigation } from '../lib/appNavigation'
import { Badge, Button, Card, Dialog, EmptyState, Field, Icon, IconButton, Input, Select, Tabs, Tag } from '../ui'

// The Apps page: what the account can connect (Catálogo), what it already connected
// (Conectados) and the HTTP actions the owner wrote themselves (Personalizados).
//
// Nothing on this page ever displays a stored credential — the API does not return
// one. A secret field left blank on save means "keep the current one".

/**
 * A PROCEDÊNCIA de um item da prateleira.
 *
 * Ela era um cabeçalho de grupo — três listas separadas, oficiais, comunidade e privados.
 * Separar dizia que instalar algo de outra pessoa é uma atividade diferente de usar um
 * App, e não é: é a mesma prateleira, com etiquetas diferentes. O que a procedência
 * continua fazendo é o que ela sempre fez de útil: dizer de quem é aquilo, e permitir
 * separar a quem quiser separar.
 */
type Origem = 'todos' | 'plataforma' | 'comunidade' | 'meus'
const ORIGENS: { valor: Origem; label: string }[] = [
  { valor: 'todos', label: 'Tudo' },
  { valor: 'plataforma', label: 'Da plataforma' },
  { valor: 'comunidade', label: 'Da comunidade' },
  { valor: 'meus', label: 'Meus' },
]

interface ItemDaPrateleira {
  chave: string
  origem: Exclude<Origem, 'todos'>
  categorias: string[]
  busca: string
  app?: AppCatalogEntry
  pacote?: ItemDeComunidade
}

type TabKey = 'catalog' | 'connected' | 'mine' | 'custom'
const TABS: { value: TabKey; label: string }[] = [
  { value: 'catalog', label: 'Catálogo' },
  { value: 'connected', label: 'Conectados' },
  { value: 'mine', label: 'Meus Apps' },
  { value: 'custom', label: 'Ferramentas' },
]

export function Apps() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: TabKey = raw === 'connected' || raw === 'custom' || raw === 'mine' ? raw : 'catalog'

  const [catalog, setCatalog] = useState<AppCatalogEntry[]>([])
  const [installations, setInstallations] = useState<AppInstallation[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('')
  const [origem, setOrigem] = useState<Origem>('todos')
  const [detail, setDetail] = useState<AppCatalogEntry | null>(null)
  // A COMUNIDADE não é um lugar: é uma procedência. O que era uma página à parte mora
  // aqui, na mesma prateleira, com o mesmo campo de busca e os mesmos filtros.
  const [comunidade, setComunidade] = useState<ItemDeComunidade[]>([])
  // O popup guarda o ID, não o objeto: depois de instalar, a lista é relida e o popup
  // precisa mostrar o estado NOVO. Um objeto capturado no clique mostraria o antigo.
  const [pacoteId, setPacoteId] = useState<string | null>(null)

  // `silent` refreshes without swapping the list for a spinner — a background
  // refresh must not unmount the panel the owner is reading (it would throw away the
  // result of the test they just ran).
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setFailed(false)
    try {
      const [apps, installed, extensoes] = await Promise.all([
        listAppCatalog(),
        listInstallations(),
        // Apps e templates: os dois são "coisa que se instala e passa a operar". As
        // ferramentas ficam na prateleira de ferramentas, que é onde se procura por elas.
        carregarComunidade(['app', 'template']),
      ])
      setCatalog(apps)
      setInstallations(installed)
      setComunidade(juntarComunidade(extensoes.catalogo, extensoes.meus, extensoes.instalados))
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const pacote = useMemo(() => comunidade.find((i) => i.id === pacoteId) ?? null, [comunidade, pacoteId])

  const prateleira = useMemo<ItemDaPrateleira[]>(
    () => [
      // `?? []` porque uma categoria ausente não pode derrubar a prateleira inteira: o
      // texto de busca é montado para TODO item, e antes só era montado quando alguém
      // digitava algo — o que escondia o buraco até o dia em que alguém digitasse.
      ...catalog.map((app) => ({
        chave: `app:${app.key}`,
        origem: app.source === 'system' ? ('plataforma' as const) : ('meus' as const),
        categorias: app.categories ?? [],
        busca: `${app.name} ${app.description} ${(app.categories ?? []).join(' ')}`,
        app,
      })),
      ...comunidade.map((item) => ({
        chave: `pkg:${item.id}`,
        // Um pacote MEU é meu, mesmo publicado: quem o escreveu não o procura em
        // "comunidade", procura no que é dele.
        origem: item.meu ? ('meus' as const) : item.author === 'platform' ? ('plataforma' as const) : ('comunidade' as const),
        categorias: item.categories ?? [],
        busca: `${item.name} ${item.summary} ${(item.categories ?? []).join(' ')}`,
        pacote: item,
      })),
    ],
    [catalog, comunidade],
  )

  const categories = useMemo(() => [...new Set(prateleira.flatMap((i) => i.categorias))].sort(), [prateleira])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return prateleira.filter((item) => {
      if (origem !== 'todos' && item.origem !== origem) return false
      if (category && !item.categorias.includes(category)) return false
      if (!needle) return true
      return item.busca.toLowerCase().includes(needle)
    })
  }, [prateleira, search, category, origem])

  const setTab = (value: string) => {
    const next = new URLSearchParams(params)
    next.set('tab', value)
    setParams(next, { replace: true })
  }

  // The surface guard sends the owner here when a page belongs to an App this account
  // has not activated. Saying so beats a silent redirect.
  const inactiveApp = params.get('inactive')
  const inactiveName = inactiveApp ? (catalog.find((a) => a.key === inactiveApp)?.name ?? inactiveApp) : null

  return (
    <AppLayout current="/apps" title="Apps" subtitle="O que os seus agentes podem usar, conectado uma vez na conta.">
      <div style={{ display: 'grid', gap: 16 }}>
        {inactiveName ? (
          <p
            data-testid="inactive-notice"
            style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: 'var(--surface-sunken)', fontSize: 13.5, color: 'var(--text-body)' }}
          >
            Aquela página pertence ao App <strong>{inactiveName}</strong>, que ainda não está ativo nesta conta. Ative-o aqui para abri-la.
          </p>
        ) : null}
        <Tabs tabs={TABS} value={tab} onChange={setTab} style={{ alignSelf: 'start' }} />

        {tab === 'custom' ? (
          <CustomToolsPanel />
        ) : tab === 'mine' ? (
          // Creating an App changes what the catalog offers, so a change here
          // refreshes the catalog too.
          <PrivateAppsPanel onChanged={() => void load(true)} />
        ) : loading ? (
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando…</p>
        ) : failed ? (
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Não foi possível carregar.{' '}
            <button type="button" onClick={() => void load()} style={LINK}>
              Tentar de novo
            </button>
          </p>
        ) : tab === 'catalog' ? (
          <>
            {/* CADA FILTRO É UMA PERGUNTA, e a pergunta fica escrita.
                Eram quinze pastilhas soltas em duas fileiras sem rótulo — e duas delas,
                "Todos" e "Tudo", com a mesma cara e significados diferentes. */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }} data-testid="apps-filtros">
              {/* Larguras que ENCOLHEM: num celular os três controles empilham, e um campo
                  de largura fixa deixa uma faixa morta ao lado dele. */}
              <label style={{ ...ROTULO, flex: '1 1 200px', maxWidth: 280 }}>
                Buscar
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="nome, descrição…"
                  aria-label="Buscar App"
                  data-testid="apps-search"
                  style={{ width: '100%' }}
                />
              </label>

              {/* A categoria vem dos dados e cresce com o catálogo: uma fileira de pastilhas
                  quebra em duas linhas no dia em que alguém publica a décima segunda. */}
              <label style={{ ...ROTULO, flex: '1 1 160px', maxWidth: 220 }}>
                Categoria
                <Select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  data-testid="apps-filtro-categoria"
                  style={{ width: '100%' }}
                  options={[{ value: '', label: 'Todas' }, ...categories.map((c) => ({ value: c, label: c }))]}
                />
              </label>

              {/* A origem é um conjunto FECHADO de quatro: emendadas, elas se leem como um
                  controle só — e não como quatro pastilhas soltas ao lado das outras onze. */}
              <div style={{ ...ROTULO, maxWidth: '100%' }} role="group" aria-label="Origem" data-testid="origem-filtros">
                Origem
                {/* Quatro segmentos emendados não podem quebrar linha sem virar dois
                    controles: numa tela estreita eles rolam dentro do próprio bloco, como
                    a tabela larga faz em toda parte deste projeto. */}
                <div style={{ display: 'flex', overflowX: 'auto', maxWidth: '100%' }}>
                  {ORIGENS.map((o, i) => (
                    <SegmentoDeOrigem
                      key={o.valor}
                      label={o.label}
                      active={origem === o.valor}
                      primeiro={i === 0}
                      ultimo={i === ORIGENS.length - 1}
                      onClick={() => setOrigem(o.valor)}
                      data-testid={`origem-${o.valor}`}
                    />
                  ))}
                </div>
              </div>

              {/* Só aparece quando há o que limpar: um controle que não faz nada é ruído. */}
              {(search || category || origem !== 'todos') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch('')
                    setCategory('')
                    setOrigem('todos')
                  }}
                  // Alinhado à base dos outros controles: ele pertence à mesma linha, e não
                  // a uma fileira própria embaixo.
                  style={{ marginBottom: 6 }}
                  data-testid="apps-limpar-filtros"
                >
                  Limpar filtros
                </Button>
              )}
            </div>

            {visible.length === 0 ? (
              <EmptyState icon="search" title="Nenhum App encontrado" body="Tente outro termo ou limpe o filtro." />
            ) : (
              <div style={GRID} data-testid="app-catalog">
                {visible.map((item) =>
                  item.app ? (
                    <AppCard key={item.chave} app={item.app} onOpen={() => setDetail(item.app!)} />
                  ) : (
                    <PacoteCard key={item.chave} item={item.pacote!} onOpen={() => setPacoteId(item.pacote!.id)} />
                  ),
                )}
              </div>
            )}
          </>
        ) : (
          <ConnectedList installations={installations} catalog={catalog} onChanged={load} />
        )}
      </div>

      {/* Fechar depois de instalar engoliria o aviso — e é justamente o aviso do template
          que diz que NADA foi criado ainda. Quem fecha é quem leu. */}
      <ExtensionDialog item={pacote} onClose={() => setPacoteId(null)} onChanged={() => void load(true)} />

      <AppDetailDialog
        app={detail}
        installations={installations.filter((i) => i.appKey === detail?.key)}
        onClose={() => setDetail(null)}
        onConnected={async () => {
          setDetail(null)
          await load()
          setTab('connected')
        }}
      />
    </AppLayout>
  )
}

const GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 14 } as const
const LINK = { background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--intent-brand)', textDecoration: 'underline', cursor: 'pointer' } as const

/** O rótulo de um filtro: a pergunta em cima, o controle embaixo — como no mapa. */
const ROTULO = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-muted)', minWidth: 0 } as const

/**
 * Um segmento da origem — emendado ao vizinho.
 *
 * Quatro botões colados são UM controle: o olho lê "escolha uma destas quatro". Quatro
 * pastilhas separadas, ao lado de outras onze, são quinze coisas soltas.
 */
function SegmentoDeOrigem({
  label,
  active,
  primeiro,
  ultimo,
  onClick,
  ...rest
}: { label: string; active: boolean; primeiro: boolean; ultimo: boolean; onClick: () => void } & { 'data-testid'?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="ds-hit"
      {...rest}
      style={{
        height: 42,
        padding: '0 14px',
        border: `1px solid ${active ? 'var(--intent-brand)' : 'var(--border-strong)'}`,
        // A borda compartilhada não pode virar duas: o vizinho da direita cobre a do vizinho
        // da esquerda, e o botão ativo sobe para a frente para a dele não ser coberta.
        marginLeft: primeiro ? 0 : -1,
        zIndex: active ? 1 : 0,
        borderTopLeftRadius: primeiro ? 'var(--radius-control)' : 0,
        borderBottomLeftRadius: primeiro ? 'var(--radius-control)' : 0,
        borderTopRightRadius: ultimo ? 'var(--radius-control)' : 0,
        borderBottomRightRadius: ultimo ? 'var(--radius-control)' : 0,
        background: active ? 'var(--surface-sunken)' : 'var(--surface-card)',
        color: active ? 'var(--text-heading)' : 'var(--text-muted)',
        fontFamily: 'var(--font-ui)',
        fontSize: 13.5,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      {label}
    </button>
  )
}

// "Sistema" descrevia a implementação; "Oficial" descreve a procedência, que é o que
// o dono precisa saber para decidir se confia. O valor guardado continua `system` —
// mudar a chave quebraria todo grant e instalação já gravados.
const SOURCE_LABEL: Record<string, string> = { system: 'Oficial', private: 'Meu App', community: 'Comunidade' }

// "Em breve" é anúncio: o App aparece com nome e descrição para o dono saber o que
// está vindo, e as ações ficam fora do alcance. Esconder seria a alternativa fácil, e
// desperdiçaria a única coisa que um "em breve" tem de útil.
const emBreve = (app: AppCatalogEntry): boolean => app.availability === 'coming_soon'

function AppCard({ app, onOpen }: { app: AppCatalogEntry; onOpen: () => void }) {
  const writes = app.actions.filter((a) => a.risk !== 'read').length
  return (
    <Card padding="16px" style={{ display: 'grid', gap: 10 }} data-testid="app-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <AppLogo appKey={app.key} icon={app.icon} size={40} title={app.name} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: 'var(--text-heading)' }}>{app.name}</span>
          {/* O SELO é só de quem é da plataforma. O da comunidade não ganha nada — por
              ora —, e "nada" é a informação certa: não afirma o que ninguém conferiu. */}
          {app.source === 'system' ? (
            <Badge tone="success" data-testid="selo-plataforma">
              {SOURCE_LABEL.system}
            </Badge>
          ) : (
            <Tag>{SOURCE_LABEL[app.source] ?? app.source}</Tag>
          )}
          {emBreve(app) ? <Tag data-testid="app-coming-soon">Em breve</Tag> : null}
          {app.connected ? <Tag>Conectado</Tag> : null}
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{app.description}</p>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }}>
        {app.actions.length > 0
          ? `${app.actions.length} ${app.actions.length === 1 ? 'ação' : 'ações'}${writes > 0 ? ` · ${writes} altera${writes === 1 ? '' : 'm'} dados` : ''}`
          : app.surfaces.length > 0
            ? // A channel App has no model actions: what it unlocks are its pages.
              `Canal de atendimento · ${app.surfaces.length} página(s)`
            : 'Usado nas entregas das rotinas'}
      </p>
      <div style={{ paddingTop: 4 }}>
        {/* Em breve: o botão fica desabilitado e diz o que é. O backend recusa de
            qualquer forma — isto evita a ida e volta. */}
        <Button
          size="sm"
          variant={app.connected ? 'secondary' : 'primary'}
          onClick={emBreve(app) ? undefined : onOpen}
          disabled={emBreve(app)}
          data-testid="app-open"
        >
          {emBreve(app)
            ? 'Em breve'
            : app.connected
              ? 'Ver conexão'
              : app.activation === 'managed_channel'
                ? 'Conectar número'
                : app.requiresAuth
                  ? 'Conectar'
                  : 'Ativar'}
        </Button>
      </div>
    </Card>
  )
}

/**
 * O cartão de um item da comunidade — do mesmo tamanho e no mesmo grid do cartão de App.
 *
 * A igualdade visual é o ponto: quem procura "algo que consulte CEP" não está procurando
 * "um pacote da comunidade", está procurando a função. O que distingue é a etiqueta, não
 * a prateleira.
 */
function PacoteCard({ item, onOpen }: { item: ItemDeComunidade; onOpen: () => void }) {
  return (
    <Card padding="16px" style={{ display: 'grid', gap: 10 }} data-testid="app-card" data-origem={item.meu ? 'meus' : item.author}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: 'var(--text-heading)' }}>{item.name}</span>
        {item.author === 'platform' && !item.meu ? (
          <Badge tone="success" data-testid="selo-plataforma">
            Oficial
          </Badge>
        ) : null}
        <Tag>{KIND_LABEL[item.kind]}</Tag>
        {/* Um pacote meu mostra o ESTADO dele, que é a única coisa que eu preciso saber
            olhando de longe: rascunho não está publicado, suspenso saiu do ar. */}
        {item.meu && item.meu.status !== 'published' ? <Tag>{STATUS_PACOTE[item.meu.status]}</Tag> : null}
        {item.instalado ? <Tag>Instalado</Tag> : null}
      </div>
      <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{item.summary}</p>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }}>
        v{item.version ?? '—'}
        {item.installs !== null ? ` · ${item.installs} instalações` : ''}
      </p>
      <div style={{ paddingTop: 4 }}>
        <Button size="sm" variant={item.instalado ? 'secondary' : 'primary'} onClick={onOpen} data-testid="app-open">
          {item.instalado ? 'Ver instalação' : 'Ver detalhes'}
        </Button>
      </div>
    </Card>
  )
}

function ConnectedList({
  installations,
  catalog,
  onChanged,
}: {
  installations: AppInstallation[]
  catalog: AppCatalogEntry[]
  onChanged: (silent?: boolean) => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ id: string; text: string; ok: boolean } | null>(null)
  // Pinning is navigation, not permission: it goes to the preference endpoint and
  // touches nothing about the connection itself.
  const { pinned, togglePin } = useAppNavigation()
  const pinnedKeys = pinned.map((p) => p.appKey)
  const [pinning, setPinning] = useState<string | null>(null)

  // A refused pin has a reason — the backend refuses one that points at a broken or
  // inactive App. Swallowing it left the button doing nothing, silently.
  const pin = async (appKey: string) => {
    setPinning(appKey)
    setMessage(null)
    try {
      await togglePin(appKey)
    } catch (e) {
      setMessage({ id: appKey, text: (e as Error).message, ok: false })
    } finally {
      setPinning(null)
    }
  }
  const [renaming, setRenaming] = useState<AppInstallation | null>(null)
  const [confirming, setConfirming] = useState<AppInstallation | null>(null)
  /**
   * Os streams por conexão. Uma busca só, e falha em silêncio de propósito: streaming
   * é exceção nesta tela, e um erro dele não pode esconder a lista de conexões.
   */
  const [streams, setStreams] = useState<Record<string, MarketStream>>({})
  useEffect(() => {
    let vivo = true
    listStreams()
      .then((lista) => vivo && setStreams(Object.fromEntries(lista.map((s) => [s.installationId, s]))))
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [])
  const [settingsFor, setSettingsFor] = useState<AppInstallation | null>(null)
  // Remover é diferente de desconectar, e por isso tem confirmação própria: desconectar
  // tira o acesso e mantém o registro; remover tira a conexão da lista.
  const [removing, setRemoving] = useState<AppInstallation | null>(null)

  const appFor = (key: string) => catalog.find((a) => a.key === key)

  if (installations.length === 0) {
    return <EmptyState icon="blocks" title="Nenhum App conectado" body="Conecte um App no catálogo para os seus agentes poderem usá-lo." />
  }

  const runTest = async (i: AppInstallation) => {
    setBusy(i.id)
    try {
      const result = await testInstallation(i.id)
      setMessage({ id: i.id, text: result.message, ok: result.ok })
      await onChanged(true)
    } finally {
      setBusy(null)
    }
  }

  const reconnect = async (i: AppInstallation) => {
    const how = await reconnectInstallation(i.id)
    if (how.kind === 'oauth' && how.connectPath) {
      window.location.href = `${API_URL}${how.connectPath}`
      return
    }
    setRenaming(i)
  }

  return (
    <>
      <div style={GRID} data-testid="connected-list">
        {installations.map((i) => {
          const app = appFor(i.appKey)
          return (
            <Card key={i.id} padding="16px" style={{ display: 'grid', gap: 12 }} data-testid="installation-card">
              {/* Cabeçalho: logo, nome, estado — e a engrenagem, que guarda tudo o
                  que não é a ação do dia a dia. Antes eram CINCO botões soltos numa
                  linha que quebrava, todos com o mesmo peso visual. */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <AppLogo appKey={i.appKey} icon={app?.icon} size={38} title={app?.name ?? i.appKey} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 15.5, fontWeight: 800, color: 'var(--text-heading)' }}>{i.name}</span>
                    <Tag>{STATUS_LABEL[i.status]}</Tag>
                    {/*
                      O AMBIENTE, quando ele não é o padrão.
                      Uma conexão de simulação e uma de verdade se parecem em tudo menos na
                      consequência — e é justamente essa que não pode depender de alguém
                      lembrar qual das duas está olhando.
                    */}
                    {i.environment && i.environment !== 'default' ? (
                      <Tag color="var(--mango-600)" data-testid="installation-environment">
                        {i.environment === 'paper' ? 'SIMULAÇÃO' : i.environment.toUpperCase()}
                      </Tag>
                    ) : null}
                  </div>
                  <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{app?.name ?? i.appKey}</p>
                </div>
                <IconButton
                  icon="settings"
                  label="Configurações da conexão"
                  size="sm"
                  onClick={() => setSettingsFor(i)}
                  data-testid={`settings-${i.appKey}`}
                />
              </div>

              {/* Os fatos da conexão, um por linha e sempre na mesma ordem. */}
              <dl style={{ margin: 0, display: 'grid', gap: 4 }}>
                {i.publicMetadata.account ? <Fact icon="user" text={`Conta: ${i.publicMetadata.account}`} /> : null}
                {i.grantedScopes.length > 0 ? <Fact icon="key-round" text={`${i.grantedScopes.length} permissão(ões) concedida(s)`} /> : null}
                <Fact
                  icon="users-round"
                  text={i.agentCount ? `${i.agentCount} ${i.agentCount === 1 ? 'agente usa' : 'agentes usam'}` : 'Nenhum agente usa ainda'}
                  testid="installation-usage"
                />
              </dl>

              {/* O stream aparece só onde existe: a maioria das conexões é REST e não
                  tem nada de tempo real para contar. */}
              {/*
                Tempo real só aparece onde ele existe de verdade — e o convite aparece
                antes de existir. Sem o convite, o recurso ficava pronto no servidor e
                inalcançável na tela.
              */}
              {app?.streamable && i.status === 'connected' ? (
                streams[i.id] ? (
                  <StreamPanel
                    stream={streams[i.id]}
                    onChange={(s) => setStreams((prev) => ({ ...prev, [s.installationId]: s }))}
                    onRemoved={() =>
                      setStreams((prev) => {
                        const { [i.id]: _removido, ...resto } = prev
                        return resto
                      })
                    }
                  />
                ) : (
                  <StreamCTA installationId={i.id} onCreated={(s) => setStreams((prev) => ({ ...prev, [s.installationId]: s }))} />
                )
              ) : null}

              {/* Segurança só aparece onde há o que limitar: um App cujas ações são
                  todas de leitura não tem política de operação nenhuma. */}
              {app?.actions?.some((a) => a.risk === 'high_risk') ? <TradingPolicyPanel installationId={i.id} /> : null}

              {message?.id === i.appKey || message?.id === i.id ? (
                <p style={{ margin: 0, fontSize: 12.5, color: message.ok ? 'var(--intent-brand)' : 'var(--coral-600, #d92d20)' }}>{message.text}</p>
              ) : null}

              {/* As duas ações do dia a dia, uma em cada ponta. O resto — renomear,
                  reconectar, desconectar — mora na engrenagem. */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                <Button size="sm" variant="secondary" icon="plug-zap" disabled={busy === i.id} onClick={() => void runTest(i)}>
                  {busy === i.id ? 'Testando…' : 'Testar conexão'}
                </Button>
                {app?.pinnable && i.status === 'connected' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={pinnedKeys.includes(i.appKey) ? 'pin-off' : 'pin'}
                    disabled={pinning === i.appKey}
                    onClick={() => void pin(i.appKey)}
                    data-testid={`pin-${i.appKey}`}
                  >
                    {pinnedKeys.includes(i.appKey) ? 'Desafixar' : 'Fixar no menu'}
                  </Button>
                ) : null}
              </div>
            </Card>
          )
        })}
      </div>

      {/* Tudo o que não é "testar" mora aqui: cada ação com o seu ícone, o seu nome
          e uma linha dizendo o que ela faz. Numa fileira de botões-fantasma, nenhum
          deles dizia isso. */}
      <Dialog
        open={settingsFor !== null}
        onClose={() => setSettingsFor(null)}
        title="Configurações da conexão"
        subtitle={settingsFor?.name}
        width={520}
      >
        {settingsFor ? (
          <div style={{ display: 'grid', gap: 8 }} data-testid="connection-settings">
            <SettingsAction
              icon="pencil"
              title="Renomear"
              body="O nome que aparece nesta lista e na hora de conceder a um agente."
              testid="action-rename"
              onClick={() => {
                const target = settingsFor
                setSettingsFor(null)
                setRenaming(target)
              }}
            />
            <SettingsAction
              icon="refresh-cw"
              title="Reconectar"
              body="Troca a credencial ou refaz o login do provedor. As permissões dos agentes ficam como estão."
              testid="action-reconnect"
              onClick={() => {
                const target = settingsFor
                setSettingsFor(null)
                void reconnect(target)
              }}
            />
            {settingsFor.status !== 'revoked' ? (
              <SettingsAction
                icon="power-off"
                title="Desconectar"
                body="Os agentes perdem acesso na hora. O histórico é preservado, e a conexão continua na lista."
                testid="disconnect"
                danger
                onClick={() => {
                  const target = settingsFor
                  setSettingsFor(null)
                  setConfirming(target)
                }}
              />
            ) : null}
            {/* Faltava isto: uma conexão desconectada ficava na lista para sempre, sem
                ação nenhuma. Desconectar tira o ACESSO; remover tira a CONEXÃO. */}
            <SettingsAction
              icon="trash-2"
              title="Remover da lista"
              body="Tira esta conexão da lista. O histórico do que já foi feito é preservado; para usar de novo, é conectar outra vez."
              testid="action-remove"
              danger
              onClick={() => {
                const target = settingsFor
                setSettingsFor(null)
                setRemoving(target)
              }}
            />
          </div>
        ) : null}
      </Dialog>

      <Dialog open={removing !== null} onClose={() => setRemoving(null)} title="Remover conexão" width={520}>
        {removing ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {removing.status === 'connected'
                ? 'A conexão será desconectada e sai da lista. Os agentes que a usam perdem acesso na hora.'
                : 'A conexão sai da lista.'}
            </p>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              O histórico do que já foi feito é preservado. Para usar de novo, basta conectar outra vez.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                data-testid="confirm-remove"
                onClick={async () => {
                  // `purge`: a rota apaga a linha em vez de só revogar.
                  await disconnectInstallation(removing.id, true)
                  setRemoving(null)
                  await onChanged()
                }}
              >
                Remover
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <RenameDialog installation={renaming} app={renaming ? appFor(renaming.appKey) : undefined} onClose={() => setRenaming(null)} onSaved={onChanged} />

      <Dialog open={confirming !== null} onClose={() => setConfirming(null)} title="Desconectar App" width={520}>
        {confirming ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {confirming.agentCount
                ? `${confirming.agentCount} ${confirming.agentCount === 1 ? 'agente perde' : 'agentes perdem'} acesso a estas ações imediatamente.`
                : 'Nenhum agente usa esta conexão hoje.'}
            </p>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {appFor(confirming.appKey)?.disconnectNote ?? 'O histórico é preservado; nada do que já foi feito é apagado.'}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                data-testid="confirm-disconnect"
                onClick={async () => {
                  await disconnectInstallation(confirming.id)
                  setConfirming(null)
                  await onChanged()
                }}
              >
                Desconectar
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  )
}

// Uma linha de fato da conexão: ícone + frase. Sempre na mesma ordem, para dois
// cartões lado a lado serem comparáveis de relance.
function Fact({ icon, text, testid }: { icon: string; text: string; testid?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)' }} data-testid={testid}>
      <Icon name={icon} size={13} color="var(--text-faint)" />
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{text}</span>
    </div>
  )
}

function SettingsAction({
  icon,
  title,
  body,
  onClick,
  testid,
  danger,
  disabled,
}: {
  icon: string
  title: string
  body: string
  onClick: () => void
  testid?: string
  danger?: boolean
  disabled?: boolean
}) {
  const tone = danger ? 'var(--intent-danger, #d92d20)' : 'var(--text-heading)'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        width: '100%',
        padding: 12,
        borderRadius: 10,
        border: '1px solid var(--border-subtle)',
        background: 'var(--surface-card)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        textAlign: 'left',
        font: 'inherit',
      }}
    >
      <Icon name={icon} size={16} color={tone} style={{ marginTop: 2 }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: tone }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)' }}>{body}</span>
      </span>
    </button>
  )
}

function RenameDialog({
  installation,
  app,
  onClose,
  onSaved,
}: {
  installation: AppInstallation | null
  app?: AppCatalogEntry
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [config, setConfig] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(installation?.name ?? '')
    setConfig({})
    setError('')
  }, [installation])

  if (!installation) return null

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const filled = Object.fromEntries(Object.entries(config).filter(([, v]) => v.trim()))
      await patchInstallation(installation.id, { name, ...(Object.keys(filled).length ? { config: filled } : {}) })
      onClose()
      await onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="Editar conexão" width={560}>
      <div style={{ display: 'grid', gap: 12 }}>
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="installation-name" />
        </Field>
        {(app?.auth.fields ?? []).map((field) => (
          <Field key={field.key} label={field.label} hint={field.secret ? 'Deixe em branco para manter o valor atual.' : field.help ?? undefined}>
            <Input
              type={field.secret ? 'password' : 'text'}
              value={config[field.key] ?? ''}
              placeholder={field.placeholder ?? ''}
              onChange={(e) => setConfig((c) => ({ ...c, [field.key]: e.target.value }))}
            />
          </Field>
        ))}
        {error ? <p style={{ margin: 0, fontSize: 13, color: 'var(--coral-600, #d92d20)' }}>{error}</p> : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()} data-testid="save-installation">
            Salvar
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export { RISK_LABEL }
