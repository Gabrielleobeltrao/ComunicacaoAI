import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { Badge, Button, Card, Field, Input, Select, Tabs } from '../ui'
import * as api from '../lib/monitoring'
import { HEALTH_LABEL, KIND_LABEL, STATUS_LABEL, desde, frase } from '../lib/monitoring'
import type { OverviewItem, SourceKind, SourceSummary, TestOutcome } from '../lib/monitoring'
import * as mon from '../lib/monitors'
import type * as mon2 from '../lib/monitoring'
import { useActivityPulse } from '../lib/activity'

// A CENTRAL DE MONITORAMENTO — cinco perguntas, uma tela.
//
// Antes disso, monitorar acontecia em cinco lugares: WebSocket no App, webhook nos Flows,
// páginas no agente, fontes ao vivo num módulo, dataset em Databases. Quem queria saber "o
// que este escritório está vigiando?" abria cinco telas e juntava de cabeça.
//
// As abas não são categorias: são as perguntas que alguém faz, na ordem em que faz.
// "Está tudo bem?" (visão geral), "de onde vem?" (fontes), "o que dispara?" (monitores),
// "o que está chegando agora?" (ao vivo) e "o que aconteceu?" (histórico).

type Aba = 'overview' | 'sources' | 'monitors' | 'live' | 'history'

const TOM: Record<api.SourceHealth, 'success' | 'danger' | 'warning' | 'neutral'> = {
  online: 'success',
  degraded: 'danger',
  paused: 'warning',
  never_read: 'neutral',
}

export function MonitoringCenter() {
  const [params, setParams] = useSearchParams()
  const aba = ((params.get('tab') as Aba) ?? 'overview') as Aba
  const [visao, setVisao] = useState<{ items: OverviewItem[]; summary: Record<string, number> } | null>(null)
  const [fontes, setFontes] = useState<SourceSummary[] | null>(null)
  const [aoVivo, setAoVivo] = useState<mon2.LiveSource[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [wizard, setWizard] = useState(false)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      if (aba === 'overview') setVisao(await api.overview())
      if (aba === 'live') setAoVivo(await api.live())
      if (aba === 'sources' || aba === 'monitors' || aba === 'history') setFontes(await api.listSources())
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [aba])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // O "ao vivo" usa o socket que já existe: um evento significa que algo andou.
  useActivityPulse(() => {
    if (aba === 'overview' || aba === 'live') void carregar()
  })

  const acao = async <T,>(fn: () => Promise<T>, mensagem?: string | ((r: T) => string)) => {
    setErro(null)
    setAviso(null)
    try {
      const r = await fn()
      // A mensagem pode depender do RESULTADO — "coletei" e "não mudou nada" são
      // notícias diferentes, e avisar sempre a mesma coisa mente sobre o que aconteceu.
      if (mensagem) setAviso(typeof mensagem === 'function' ? mensagem(r) : mensagem)
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  const trocar = (nova: Aba) => {
    const p = new URLSearchParams(params)
    p.set('tab', nova)
    setParams(p, { replace: true })
  }

  return (
    <AppLayout current="/monitoring" title="Central de Monitoramento" subtitle="O que o escritório vigia, de onde vem e o que dispara">
      <div className="flex flex-col gap-3">
        <Tabs
          value={aba}
          onChange={(v) => trocar(v as Aba)}
          tabs={[
            { value: 'overview', label: 'Visão geral' },
            { value: 'sources', label: 'Fontes' },
            { value: 'monitors', label: 'Monitores' },
            { value: 'live', label: 'Ao vivo' },
            { value: 'history', label: 'Histórico' },
          ]}
        />

        {erro && (
          <Card>
            <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger)' }} data-testid="monitoring-error">
              {erro}
            </p>
          </Card>
        )}
        {aviso && (
          <Card>
            <p role="status" style={{ fontSize: 13 }} data-testid="monitoring-aviso">
              {aviso}
            </p>
          </Card>
        )}

        {aba === 'overview' && <VisaoGeral visao={visao} />}

        {aba === 'sources' && (
          <>
            {!wizard && (
              <div>
                <Button onClick={() => setWizard(true)} data-testid="fonte-nova">
                  Nova fonte
                </Button>
              </div>
            )}
            {wizard && (
              <Wizard
                onCancel={() => setWizard(false)}
                onDone={async (mensagem) => {
                  setWizard(false)
                  setAviso(mensagem)
                  await carregar()
                }}
                onError={setErro}
              />
            )}
            <ListaDeFontes fontes={fontes} acao={acao} />
          </>
        )}

        {aba === 'monitors' && <AbaMonitores fontes={fontes} />}
        {aba === 'live' && <AoVivo fontes={aoVivo} />}
        {aba === 'history' && <Historico fontes={fontes} />}
      </div>
    </AppLayout>
  )
}

// --- visão geral -----------------------------------------------------------------------

function VisaoGeral({ visao }: { visao: { items: OverviewItem[]; summary: Record<string, number> } | null }) {
  if (!visao) return null
  if (visao.items.length === 0) {
    return (
      <Card>
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
          Nenhuma fonte ainda. Uma fonte é de onde o dado vem — uma API, uma página, um evento — e é ela que alimenta os monitores.
        </p>
      </Card>
    )
  }
  return (
    <>
      <Card>
        <div className="flex flex-wrap gap-3" data-testid="monitoring-resumo">
          {(['online', 'degraded', 'paused', 'neverRead'] as const).map((k) => (
            <div key={k} style={{ minWidth: 92 }}>
              <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{visao.summary[k] ?? 0}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {k === 'online' ? 'no ar' : k === 'degraded' ? 'degradadas' : k === 'paused' ? 'pausadas' : 'nunca leram'}
              </div>
            </div>
          ))}
        </div>
      </Card>
      {visao.items.map((item) => (
        <Card key={item.id}>
          <div className="flex flex-col gap-1" data-testid="monitoring-item">
            <div className="flex flex-wrap items-center gap-2">
              <strong style={{ fontSize: 15 }}>{item.name}</strong>
              <Badge tone={TOM[item.health]}>{HEALTH_LABEL[item.health]}</Badge>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{frase(item)}</p>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {item.nextReadAt ? `Próxima leitura ${desde(item.nextReadAt)}` : 'Chega sozinha: não tem próxima leitura'}
              {item.readsFailed > 0 ? ` · ${item.readsFailed} falhas` : ''}
            </p>
          </div>
        </Card>
      ))}
    </>
  )
}

// --- fontes ----------------------------------------------------------------------------

/** A ação da lista: a mensagem pode ser fixa ou vir do resultado da chamada. */
type Acao = <T>(fn: () => Promise<T>, m?: string | ((r: T) => string)) => Promise<void>

function ListaDeFontes({ fontes, acao }: { fontes: SourceSummary[] | null; acao: Acao }) {
  if (!fontes) return null
  if (fontes.length === 0) {
    return (
      <Card>
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Nenhuma fonte cadastrada.</p>
      </Card>
    )
  }
  return (
    <>
      {fontes.map((f) => (
        <Card key={f.id}>
          <div className="flex flex-col gap-2" data-testid="fonte-item">
            <div className="flex flex-wrap items-center gap-2">
              <strong style={{ fontSize: 15 }}>{f.name}</strong>
              <Badge tone="neutral">{KIND_LABEL[f.kind]}</Badge>
              <Badge tone={f.status === 'active' ? 'success' : f.status === 'paused' ? 'warning' : 'neutral'}>{STATUS_LABEL[f.status]}</Badge>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {f.mapping.fields.map((c) => c.to).join(', ')} · {f.destination.history ? 'histórico' : ''}
              {f.destination.history && f.destination.live ? ' e ' : ''}
              {f.destination.live ? 'ao vivo' : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => acao(() => api.testSource(f.id), 'Fonte testada.')} data-testid="fonte-testar">
                Testar
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  acao(
                    () => api.readNow(f.id),
                    (r) =>
                      r.unchanged
                        ? 'Coletado. Nada mudou desde a última leitura, então nada foi gravado.'
                        : `Coletado: ${r.rows} ${r.rows === 1 ? 'linha lida' : 'linhas lidas'}, ${r.recorded} ${r.recorded === 1 ? 'gravada' : 'gravadas'}.`,
                  )
                }
                data-testid="fonte-coletar"
              >
                Coletar agora
              </Button>
              {f.status !== 'active' && (
                <Button onClick={() => acao(() => api.activate(f.id), 'Fonte ativada.')} data-testid="fonte-ativar">
                  Ativar
                </Button>
              )}
              {f.status === 'active' && (
                <Button variant="ghost" onClick={() => acao(() => api.pause(f.id), 'Fonte pausada.')} data-testid="fonte-pausar">
                  Pausar
                </Button>
              )}
              <Button variant="ghost" onClick={() => acao(() => api.duplicate(f.id), 'Fonte duplicada como rascunho.')} data-testid="fonte-duplicar">
                Duplicar
              </Button>
              <Button
                variant="ghost"
                onClick={() => acao(() => api.remove(f.id), 'Fonte excluída. O histórico que ela gravou continua.')}
                data-testid="fonte-excluir"
              >
                Excluir
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </>
  )
}

// --- o wizard --------------------------------------------------------------------------

/**
 * O QUE CADA TIPO REALMENTE TEM — a mesma união discriminada do backend.
 *
 * O wizard antigo mandava `url + GET + intervalo` para os nove tipos. Uma fonte de
 * webhook não tem endereço para consultar, e o servidor recusava a criação inteira por
 * causa de um campo que o formulário mandou sozinho: dava para escolher "Webhook" no
 * primeiro passo e descobrir no último que aquele caminho nunca funcionou.
 *
 * Aqui cada tipo diz o que pede. O que não pertence ao tipo não é enviado — e o que o
 * backend recusa continua sendo recusado lá, que é onde a decisão vale.
 */
const CAPACIDADES: Record<SourceKind, { puxa: boolean; endereco: boolean; cabecalhos: boolean; instalacao: boolean }> = {
  api_polling: { puxa: true, endereco: true, cabecalhos: true, instalacao: false },
  rss: { puxa: true, endereco: true, cabecalhos: true, instalacao: false },
  http_page: { puxa: true, endereco: true, cabecalhos: true, instalacao: false },
  browser: { puxa: true, endereco: true, cabecalhos: false, instalacao: false },
  app_action: { puxa: true, endereco: false, cabecalhos: false, instalacao: true },
  dataset: { puxa: true, endereco: false, cabecalhos: false, instalacao: false },
  webhook: { puxa: false, endereco: false, cabecalhos: false, instalacao: false },
  websocket: { puxa: false, endereco: false, cabecalhos: false, instalacao: true },
  internal_event: { puxa: false, endereco: false, cabecalhos: false, instalacao: false },
}

/** Por que este tipo não pode ser testado antes de existir. Dito, não escondido. */
const SEM_TESTE: Partial<Record<SourceKind, string>> = {
  webhook: 'Um webhook não é consultado: ele chega. O teste real é o primeiro envio, e o endereço só existe depois que a fonte é criada.',
  websocket: 'Um fluxo é testado conectando, e a conexão só abre depois que a fonte é ativada.',
  internal_event: 'Um evento da plataforma acontece quando acontece. Não há o que consultar agora.',
}

interface Cfg {
  url: string
  method: 'GET' | 'POST'
  body: string
  query: { key: string; value: string }[]
  headerNames: string
  paginacao: 'none' | 'cursor' | 'page'
  cursorPath: string
  pageParam: string
  maxPages: number
  selector: string
  strategy: ('json' | 'jsonld' | 'dom' | 'browser' | 'vision')[]
  protocol: 'websocket' | 'sse'
  subscriptions: string
  heartbeatMs: number
  installationId: string
  appKey: string
  actionKey: string
  dataStoreId: string
  datasetKey: string
  eventType: string
  script: string
}

const CFG_VAZIA: Cfg = {
  url: '',
  method: 'GET',
  body: '',
  query: [],
  headerNames: '',
  paginacao: 'none',
  cursorPath: '',
  pageParam: 'page',
  maxPages: 5,
  selector: '',
  strategy: ['json', 'jsonld', 'dom', 'browser'],
  protocol: 'sse',
  subscriptions: '',
  heartbeatMs: 30_000,
  installationId: '',
  appKey: '',
  actionKey: '',
  dataStoreId: '',
  datasetKey: '',
  eventType: '',
  script: '',
}

const lista = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

/** A configuração do TIPO, e só dela. É esta função que o passo de revisão também lê. */
function configDoTipo(kind: SourceKind, c: Cfg): Record<string, unknown> {
  const script = c.script.trim() ? { extractScript: { version: 1, source: c.script } } : {}
  switch (kind) {
    case 'api_polling':
      return {
        url: c.url,
        method: c.method,
        ...(c.query.length ? { query: c.query.filter((q) => q.key) } : {}),
        ...(c.method === 'POST' && c.body.trim() ? { body: c.body } : {}),
        ...(c.headerNames.trim() ? { headerNames: lista(c.headerNames) } : {}),
        pagination:
          c.paginacao === 'cursor'
            ? { kind: 'cursor', cursorPath: c.cursorPath, maxPages: c.maxPages }
            : c.paginacao === 'page'
              ? { kind: 'page', pageParam: c.pageParam, maxPages: c.maxPages }
              : { kind: 'none' },
        ...script,
      }
    case 'rss':
      return { url: c.url, ...(c.headerNames.trim() ? { headerNames: lista(c.headerNames) } : {}), ...script }
    case 'http_page':
      return {
        url: c.url,
        ...(c.headerNames.trim() ? { headerNames: lista(c.headerNames) } : {}),
        ...(c.selector.trim() ? { selector: c.selector } : {}),
        ...script,
      }
    case 'browser':
      return { url: c.url, ...(c.selector.trim() ? { selector: c.selector } : {}), strategy: c.strategy, ...script }
    case 'webhook':
      return {}
    case 'websocket':
      return {
        protocol: c.protocol,
        ...(c.protocol === 'sse' ? { url: c.url } : { installationId: c.installationId }),
        ...(c.subscriptions.trim() ? { subscriptions: lista(c.subscriptions) } : {}),
        heartbeatMs: c.heartbeatMs,
      }
    case 'app_action':
      return { appKey: c.appKey, actionKey: c.actionKey, installationId: c.installationId }
    case 'dataset':
      return { dataStoreId: c.dataStoreId, datasetKey: c.datasetKey }
    case 'internal_event':
      return { eventType: c.eventType }
  }
}

function Wizard({ onCancel, onDone, onError }: { onCancel: () => void; onDone: (m: string) => Promise<void>; onError: (m: string) => void }) {
  const [passo, setPasso] = useState(0)
  const [kind, setKind] = useState<SourceKind>('api_polling')
  const [name, setName] = useState('')
  const [cfg, setCfg] = useState<Cfg>(CFG_VAZIA)
  const [avancado, setAvancado] = useState(false)
  const [ritmo, setRitmo] = useState<'interval' | 'cron'>('interval')
  const [intervalMs, setIntervalMs] = useState(60_000)
  const [cron, setCron] = useState('0 9 * * *')
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const [campos, setCampos] = useState<api.FieldRule[]>([{ to: 'valor', from: '' }])
  const [destino, setDestino] = useState({ live: false, history: true })
  const [teste, setTeste] = useState<TestOutcome | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [conexoes, setConexoes] = useState<api.ConnectionOption[]>([])
  const [connectionId, setConnectionId] = useState('')
  const [criarMonitor, setCriarMonitor] = useState(false)
  const [monitorNome, setMonitorNome] = useState('')
  const [monitorCampo, setMonitorCampo] = useState('')
  const [monitorOp, setMonitorOp] = useState<mon.ComparisonOp>('lt')
  const [monitorValor, setMonitorValor] = useState('')

  const cap = CAPACIDADES[kind]

  // Os passos do TIPO. Perguntar "qual conexão" a uma fonte que não autentica é um passo
  // vazio que a pessoa aprende a atravessar sem ler — e aí ela atravessa os outros também.
  const passos = [
    'Tipo',
    ...(cap.cabecalhos || cap.instalacao ? ['Conexão'] : []),
    'Configuração',
    'Mapeamento',
    'Teste',
    'Destino',
    'Revisão',
  ]
  const nomeDoPasso = passos[Math.min(passo, passos.length - 1)]

  useEffect(() => {
    void api.connections().then(setConexoes)
  }, [])

  // Trocar de tipo zera o que era do tipo anterior: um `selector` sobrando numa fonte de
  // dataset seria recusado pelo servidor sem que ninguém tivesse digitado nada ali.
  const trocarTipo = (k: SourceKind) => {
    setKind(k)
    setCfg(CFG_VAZIA)
    setConnectionId('')
    setTeste(null)
    setRitmo('interval')
  }

  const corpo = () => ({
    name,
    kind,
    ...(connectionId ? { connectionId } : {}),
    config: configDoTipo(kind, cfg),
    mapping: { version: 1, fields: campos.filter((c) => c.to && c.from) },
    cadence: cap.puxa ? (ritmo === 'cron' ? { mode: 'cron' as const, cron, timezone } : { mode: 'interval' as const, intervalMs }) : { mode: 'stream' as const },
    destination: destino,
  })

  const testar = async () => {
    setOcupado(true)
    setTeste(null)
    try {
      setTeste(await api.testDraft(corpo()))
    } catch (e) {
      // A recusa do servidor É o resultado do teste: escondê-la num alerta separado faz a
      // pessoa achar que o teste não rodou.
      setTeste({ ok: false, rows: [], sample: null, strategy: 'none', missing: [], fields: [], latencyMs: 0, status: null, error: { kind: 'refused', message: (e as Error).message } })
    } finally {
      setOcupado(false)
    }
  }

  const salvar = async () => {
    setOcupado(true)
    try {
      const fonte = await api.createSource(corpo())
      if (!criarMonitor) {
        await onDone('Fonte criada como rascunho. Teste e ative quando estiver certa.')
        return
      }
      /**
       * O monitor é criado DE VERDADE, e a mensagem só fala dele depois da resposta.
       *
       * A versão anterior só ligava um booleano local e avisava "um monitor foi criado":
       * quem ia procurá-lo na outra aba não encontrava nada.
       */
      const n = Number(monitorValor)
      const m = await api.createMonitorForSource(fonte.id, {
        name: monitorNome.trim() || `${name} — ${monitorCampo} ${mon.OP_LABEL[monitorOp]} ${monitorValor}`,
        condition: { kind: 'compare', field: monitorCampo, op: monitorOp, value: Number.isFinite(n) && monitorValor !== '' ? n : monitorValor },
        triggerMode: 'enter',
        debounceMs: 0,
        cooldownMs: 0,
        flowId: null,
      })
      await onDone(`Fonte criada como rascunho, e o monitor ${m.id} nasceu em rascunho junto. Publique-o na aba Monitores quando estiver certo.`)
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const monitorIncompleto = criarMonitor && (!monitorCampo || monitorValor === '')

  const campoUrl = (rotulo: string, dica: string, placeholder: string) => (
    <Field label={rotulo} hint={dica}>
      <Input value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} placeholder={placeholder} data-testid="wizard-url" />
    </Field>
  )

  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="fonte-wizard">
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="wizard-passo">
          Passo {passo + 1} de {passos.length}: {nomeDoPasso}
        </p>

        {nomeDoPasso === 'Tipo' && (
          <>
            <Field label="Nome">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Preço do fornecedor" data-testid="wizard-nome" />
            </Field>
            <Field label="Tipo de fonte" hint="É ele que decide se a plataforma consulta ou se o dado chega sozinho — e quais perguntas vêm a seguir.">
              <Select
                value={kind}
                onChange={(e) => trocarTipo(e.target.value as SourceKind)}
                options={(Object.keys(KIND_LABEL) as SourceKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
                data-testid="wizard-tipo"
              />
            </Field>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="wizard-tipo-explica">
              {cap.puxa ? 'A plataforma consulta esta fonte no ritmo que você escolher.' : 'O dado chega sozinho: não há intervalo a configurar.'}
            </p>
          </>
        )}

        {nomeDoPasso === 'Conexão' && (
          <>
            <Field
              label="Conexão"
              hint="A credencial mora na conexão cifrada. A fonte guarda só o nome do cabeçalho; o valor sai do cofre na hora da leitura."
            >
              <Select value={connectionId} onChange={(e) => setConnectionId(e.target.value)} data-testid="wizard-conexao">
                <option value="">{cap.instalacao ? 'Escolha a conexão' : 'Nenhuma: este endereço é público'}</option>
                {conexoes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.appKey})
                  </option>
                ))}
              </Select>
            </Field>
            {cap.cabecalhos && connectionId && (
              <Field label="Cabeçalhos que a conexão preenche" hint="Só os nomes, separados por vírgula. Nenhum valor é digitado aqui.">
                <Input
                  value={cfg.headerNames}
                  onChange={(e) => setCfg({ ...cfg, headerNames: e.target.value })}
                  placeholder="Authorization"
                  data-testid="wizard-headers"
                />
              </Field>
            )}
            {cap.instalacao && (
              <Field label="Instalação do App" hint="É por ela que o fluxo ou a ação encontra a conta do outro lado.">
                <Select value={cfg.installationId} onChange={(e) => setCfg({ ...cfg, installationId: e.target.value })} data-testid="wizard-instalacao">
                  <option value="">Escolha a instalação</option>
                  {conexoes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.appKey})
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}

        {nomeDoPasso === 'Configuração' && (
          <>
            {kind === 'api_polling' && (
              <>
                {campoUrl('Endereço', 'A credencial nunca vai aqui: ela vem de uma conexão, e a Central recusa chave na URL.', 'https://api.exemplo.com/precos')}
                <Field label="Método">
                  <Select
                    value={cfg.method}
                    onChange={(e) => setCfg({ ...cfg, method: e.target.value as 'GET' | 'POST' })}
                    options={[
                      { value: 'GET', label: 'GET' },
                      { value: 'POST', label: 'POST' },
                    ]}
                    data-testid="wizard-metodo"
                  />
                </Field>
                {cfg.method === 'POST' && (
                  <Field label="Corpo do pedido" hint="JSON enviado a cada leitura. Segredo aqui é recusado.">
                    <Input value={cfg.body} onChange={(e) => setCfg({ ...cfg, body: e.target.value })} data-testid="wizard-corpo" />
                  </Field>
                )}
              </>
            )}

            {kind === 'rss' && campoUrl('Endereço do feed', 'RSS ou Atom. A Central analisa o XML sem executar nada dele.', 'https://exemplo.com/feed.xml')}

            {kind === 'http_page' && (
              <>
                {campoUrl('Endereço da página', 'A leitura tenta JSON, JSON-LD e seletor, nesta ordem — do mais barato ao mais caro.', 'https://exemplo.com/produto')}
                <Field label="Seletor CSS" hint="Opcional: o pedaço da página que interessa. Sem ele, a leitura tenta os formatos estruturados.">
                  <Input value={cfg.selector} onChange={(e) => setCfg({ ...cfg, selector: e.target.value })} placeholder=".preco" data-testid="wizard-seletor" />
                </Field>
              </>
            )}

            {kind === 'browser' && (
              <>
                {campoUrl('Endereço da página', 'Renderizada num worker isolado, sem sessão e sem contornar login ou CAPTCHA.', 'https://exemplo.com/painel')}
                <Field label="Seletor CSS" hint="O pedaço que interessa depois de a página montar.">
                  <Input value={cfg.selector} onChange={(e) => setCfg({ ...cfg, selector: e.target.value })} placeholder="#saldo" data-testid="wizard-seletor" />
                </Field>
                <Field label="Como ler" hint="Do mais barato ao mais caro. A visão é palpite, e por isso entra só quando escolhida.">
                  <div className="flex flex-wrap gap-2">
                    {(['json', 'jsonld', 'dom', 'browser', 'vision'] as const).map((e) => (
                      <Button
                        key={e}
                        variant={cfg.strategy.includes(e) ? 'primary' : 'ghost'}
                        onClick={() =>
                          setCfg({ ...cfg, strategy: cfg.strategy.includes(e) ? cfg.strategy.filter((x) => x !== e) : [...cfg.strategy, e] })
                        }
                        data-testid={`wizard-estrategia-${e}`}
                      >
                        {e === 'browser' ? 'renderizar' : e === 'vision' ? 'visão (imagem)' : e}
                      </Button>
                    ))}
                  </div>
                </Field>
                {cfg.strategy.includes('vision') && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="wizard-visao-aviso">
                    A visão só grava quando a confiança é alta e a evidência confere. Um número lido de uma imagem com dúvida não vira registro.
                  </p>
                )}
              </>
            )}

            {kind === 'webhook' && (
              <p style={{ fontSize: 13 }} data-testid="wizard-webhook-explica">
                Nada a configurar aqui: o endereço e o segredo são gerados pelo servidor quando a fonte é criada. O segredo aparece uma única vez.
              </p>
            )}

            {kind === 'websocket' && (
              <>
                <Field label="Protocolo" hint="Dito, e não adivinhado pela URL: uma API que fala os dois se comportaria diferente em produção.">
                  <Select
                    value={cfg.protocol}
                    onChange={(e) => setCfg({ ...cfg, protocol: e.target.value as 'websocket' | 'sse' })}
                    options={[
                      { value: 'sse', label: 'SSE (fluxo por HTTP)' },
                      { value: 'websocket', label: 'WebSocket (pelo App conectado)' },
                    ]}
                    data-testid="wizard-protocolo"
                  />
                </Field>
                {cfg.protocol === 'sse' && campoUrl('Endereço do fluxo', 'O SSE é lido por HTTP: este é o endereço que fica aberto.', 'https://api.exemplo.com/stream')}
                <Field label="Assinaturas" hint="Os canais ou tópicos que interessam, separados por vírgula.">
                  <Input value={cfg.subscriptions} onChange={(e) => setCfg({ ...cfg, subscriptions: e.target.value })} data-testid="wizard-assinaturas" />
                </Field>
                <Field label="Silêncio máximo (s)" hint="Silêncio além disso é conexão morta, mesmo sem erro nenhum.">
                  <Input
                    type="number"
                    min={5}
                    value={Math.round(cfg.heartbeatMs / 1000)}
                    onChange={(e) => setCfg({ ...cfg, heartbeatMs: Math.max(5, Number(e.target.value)) * 1000 })}
                    data-testid="wizard-heartbeat"
                  />
                </Field>
              </>
            )}

            {kind === 'app_action' && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Field label="App" style={{ flex: 1 }}>
                  <Input value={cfg.appKey} onChange={(e) => setCfg({ ...cfg, appKey: e.target.value })} placeholder="crm" data-testid="wizard-appkey" />
                </Field>
                <Field label="Ação" style={{ flex: 1 }}>
                  <Input value={cfg.actionKey} onChange={(e) => setCfg({ ...cfg, actionKey: e.target.value })} placeholder="listar_pedidos" data-testid="wizard-acao" />
                </Field>
              </div>
            )}

            {kind === 'dataset' && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Field label="Database" style={{ flex: 1 }}>
                  <Input value={cfg.dataStoreId} onChange={(e) => setCfg({ ...cfg, dataStoreId: e.target.value })} data-testid="wizard-datastore" />
                </Field>
                <Field label="Conjunto de dados" style={{ flex: 1 }}>
                  <Input value={cfg.datasetKey} onChange={(e) => setCfg({ ...cfg, datasetKey: e.target.value })} data-testid="wizard-dataset" />
                </Field>
              </div>
            )}

            {kind === 'internal_event' && (
              <Field label="Tipo do evento" hint="O que já acontece dentro da plataforma e vale guardar como série.">
                <Input value={cfg.eventType} onChange={(e) => setCfg({ ...cfg, eventType: e.target.value })} placeholder="flow.finished" data-testid="wizard-evento" />
              </Field>
            )}

            {cap.puxa && (
              <>
                <Field label="Ritmo" hint="Intervalo é “de tantos em tantos”; horário é “às nove da manhã”. São perguntas diferentes.">
                  <Select
                    value={ritmo}
                    onChange={(e) => setRitmo(e.target.value as 'interval' | 'cron')}
                    options={[
                      { value: 'interval', label: 'a cada X segundos' },
                      { value: 'cron', label: 'em horários fixos' },
                    ]}
                    data-testid="wizard-ritmo"
                  />
                </Field>
                {ritmo === 'interval' ? (
                  <Field label="A cada quantos segundos">
                    <Input
                      type="number"
                      min={15}
                      value={Math.round(intervalMs / 1000)}
                      onChange={(e) => setIntervalMs(Math.max(15, Number(e.target.value)) * 1000)}
                      data-testid="wizard-intervalo"
                    />
                  </Field>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Field label="Horário (cron)" hint="Cinco campos: minuto, hora, dia, mês, dia da semana." style={{ flex: 1 }}>
                      <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 9 * * *" data-testid="wizard-cron" />
                    </Field>
                    <Field label="Fuso" hint="O seu, não o do servidor: 9h aqui é 9h aqui." style={{ flex: 1 }}>
                      <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} data-testid="wizard-fuso" />
                    </Field>
                  </div>
                )}
              </>
            )}

            <div>
              <Button variant="ghost" onClick={() => setAvancado(!avancado)} data-testid="wizard-avancado">
                {avancado ? 'Esconder opções avançadas' : 'Opções avançadas'}
              </Button>
            </div>

            {avancado && (
              <>
                {kind === 'api_polling' && (
                  <>
                    <Field label="Paginação" hint="Sem ela, uma resposta paginada entrega só a primeira página e a série fica pela metade.">
                      <Select
                        value={cfg.paginacao}
                        onChange={(e) => setCfg({ ...cfg, paginacao: e.target.value as Cfg['paginacao'] })}
                        options={[
                          { value: 'none', label: 'a resposta vem inteira' },
                          { value: 'cursor', label: 'por cursor' },
                          { value: 'page', label: 'por número de página' },
                        ]}
                        data-testid="wizard-paginacao"
                      />
                    </Field>
                    {cfg.paginacao === 'cursor' && (
                      <Field label="Caminho do cursor">
                        <Input value={cfg.cursorPath} onChange={(e) => setCfg({ ...cfg, cursorPath: e.target.value })} placeholder="meta.next" data-testid="wizard-cursor" />
                      </Field>
                    )}
                    {cfg.paginacao === 'page' && (
                      <Field label="Parâmetro da página">
                        <Input value={cfg.pageParam} onChange={(e) => setCfg({ ...cfg, pageParam: e.target.value })} data-testid="wizard-pageparam" />
                      </Field>
                    )}
                    {cfg.paginacao !== 'none' && (
                      <Field label="Máximo de páginas" hint="O teto existe para uma paginação sem fim não virar uma leitura sem fim.">
                        <Input
                          type="number"
                          min={1}
                          max={20}
                          value={cfg.maxPages}
                          onChange={(e) => setCfg({ ...cfg, maxPages: Math.min(20, Math.max(1, Number(e.target.value))) })}
                          data-testid="wizard-maxpages"
                        />
                      </Field>
                    )}
                    <Field label="Parâmetros de busca" hint="Chave e valor. Credencial aqui é recusada: ela vem da conexão.">
                      <div className="flex flex-col gap-2">
                        {cfg.query.map((q, i) => (
                          <div key={i} className="flex flex-col gap-2 sm:flex-row">
                            <Input
                              value={q.key}
                              onChange={(e) => setCfg({ ...cfg, query: cfg.query.map((x, j) => (i === j ? { ...x, key: e.target.value } : x)) })}
                              placeholder="limite"
                              data-testid={`wizard-query-key-${i}`}
                            />
                            <Input
                              value={q.value}
                              onChange={(e) => setCfg({ ...cfg, query: cfg.query.map((x, j) => (i === j ? { ...x, value: e.target.value } : x)) })}
                              placeholder="100"
                              data-testid={`wizard-query-value-${i}`}
                            />
                          </div>
                        ))}
                        <div>
                          <Button variant="ghost" onClick={() => setCfg({ ...cfg, query: [...cfg.query, { key: '', value: '' }] })} data-testid="wizard-query-add">
                            Adicionar parâmetro
                          </Button>
                        </div>
                      </div>
                    </Field>
                  </>
                )}
                {(kind === 'api_polling' || kind === 'rss' || kind === 'http_page' || kind === 'browser') && (
                  <Field
                    label="Script de extração"
                    hint="Último recurso, quando o mapeamento não alcança. Roda na sandbox, sobre dado já analisado — nunca sobre HTML cru."
                  >
                    <Input value={cfg.script} onChange={(e) => setCfg({ ...cfg, script: e.target.value })} data-testid="wizard-script" />
                  </Field>
                )}
                {!avancadoTem(kind) && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Este tipo não tem opções avançadas.</p>
                )}
              </>
            )}
          </>
        )}

        {nomeDoPasso === 'Mapeamento' && (
          <>
            <p style={{ fontSize: 13 }} data-testid="wizard-mapeamento-explica">
              Diga o que guardar antes de testar: assim o teste responde “achei o preço” em vez de despejar a resposta inteira e deixar você
              procurar.
            </p>
            {campos.map((c, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row">
                <Field label="Chamar de" style={{ flex: 1 }}>
                  <Input
                    value={c.to}
                    onChange={(e) => setCampos(campos.map((x, j) => (i === j ? { ...x, to: e.target.value } : x)))}
                    data-testid={`wizard-campo-to-${i}`}
                  />
                </Field>
                <Field label="Caminho na resposta" style={{ flex: 1 }}>
                  <Input
                    value={c.from}
                    onChange={(e) => setCampos(campos.map((x, j) => (i === j ? { ...x, from: e.target.value } : x)))}
                    placeholder="dados.preco"
                    data-testid={`wizard-campo-from-${i}`}
                  />
                </Field>
              </div>
            ))}
            <div>
              <Button variant="ghost" onClick={() => setCampos([...campos, { to: '', from: '' }])} data-testid="wizard-campo-add">
                Mapear outro campo
              </Button>
            </div>
          </>
        )}

        {nomeDoPasso === 'Teste' && (
          <>
            {SEM_TESTE[kind] ? (
              <p style={{ fontSize: 13 }} data-testid="wizard-sem-teste">
                {SEM_TESTE[kind]}
              </p>
            ) : (
              <>
                <Button onClick={testar} disabled={ocupado} data-testid="wizard-testar">
                  {ocupado ? 'Lendo…' : 'Testar de verdade'}
                </Button>
                {teste && !teste.ok && (
                  <div className="flex flex-col gap-1">
                    <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger)' }} data-testid="wizard-teste-erro">
                      {teste.error?.message}
                      {teste.status ? ` (o servidor respondeu ${teste.status})` : ''}
                    </p>
                    <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      Volte um passo para corrigir o endereço ou o mapeamento. Nada é gravado enquanto o teste não passa.
                    </p>
                  </div>
                )}
                {teste?.ok && (
                  <div className="flex flex-col gap-1" data-testid="wizard-amostra">
                    <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      Leu em {teste.latencyMs} ms pela estratégia {teste.strategy}
                      {teste.status ? `, com status ${teste.status}` : ''}. Credenciais aparecem como «oculto».
                    </p>
                    <p style={{ fontSize: 13 }} data-testid="wizard-campos-achados">
                      {teste.fields.filter((f) => f.present).length
                        ? `Achei: ${teste.fields.filter((f) => f.present).map((f) => f.name).join(', ')}.`
                        : 'Nenhum campo do mapeamento foi encontrado nesta resposta.'}
                      {teste.fields.some((f) => !f.present)
                        ? ` Não achei: ${teste.fields.filter((f) => !f.present).map((f) => f.name).join(', ')}.`
                        : ''}
                    </p>
                    <pre
                      style={{ fontSize: 12, overflowX: 'auto', maxHeight: 220, background: 'var(--surface-sunken)', padding: 8, borderRadius: 8, margin: 0 }}
                    >
                      {JSON.stringify(teste.sample, null, 1)}
                    </pre>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {nomeDoPasso === 'Destino' && (
          <Field label="Onde guardar" hint="“Ao vivo” responde “quanto está agora”; “histórico” responde “como variou”.">
            <div className="flex flex-wrap gap-2">
              <Button variant={destino.history ? 'primary' : 'ghost'} onClick={() => setDestino({ ...destino, history: !destino.history })} data-testid="wizard-destino-historico">
                Histórico {destino.history ? '✓' : ''}
              </Button>
              <Button variant={destino.live ? 'primary' : 'ghost'} onClick={() => setDestino({ ...destino, live: !destino.live })} data-testid="wizard-destino-live">
                Ao vivo {destino.live ? '✓' : ''}
              </Button>
            </div>
          </Field>
        )}

        {nomeDoPasso === 'Revisão' && (
          <div style={{ fontSize: 13 }} data-testid="wizard-revisao">
            <p>
              <strong>{name || 'sem nome'}</strong> — {KIND_LABEL[kind]}
            </p>
            <p style={{ color: 'var(--text-muted)' }}>{cfg.url || resumoDaConfig(kind, cfg)}</p>
            <p style={{ color: 'var(--text-muted)' }}>
              {cap.puxa ? (ritmo === 'cron' ? `no horário ${cron} (${timezone})` : `a cada ${Math.round(intervalMs / 1000)} s`) : 'chega sozinha'} · campos:{' '}
              {campos.filter((c) => c.to).map((c) => c.to).join(', ') || '—'}
            </p>
            <p style={{ color: 'var(--text-muted)' }}>
              {connectionId ? 'Usa uma conexão do cofre para autenticar.' : 'Sem credencial: nada é digitado aqui.'}
            </p>
            <p style={{ color: 'var(--text-muted)' }}>Ela nasce como rascunho: nada é consultado até você ativar.</p>
            <div style={{ marginTop: 8 }}>
              <Button
                variant={criarMonitor ? 'primary' : 'ghost'}
                onClick={() => {
                  setCriarMonitor(!criarMonitor)
                  if (!monitorCampo) setMonitorCampo(campos.find((c) => c.to)?.to ?? '')
                }}
                disabled={!destino.history}
                data-testid="wizard-criar-monitor"
              >
                Criar também um monitor em rascunho {criarMonitor ? '✓' : ''}
              </Button>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {destino.history
                  ? 'Ele também nasce rascunho: uma regra que passa a agir sozinha no fim de um wizard é uma regra que ninguém revisou.'
                  : 'Só uma fonte que grava histórico pode ser observada — ligue o histórico no passo anterior.'}
              </p>
            </div>
            {criarMonitor && (
              <div className="flex flex-col gap-2" style={{ marginTop: 8 }} data-testid="wizard-monitor-campos">
                <Field label="Nome do monitor" hint="Em branco, ele recebe um nome a partir da condição.">
                  <Input value={monitorNome} onChange={(e) => setMonitorNome(e.target.value)} data-testid="wizard-monitor-nome" />
                </Field>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Field label="Avisar quando" style={{ flex: 1 }}>
                    <Select value={monitorCampo} onChange={(e) => setMonitorCampo(e.target.value)} data-testid="wizard-monitor-campo">
                      <option value="">Escolha o campo</option>
                      {campos.filter((c) => c.to).map((c) => (
                        <option key={c.to} value={c.to}>
                          {c.to}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Comparação" style={{ flex: 1 }}>
                    <Select
                      value={monitorOp}
                      onChange={(e) => setMonitorOp(e.target.value as mon.ComparisonOp)}
                      options={(Object.keys(mon.OP_LABEL) as mon.ComparisonOp[]).map((o) => ({ value: o, label: mon.OP_LABEL[o] }))}
                      data-testid="wizard-monitor-op"
                    />
                  </Field>
                  <Field label="Valor" style={{ flex: 1 }}>
                    <Input value={monitorValor} onChange={(e) => setMonitorValor(e.target.value)} data-testid="wizard-monitor-valor" />
                  </Field>
                </div>
                {monitorIncompleto && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="wizard-monitor-falta">
                    Escolha o campo e o valor: sem os dois não há condição para criar.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {passo > 0 && (
            <Button variant="ghost" onClick={() => setPasso(passo - 1)} data-testid="wizard-voltar">
              Voltar
            </Button>
          )}
          {passo < passos.length - 1 && (
            <Button onClick={() => setPasso(passo + 1)} data-testid="wizard-avancar">
              Avançar
            </Button>
          )}
          {passo === passos.length - 1 && (
            <Button onClick={salvar} disabled={ocupado || monitorIncompleto} data-testid="wizard-salvar">
              Criar rascunho
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** Tem opção avançada? Só os tipos que leem de um endereço têm o que esconder. */
const avancadoTem = (kind: SourceKind) => kind === 'api_polling' || kind === 'rss' || kind === 'http_page' || kind === 'browser'

/** O que a revisão mostra quando o tipo não tem endereço. */
function resumoDaConfig(kind: SourceKind, c: Cfg): string {
  switch (kind) {
    case 'webhook':
      return 'endereço e segredo gerados na criação'
    case 'app_action':
      return `${c.appKey || 'app'} · ${c.actionKey || 'ação'}`
    case 'dataset':
      return `${c.dataStoreId || 'database'} · ${c.datasetKey || 'conjunto'}`
    case 'internal_event':
      return c.eventType || 'evento da plataforma'
    case 'websocket':
      return c.protocol === 'sse' ? c.url : `WebSocket pela instalação ${c.installationId || '—'}`
    default:
      return ''
  }
}

// --- monitores, ao vivo e histórico -------------------------------------------------------

/**
 * A aba de MONITORES — a condição montada de pedaços fechados, com prévia e simulação.
 *
 * O construtor é de listas, e não de texto livre: o que dispara ação sozinho precisa ser
 * conferível. E a simulação está aqui porque "cruzou 30 para cima" parece óbvio e engana —
 * quem escreve não distingue estado de borda até ver os dois lado a lado.
 */
function AbaMonitores({ fontes }: { fontes: SourceSummary[] | null }) {
  const observaveis = (fontes ?? []).filter((f) => f.destination.history)
  const [fonteId, setFonteId] = useState('')
  const [modo, setModo] = useState<mon.TriggerMode>('enter')
  const [juncao, setJuncao] = useState<'and' | 'or'>('and')
  const [partes, setPartes] = useState<{ field: string; op: mon.ComparisonOp; value: string; delta: boolean; deltaMode: 'absolute' | 'percent' }[]>([
    { field: '', op: 'lt', value: '', delta: false, deltaMode: 'absolute' },
  ])
  const [threshold, setThreshold] = useState('')
  const [thresholdField, setThresholdField] = useState('')
  const [debounceMs, setDebounceMs] = useState(0)
  const [cooldownMs, setCooldownMs] = useState(0)
  const [aoFaltar, setAoFaltar] = useState<'ignore' | 'degrade'>('degrade')
  const [antes, setAntes] = useState<Record<string, string>>({})
  const [agora, setAgora] = useState<Record<string, string>>({})
  const [resultado, setResultado] = useState<mon.SimulationResult | null>(null)
  const [erroSim, setErroSim] = useState<string | null>(null)

  const fonte = observaveis.find((f) => f.id === fonteId)
  const camposDaFonte = fonte?.mapping.fields.map((c) => c.to) ?? []

  const condicao = (): mon.ConditionNode => {
    const folhas = partes
      .filter((p) => p.field)
      .map((p) => {
        const n = Number(p.value)
        // MUDANÇA é outra pergunta: "variou mais que X" compara com o valor anterior, e não
        // com um limite fixo. Misturar as duas na mesma folha faria a prévia mentir.
        if (p.delta) return { kind: 'delta' as const, field: p.field, op: p.op, value: Number.isFinite(n) ? n : 0, mode: p.deltaMode }
        const valor: number | string | boolean = p.value === 'true' ? true : p.value === 'false' ? false : p.value !== '' && Number.isFinite(n) ? n : p.value
        return { kind: 'compare' as const, field: p.field, op: p.op, value: valor }
      })
    if (folhas.length === 0) return { kind: 'compare', field: '', op: 'lt', value: 0 }
    return folhas.length === 1 ? folhas[0] : { kind: juncao, children: folhas }
  }

  const simular = async () => {
    setErroSim(null)
    setResultado(null)
    try {
      const numero = (v: Record<string, string>) =>
        Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : x]))
      setResultado(
        await mon.simulate({
          condition: condicao(),
          triggerMode: modo,
          ...(threshold !== '' ? { threshold: Number(threshold) } : {}),
          ...(thresholdField ? { thresholdField } : {}),
          value: numero(agora),
          previous: Object.keys(antes).length ? numero(antes) : null,
          ...(camposDaFonte.length ? { fields: camposDaFonte } : {}),
        }),
      )
    } catch (e) {
      setErroSim((e as Error).message)
    }
  }

  const campos = mon.camposDaCondicao(condicao())

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3" data-testid="monitor-builder">
          <p style={{ fontSize: 13 }}>
            Um monitor observa o dado que uma fonte já normalizou — ele nunca consulta o serviço lá fora a cada condição.
          </p>

          <Field label="Observar a fonte" hint="Só fontes que gravam histórico podem ser observadas.">
            <Select
              value={fonteId}
              onChange={(e) => setFonteId(e.target.value)}
              data-testid="monitor-fonte"
            >
              <option value="">Escolha uma fonte</option>
              {observaveis.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>

          {partes.map((p, i) => (
            <div key={i} className="flex flex-col gap-2 sm:flex-row">
              <Field label={i === 0 ? 'Campo' : juncao === 'and' ? 'E o campo' : 'Ou o campo'} style={{ flex: 1 }}>
                {camposDaFonte.length ? (
                  <Select
                    value={p.field}
                    onChange={(e) => setPartes(partes.map((x, j) => (i === j ? { ...x, field: e.target.value } : x)))}
                    data-testid={`monitor-campo-${i}`}
                  >
                    <option value="">Escolha</option>
                    {camposDaFonte.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={p.field}
                    onChange={(e) => setPartes(partes.map((x, j) => (i === j ? { ...x, field: e.target.value } : x)))}
                    placeholder="rsi"
                    data-testid={`monitor-campo-${i}`}
                  />
                )}
              </Field>
              <Field label="Comparação" style={{ flex: 1 }}>
                <Select
                  value={p.op}
                  onChange={(e) => setPartes(partes.map((x, j) => (i === j ? { ...x, op: e.target.value as mon.ComparisonOp } : x)))}
                  options={(Object.keys(mon.OP_LABEL) as mon.ComparisonOp[]).map((o) => ({ value: o, label: mon.OP_LABEL[o] }))}
                  data-testid={`monitor-op-${i}`}
                />
              </Field>
              <Field label={p.delta ? 'Variação' : 'Valor'} style={{ flex: 1 }}>
                <Input
                  value={p.value}
                  onChange={(e) => setPartes(partes.map((x, j) => (i === j ? { ...x, value: e.target.value } : x)))}
                  data-testid={`monitor-valor-${i}`}
                />
              </Field>
              <Field label="Comparar com" style={{ flex: 1 }}>
                <Select
                  value={p.delta ? `delta-${p.deltaMode}` : 'nivel'}
                  onChange={(e) =>
                    setPartes(
                      partes.map((x, j) =>
                        i === j
                          ? { ...x, delta: e.target.value !== 'nivel', deltaMode: e.target.value === 'delta-percent' ? 'percent' : 'absolute' }
                          : x,
                      ),
                    )
                  }
                  options={[
                    { value: 'nivel', label: 'o valor de agora' },
                    { value: 'delta-absolute', label: 'quanto variou' },
                    { value: 'delta-percent', label: 'quanto variou (%)' },
                  ]}
                  data-testid={`monitor-comparar-${i}`}
                />
              </Field>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => setPartes([...partes, { field: '', op: 'lt', value: '', delta: false, deltaMode: 'absolute' }])}
              data-testid="monitor-add-parte"
            >
              Adicionar condição
            </Button>
            {partes.length > 1 && (
              <Button variant="ghost" onClick={() => setJuncao(juncao === 'and' ? 'or' : 'and')} data-testid="monitor-juncao">
                Exigir {juncao === 'and' ? 'todas' : 'qualquer uma'}
              </Button>
            )}
          </div>

          <Field label="Avisar" hint="Borda é diferente de nível: “passou a ser verdadeira” avisa uma vez, não a cada tique.">
            <Select
              value={modo}
              onChange={(e) => setModo(e.target.value as mon.TriggerMode)}
              options={(Object.keys(mon.TRIGGER_LABEL) as mon.TriggerMode[]).map((t) => ({ value: t, label: mon.TRIGGER_LABEL[t] }))}
              data-testid="monitor-modo"
            />
          </Field>

          {(modo === 'cross_up' || modo === 'cross_down') && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Field label="Campo do cruzamento" hint="Cruzar precisa de dois números: o de antes e o de agora." style={{ flex: 1 }}>
                {camposDaFonte.length ? (
                  <Select
                    value={thresholdField}
                    onChange={(e) => setThresholdField(e.target.value)}
                    data-testid="monitor-threshold-campo"
                  >
                    <option value="">Escolha</option>
                    {camposDaFonte.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input value={thresholdField} onChange={(e) => setThresholdField(e.target.value)} data-testid="monitor-threshold-campo" />
                )}
              </Field>
              <Field label="Limiar" style={{ flex: 1 }}>
                <Input value={threshold} onChange={(e) => setThreshold(e.target.value)} data-testid="monitor-threshold" />
              </Field>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Field label="Debounce (s)" hint="Distância mínima entre observações." style={{ flex: 1 }}>
              <Input
                type="number"
                min={0}
                value={Math.round(debounceMs / 1000)}
                onChange={(e) => setDebounceMs(Math.max(0, Number(e.target.value)) * 1000)}
                data-testid="monitor-debounce"
              />
            </Field>
            <Field label="Cooldown (s)" hint="Distância mínima entre disparos. É outra coisa: um protege de fonte tagarela, o outro de avisar demais." style={{ flex: 1 }}>
              <Input
                type="number"
                min={0}
                value={Math.round(cooldownMs / 1000)}
                onChange={(e) => setCooldownMs(Math.max(0, Number(e.target.value)) * 1000)}
                data-testid="monitor-cooldown"
              />
            </Field>
          </div>

          <Field label="Se o dado estiver velho ou faltando" hint="Decidir sobre um número que já não é verdade é o alarme que toca sozinho de madrugada.">
            <Select
              value={aoFaltar}
              onChange={(e) => setAoFaltar(e.target.value as 'ignore' | 'degrade')}
              options={[
                { value: 'degrade', label: 'não disparar e marcar a fonte como degradada' },
                { value: 'ignore', label: 'não disparar e seguir em silêncio' },
              ]}
              data-testid="monitor-stale"
            />
          </Field>

          {/* A PRÉVIA, montada na tela: sem ela, quem monta só descobre o que escreveu
              depois de salvar. */}
          <p style={{ fontSize: 13.5 }} data-testid="monitor-previa">
            Quando <strong>{mon.descreverCondicao(condicao())}</strong> — {mon.TRIGGER_LABEL[modo]}
            {threshold !== '' && (modo === 'cross_up' || modo === 'cross_down') ? ` de ${threshold}` : ''}.
            {debounceMs > 0 ? ` Observando no máximo a cada ${Math.round(debounceMs / 1000)}s.` : ''}
            {cooldownMs > 0 ? ` Avisando no máximo a cada ${Math.round(cooldownMs / 1000)}s.` : ''}
            {aoFaltar === 'degrade' ? ' Dado velho não dispara e marca a fonte.' : ' Dado velho não dispara.'}
          </p>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3" data-testid="monitor-simulacao">
          <p style={{ fontSize: 13 }}>
            Simule com uma amostra: o valor de <strong>antes</strong> e o de <strong>agora</strong>. É a diferença entre estado e borda.
          </p>
          {campos.map((c) => (
            <div key={c} className="flex flex-col gap-2 sm:flex-row">
              <Field label={`${c} antes`} style={{ flex: 1 }}>
                <Input value={antes[c] ?? ''} onChange={(e) => setAntes({ ...antes, [c]: e.target.value })} data-testid={`sim-antes-${c}`} />
              </Field>
              <Field label={`${c} agora`} style={{ flex: 1 }}>
                <Input value={agora[c] ?? ''} onChange={(e) => setAgora({ ...agora, [c]: e.target.value })} data-testid={`sim-agora-${c}`} />
              </Field>
            </div>
          ))}
          <div>
            <Button onClick={simular} data-testid="monitor-simular">
              Simular
            </Button>
          </div>
          {erroSim && (
            <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger)' }} data-testid="sim-erro">
              {erroSim}
            </p>
          )}
          {resultado && (
            <div data-testid="sim-resultado">
              <p style={{ fontSize: 14, fontWeight: 700 }}>{resultado.wouldTrigger ? 'Dispararia' : 'Não dispararia'}</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{resultado.explanation}</p>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="monitores-fontes">
          {observaveis.length
            ? `${observaveis.length} fonte(s) gravam histórico e podem ser observadas.`
            : 'Cadastre uma fonte que grave histórico: sem dado normalizado não há o que observar.'}
        </p>
        <div>
          <a
            href="/monitors"
            style={{ fontSize: 13, textDecoration: 'underline', minHeight: 'var(--hit-min, 44px)', display: 'inline-flex', alignItems: 'center' }}
            data-testid="monitores-link"
          >
            Ver e publicar monitores
          </a>
        </div>
      </Card>
    </>
  )
}

/**
 * O AO VIVO — o que está CHEGANDO, e não só quem está de pé.
 *
 * A primeira versão listava as fontes ativas com bolinha verde. Mas quem abre "ao vivo"
 * quer ver o valor que acabou de entrar: um nome não responde "o que está acontecendo
 * agora". O valor vem redigido do servidor — esta tela costuma ficar aberta na parede.
 */
function AoVivo({ fontes }: { fontes: mon2.LiveSource[] | null }) {
  if (!fontes) return null
  return (
    <>
      <Card>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          Atualiza sozinho pelo mesmo canal das execuções. Sem sondagem: quando algo anda, a lista se refaz.
        </p>
      </Card>
      {fontes.length === 0 && (
        <Card>
          <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Nenhuma fonte ativa. Ative uma para ver leitura chegando.</p>
        </Card>
      )}
      {fontes.map((f) => (
        <Card key={f.id}>
          <div className="flex flex-col gap-2" data-testid="live-item">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TOM[f.health]}>{HEALTH_LABEL[f.health]}</Badge>
              <strong style={{ fontSize: 14 }}>{f.name}</strong>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="live-metricas">
              última {desde(f.lastReadAt)} · {f.readsOk} leituras · {f.readsFailed} falhas · {f.reconnects} reconexões · {f.triggers} disparos
            </p>
            {f.readings.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Nada chegou ainda.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="live-valores">
                {f.readings.map((leitura, i) => (
                  <li key={`${leitura.at}-${i}`} style={{ fontSize: 12.5, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{new Date(leitura.at).toLocaleTimeString('pt-BR')}</span>
                    <span style={{ overflowX: 'auto' }}>
                      {Object.entries(leitura.value)
                        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ))}
    </>
  )
}

function Historico({ fontes }: { fontes: SourceSummary[] | null }) {
  const [fonte, setFonte] = useState('')
  const lista = (fontes ?? []).filter((f) => !fonte || f.id === fonte)
  return (
    <>
      <Select value={fonte} onChange={(e) => setFonte(e.target.value)} style={{ maxWidth: 280 }} data-testid="historico-filtro">
        <option value="">Todas as fontes</option>
        {(fontes ?? []).map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </Select>
      {lista.map((f) => (
        <Card key={f.id}>
          <div className="flex flex-col gap-1" data-testid="historico-item">
            <strong style={{ fontSize: 14 }}>{f.name}</strong>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {f.telemetry.readsOk} leituras boas · {f.telemetry.readsFailed} falhas · última {desde(f.telemetry.lastReadAt)}
              {f.telemetry.lastErrorCode ? ` · último erro: ${f.telemetry.lastErrorCode}` : ''}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              O conteúdo lido não aparece aqui: o log diz o que aconteceu, não o que passou por ele.
            </p>
          </div>
        </Card>
      ))}
    </>
  )
}
