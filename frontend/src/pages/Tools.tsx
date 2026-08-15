import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppLayout } from '../components/AppLayout'
import { ToolForm } from '../components/ToolForm'
import { useT } from '../i18n'
import { deleteTool, listTools } from '../lib/tools'
import type { Tool } from '../lib/tools'
import { Button, Card, Dialog, Tag } from '../ui'

// The Tools area: create, edit, duplicate, test, enable/disable, delete, and see
// which agents use each one. Every string comes from the dictionary — this page
// is the pattern for the rest of the UI to follow.
//
// It is also the "Personalizados" tab of the Apps page: the panel below is the whole
// surface, so the two places are literally the same code rather than two that drift.
export function Tools() {
  const t = useT()
  return (
    <AppLayout current="/apps" title={t('tools.title')} subtitle={t('tools.subtitle')}>
      <CustomToolsPanel />
    </AppLayout>
  )
}

export function CustomToolsPanel() {
  const t = useT()
  const [tools, setTools] = useState<Tool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [editing, setEditing] = useState<Tool | null>(null)
  const [creating, setCreating] = useState(false)
  // A duplicate is a create pre-filled from another tool.
  const [draft, setDraft] = useState<Tool | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      setTools(await listTools())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const close = () => {
    setEditing(null)
    setCreating(false)
    setDraft(null)
  }

  const onSaved = async () => {
    close()
    await load()
  }

  const remove = async (tool: Tool) => {
    if (!window.confirm(t('tools.deleteConfirm', { name: tool.name }))) return
    await deleteTool(tool._id)
    await load()
  }

  const duplicate = (tool: Tool) => {
    // A copy needs a distinct name (the backend enforces uniqueness) and never
    // carries the credential — it was never sent to the browser.
    setDraft({ ...tool, _id: '', name: `${tool.name}_copia`, auth: { ...tool.auth, hasSecret: false } })
    setCreating(true)
  }

  const sorted = useMemo(() => [...tools].sort((a, b) => a.name.localeCompare(b.name)), [tools])

  return (
    <>
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <Button icon="plus" onClick={() => setCreating(true)} data-testid="new-tool">
            {t('tools.new')}
          </Button>
        </div>

        {loading ? (
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>{t('common.loading')}</p>
        ) : error ? (
          <p style={{ fontSize: 14, color: 'var(--coral-600, #d92d20)' }}>
            {t('common.retry')}{' '}
            <button type="button" onClick={() => void load()} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--intent-brand)', textDecoration: 'underline', cursor: 'pointer' }}>
              {t('common.retry')}
            </button>
          </p>
        ) : sorted.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 620 }} data-testid="tools-empty">
            {t('tools.empty')}
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 14 }}>
            {sorted.map((tool) => (
              <Card key={tool._id} padding="16px" style={{ display: 'grid', gap: 10 }} data-testid="tool-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: 'var(--text-heading)' }}>{tool.name}</span>
                  <Tag>{tool.method}</Tag>
                  {!tool.enabled && <Tag>{t('common.disabled')}</Tag>}
                </div>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{tool.description}</p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)', wordBreak: 'break-all' }}>{tool.url}</p>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="tool-usage">
                  {tool.usedBy && tool.usedBy.length > 0 ? t('tools.usedBy', { count: tool.usedBy.length }) : t('tools.usedByNone')}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(tool)}>
                    {t('common.edit')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => duplicate(tool)}>
                    {t('common.duplicate')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(tool)}>
                    {t('common.delete')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={creating || editing !== null} onClose={close} title={editing ? t('common.edit') : t('tools.new')} width={720}>
        <ToolForm key={editing?._id ?? draft?.name ?? 'new'} tool={editing ?? draft} onSaved={onSaved} onCancel={close} />
      </Dialog>
    </>
  )
}
