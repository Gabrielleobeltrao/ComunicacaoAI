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

  const set = (patch: Partial<WsConnectionConfig>) => setConfig((prev) => ({ ...prev, ...patch }))

  const conferirUrl = async () => {
    const r = await checkUrl(config.endpoint).catch(() => ({ ok: false, message: 'Não foi possível conferir.' }))
    setUrlOk(r.message)
  }

  const salvar = async () => {
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
            <Field label="Mensagem do ping" hint="JSON.">
              <Input value={config.heartbeat.message} onChange={(e) => set({ heartbeat: { ...config.heartbeat, message: e.target.value } })} placeholder='{"type":"ping"}' data-testid="ws-heartbeat-message" />
            </Field>
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
