import { useState } from 'react'
import { useT } from '../i18n'
import { createTool, paramsToSchema, schemaToParams, testTool, TOOL_AUTH_KINDS, TOOL_METHODS, ToolApiError, updateTool } from '../lib/tools'
import type { Tool, ToolAuthKind, ToolMethod, ToolParam, ToolTestResult } from '../lib/tools'
import { Button, Card } from '../ui'

// Create/edit a Custom Tool, and try it before trusting an agent with it.
//
// The credential is write-only by construction: an existing tool arrives with
// `auth.hasSecret` and no value, and an untouched field sends nothing — so the
// stored secret is kept without ever having been in the browser.

const input = 'w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)'
const label = 'mb-1 block text-sm text-(--text-muted)'

export function ToolForm({ tool, onSaved, onCancel }: { tool: Tool | null; onSaved: () => void; onCancel: () => void }) {
  const t = useT()
  const isEditing = Boolean(tool?._id)

  const [name, setName] = useState(tool?.name ?? '')
  const [description, setDescription] = useState(tool?.description ?? '')
  const [method, setMethod] = useState<ToolMethod>(tool?.method ?? 'GET')
  const [url, setUrl] = useState(tool?.url ?? '')
  const [params, setParams] = useState<ToolParam[]>(schemaToParams(tool?.inputSchema))
  const [authKind, setAuthKind] = useState<ToolAuthKind>(tool?.auth.kind ?? 'none')
  const [headerName, setHeaderName] = useState(tool?.auth.headerName ?? '')
  const [username, setUsername] = useState(tool?.auth.username ?? '')
  // Empty means "keep what is stored"; the placeholder says so.
  const [secret, setSecret] = useState('')
  const [timeoutSeconds, setTimeoutSeconds] = useState(Math.round((tool?.timeoutMs ?? 8000) / 1000))
  const [enabled, setEnabled] = useState(tool?.enabled ?? true)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ message: string; field?: string } | null>(null)
  const [testArgs, setTestArgs] = useState('{}')
  const [testResult, setTestResult] = useState<ToolTestResult | null>(null)
  const [testing, setTesting] = useState(false)

  const patchParam = (index: number, patch: Partial<ToolParam>) =>
    setParams((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))

  const payload = () => ({
    name: name.trim(),
    description: description.trim(),
    method,
    url: url.trim(),
    inputSchema: paramsToSchema(params),
    enabled,
    timeoutMs: Math.round(timeoutSeconds * 1000),
    auth: {
      kind: authKind,
      ...(authKind === 'api_key' ? { headerName: headerName.trim() } : {}),
      ...(authKind === 'basic' ? { username: username.trim() } : {}),
      // Omitted entirely when untouched, so the backend keeps the stored value.
      ...(secret ? { secret } : {}),
    },
  })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      if (isEditing && tool) await updateTool(tool._id, payload())
      else await createTool(payload())
      onSaved()
    } catch (e) {
      const err = e as ToolApiError
      setError({ message: err.message, field: err.field })
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    if (!tool?._id) return
    setTesting(true)
    setTestResult(null)
    try {
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(testArgs || '{}')
      } catch {
        setError({ message: 'JSON inválido', field: 'testArgs' })
        return
      }
      setTestResult(await testTool(tool._id, parsed))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }} data-testid="tool-form">
      <div>
        <label className={label} htmlFor="tool-name">
          {t('tools.name')}
        </label>
        <input id="tool-name" className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('tools.namePlaceholder')} />
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>{t('tools.nameHelp')}</p>
      </div>

      <div>
        <label className={label} htmlFor="tool-description">
          {t('tools.description')}
        </label>
        <textarea id="tool-description" className={input} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('tools.descriptionPlaceholder')} />
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>{t('tools.descriptionHelp')}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10 }}>
        <div>
          <label className={label} htmlFor="tool-method">
            {t('tools.method')}
          </label>
          <select id="tool-method" className={input} value={method} onChange={(e) => setMethod(e.target.value as ToolMethod)}>
            {TOOL_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="tool-url">
            {t('tools.url')}
          </label>
          <input id="tool-url" className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.exemplo.com/pedidos/{{numero}}" />
        </div>
      </div>

      {/* Parameters — the model fills these in */}
      <Card padding="12px 14px" style={{ display: 'grid', gap: 10 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-heading)' }}>{t('tools.parameters')}</span>
        {params.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{t('tools.noParameters')}</p> : null}
        {params.map((p, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr auto', gap: 8, alignItems: 'center' }} data-testid="tool-param">
            <input className={input} value={p.name} onChange={(e) => patchParam(i, { name: e.target.value })} placeholder="numero" aria-label={t('tools.name')} />
            <select className={input} value={p.type} onChange={(e) => patchParam(i, { type: e.target.value as ToolParam['type'] })}>
              {(['string', 'number', 'integer', 'boolean'] as const).map((ty) => (
                <option key={ty} value={ty}>
                  {ty}
                </option>
              ))}
            </select>
            <input className={input} value={p.description} onChange={(e) => patchParam(i, { description: e.target.value })} placeholder={t('tools.description')} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={p.required} onChange={(e) => patchParam(i, { required: e.target.checked })} />
              {t('common.required')}
            </label>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setParams((prev) => [...prev, { name: '', type: 'string', description: '', required: false }])} data-testid="add-param">
          {t('tools.addParameter')}
        </Button>
      </Card>

      {/* Authentication — the value is write-only */}
      <Card padding="12px 14px" style={{ display: 'grid', gap: 10 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-heading)' }}>{t('tools.auth')}</span>
        <select className={input} value={authKind} onChange={(e) => setAuthKind(e.target.value as ToolAuthKind)} aria-label={t('tools.auth')}>
          {TOOL_AUTH_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`tools.auth.${kind}` as 'tools.auth.none')}
            </option>
          ))}
        </select>
        {authKind === 'api_key' && (
          <input className={input} value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="X-API-Key" aria-label={t('tools.auth.apiKey')} />
        )}
        {authKind === 'basic' && <input className={input} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="usuario" aria-label={t('tools.auth.basic')} />}
        {authKind !== 'none' && (
          <div>
            <input
              className={input}
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={tool?.auth.hasSecret ? t('tools.secretReplace') : '••••••••'}
              aria-label={t('tools.auth')}
              data-testid="tool-secret"
            />
            {tool?.auth.hasSecret && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>{t('tools.secretStored')}</p>}
          </div>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'end' }}>
        <div>
          <label className={label} htmlFor="tool-timeout">
            {t('tools.timeout')}
          </label>
          <input id="tool-timeout" className={input} type="number" min={1} max={60} value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(Number(e.target.value))} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('common.enabled')}
        </label>
      </div>

      {error && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--coral-600, #d92d20)' }} data-testid="tool-error">
          {error.message}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={() => void save()} disabled={saving} data-testid="save-tool">
          {saving ? t('common.saving') : t('common.save')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>

      {/* Manual test — same executor, same masking */}
      {isEditing && (
        <Card padding="12px 14px" style={{ display: 'grid', gap: 10 }} data-testid="tool-test">
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-heading)' }}>{t('tools.testTitle')}</span>
          <textarea className={input} rows={2} value={testArgs} onChange={(e) => setTestArgs(e.target.value)} aria-label={t('tools.parameters')} />
          <div>
            <Button size="sm" variant="secondary" onClick={() => void runTest()} disabled={testing} data-testid="run-test">
              {testing ? t('common.loading') : t('tools.testRun')}
            </Button>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>{t('tools.testHint')}</p>
          {testResult && (
            <div style={{ display: 'grid', gap: 8 }} data-testid="tool-test-result">
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{t('tools.testRequest')}</span>
                <pre style={{ margin: '4px 0 0', fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--surface-sunken)', padding: 8, borderRadius: 8 }}>
                  {JSON.stringify(testResult.detail.request, null, 2)}
                </pre>
              </div>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: testResult.ok ? 'var(--emerald-700, #067647)' : 'var(--coral-600, #d92d20)' }}>
                  {t('tools.testResponse')} {testResult.detail.status ? `· ${testResult.detail.status}` : ''} · {testResult.detail.durationMs}ms
                </span>
                <pre style={{ margin: '4px 0 0', fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--surface-sunken)', padding: 8, borderRadius: 8 }}>
                  {testResult.result}
                </pre>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
