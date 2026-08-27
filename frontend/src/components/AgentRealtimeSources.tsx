import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card, Dialog, EmptyState, Field, Icon, IconButton, Input, Select } from '../ui'
import {
  createRealtimeSource,
  deleteRealtimeSource,
  grantSourceToAgent,
  idade,
  listAgentSources,
  listRealtimeSources,
  realtimeCatalog,
  statusDa,
} from '../lib/realtimeSources'
import type { RealtimeCatalog, RealtimeSource, RealtimeSourceWithReading } from '../lib/realtimeSources'

/**
 * As fontes em tempo real DESTE agente.
 *
 * O que a tela promete: escolher uma conexão pelo nome, uma chave que já chegou de
 * verdade, e um apelido que o agente vai usar. Ninguém copia id de banco.
 *
 * E o que ela deixa claro sem que ninguém pergunte: **isto não guarda histórico**. Usar
 * em tempo real e guardar para depois são decisões separadas, e forçar a segunda para
 * responder a primeira encheria o banco de quem só queria saber o valor de agora.
 */
export function AgentRealtimeSources({ agentId }: { agentId: string }) {
  const [fontes, setFontes] = useState<RealtimeSourceWithReading[] | null>(null)
  const [catalogo, setCatalogo] = useState<RealtimeCatalog | null>(null)
  const [existentes, setExistentes] = useState<RealtimeSource[]>([])
  const [abrindo, setAbrindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const [conexao, setConexao] = useState('')
  const [chave, setChave] = useState('')
  const [alias, setAlias] = useState('')
  const [nome, setNome] = useState('')
  const [campos, setCampos] = useState('')

  const carregar = useCallback(async () => {
    try {
      setFontes(await listAgentSources(agentId))
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [agentId])

  useEffect(() => {
    void carregar()
    // A idade do dado muda sozinha: sem isto, "há 1s" continuaria dizendo 1s para
    // sempre, que é pior do que não mostrar nada.
    const t = setInterval(() => void carregar(), 10_000)
    return () => clearInterval(t)
  }, [carregar])

  async function abrir() {
    setErro(null)
    setAbrindo(true)
    try {
      const [c, todas] = await Promise.all([realtimeCatalog(), listRealtimeSources()])
      setCatalogo(c)
      setExistentes(todas.filter((f) => !f.agentIds.includes(agentId)))
      const primeira = c.live_data[0]
      if (primeira) setConexao(primeira.ref)
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  const chaves = catalogo?.live_data.find((c) => c.ref === conexao)?.keys ?? []

  async function adicionar() {
    setErro(null)
    setSalvando(true)
    try {
      const criada = await createRealtimeSource({
        name: nome.trim() || chave,
        sourceKind: 'live_data',
        sourceRef: conexao,
        key: chave,
        alias: alias.trim(),
        allowedFields: campos.trim() ? campos.split(',').map((c) => c.trim()).filter(Boolean) : null,
        agentIds: [agentId],
      })
      void criada
      setAbrindo(false)
      setChave('')
      setAlias('')
      setNome('')
      setCampos('')
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  async function usarExistente(id: string) {
    setErro(null)
    try {
      await grantSourceToAgent(id, agentId, true)
      setAbrindo(false)
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  async function remover(fonte: RealtimeSourceWithReading) {
    setErro(null)
    try {
      // Compartilhada com outro agente: só retira a concessão. Sozinha, some de vez —
      // deixar uma fonte órfã seria lixo que ninguém entende depois.
      if (fonte.agentIds.length > 1) await grantSourceToAgent(fonte.id, agentId, false)
      else await deleteRealtimeSource(fonte.id)
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="agent-realtime">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p style={{ margin: 0, fontWeight: 600 }}>Fontes de dados em tempo real</p>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
              O agente consulta quando precisar. Nada é enviado para ele sozinho, e nada é guardado.
            </p>
          </div>
          <Button size="sm" icon="plus" onClick={() => void abrir()} data-testid="add-realtime-source">
            Adicionar fonte
          </Button>
        </div>

        {erro && (
          <p role="alert" style={{ color: 'var(--intent-danger)', fontSize: 13 }} data-testid="realtime-error">
            {erro}
          </p>
        )}

        {fontes === null ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Carregando…</p>
        ) : fontes.length === 0 ? (
          <EmptyState
            icon="radio"
            title="Nenhuma fonte em tempo real"
            body="Ligue uma conexão de WebSocket e escolha a chave que este agente pode consultar. Não é preciso guardar histórico."
          />
        ) : (
          <div className="flex flex-col gap-2" data-testid="realtime-list">
            {fontes.map((f) => {
              const status = statusDa(f.reading)
              return (
                <div
                  key={f.id}
                  className="flex flex-wrap items-start gap-3"
                  style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 12 }}
                  data-testid="realtime-item"
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span style={{ fontWeight: 600 }}>{f.name}</span>
                      <Badge tone={status.tone}>{status.texto}</Badge>
                      <code style={{ fontSize: 12, color: 'var(--text-muted)' }}>{f.alias}</code>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
                      Fonte: {f.sourceLabel ?? 'Conexão'} · Chave: {f.key} · Atualizado {idade(f.reading.ageMs)}
                    </p>
                    {/* Dito em voz alta, e não subentendido: consultar não guarda. */}
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-faint)' }} data-testid="realtime-history-note">
                      Histórico: não configurado
                    </p>
                  </div>
                  <IconButton icon="trash-2" label={`Remover ${f.name}`} onClick={() => void remover(f)} data-testid={`remove-realtime-${f.alias}`} />
                </div>
              )
            })}
          </div>
        )}

        <p style={{ color: 'var(--text-muted)', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="info" size={14} />
          Quer guardar o que chega? Isso se configura em Históricos, à parte.
        </p>

        <Dialog
          open={abrindo}
          title="Adicionar fonte em tempo real"
          subtitle="O agente vai poder consultar este valor quando precisar."
          onClose={() => setAbrindo(false)}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setAbrindo(false)} disabled={salvando}>
                Cancelar
              </Button>
              <Button onClick={() => void adicionar()} disabled={salvando || !conexao || !chave || !alias.trim()} data-testid="save-realtime-source">
                {salvando ? 'Adicionando…' : 'Adicionar'}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            {existentes.length > 0 && (
              <Field label="Já existe nesta conta" hint="Um mesmo dado pode servir vários agentes — sem abrir outra conexão.">
                <div className="flex flex-wrap gap-2" data-testid="realtime-existing">
                  {existentes.map((f) => (
                    <Button key={f.id} size="sm" variant="secondary" onClick={() => void usarExistente(f.id)} data-testid={`use-existing-${f.alias}`}>
                      {f.name} ({f.alias})
                    </Button>
                  ))}
                </div>
              </Field>
            )}

            <Field label="Conexão" hint="As conexões de WebSocket desta conta.">
              <Select
                value={conexao}
                onChange={(e) => {
                  setConexao(e.target.value)
                  setChave('')
                }}
                data-testid="realtime-connection"
                options={[
                  { value: '', label: catalogo?.live_data.length ? 'Escolha…' : 'Nenhuma conexão ligada ainda' },
                  ...(catalogo?.live_data ?? []).map((c) => ({ value: c.ref, label: c.label })),
                ]}
              />
            </Field>

            <Field label="Chave" hint={chaves.length ? 'As chaves que essa conexão já recebeu.' : 'Nada chegou nessa conexão ainda — digite a chave.'}>
              {chaves.length ? (
                <Select
                  value={chave}
                  onChange={(e) => {
                    setChave(e.target.value)
                    if (!alias.trim()) setAlias(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
                  }}
                  data-testid="realtime-key"
                  options={[{ value: '', label: 'Escolha…' }, ...chaves.map((k) => ({ value: k.key, label: `${k.key} (${k.updates} atualizações)` }))]}
                />
              ) : (
                <Input value={chave} onChange={(e) => setChave(e.target.value)} placeholder="BTCUSDT" data-testid="realtime-key" />
              )}
            </Field>

            <Field label="Nome para o agente" hint="É por este nome que ele consulta. Ex.: btc_price">
              <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="btc_price" data-testid="realtime-alias" />
            </Field>

            <Field label="Como aparece na tela" hint="Opcional. Sem isto, usa a chave.">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="BTC atual" data-testid="realtime-name" />
            </Field>

            <Field label="Campos que o agente enxerga" hint="Opcional, separados por vírgula. Sem isto, o valor inteiro.">
              <Input value={campos} onChange={(e) => setCampos(e.target.value)} placeholder="symbol, price, volume" data-testid="realtime-fields" />
            </Field>
          </div>
        </Dialog>
      </div>
    </Card>
  )
}
