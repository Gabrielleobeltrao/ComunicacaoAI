import { useEffect, useState } from 'react'
import { createInstallation, RISK_LABEL } from '../lib/apps'
import type { AppCatalogEntry, AppInstallation } from '../lib/apps'
import { API_URL } from '../lib/api'
import { Button, Dialog, Field, Input, Tag } from '../ui'

// What the owner reads BEFORE connecting: what the App does, what it reaches, what
// it reads, what it stores, and exactly what happens on disconnect. Short blocks, in
// the order someone actually decides in.

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 6 }}>
      <h3 style={{ margin: 0, fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-faint)' }}>{title}</h3>
      {children}
    </section>
  )
}

const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{children}</p>
)

export function AppDetailDialog({
  app,
  installations,
  onClose,
  onConnected,
}: {
  app: AppCatalogEntry | null
  installations: AppInstallation[]
  onClose: () => void
  onConnected: () => Promise<void> | void
}) {
  const [config, setConfig] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setConfig({})
    setName('')
    setError('')
  }, [app?.key])

  if (!app) return null

  const active = installations.filter((i) => i.status !== 'revoked')
  const isOauth = app.auth.kind === 'oauth2'
  const canAddAnother = app.supportsMultipleConnections || active.length === 0

  const connect = async () => {
    setSaving(true)
    setError('')
    try {
      await createInstallation({ appKey: app.key, name: name.trim() || app.name, config })
      await onConnected()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={app.name} width={640}>
      <div style={{ display: 'grid', gap: 16 }} data-testid="app-detail">
        <Block title="Sobre">
          <P>{app.description}</P>
        </Block>

        {app.actions.length > 0 ? (
          <Block title="Ações">
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
              {app.actions.map((action) => (
                <li key={action.key} style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                  <span style={{ color: 'var(--text-heading)', fontWeight: 600 }}>{action.name}</span> — {action.description}{' '}
                  <Tag>{RISK_LABEL[action.risk]}</Tag>
                </li>
              ))}
            </ul>
          </Block>
        ) : (
          <Block title="Ações">
            <P>Este App não oferece ações para o agente: ele é usado nas entregas das rotinas.</P>
          </Block>
        )}

        {app.surfaces.length > 0 ? (
          <Block title="Páginas que este App libera">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {app.surfaces.map((s) => (
                <li key={s.key} style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                  {s.label} — {s.description}
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {app.dataAccess.length > 0 ? (
          <Block title="Dados acessados">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {app.dataAccess.map((d) => (
                <li key={d} style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                  {d}
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {app.allowedDomains.length > 0 ? (
          <Block title="Domínios externos acessados">
            <P>{app.allowedDomains.join(', ')}</P>
          </Block>
        ) : null}

        {app.auth.scopes.length > 0 ? (
          <Block title="Permissões solicitadas">
            <P>{app.auth.scopes.join(', ')}</P>
          </Block>
        ) : null}

        {app.storageNote ? (
          <Block title="Como os dados são guardados">
            <P>{app.storageNote}</P>
          </Block>
        ) : null}

        {app.disconnectNote ? (
          <Block title="Ao desconectar">
            <P>{app.disconnectNote}</P>
          </Block>
        ) : null}

        {app.providerCostNote ? (
          <Block title="Custos do provedor">
            <P>{app.providerCostNote}</P>
          </Block>
        ) : null}

        <Block title="Origem e versão">
          <P>
            {app.source === 'system' ? 'App do sistema' : app.source === 'private' ? 'App privado' : 'App da comunidade'} · versão {app.version}
          </P>
        </Block>

        {active.length > 0 ? (
          <Block title="Conexões desta conta">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {active.map((i) => (
                <li key={i.id} style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                  {i.name}
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {app.documentationUrl ? (
          <a href={app.documentationUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--intent-brand)' }}>
            Documentação oficial
          </a>
        ) : null}

        {/* --- conectar ------------------------------------------------------- */}
        {isOauth ? (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
            <Button
              variant="primary"
              data-testid="connect-oauth"
              onClick={() => {
                window.location.href = `${API_URL}/api/integrations/google/connect`
              }}
            >
              {active.length > 0 ? 'Reconectar conta' : 'Conectar conta'}
            </Button>
          </div>
        ) : canAddAnother ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Nome desta conexão" hint="Para você reconhecer depois (ex: “Canal de vendas”).">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={app.name} data-testid="connection-name" />
            </Field>
            {app.auth.fields.map((field) => (
              <Field key={field.key} label={field.label} hint={field.help ?? undefined}>
                <Input
                  type={field.secret ? 'password' : 'text'}
                  value={config[field.key] ?? ''}
                  placeholder={field.placeholder ?? ''}
                  onChange={(e) => setConfig((c) => ({ ...c, [field.key]: e.target.value }))}
                  data-testid={`field-${field.key}`}
                />
              </Field>
            ))}
            {error ? <p style={{ margin: 0, fontSize: 13, color: 'var(--coral-600, #d92d20)' }}>{error}</p> : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="primary" disabled={saving} onClick={() => void connect()} data-testid="connect-app">
                {app.requiresAuth ? 'Conectar' : 'Ativar'}
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}
