import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { Badge, Button, Card, Field, Input, Select, Tabs } from '../ui'
import * as api from '../lib/monitoring'
import { HEALTH_LABEL, KIND_LABEL, STATUS_LABEL, desde, frase } from '../lib/monitoring'
import type { OverviewItem, SourceKind, SourceSummary, TestOutcome } from '../lib/monitoring'
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
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [wizard, setWizard] = useState(false)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      if (aba === 'overview' || aba === 'live') setVisao(await api.overview())
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
        {aba === 'live' && <AoVivo visao={visao} />}
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

const PASSOS = ['Tipo', 'Endereço', 'Teste', 'Mapeamento', 'Destino', 'Revisão'] as const

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

  const corpo = () => ({
    name,
    kind,
    config: { url, method: 'GET' as const },
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
      // Rascunho: o backend recusa ativar o que nunca leu, e a tela diz isso em vez de
      // esconder o botão.
      await onDone('Fonte criada como rascunho. Teste e ative quando estiver certa.')
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

        {passo === 2 && (
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

        {passo === 3 && (
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

        {passo === 4 && (
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

        {passo === 5 && (
          <div style={{ fontSize: 13 }} data-testid="wizard-revisao">
            <p>
              <strong>{name || 'sem nome'}</strong> — {KIND_LABEL[kind]}
            </p>
            <p style={{ color: 'var(--text-muted)' }}>{url}</p>
            <p style={{ color: 'var(--text-muted)' }}>
              a cada {Math.round(intervalMs / 1000)} s · campos: {campos.filter((c) => c.to).map((c) => c.to).join(', ') || '—'}
            </p>
            <p style={{ color: 'var(--text-muted)' }}>Ela nasce como rascunho: nada é consultado até você ativar.</p>
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

function AbaMonitores({ fontes }: { fontes: SourceSummary[] | null }) {
  return (
    <Card>
      <div className="flex flex-col gap-2">
        <p style={{ fontSize: 13.5 }}>
          Um monitor observa o dado que uma fonte já normalizou — ele nunca consulta o serviço lá fora a cada condição.
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="monitores-fontes">
          {fontes?.length
            ? `${fontes.filter((f) => f.destination.history).length} fonte(s) gravam histórico e podem ser observadas.`
            : 'Cadastre uma fonte primeiro: sem dado normalizado não há o que observar.'}
        </p>
        <div>
          <a href="/monitors" style={{ fontSize: 13, textDecoration: 'underline', minHeight: 'var(--hit-min, 44px)', display: 'inline-flex', alignItems: 'center' }} data-testid="monitores-link">
            Abrir monitores
          </a>
        </div>
      </div>
    </Card>
  )
}

function AoVivo({ visao }: { visao: { items: OverviewItem[] } | null }) {
  const ativas = (visao?.items ?? []).filter((i) => i.status === 'active')
  return (
    <>
      <Card>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          Atualiza sozinho pelo mesmo canal das execuções. Sem sondagem: quando algo anda, a lista se refaz.
        </p>
      </Card>
      {ativas.length === 0 && (
        <Card>
          <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Nenhuma fonte ativa. Ative uma para ver leitura chegando.</p>
        </Card>
      )}
      {ativas.map((i) => (
        <Card key={i.id}>
          <div className="flex flex-wrap items-center gap-2" data-testid="live-item">
            <Badge tone={TOM[i.health]}>{HEALTH_LABEL[i.health]}</Badge>
            <strong style={{ fontSize: 14 }}>{i.name}</strong>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              última {desde(i.lastReadAt)} · {i.readsOk} leituras · {i.readsFailed} falhas
            </span>
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
