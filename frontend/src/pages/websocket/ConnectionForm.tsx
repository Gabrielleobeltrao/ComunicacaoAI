import { useState } from 'react'
import { checkUrl, emptyConfig, saveConnection } from '../../lib/websocketApp'
import type { WsAuthKind, WsConnection, WsConnectionConfig, WsDedupeStrategy, WsFilter } from '../../lib/websocketApp'
import { Button, Field, Icon, Input, Textarea } from '../../ui'

/**
 * A configuração da conexão, em duas camadas.
 *
 * Na frente, o que todo serviço precisa: endereço, formato e como ele autentica. Atrás,
 * o que só alguns precisam — caminhos, filtros, schema, limites. Doze campos de uma vez
 * é um formulário que ninguém preenche, e uma conexão mal preenchida é uma conexão que
 * não funciona por um motivo que a tela não explicou.
 *
 * Nenhum campo aqui aceita expressão: tudo é dado, e o servidor só lê caminho de objeto
 * e compara texto.
 */

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-card)',
  color: 'var(--text-body)',
  fontSize: 13.5,
}

const AUTENTICACAO: { value: WsAuthKind; label: string }[] = [
  { value: 'none', label: 'Nenhuma' },
  { value: 'header', label: 'Cabeçalho' },
  { value: 'query', label: 'Parâmetro no endereço' },
  { value: 'message', label: 'Primeira mensagem' },
]

const DEDUPE: { value: WsDedupeStrategy; label: string }[] = [
  { value: 'none', label: 'Não deduplicar' },
  { value: 'message_id', label: 'Pelo identificador da mensagem' },
  { value: 'payload_hash', label: 'Pelo conteúdo' },
]

export function ConnectionForm({ connection, onSaved }: { connection: WsConnection; onSaved: () => void }) {
  const [config, setConfig] = useState<WsConnectionConfig>(connection.config ?? emptyConfig())
  const [token, setToken] = useState('')
  const [avancado, setAvancado] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [urlOk, setUrlOk] = useState<string | null>(null)
  // O schema é editado como TEXTO e convertido a cada tecla: guardar só o objeto faria
  // um JSON pela metade sumir da tela no meio da digitação.
  const [schemaTexto, setSchemaTexto] = useState(connection.config?.schema ? JSON.stringify(connection.config.schema, null, 2) : '')
  const [schemaErro, setSchemaErro] = useState<string | null>(null)

  const set = (patch: Partial<WsConnectionConfig>) => setConfig((prev) => ({ ...prev, ...patch }))

  const conferirUrl = async () => {
    const r = await checkUrl(config.endpoint).catch(() => ({ ok: false, message: 'Não foi possível conferir.' }))
    setUrlOk(r.message)
  }

  const salvar = async () => {
    if (schemaErro) {
      setErro('Corrija o JSON Schema antes de salvar.')
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      await saveConnection(connection.id, { config, ...(token ? { token } : {}) })
      onSaved()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const setFiltro = (i: number, patch: Partial<WsFilter>) =>
    set({ filters: config.filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) })

  return (
    <div style={{ display: 'grid', gap: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }} data-testid="ws-connection-form">
      <Field label="Endereço do serviço" hint="Precisa começar com wss://.">
        <Input value={config.endpoint} onChange={(e) => set({ endpoint: e.target.value })} placeholder="wss://exemplo.com/stream" data-testid="ws-endpoint-input" />
      </Field>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="sm" variant="ghost" onClick={() => void conferirUrl()} data-testid="ws-check-url">
          Conferir endereço
        </Button>
        {urlOk ? (
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="ws-url-result">
            {urlOk}
          </span>
        ) : null}
      </div>

      <Field label="Formato das mensagens">
        <select style={selectStyle} value={config.format} onChange={(e) => set({ format: e.target.value as 'json' | 'text' })} data-testid="ws-format">
          <option value="json">JSON</option>
          <option value="text">Texto</option>
        </select>
      </Field>

      <Field label="Autenticação">
        <select
          style={selectStyle}
          value={config.auth.kind}
          onChange={(e) => set({ auth: { ...config.auth, kind: e.target.value as WsAuthKind } })}
          data-testid="ws-auth-kind"
        >
          {AUTENTICACAO.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>

      {config.auth.kind === 'header' || config.auth.kind === 'query' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label={config.auth.kind === 'header' ? 'Nome do cabeçalho' : 'Nome do parâmetro'}>
            <Input value={config.auth.name} onChange={(e) => set({ auth: { ...config.auth, name: e.target.value } })} placeholder="Authorization" data-testid="ws-auth-name" />
          </Field>
          <Field label="Prefixo (opcional)">
            <Input value={config.auth.prefix} onChange={(e) => set({ auth: { ...config.auth, prefix: e.target.value } })} placeholder="Bearer " data-testid="ws-auth-prefix" />
          </Field>
        </div>
      ) : null}

      {config.auth.kind === 'message' ? (
        <Field label="Mensagem de autenticação" hint="JSON. Use {{token}} onde a credencial entra.">
          <Textarea
            rows={2}
            value={config.auth.messageTemplate}
            onChange={(e) => set({ auth: { ...config.auth, messageTemplate: e.target.value } })}
            placeholder='{"action":"auth","token":"{{token}}"}'
            data-testid="ws-auth-message"
          />
        </Field>
      ) : null}

      {config.auth.kind !== 'none' ? (
        <Field label="Credencial" hint="Guardada cifrada. Em branco mantém a que já está salva.">
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="••••••••" data-testid="ws-token" />
        </Field>
      ) : null}

      <button
        type="button"
        onClick={() => setAvancado((v) => !v)}
        style={{ justifySelf: 'start', background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
        data-testid="ws-advanced-toggle"
      >
        <Icon name={avancado ? 'chevron-up' : 'chevron-down'} size={13} />
        Avançado
      </button>

      {avancado ? (
        <div style={{ display: 'grid', gap: 10, paddingLeft: 10, borderLeft: '2px solid var(--border-subtle)' }} data-testid="ws-advanced">
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
            Os caminhos são campos de objeto, como <code>data.evento</code>. Em branco, a mensagem inteira é usada.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Caminho do conteúdo">
              <Input value={config.paths.payload} onChange={(e) => set({ paths: { ...config.paths, payload: e.target.value } })} data-testid="ws-path-payload" />
            </Field>
            <Field label="Caminho do identificador">
              <Input value={config.paths.messageId} onChange={(e) => set({ paths: { ...config.paths, messageId: e.target.value } })} data-testid="ws-path-id" />
            </Field>
            <Field label="Caminho do canal">
              <Input value={config.paths.channel} onChange={(e) => set({ paths: { ...config.paths, channel: e.target.value } })} data-testid="ws-path-channel" />
            </Field>
            <Field label="Caminho da data">
              <Input value={config.paths.occurredAt} onChange={(e) => set({ paths: { ...config.paths, occurredAt: e.target.value } })} data-testid="ws-path-date" />
            </Field>
          </div>

          <Field label="Filtros" hint="Só o que casar com todos é aproveitado. Vazio aceita tudo.">
            <div style={{ display: 'grid', gap: 6 }}>
              {config.filters.map((f, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr auto', gap: 6 }}>
                  <Input value={f.path} onChange={(e) => setFiltro(i, { path: e.target.value })} placeholder="data.tipo" data-testid={`ws-filter-path-${i}`} />
                  <select style={selectStyle} value={f.operator} onChange={(e) => setFiltro(i, { operator: e.target.value as 'equals' | 'contains' })} data-testid={`ws-filter-op-${i}`}>
                    <option value="equals">é igual a</option>
                    <option value="contains">contém</option>
                  </select>
                  <Input value={f.value} onChange={(e) => setFiltro(i, { value: e.target.value })} data-testid={`ws-filter-value-${i}`} />
                  <Button size="sm" variant="ghost" icon="trash-2" onClick={() => set({ filters: config.filters.filter((_, idx) => idx !== i) })} />
                </div>
              ))}
              <Button size="sm" variant="ghost" icon="plus" onClick={() => set({ filters: [...config.filters, { path: '', operator: 'equals', value: '' }] })} data-testid="ws-add-filter">
                Adicionar filtro
              </Button>
            </div>
          </Field>

          <Field label="Subprotocolos" hint="Separados por vírgula. Alguns serviços exigem um para aceitar a conexão.">
            <Input
              value={config.protocols.join(', ')}
              onChange={(e) =>
                set({
                  protocols: e.target.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              placeholder="graphql-ws"
              data-testid="ws-protocols"
            />
          </Field>

          <Field label="JSON Schema" hint="Opcional. O que não bater com ele é recusado em vez de virar dado errado.">
            <Textarea
              rows={3}
              value={schemaTexto}
              onChange={(e) => {
                setSchemaTexto(e.target.value)
                if (!e.target.value.trim()) {
                  setSchemaErro(null)
                  set({ schema: null })
                  return
                }
                try {
                  const lido = JSON.parse(e.target.value)
                  if (typeof lido !== 'object' || lido === null || Array.isArray(lido)) throw new Error('objeto')
                  setSchemaErro(null)
                  set({ schema: lido as Record<string, unknown> })
                } catch {
                  // A mensagem é sobre o que fazer, e não sobre o parser.
                  setSchemaErro('Escreva um objeto JSON, como {"type":"object","required":["id"]}.')
                }
              }}
              placeholder='{"type":"object","required":["id"]}'
              data-testid="ws-schema"
            />
          </Field>
          {schemaErro ? (
            <p style={{ margin: '-4px 0 0', fontSize: 12.5, color: 'var(--coral-600, #d92d20)' }} data-testid="ws-schema-error">
              {schemaErro}
            </p>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Intervalo do ping (s)" hint="Vale para ESTA conexão.">
              <Input
                type="number"
                value={String(Math.round(config.heartbeat.intervalMs / 1000))}
                onChange={(e) => set({ heartbeat: { ...config.heartbeat, intervalMs: (Number(e.target.value) || 30) * 1000 } })}
                data-testid="ws-heartbeat-interval"
              />
            </Field>
            <Field label="Silêncio até reconectar (s)" hint="Sem nenhuma mensagem por este tempo, a conexão é tratada como caída.">
              <Input
                type="number"
                value={String(Math.round(config.idleTimeoutMs / 1000))}
                onChange={(e) => set({ idleTimeoutMs: (Number(e.target.value) || 90) * 1000 })}
                data-testid="ws-idle-timeout"
              />
            </Field>
          </div>

          <Field label="Deduplicação">
            <select style={selectStyle} value={config.dedupe} onChange={(e) => set({ dedupe: e.target.value as WsDedupeStrategy })} data-testid="ws-dedupe">
              {DEDUPE.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Mensagens por minuto">
              <Input
                type="number"
                value={String(config.maxMessagesPerMinute)}
                onChange={(e) => set({ maxMessagesPerMinute: Number(e.target.value) || 1 })}
                data-testid="ws-rate"
              />
            </Field>
            <Field label="Tamanho máximo (bytes)">
              <Input type="number" value={String(config.maxMessageBytes)} onChange={(e) => set({ maxMessageBytes: Number(e.target.value) || 200 })} data-testid="ws-max-bytes" />
            </Field>
          </div>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={config.heartbeat.enabled}
              onChange={(e) => set({ heartbeat: { ...config.heartbeat, enabled: e.target.checked } })}
              data-testid="ws-heartbeat-enabled"
            />
            <span>Mandar um ping de tempos em tempos</span>
          </label>
          {config.heartbeat.enabled ? (
            <>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={config.heartbeat.native}
                  onChange={(e) => set({ heartbeat: { ...config.heartbeat, native: e.target.checked } })}
                  data-testid="ws-heartbeat-native"
                />
                {/* O ping do protocolo é o padrão: ele não chega como mensagem para a
                    aplicação do outro lado. Só quem precisa de um quadro próprio desmarca. */}
                <span>Usar o ping do protocolo (recomendado)</span>
              </label>
              {!config.heartbeat.native ? (
                <Field label="Mensagem do ping" hint="JSON.">
                  <Input value={config.heartbeat.message} onChange={(e) => set({ heartbeat: { ...config.heartbeat, message: e.target.value } })} placeholder='{"type":"ping"}' data-testid="ws-heartbeat-message" />
                </Field>
              ) : null}
              <Field label="Espera pela resposta do ping (s)" hint="Sem resposta neste tempo, a conexão é dada como morta e reconecta.">
                <Input
                  type="number"
                  value={String(Math.round(config.heartbeat.timeoutMs / 1000))}
                  onChange={(e) => set({ heartbeat: { ...config.heartbeat, timeoutMs: (Number(e.target.value) || 10) * 1000 } })}
                  data-testid="ws-heartbeat-timeout"
                />
              </Field>
            </>
          ) : null}

          <Field label="Prazo do handshake (s)" hint="Quanto esperar a conexão abrir antes de desistir.">
            <Input
              type="number"
              value={String(Math.round(config.connectTimeoutMs / 1000))}
              onChange={(e) => set({ connectTimeoutMs: (Number(e.target.value) || 15) * 1000 })}
              data-testid="ws-connect-timeout"
            />
          </Field>

          {/* --- cabeçalhos extras --------------------------------------------------- */}
          <Field label="Cabeçalhos adicionais" hint="Alguns serviços exigem Origin ou um cabeçalho próprio. Use {{token}} no valor para a credencial entrar sem ficar guardada aqui.">
            <div style={{ display: 'grid', gap: 6 }} data-testid="ws-headers">
              {config.headers.map((h, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
                  <Input
                    value={h.name}
                    placeholder="Origin"
                    onChange={(e) => set({ headers: config.headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                    data-testid={`ws-header-name-${i}`}
                  />
                  <Input
                    value={h.value}
                    placeholder="https://meu-site.com"
                    onChange={(e) => set({ headers: config.headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                    data-testid={`ws-header-value-${i}`}
                  />
                  <Button size="sm" variant="secondary" onClick={() => set({ headers: config.headers.filter((_, j) => j !== i) })} data-testid={`ws-header-remove-${i}`}>
                    Remover
                  </Button>
                </div>
              ))}
              <div>
                <Button size="sm" variant="secondary" onClick={() => set({ headers: [...config.headers, { name: '', value: '' }] })} data-testid="ws-header-add">
                  Adicionar cabeçalho
                </Button>
              </div>
            </div>
          </Field>

          {/* --- mensagens iniciais ---------------------------------------------------- */}
          <Field label="Mensagens ao conectar" hint="Enviadas nesta ordem assim que a conexão abre. Autenticar primeiro, assinar depois — é o que a maioria dos serviços exige.">
            <div style={{ display: 'grid', gap: 6 }} data-testid="ws-initial-messages">
              {config.initialMessages.map((m, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                  <Input
                    value={m}
                    placeholder='{"action":"subscribe","params":{"symbols":"AAPL,TSLA"}}'
                    onChange={(e) => set({ initialMessages: config.initialMessages.map((x, j) => (j === i ? e.target.value : x)) })}
                    data-testid={`ws-initial-message-${i}`}
                  />
                  <Button size="sm" variant="secondary" onClick={() => set({ initialMessages: config.initialMessages.filter((_, j) => j !== i) })} data-testid={`ws-initial-remove-${i}`}>
                    Remover
                  </Button>
                </div>
              ))}
              <div>
                <Button size="sm" variant="secondary" onClick={() => set({ initialMessages: [...config.initialMessages, ''] })} data-testid="ws-initial-add">
                  Adicionar mensagem
                </Button>
              </div>
            </div>
          </Field>

          {/* --- mapeamento e dado ao vivo ---------------------------------------------- */}
          <Field label="Normalizar campos" hint="De onde ler, e como o campo passa a se chamar aqui dentro. É o que faz dois serviços diferentes virarem o mesmo objeto.">
            <div style={{ display: 'grid', gap: 6 }} data-testid="ws-mapping">
              {config.mapping.map((r, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
                  <Input
                    value={r.from}
                    placeholder="$.data.ticker"
                    onChange={(e) => set({ mapping: config.mapping.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })}
                    data-testid={`ws-mapping-from-${i}`}
                  />
                  <Input
                    value={r.to}
                    placeholder="symbol"
                    onChange={(e) => set({ mapping: config.mapping.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })}
                    data-testid={`ws-mapping-to-${i}`}
                  />
                  <Button size="sm" variant="secondary" onClick={() => set({ mapping: config.mapping.filter((_, j) => j !== i) })} data-testid={`ws-mapping-remove-${i}`}>
                    Remover
                  </Button>
                </div>
              ))}
              <div>
                <Button size="sm" variant="secondary" onClick={() => set({ mapping: [...config.mapping, { from: '', to: '' }] })} data-testid="ws-mapping-add">
                  Adicionar campo
                </Button>
              </div>
            </div>
          </Field>

          {config.mapping.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Field label="Chave do dado ao vivo" hint="Qual campo identifica a coisa. Normalmente symbol.">
                <Input value={config.liveKeyPath} placeholder="symbol" onChange={(e) => set({ liveKeyPath: e.target.value })} data-testid="ws-live-key" />
              </Field>
              <Field label="Validade (s)" hint="Depois disso o último valor deixa de valer.">
                <Input type="number" value={String(config.liveTtlSeconds)} onChange={(e) => set({ liveTtlSeconds: Number(e.target.value) || 300 })} data-testid="ws-live-ttl" />
              </Field>
              <Field label="Espaço entre eventos (ms)" hint="0 publica tudo. Guardar o valor é barato; publicar é durável e pode disparar trabalho.">
                <Input type="number" value={String(config.publishThrottleMs)} onChange={(e) => set({ publishThrottleMs: Number(e.target.value) || 0 })} data-testid="ws-throttle" />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}

      {erro ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--coral-600, #d92d20)' }} data-testid="ws-form-error">{erro}</p> : null}
      <div>
        <Button size="sm" onClick={() => void salvar()} disabled={salvando} data-testid="ws-save-connection">
          {salvando ? 'Salvando…' : 'Salvar configuração'}
        </Button>
      </div>
    </div>
  )
}
