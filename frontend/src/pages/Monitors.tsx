import { useCallback, useEffect, useState } from 'react'
import { AppLayout } from '../components/AppLayout'
import { Badge, Button, Card, Field, Input, Select } from '../ui'
import * as api from '../lib/monitors'
import { OP_LABEL, STATUS_LABEL, TRIGGER_LABEL } from '../lib/monitors'
import type { ComparisonOp, FlowOption, MonitorInput, MonitorSummary, TriggerMode } from '../lib/monitors'

// MONITORES — o plantão do escritório.
//
// A tela é uma frase montada em pedaços fechados: "quando <campo> <operador> <valor>,
// <modo>, acione <Flow>". Nada de campo livre para condição — o que não é escolhido de
// uma lista não pode ser conferido, e uma condição que ninguém confere é um alarme que
// toca sozinho de madrugada.
//
// Salvar e publicar são botões diferentes porque são coisas diferentes: o rascunho é
// livre, e o que fica de plantão é o que alguém revisou.

const VAZIO: MonitorInput = {
  name: '',
  source: { kind: 'internal_event', eventType: '' },
  condition: { kind: 'compare', field: '', op: 'lt', value: 0 },
  triggerMode: 'enter',
  debounceMs: 0,
  cooldownMs: 0,
  flowId: null,
}

export function Monitors() {
  const [lista, setLista] = useState<MonitorSummary[] | null>(null)
  const [meta, setMeta] = useState<api.MonitorMeta | null>(null)
  const [flows, setFlows] = useState<FlowOption[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [editando, setEditando] = useState<{ id: string | null; input: MonitorInput } | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const [m, mt, fl] = await Promise.all([api.listMonitors(), api.monitorMeta(), api.listFlows().catch(() => [])])
      setLista(m)
      setMeta(mt)
      setFlows(fl)
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const acao = async (fn: () => Promise<unknown>) => {
    setErro(null)
    try {
      await fn()
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  const salvar = async () => {
    if (!editando) return
    setSalvando(true)
    try {
      setErro(null)
      if (editando.id) await api.updateMonitor(editando.id, editando.input)
      else await api.createMonitor(editando.input)
      setEditando(null)
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <AppLayout current="/monitors" title="Monitores" subtitle="O que o escritório vigia, e o que ele aciona quando algo muda">
      <div className="flex flex-col gap-3">
        {erro && (
          <Card>
            <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger)' }} data-testid="monitors-error">
              {erro}
            </p>
          </Card>
        )}

        {!editando && (
          <div>
            <Button
              onClick={() => setEditando({ id: null, input: { ...VAZIO, source: { kind: 'internal_event', eventType: meta?.eventTypes[0] ?? '' } } })}
              data-testid="monitor-novo"
            >
              Novo monitor
            </Button>
          </div>
        )}

        {editando && meta && (
          <Card>
            <div className="flex flex-col gap-3" data-testid="monitor-form">
              <Field label="Nome">
                <Input
                  value={editando.input.name}
                  onChange={(e) => setEditando({ ...editando, input: { ...editando.input, name: e.target.value } })}
                  placeholder="RSI sobrevendido"
                  data-testid="monitor-nome"
                />
              </Field>

              <Field label="Observa" hint="O evento da plataforma que este monitor acompanha.">
                <Select
                  value={editando.input.source.eventType}
                  onChange={(e) => setEditando({ ...editando, input: { ...editando.input, source: { kind: 'internal_event', eventType: e.target.value } } })}
                  options={meta.eventTypes}
                  data-testid="monitor-evento"
                />
              </Field>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Field label="Campo" style={{ flex: 1 }}>
                  <Input
                    value={editando.input.condition.field}
                    onChange={(e) =>
                      setEditando({ ...editando, input: { ...editando.input, condition: { ...editando.input.condition, field: e.target.value } } })
                    }
                    placeholder="rsi"
                    data-testid="monitor-campo"
                  />
                </Field>
                <Field label="Comparação" style={{ flex: 1 }}>
                  <Select
                    value={editando.input.condition.op}
                    onChange={(e) =>
                      setEditando({
                        ...editando,
                        input: { ...editando.input, condition: { ...editando.input.condition, op: e.target.value as ComparisonOp } },
                      })
                    }
                    options={meta.operators.map((o) => ({ value: o, label: OP_LABEL[o] }))}
                    data-testid="monitor-operador"
                  />
                </Field>
                <Field label="Valor" style={{ flex: 1 }}>
                  <Input
                    value={String(editando.input.condition.value)}
                    onChange={(e) => {
                      const bruto = e.target.value
                      const n = Number(bruto)
                      setEditando({
                        ...editando,
                        input: { ...editando.input, condition: { ...editando.input.condition, value: bruto !== '' && Number.isFinite(n) ? n : bruto } },
                      })
                    }}
                    data-testid="monitor-valor"
                  />
                </Field>
              </div>

              <Field label="Avisar" hint="Borda é diferente de nível: “passou a ser verdadeira” avisa uma vez, não a cada tique.">
                <Select
                  value={editando.input.triggerMode}
                  onChange={(e) => setEditando({ ...editando, input: { ...editando.input, triggerMode: e.target.value as TriggerMode } })}
                  options={meta.triggerModes.map((t) => ({ value: t, label: TRIGGER_LABEL[t] }))}
                  data-testid="monitor-modo"
                />
              </Field>

              <Field label="Aciona o Flow" hint="Um monitor sem Flow observa e não faz nada — e por isso não publica.">
                <Select
                  value={editando.input.flowId ?? ''}
                  onChange={(e) => setEditando({ ...editando, input: { ...editando.input, flowId: e.target.value || null } })}
                  data-testid="monitor-flow"
                >
                  <option value="">Escolha um Flow</option>
                  {flows.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                      {f.lastPublishedVersion == null ? ' (sem versão publicada)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Field label="Debounce (ms)" hint="Distância mínima entre observações." style={{ flex: 1 }}>
                  <Input
                    type="number"
                    min={0}
                    value={editando.input.debounceMs}
                    onChange={(e) => setEditando({ ...editando, input: { ...editando.input, debounceMs: Number(e.target.value) } })}
                    data-testid="monitor-debounce"
                  />
                </Field>
                <Field label="Cooldown (ms)" hint="Distância mínima entre disparos." style={{ flex: 1 }}>
                  <Input
                    type="number"
                    min={0}
                    value={editando.input.cooldownMs}
                    onChange={(e) => setEditando({ ...editando, input: { ...editando.input, cooldownMs: Number(e.target.value) } })}
                    data-testid="monitor-cooldown"
                  />
                </Field>
              </div>

              <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                Salvar guarda um rascunho. Um monitor só entra de plantão quando você publica.
              </p>
              <div className="flex gap-2">
                <Button onClick={salvar} disabled={salvando} data-testid="monitor-salvar">
                  {salvando ? 'Salvando…' : 'Salvar rascunho'}
                </Button>
                <Button variant="ghost" onClick={() => setEditando(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          </Card>
        )}

        {lista?.length === 0 && !editando && (
          <Card>
            <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
              Nenhum monitor ainda. Um monitor vigia um dado e aciona um Flow quando algo muda — sem chamar modelo nenhum para decidir isso.
            </p>
          </Card>
        )}

        {lista?.map((m) => (
          <Card key={m.id}>
            <div className="flex flex-col gap-2" data-testid="monitor-item">
              <div className="flex flex-wrap items-center gap-2">
                <strong style={{ fontSize: 15 }}>{m.name}</strong>
                <Badge tone={m.status === 'published' ? 'success' : m.status === 'paused' ? 'warning' : 'neutral'}>{STATUS_LABEL[m.status]}</Badge>
                {m.state?.status === 'degraded' && <Badge tone="danger">degradado</Badge>}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Quando <strong>{m.conditionText}</strong> — {TRIGGER_LABEL[m.triggerMode]}.
              </p>
              {m.state?.error && (
                <p role="alert" style={{ fontSize: 12.5, color: 'var(--intent-danger)' }}>
                  {m.state.error.message}
                </p>
              )}
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {m.state?.lastTriggeredAt
                  ? `Último disparo: ${new Date(m.state.lastTriggeredAt).toLocaleString('pt-BR')}`
                  : 'Ainda não disparou.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  onClick={() =>
                    setEditando({
                      id: m.id,
                      input: {
                        name: m.name,
                        source: m.source.kind === 'internal_event' ? { kind: 'internal_event', eventType: m.source.eventType } : VAZIO.source,
                        condition: m.condition,
                        triggerMode: m.triggerMode,
                        threshold: m.threshold,
                        thresholdField: m.thresholdField,
                        debounceMs: m.debounceMs,
                        cooldownMs: m.cooldownMs,
                        flowId: m.flowId,
                      },
                    })
                  }
                >
                  Editar
                </Button>
                {m.status !== 'published' && (
                  <Button onClick={() => acao(() => api.publishMonitor(m.id))} data-testid="monitor-publicar">
                    Pôr de plantão
                  </Button>
                )}
                {m.status === 'published' && (
                  <Button variant="ghost" onClick={() => acao(() => api.pauseMonitor(m.id))} data-testid="monitor-pausar">
                    Pausar
                  </Button>
                )}
                <Button variant="ghost" onClick={() => acao(() => api.deleteMonitor(m.id))}>
                  Apagar
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </AppLayout>
  )
}
