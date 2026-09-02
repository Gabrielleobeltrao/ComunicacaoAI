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

  const acao = async (fn: () => Promise<unknown>, mensagem?: string) => {
    setErro(null)
    setAviso(null)
    try {
      await fn()
      if (mensagem) setAviso(mensagem)
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

function ListaDeFontes({ fontes, acao }: { fontes: SourceSummary[] | null; acao: (fn: () => Promise<unknown>, m?: string) => Promise<void> }) {
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

const PASSOS = ['Tipo', 'Conexão', 'Endereço', 'Teste', 'Mapeamento', 'Destino', 'Revisão'] as const

function Wizard({ onCancel, onDone, onError }: { onCancel: () => void; onDone: (m: string) => Promise<void>; onError: (m: string) => void }) {
  const [passo, setPasso] = useState(0)
  const [kind, setKind] = useState<SourceKind>('api_polling')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [intervalMs, setIntervalMs] = useState(60_000)
  const [campos, setCampos] = useState<api.FieldRule[]>([{ to: 'valor', from: '' }])
  const [destino, setDestino] = useState({ live: false, history: true })
  const [teste, setTeste] = useState<TestOutcome | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [conexoes, setConexoes] = useState<api.ConnectionOption[]>([])
  const [connectionId, setConnectionId] = useState('')
  const [headerNames, setHeaderNames] = useState('')
  const [criarMonitor, setCriarMonitor] = useState(false)

  // As conexões do cofre: a fonte guarda o NOME do cabeçalho, e o valor sai daqui na hora
  // da leitura. É por isso que a pergunta é "qual conexão", e não "qual chave".
  useEffect(() => {
    void api.connections().then(setConexoes)
  }, [])

  const corpo = () => ({
    name,
    kind,
    ...(connectionId ? { connectionId } : {}),
    config: {
      url,
      method: 'GET' as const,
      ...(headerNames.trim() ? { headerNames: headerNames.split(',').map((h) => h.trim()).filter(Boolean) } : {}),
    },
    mapping: { version: 1, fields: campos.filter((c) => c.to && c.from) },
    cadence: { mode: 'interval' as const, intervalMs },
    destination: destino,
  })

  const testar = async () => {
    setOcupado(true)
    try {
      setTeste(await api.testDraft(corpo()))
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const salvar = async () => {
    setOcupado(true)
    try {
      await api.createSource(corpo())
      /**
       * O monitor opcional nasce RASCUNHO, como tudo aqui.
       *
       * Criar junto poupa a viagem até a outra aba, mas não pode publicar nada: uma regra
       * que passa a agir sozinha no fim de um wizard é uma regra que ninguém revisou.
       */
      const extra = criarMonitor ? ' Um monitor em rascunho foi criado a partir dela.' : ''
      await onDone(`Fonte criada como rascunho. Teste e ative quando estiver certa.${extra}`)
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="fonte-wizard">
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="wizard-passo">
          Passo {passo + 1} de {PASSOS.length}: {PASSOS[passo]}
        </p>

        {passo === 0 && (
          <>
            <Field label="Nome">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Preço do fornecedor" data-testid="wizard-nome" />
            </Field>
            <Field label="Tipo de fonte" hint="É ele que decide se a plataforma consulta ou se o dado chega sozinho.">
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value as SourceKind)}
                options={(Object.keys(KIND_LABEL) as SourceKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
                data-testid="wizard-tipo"
              />
            </Field>
          </>
        )}

        {passo === 1 && (
          <>
            <Field
              label="Conexão"
              hint="A credencial mora na conexão cifrada. A fonte guarda só o nome do cabeçalho; o valor sai do cofre na hora da leitura."
            >
              <Select value={connectionId} onChange={(e) => setConnectionId(e.target.value)} data-testid="wizard-conexao">
                <option value="">Nenhuma: este endereço é público</option>
                {conexoes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.appKey})
                  </option>
                ))}
              </Select>
            </Field>
            {connectionId && (
              <Field label="Cabeçalhos que a conexão preenche" hint="Só os nomes, separados por vírgula. Nenhum valor é digitado aqui.">
                <Input value={headerNames} onChange={(e) => setHeaderNames(e.target.value)} placeholder="Authorization" data-testid="wizard-headers" />
              </Field>
            )}
          </>
        )}

        {passo === 2 && (
          <>
            <Field label="Endereço" hint="A credencial nunca vai aqui: ela vem de uma conexão, e a Central recusa chave na URL.">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.exemplo.com/precos" data-testid="wizard-url" />
            </Field>
            <Field label="A cada quantos segundos">
              <Input
                type="number"
                min={15}
                value={Math.round(intervalMs / 1000)}
                onChange={(e) => setIntervalMs(Math.max(15, Number(e.target.value)) * 1000)}
                data-testid="wizard-intervalo"
              />
            </Field>
          </>
        )}

        {passo === 3 && (
          <>
            <Button onClick={testar} disabled={ocupado} data-testid="wizard-testar">
              {ocupado ? 'Lendo…' : 'Testar de verdade'}
            </Button>
            {teste && !teste.ok && (
              <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger)' }} data-testid="wizard-teste-erro">
                {teste.error?.message}
              </p>
            )}
            {teste?.ok && (
              <div className="flex flex-col gap-1" data-testid="wizard-amostra">
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  Leu em {teste.latencyMs} ms pela estratégia {teste.strategy}. Credenciais aparecem como «oculto».
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

        {passo === 4 && (
          <>
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

        {passo === 5 && (
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

        {passo === 6 && (
          <div style={{ fontSize: 13 }} data-testid="wizard-revisao">
            <p>
              <strong>{name || 'sem nome'}</strong> — {KIND_LABEL[kind]}
            </p>
            <p style={{ color: 'var(--text-muted)' }}>{url}</p>
            <p style={{ color: 'var(--text-muted)' }}>
              a cada {Math.round(intervalMs / 1000)} s · campos: {campos.filter((c) => c.to).map((c) => c.to).join(', ') || '—'}
            </p>
            <p style={{ color: 'var(--text-muted)' }}>
              {connectionId ? 'Usa uma conexão do cofre para autenticar.' : 'Endereço público, sem credencial.'}
            </p>
            <p style={{ color: 'var(--text-muted)' }}>Ela nasce como rascunho: nada é consultado até você ativar.</p>
            <div style={{ marginTop: 8 }}>
              <Button variant={criarMonitor ? 'primary' : 'ghost'} onClick={() => setCriarMonitor(!criarMonitor)} data-testid="wizard-criar-monitor">
                Criar também um monitor em rascunho {criarMonitor ? '✓' : ''}
              </Button>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Ele também nasce rascunho: uma regra que passa a agir sozinha no fim de um wizard é uma regra que ninguém revisou.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {passo > 0 && (
            <Button variant="ghost" onClick={() => setPasso(passo - 1)} data-testid="wizard-voltar">
              Voltar
            </Button>
          )}
          {passo < PASSOS.length - 1 && (
            <Button onClick={() => setPasso(passo + 1)} data-testid="wizard-avancar">
              Avançar
            </Button>
          )}
          {passo === PASSOS.length - 1 && (
            <Button onClick={salvar} disabled={ocupado} data-testid="wizard-salvar">
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
  const [partes, setPartes] = useState<{ field: string; op: mon.ComparisonOp; value: string }[]>([{ field: '', op: 'lt', value: '' }])
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
              <Field label="Valor" style={{ flex: 1 }}>
                <Input
                  value={p.value}
                  onChange={(e) => setPartes(partes.map((x, j) => (i === j ? { ...x, value: e.target.value } : x)))}
                  data-testid={`monitor-valor-${i}`}
                />
              </Field>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setPartes([...partes, { field: '', op: 'lt', value: '' }])} data-testid="monitor-add-parte">
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

          {/* A PRÉVIA, montada na tela: sem ela, quem monta só descobre o que escreveu
              depois de salvar. */}
          <p style={{ fontSize: 13.5 }} data-testid="monitor-previa">
            Quando <strong>{mon.descreverCondicao(condicao())}</strong> — {mon.TRIGGER_LABEL[modo]}.
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
