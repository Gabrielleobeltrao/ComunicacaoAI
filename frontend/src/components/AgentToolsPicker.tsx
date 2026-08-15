import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { API_URL } from '../lib/api'
import { listTools } from '../lib/tools'
import type { Tool } from '../lib/tools'
import type { AgentSummary } from '../lib/types'
import { Button, Card, Tag } from '../ui'

// Which reusable Custom Tools this agent may call. The list is the permission:
// the backend resolves only the ids stored here, owner-scoped, so unchecking a
// box genuinely takes the capability away.
export function AgentToolsPicker({ agent, onSaved }: { agent: AgentSummary; onSaved: () => void | Promise<void> }) {
  const t = useT()
  const [tools, setTools] = useState<Tool[]>([])
  const [selected, setSelected] = useState<string[]>(agent.toolIds ?? [])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    listTools()
      .then((list) => {
        if (!cancelled) setTools(list)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const save = async () => {
    setSaving(true)
    setResult(null)
    try {
      const res = await fetch(`${API_URL}/api/agents/${agent._id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolIds: selected }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setResult({ ok: false, message: (body as { error?: string }).error ?? 'HTTP ' + res.status })
        return
      }
      setResult({ ok: true, message: t('common.save') })
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card padding="16px" style={{ display: 'grid', gap: 10 }} data-testid="agent-tools-picker">
      <div>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 800, color: 'var(--text-heading)' }}>{t('agents.tools')}</h3>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{t('agents.toolsHelp')}</p>
      </div>

      {tools.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{t('agents.noToolsAvailable')}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 8 }}>
          {tools.map((tool) => (
            <label
              key={tool._id}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border-subtle)', cursor: 'pointer', minWidth: 0 }}
            >
              <input type="checkbox" checked={selected.includes(tool._id)} onChange={() => toggle(tool._id)} style={{ marginTop: 3 }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-heading)' }}>{tool.name}</span>
                  {!tool.enabled && <Tag>{t('common.disabled')}</Tag>}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>{tool.description}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button onClick={() => void save()} disabled={saving} data-testid="save-agent-tools">
          {saving ? t('common.saving') : t('common.save')}
        </Button>
        {result && (
          <span style={{ fontSize: 13, color: result.ok ? 'var(--emerald-700, #067647)' : 'var(--coral-600, #d92d20)' }} data-testid="agent-tools-result">
            {result.message}
          </span>
        )}
      </div>
    </Card>
  )
}
