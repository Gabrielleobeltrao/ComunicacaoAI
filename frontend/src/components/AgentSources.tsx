import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { API_URL } from '../lib/api'
import { useActiveFloorId } from '../contexts/BuildingContext'
import { floorAgent } from '../lib/floorRoutes'
import { Button, Card, Field, Input, Select } from '../ui'

// Sites que este agente consulta QUANDO É CHAMADO.
//
// A rotina já respondia "verifique de hora em hora". Faltava o outro caso, que é o mais
// comum: "quando alguém perguntar, olhe aqui". Sem horário, sem checkpoint e sem custo
// enquanto ninguém pergunta — o agente consulta com a ferramenta `verificar_fonte`, e só
// quando a pergunta pedir.
//
// As fontes que vêm de rotinas aparecem juntas, como leitura: elas também podem ser
// consultadas sob demanda, mas quem manda nelas é a rotina, e editá-las aqui seria mexer
// no horário de outra coisa sem dizer.

export type Quando = 'on_demand' | 'always' | 'on_change'

export interface AgentSource {
  routineId: string | null
  origem: 'agente' | 'rotina'
  id?: string
  name: string
  kind: 'rss' | 'http'
  host: string | null
  url?: string
  when?: Quando
  initialWindow?: '24h' | '3d' | '7d'
  refreshMode?: RefreshMode
  intervalMinutes?: number | null
  maxStalenessMinutes?: number | null
  discoveryMode?: DiscoveryMode
  crawlArticles?: boolean
  maxArticlesPerRun?: number | null
  sameDomainOnly?: boolean
  status?: string
  lastSuccessfulFetchAt?: string | null
  nextScheduledAt?: string | null
  lastError?: string | null
}

interface Linha {
  id: string
  name: string
  kind: 'rss' | 'http'
  url: string
  when: Quando
  initialWindow: '24h' | '3d' | '7d'
  // Como este endereço vira CONHECIMENTO — documento na base, não texto de um prompt.
  // Ausente significa "manual": uma fonte antiga não passa a consumir banda sozinha.
  refreshMode: RefreshMode
  intervalMinutes: number
  maxStalenessMinutes: number
  discoveryMode: DiscoveryMode
  crawlArticles: boolean
  maxArticlesPerRun: number
  sameDomainOnly: boolean
  // O que aconteceu na última leitura. Só leitura: quem escreve é o servidor.
  status?: string
  lastSuccessfulFetchAt?: string | null
  nextScheduledAt?: string | null
  lastError?: string | null
}

type RefreshMode = 'scheduled' | 'on_demand' | 'manual' | 'hybrid'
type DiscoveryMode = 'auto' | 'rss' | 'sitemap' | 'listing' | 'single_page'

// O que cada modo custa e quando ele serve, dito onde a escolha é feita.
const ATUALIZACAO_OPCOES: { value: RefreshMode; label: string }[] = [
  { value: 'manual', label: 'Só quando eu pedir — nada acontece sozinho' },
  { value: 'on_demand', label: 'Antes de usar o agente — lê se estiver velho' },
  { value: 'scheduled', label: 'De tempos em tempos — previsível, no relógio' },
  { value: 'hybrid', label: 'As duas: no relógio, e antes de usar se envelheceu' },
]

const INTERVALO_OPCOES = [
  { value: '5', label: 'a cada 5 min' },
  { value: '10', label: 'a cada 10 min' },
  { value: '15', label: 'a cada 15 min' },
  { value: '30', label: 'a cada 30 min' },
  { value: '60', label: 'a cada hora' },
  { value: '360', label: 'a cada 6 horas' },
  { value: '1440', label: 'uma vez por dia' },
]

const DESCOBERTA_OPCOES: { value: DiscoveryMode; label: string }[] = [
  { value: 'auto', label: 'Automático — decide pelo endereço' },
  { value: 'single_page', label: 'Só esta página' },
  { value: 'rss', label: 'Os itens do feed' },
  { value: 'sitemap', label: 'As páginas do sitemap' },
  { value: 'listing', label: 'Os links desta página' },
]

interface Config {
  maxItems: number
  charBudget: number
  maxSources: number
  toolName: string
  toolDescription: string
}

const PADRAO: Config = { maxItems: 8, charBudget: 2400, maxSources: 5, toolName: '', toolDescription: '' }

// O custo de cada escolha, dito onde a escolha é feita.
const QUANDO_OPCOES: { value: Quando; label: string }[] = [
  { value: 'on_demand', label: 'Quando o agente julgar — 0 token se ninguém perguntar' },
  { value: 'always', label: 'Sempre que for chamado — paga o texto em todo turno' },
  { value: 'on_change', label: 'Sempre, mas só se mudou — 0 na maioria dos turnos' },
]

const JANELA_OPCOES = [
  { value: '24h', label: 'últimas 24h' },
  { value: '3d', label: 'últimos 3 dias' },
  { value: '7d', label: 'últimos 7 dias' },
]

export function AgentSources({ agentId }: { agentId: string }) {
  const [proprias, setProprias] = useState<Linha[]>([])
  const [cfg, setCfg] = useState<Config>(PADRAO)
  const [deRotinas, setDeRotinas] = useState<AgentSource[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)
  const [atualizando, setAtualizando] = useState(false)
  const [resumo, setResumo] = useState<string | null>(null)
  const fid = useActiveFloorId()

  useEffect(() => {
    let vivo = true
    fetch(`${API_URL}/api/agents/${agentId}/sources`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((corpo) => {
        if (!vivo) return
        // O GET devolve a lista; as configurações vêm junto quando existem.
        const lista: AgentSource[] = Array.isArray(corpo) ? corpo : (corpo?.sources ?? [])
        setProprias(
          lista
            .filter((s) => s.origem === 'agente')
            .map((s, i) => ({
              id: s.id ?? `${i}`,
              name: s.name,
              kind: s.kind,
              url: s.url ?? '',
              when: s.when ?? 'on_demand',
              initialWindow: s.initialWindow ?? '7d',
              refreshMode: s.refreshMode ?? 'manual',
              intervalMinutes: s.intervalMinutes ?? 30,
              maxStalenessMinutes: s.maxStalenessMinutes ?? 30,
              discoveryMode: s.discoveryMode ?? 'auto',
              crawlArticles: s.crawlArticles === true,
              maxArticlesPerRun: s.maxArticlesPerRun ?? 5,
              sameDomainOnly: s.sameDomainOnly !== false,
              status: s.status,
              lastSuccessfulFetchAt: s.lastSuccessfulFetchAt,
              nextScheduledAt: s.nextScheduledAt,
              lastError: s.lastError,
            })),
        )
        if (!Array.isArray(corpo) && corpo?.settings) setCfg({ ...PADRAO, ...corpo.settings })
        setDeRotinas(lista.filter((s) => s.origem === 'rotina'))
        setCarregando(false)
      })
      .catch(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [agentId])

  /** Lê agora o que está salvo, e conta o que aconteceu com cada endereço. */
  async function atualizarAgora() {
    setAtualizando(true)
    setResumo(null)
    try {
      const res = await fetch(`${API_URL}/api/agents/${agentId}/sources/refresh`, { method: 'POST', credentials: 'include' })
      const corpo = await res.json().catch(() => null)
      const fontes: { name: string; refreshed: boolean; created: number; updated: number; unchanged: number; error: string | null }[] =
        corpo?.sources ?? []
      const lidas = fontes.filter((f) => f.refreshed)
      setResumo(
        lidas.length === 0
          ? 'Nada a atualizar agora.'
          : lidas
              .map((f) => `${f.name}: ${f.error ? `falhou (${f.error})` : `${f.created} nova(s), ${f.updated} atualizada(s), ${f.unchanged} sem mudança`}`)
              .join(' · '),
      )
    } catch {
      setResumo('Não foi possível atualizar agora.')
    } finally {
      setAtualizando(false)
    }
  }

  const alterar = (id: string, patch: Partial<Linha>) => {
    setSalvo(false)
    setProprias((antes) => antes.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch(`${API_URL}/api/agents/${agentId}/sources`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources: proprias
            .filter((l) => l.url.trim())
            .map((l) => ({
              id: l.id,
              name: l.name.trim(),
              kind: l.kind,
              url: l.url.trim(),
              when: l.when,
              initialWindow: l.initialWindow,
              refreshMode: l.refreshMode,
              intervalMinutes: l.intervalMinutes,
              maxStalenessMinutes: l.maxStalenessMinutes,
              discoveryMode: l.discoveryMode,
              crawlArticles: l.crawlArticles,
              maxArticlesPerRun: l.maxArticlesPerRun,
              sameDomainOnly: l.sameDomainOnly,
            })),
          settings: cfg,
        }),
      })
      if (!res.ok) {
        const corpo = await res.json().catch(() => null)
        setErro(corpo?.error ?? 'Não foi possível salvar.')
        return
      }
      setSalvo(true)
    } finally {
      setSalvando(false)
    }
  }

  const fluxos = fid ? floorAgent(fid, agentId, 'fluxos') : `/agents/${agentId}/fluxos`

  return (
    <Card padding="16px" style={{ display: 'grid', gap: 12 }} data-testid="agent-sources">
      <div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
          Endereços que o agente pode olhar <strong>quando for acionado</strong> — numa conversa, num canal ou dentro de um
          setor. Não tem horário: ele consulta quando a pergunta pedir. Buscar não gasta tokens; o que custa é ele ler e
          responder.
        </p>
      </div>

      {carregando ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)' }}>Carregando…</p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }} data-testid="agent-sources-list">
          {proprias.length === 0 && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }} data-testid="agent-sources-empty">
              Nenhum endereço ainda. Adicione um e o agente passa a poder consultá-lo durante o atendimento.
            </p>
          )}
          {proprias.map((linha) => (
            <div key={linha.id} style={{ display: 'grid', gap: 8, border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 10 }}>
             <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr auto', alignItems: 'end' }}>
              <Field label="Nome">
                <Input
                  value={linha.name}
                  onChange={(e) => alterar(linha.id, { name: e.target.value })}
                  placeholder="Blog da empresa"
                  data-testid="agent-source-name"
                />
              </Field>
              <Field label="Endereço">
                <Input
                  value={linha.url}
                  onChange={(e) => alterar(linha.id, { url: e.target.value })}
                  placeholder={linha.kind === 'rss' ? 'https://exemplo.com/feed.xml' : 'https://exemplo.com/pagina'}
                  data-testid="agent-source-url"
                />
              </Field>
              <div style={{ display: 'flex', gap: 6, alignItems: 'end' }}>
                <Select
                  value={linha.kind}
                  onChange={(e) => alterar(linha.id, { kind: e.target.value as 'rss' | 'http' })}
                  data-testid="agent-source-kind"
                  aria-label="Tipo"
                  options={[
                    { value: 'http', label: 'Página' },
                    { value: 'rss', label: 'Feed' },
                  ]}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSalvo(false)
                    setProprias((antes) => antes.filter((l) => l.id !== linha.id))
                  }}
                  data-testid="agent-source-remove"
                >
                  Remover
                </Button>
              </div>
             </div>

             {/* O endereço como CONHECIMENTO: o conteúdo vira documento na base do agente,
                 e não texto de um prompt. É outra coisa da escolha acima — e as duas
                 convivem. */}
             <details style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }} data-testid="agent-source-web">
               <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--text-muted)' }}>
                 Manter na base de conhecimento{linha.refreshMode !== 'manual' ? ' · ligado' : ''}
               </summary>
               <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                 <Field label="Atualizar" hint="Ler o site e guardar o conteúdo na base deste agente.">
                   <Select
                     value={linha.refreshMode}
                     onChange={(e) => alterar(linha.id, { refreshMode: e.target.value as RefreshMode })}
                     data-testid="agent-source-refresh-mode"
                     options={ATUALIZACAO_OPCOES}
                   />
                 </Field>
                 {(linha.refreshMode === 'scheduled' || linha.refreshMode === 'hybrid') && (
                   <Field label="Com que frequência">
                     <Select
                       value={String(linha.intervalMinutes)}
                       onChange={(e) => alterar(linha.id, { intervalMinutes: Number(e.target.value) })}
                       data-testid="agent-source-interval"
                       options={INTERVALO_OPCOES}
                     />
                   </Field>
                 )}
                 {(linha.refreshMode === 'on_demand' || linha.refreshMode === 'hybrid') && (
                   <Field label="Considerar velho depois de" hint="Antes de usar o agente, relê só se passou disso.">
                     <Select
                       value={String(linha.maxStalenessMinutes)}
                       onChange={(e) => alterar(linha.id, { maxStalenessMinutes: Number(e.target.value) })}
                       data-testid="agent-source-staleness"
                       options={INTERVALO_OPCOES.map((o) => ({ value: o.value, label: o.label.replace('a cada ', '').replace('uma vez por dia', '1 dia') }))}
                     />
                   </Field>
                 )}
                 {linha.refreshMode !== 'manual' && (
                   <>
                     <Field label="O que ler">
                       <Select
                         value={linha.discoveryMode}
                         onChange={(e) => alterar(linha.id, { discoveryMode: e.target.value as DiscoveryMode })}
                         data-testid="agent-source-discovery"
                         options={DESCOBERTA_OPCOES}
                       />
                     </Field>
                     {(linha.discoveryMode === 'listing' || linha.discoveryMode === 'auto') && (
                       <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-body)' }}>
                         <input
                           type="checkbox"
                           checked={linha.crawlArticles}
                           onChange={(e) => alterar(linha.id, { crawlArticles: e.target.checked })}
                           data-testid="agent-source-crawl"
                         />
                         Seguir os links desta página (até {linha.maxArticlesPerRun} por leitura, mesmo domínio)
                       </label>
                     )}
                   </>
                 )}
                 {/* O que aconteceu de verdade — sem isto, "atualização automática" é
                     promessa sem recibo. */}
                 {linha.status && linha.status !== 'never_run' && (
                   <p style={{ margin: 0, fontSize: 12, color: linha.lastError ? 'var(--coral-600)' : 'var(--text-muted)' }} data-testid="agent-source-status">
                     {linha.lastError
                       ? `Última tentativa falhou: ${linha.lastError}`
                       : `Última leitura: ${linha.lastSuccessfulFetchAt ? new Date(linha.lastSuccessfulFetchAt).toLocaleString('pt-BR') : '—'}`}
                     {linha.nextScheduledAt ? ` · próxima: ${new Date(linha.nextScheduledAt).toLocaleString('pt-BR')}` : ''}
                   </p>
                 )}
               </div>
             </details>

             {/* A escolha que decide o custo — por endereço, porque um blog institucional
                 e uma página de preços não merecem a mesma regra. */}
             <div style={{ display: 'grid', gap: 8, gridTemplateColumns: linha.kind === 'rss' ? '2fr 1fr' : '1fr' }}>
               <Field label="Quando consultar">
                 <Select
                   value={linha.when}
                   onChange={(e) => alterar(linha.id, { when: e.target.value as Quando })}
                   data-testid="agent-source-when"
                   aria-label="Quando consultar"
                   options={QUANDO_OPCOES}
                 />
               </Field>
               {linha.kind === 'rss' && (
                 <Field label="Olhar para trás">
                   <Select
                     value={linha.initialWindow}
                     onChange={(e) => alterar(linha.id, { initialWindow: e.target.value as '24h' | '3d' | '7d' })}
                     data-testid="agent-source-window"
                     aria-label="Janela do feed"
                     options={JANELA_OPCOES}
                   />
                 </Field>
               )}
             </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              disabled={proprias.length >= cfg.maxSources}
              onClick={() => {
                setSalvo(false)
                setProprias((antes) => [
                  ...antes,
                  {
                    id: `novo-${antes.length}-${Date.now()}`,
                    name: '',
                    kind: 'http',
                    url: '',
                    when: 'on_demand',
                    initialWindow: '7d',
                    // Nasce sem ler nada sozinho: quem liga a atualização automática é o
                    // dono, sabendo o que ela custa.
                    refreshMode: 'manual',
                    intervalMinutes: 30,
                    maxStalenessMinutes: 30,
                    discoveryMode: 'auto',
                    crawlArticles: false,
                    maxArticlesPerRun: 5,
                    sameDomainOnly: true,
                  },
                ])
              }}
              data-testid="agent-source-add"
            >
              Adicionar endereço
            </Button>
            <Button onClick={() => void salvar()} disabled={salvando} data-testid="agent-sources-save">
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
            {/* "Atualizar agora": lê os endereços já salvos e diz o que mudou. Existe
                porque `manual` é um modo de verdade — e porque em qualquer modo alguém
                quer ver o efeito antes de esperar o relógio. */}
            {proprias.some((l) => l.url.trim()) && (
              <Button variant="secondary" onClick={() => void atualizarAgora()} disabled={atualizando} data-testid="agent-sources-refresh">
                {atualizando ? 'Lendo…' : 'Atualizar agora'}
              </Button>
            )}
            {resumo && (
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="agent-sources-refresh-result">
                {resumo}
              </span>
            )}
            {salvo && (
              <span style={{ fontSize: 13, color: 'var(--emerald-700, #067647)' }} data-testid="agent-sources-saved">
                Salvo
              </span>
            )}
            {erro && (
              <span style={{ fontSize: 13, color: 'var(--coral-600, #d92d20)' }} data-testid="agent-sources-error">
                {erro}
              </span>
            )}
            {proprias.length >= cfg.maxSources && (
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Máximo de {cfg.maxSources}.</span>
            )}
          </div>
        </div>
      )}

      {/* --- os limites, que são de quem paga ------------------------------------- */}
      {!carregando && (
        <details style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }} data-testid="agent-sources-settings">
          <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--text-muted)' }}>
            Limites e como o agente enxerga a ferramenta
          </summary>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 10 }}>
            <Field label="Itens por consulta" hint="1 a 30">
              <Input
                type="number"
                value={String(cfg.maxItems)}
                onChange={(e) => {
                  setSalvo(false)
                  setCfg((c) => ({ ...c, maxItems: Number(e.target.value) }))
                }}
                data-testid="agent-sources-max-items"
              />
            </Field>
            <Field label="Caracteres por consulta" hint="200 a 20000">
              <Input
                type="number"
                value={String(cfg.charBudget)}
                onChange={(e) => {
                  setSalvo(false)
                  setCfg((c) => ({ ...c, charBudget: Number(e.target.value) }))
                }}
                data-testid="agent-sources-budget"
              />
            </Field>
            <Field label="Endereços por agente" hint="1 a 20">
              <Input
                type="number"
                value={String(cfg.maxSources)}
                onChange={(e) => {
                  setSalvo(false)
                  setCfg((c) => ({ ...c, maxSources: Number(e.target.value) }))
                }}
                data-testid="agent-sources-max-sources"
              />
            </Field>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <Field
              label="Nome da ferramenta"
              hint="Como o agente a enxerga. Só letras, números, _ e - — o resto é convertido ao salvar."
            >
              <Input
                value={cfg.toolName}
                onChange={(e) => {
                  setSalvo(false)
                  setCfg((c) => ({ ...c, toolName: e.target.value }))
                }}
                placeholder="verificar_fonte"
                data-testid="agent-sources-tool-name"
              />
            </Field>
            <Field label="Quando ele deve consultar" hint="Escrito para o agente ler. Vazio usa o texto padrão.">
              <Input
                value={cfg.toolDescription}
                onChange={(e) => {
                  setSalvo(false)
                  setCfg((c) => ({ ...c, toolDescription: e.target.value }))
                }}
                placeholder="Use quando perguntarem sobre novidades, preços ou estoque."
                data-testid="agent-sources-tool-description"
              />
            </Field>
          </div>
        </details>
      )}

      {deRotinas.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }} data-testid="agent-sources-routines">
          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
            Vindos de rotinas — o agente também pode consultá-los sob demanda
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
            {deRotinas.map((s) => (
              <li key={s.routineId} style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
                {s.name} <span>· {s.kind === 'rss' ? 'feed' : 'página'}{s.host ? ` · ${s.host}` : ''}</span>
              </li>
            ))}
          </ul>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
            O horário deles fica em <Link to={fluxos} style={{ color: 'var(--intent-brand)' }}>Fluxos</Link>. Consultar aqui
            não consome o alerta da rotina.
          </p>
        </div>
      )}
    </Card>
  )
}
