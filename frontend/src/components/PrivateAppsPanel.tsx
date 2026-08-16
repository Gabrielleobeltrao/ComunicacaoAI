import { useCallback, useEffect, useRef, useState } from 'react'
import {
  archivePrivateApp,
  createPrivateApp,
  deletePrivateApp,
  exportPrivateApp,
  importPrivateApp,
  listPrivateApps,
  privateAppImpact,
  updatePrivateApp,
} from '../lib/apps'
import type { AppCatalogEntry, PrivateAppImpact } from '../lib/apps'
import { Button, Card, Dialog, EmptyState, Tag } from '../ui'

// Apps the owner writes themselves.
//
// A private App is a MANIFEST — declarative HTTP actions and nothing else — so it is
// edited as JSON, which is what it literally is. There is no code to compile and no
// page to render, and that is exactly what makes exporting one and handing it to
// someone else safe: the manifest never held a credential. The credential belongs to
// the connection, which the importer supplies themselves.

const EXAMPLE = `{
  "key": "minha_loja",
  "version": "1.0.0",
  "name": "Minha Loja",
  "description": "Consulta pedidos no sistema da loja.",
  "categories": ["vendas"],
  "auth": {
    "kind": "api_key",
    "fields": [{ "key": "apiKey", "label": "Chave de API", "required": true, "secret": true }]
  },
  "allowedDomains": ["api.minhaloja.com"],
  "supportsMultipleConnections": false,
  "actions": [
    {
      "key": "buscar_pedido",
      "name": "Buscar pedido",
      "description": "Busca um pedido pelo número.",
      "risk": "read",
      "inputSchema": { "type": "object", "properties": { "numero": { "type": "string" } }, "required": ["numero"] },
      "execution": {
        "kind": "http",
        "method": "GET",
        "url": "https://api.minhaloja.com/pedidos/{{input.numero}}",
        "headers": [{ "key": "Authorization", "value": "Bearer {{auth.apiKey}}" }]
      }
    }
  ]
}`

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 320,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12.5,
  lineHeight: 1.5,
  padding: 12,
  borderRadius: 10,
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-card)',
  color: 'var(--text-body)',
  resize: 'vertical',
}

type Editing = { key: string | null; json: string; mode: 'create' | 'import' | 'edit' }

export function PrivateAppsPanel({ onChanged }: { onChanged?: () => void }) {
  const [apps, setApps] = useState<AppCatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<{ app: AppCatalogEntry; impact: PrivateAppImpact } | null>(null)
  const [exported, setExported] = useState<{ name: string; json: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      setApps(await listPrivateApps())
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    await load()
    onChanged?.()
  }

  const save = async () => {
    if (!editing || saving) return
    let parsed: unknown
    try {
      parsed = JSON.parse(editing.json)
    } catch {
      // A JSON syntax error is the owner's typo, not a server refusal — say so here
      // instead of sending a broken body and showing whatever comes back.
      setError('O JSON está inválido. Confira vírgulas e chaves.')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (editing.mode === 'edit' && editing.key) await updatePrivateApp(editing.key, parsed)
      else if (editing.mode === 'import') await importPrivateApp(parsed)
      else await createPrivateApp(parsed)
      setEditing(null)
      await refresh()
    } catch (e) {
      // The backend's validation message names the field that is wrong.
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const openEdit = async (app: AppCatalogEntry) => {
    setError('')
    try {
      const manifest = await exportPrivateApp(app.key)
      setEditing({ key: app.key, json: JSON.stringify(manifest, null, 2), mode: 'edit' })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const openExport = async (app: AppCatalogEntry) => {
    setCopied(false)
    try {
      const manifest = await exportPrivateApp(app.key)
      setExported({ name: app.name, json: JSON.stringify(manifest, null, 2) })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const askRemove = async (app: AppCatalogEntry) => {
    try {
      setRemoving({ app, impact: await privateAppImpact(app.key) })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const confirmRemove = async () => {
    if (!removing) return
    try {
      await deletePrivateApp(removing.app.key)
      setRemoving(null)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const toggleArchive = async (app: AppCatalogEntry) => {
    try {
      await archivePrivateApp(app.key, app.status !== 'suspended')
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const readFile = async (file: File) => {
    setEditing({ key: null, json: await file.text(), mode: 'import' })
    setError('')
  }

  if (loading) return <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Carregando…</p>
  if (failed)
    return (
      <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        Não foi possível carregar seus Apps.{' '}
        <button type="button" onClick={() => void load()} style={{ background: 'none', border: 0, padding: 0, textDecoration: 'underline', cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
          Tentar de novo
        </button>
      </p>
    )

  return (
    <div style={{ display: 'grid', gap: 14 }} data-testid="private-apps">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="sm" onClick={() => setEditing({ key: null, json: EXAMPLE, mode: 'create' })} data-testid="create-private-app">
          Criar App
        </Button>
        <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()} data-testid="import-private-app">
          Importar JSON
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          data-testid="import-file"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void readFile(file)
          }}
        />
      </div>

      {error && !editing && !removing ? (
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--coral-600, #d92d20)' }} data-testid="private-apps-error">
          {error}
        </p>
      ) : null}

      {apps.length === 0 ? (
        <EmptyState
          icon="puzzle"
          title="Nenhum App seu ainda"
          body="Um App seu é um manifesto: você declara as ações HTTP, conecta sua credencial e escolhe quais agentes podem usá-las."
        />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {apps.map((app) => {
            const archived = app.status === 'suspended'
            return (
              <Card key={app.key} padding="14px" data-testid="private-app-card">
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14.5 }}>{app.name}</strong>
                  <Tag>v{app.version}</Tag>
                  {archived ? <Tag color="var(--text-faint)">arquivado</Tag> : null}
                  <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
                    {app.actions.length} ação(ões) · {app.allowedDomains.join(', ')}
                  </span>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--text-muted)' }}>{app.description}</p>
                {archived ? (
                  <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-faint)' }}>
                    Não aparece no catálogo. As conexões e permissões existentes continuam funcionando.
                  </p>
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  <Button size="sm" variant="secondary" onClick={() => void openEdit(app)} data-testid={`edit-${app.key}`}>
                    Editar
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void openExport(app)} data-testid={`export-${app.key}`}>
                    Exportar
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void toggleArchive(app)} data-testid={`archive-${app.key}`}>
                    {archived ? 'Reativar' : 'Arquivar'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void askRemove(app)} data-testid={`delete-${app.key}`}>
                    Excluir
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* --- editor ------------------------------------------------------------- */}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.mode === 'edit' ? 'Editar App' : editing?.mode === 'import' ? 'Importar App' : 'Criar App'}
        width={720}
      >
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)' }}>
          Só ações HTTP declarativas. Um App seu não roda código, não abre página e nunca guarda credencial aqui — a credencial fica na
          conexão, em Conectados.
        </p>
        <textarea
          value={editing?.json ?? ''}
          onChange={(e) => setEditing((prev) => (prev ? { ...prev, json: e.target.value } : prev))}
          style={textareaStyle}
          spellCheck={false}
          aria-label="Manifesto do App"
          data-testid="manifest-json"
        />
        {error ? (
          <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--coral-600, #d92d20)' }} data-testid="manifest-error">
            {error}
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button size="sm" onClick={() => void save()} disabled={saving} data-testid="save-manifest">
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
            Cancelar
          </Button>
        </div>
      </Dialog>

      {/* --- export ------------------------------------------------------------- */}
      <Dialog open={exported !== null} onClose={() => setExported(null)} title={`Exportar ${exported?.name ?? ''}`} width={720}>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)' }}>
          Este manifesto não contém credencial nenhuma. Quem importar precisa conectar a própria e autorizar os próprios agentes.
        </p>
        <textarea readOnly value={exported?.json ?? ''} style={textareaStyle} spellCheck={false} data-testid="export-json" />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(exported?.json ?? '').then(() => setCopied(true))
            }}
            data-testid="copy-export"
          >
            Copiar JSON
          </Button>
          {copied ? <span style={{ fontSize: 12.5, color: 'var(--intent-brand)' }}>Copiado</span> : null}
        </div>
      </Dialog>

      {/* --- exclusão ----------------------------------------------------------- */}
      <Dialog open={removing !== null} onClose={() => setRemoving(null)} title={`Excluir ${removing?.app.name ?? ''}?`}>
        {removing && (removing.impact.installations > 0 || removing.impact.agents > 0) ? (
          <>
            <p style={{ margin: 0, fontSize: 13.5 }} data-testid="delete-blocked">
              Ainda em uso: {removing.impact.installations} conexão(ões) e {removing.impact.agents} agente(s) com permissão. Excluir agora
              quebraria o que já está funcionando.
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--text-muted)' }}>
              Desconecte em <strong>Conectados</strong> e revogue as permissões nos agentes — ou arquive o App, que tira do catálogo sem
              derrubar nada.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button
                size="sm"
                onClick={() => {
                  const app = removing.app
                  setRemoving(null)
                  void toggleArchive(app)
                }}
                data-testid="archive-instead"
              >
                Arquivar
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRemoving(null)}>
                Cancelar
              </Button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Nenhuma conexão nem permissão aponta para este App. Exclui-lo remove o manifesto desta conta.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button size="sm" variant="danger" onClick={() => void confirmRemove()} data-testid="confirm-delete">
                Excluir
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRemoving(null)}>
                Cancelar
              </Button>
            </div>
          </>
        )}
        {error && removing ? (
          <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--coral-600, #d92d20)' }} data-testid="delete-error">
            {error}
          </p>
        ) : null}
      </Dialog>
    </div>
  )
}
