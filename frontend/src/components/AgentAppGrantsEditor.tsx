import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AppLogo } from './AppLogo'
import { listAppCatalog, listAgentGrants, listInstallations, saveAgentGrants, RISK_LABEL } from '../lib/apps'
import type { AppCatalogEntry, AppGrant, AppInstallation } from '../lib/apps'
import { Button } from '../ui'

// What this agent may do with the Apps the account has connected.
//
// The permission is per ACTION, and a write is a second decision on top of the first:
// granting "criar evento" does not authorise the agent to create one on its own.
// Credentials are never here — they live on the connection.
//
// Editing is a DRAFT with an explicit save. The previous version sent the whole list
// on every checkbox and every keystroke, so a slow response could land after a newer
// one and silently restore permissions the owner had just removed. Now there is one
// request, the owner decides when, and a refusal restores exactly what the server
// confirmed rather than leaving the screen lying.

const inputClass =
  'w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)'

type Draft = Omit<AppGrant, 'appKey'>

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string }

const sortDraft = (list: Draft[]): Draft[] =>
  [...list]
    .map((g) => ({
      ...g,
      actionKeys: [...g.actionKeys].sort(),
      autonomousWriteActionKeys: [...g.autonomousWriteActionKeys].sort(),
      resourceConfig: Object.fromEntries(Object.entries(g.resourceConfig).filter(([, v]) => v !== '')),
    }))
    .sort((a, b) => a.installationId.localeCompare(b.installationId))

const sameDraft = (a: Draft[], b: Draft[]): boolean => JSON.stringify(sortDraft(a)) === JSON.stringify(sortDraft(b))

export function AgentAppGrantsEditor({ agentId }: { agentId: string | null }) {
  const [catalog, setCatalog] = useState<AppCatalogEntry[]>([])
  const [installations, setInstallations] = useState<AppInstallation[]>([])
  // What the server last confirmed, and what the owner is editing.
  const [saved, setSaved] = useState<Draft[]>([])
  const [draft, setDraft] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  // One in-flight save at a time: a second click must not race the first.
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (!agentId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const [apps, installed, current] = await Promise.all([listAppCatalog(), listInstallations(), listAgentGrants(agentId)])
      setCatalog(apps)
      // Only a working connection can be granted — the backend refuses the rest.
      setInstallations(installed.filter((i) => i.status === 'connected'))
      const rows = current.map(({ installationId, actionKeys, resourceConfig, autonomousWriteActionKeys }) => ({
        installationId,
        actionKeys,
        resourceConfig,
        autonomousWriteActionKeys,
      }))
      setSaved(rows)
      setDraft(rows)
    } catch {
      setLoadError('Não foi possível carregar os Apps conectados.')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(() => !sameDraft(draft, saved), [draft, saved])

  // Editing again clears a stale "saved" badge, so the screen never claims the
  // current state is persisted when it is not.
  const edit = (next: Draft[]) => {
    setDraft(next)
    setSave((s) => (s.kind === 'saved' ? { kind: 'idle' } : s))
  }

  const submit = async () => {
    if (!agentId || inFlight.current || !dirty) return
    inFlight.current = true
    setSave({ kind: 'saving' })
    try {
      // The backend validates the WHOLE list atomically and answers with what it
      // stored — that answer, not the draft, becomes the new confirmed state.
      const confirmed = await saveAgentGrants(
        agentId,
        draft.filter((g) => g.actionKeys.length > 0),
      )
      const rows = confirmed.map(({ installationId, actionKeys, resourceConfig, autonomousWriteActionKeys }) => ({
        installationId,
        actionKeys,
        resourceConfig,
        autonomousWriteActionKeys,
      }))
      setSaved(rows)
      setDraft(rows)
      setSave({ kind: 'saved' })
    } catch (e) {
      // Refused: show why and put back exactly what the server has, so nobody walks
      // away believing a permission was granted.
      setSave({ kind: 'error', message: (e as Error).message })
      setDraft(saved)
    } finally {
      inFlight.current = false
    }
  }

  const discard = () => {
    setDraft(saved)
    setSave({ kind: 'idle' })
  }

  if (!agentId) {
    return (
      <p className="text-sm text-(--text-muted)">
        Salve o agente primeiro. Depois você escolhe aqui o que ele pode usar dos Apps conectados em{' '}
        <Link to="/apps" className="underline">
          Apps
        </Link>
        .
      </p>
    )
  }

  if (loading) return <p className="text-sm text-(--text-muted)">Carregando…</p>
  if (loadError) {
    return (
      <p className="text-sm text-(--text-muted)">
        {loadError}{' '}
        <button type="button" onClick={() => void load()} className="underline" data-testid="grants-retry">
          Tentar de novo
        </button>
      </p>
    )
  }

  if (installations.length === 0) {
    return (
      <p className="text-sm text-(--text-muted)" data-testid="no-installations">
        Nenhum App conectado nesta conta ainda.{' '}
        <Link to="/apps" className="underline">
          Conectar um App
        </Link>
        .
      </p>
    )
  }

  return (
    <div className="space-y-3" data-testid="agent-app-grants">
      {installations.map((installation) => {
        const app = catalog.find((a) => a.key === installation.appKey)
        if (!app || app.actions.length === 0) return null
        const grant = draft.find((g) => g.installationId === installation.id)

        const update = (next: Partial<Draft>) => {
          const base: Draft = grant ?? { installationId: installation.id, actionKeys: [], resourceConfig: {}, autonomousWriteActionKeys: [] }
          edit([...draft.filter((g) => g.installationId !== installation.id), { ...base, ...next }])
        }

        const toggleAction = (key: string, on: boolean) => {
          const actionKeys = on ? [...(grant?.actionKeys ?? []), key] : (grant?.actionKeys ?? []).filter((k) => k !== key)
          // Removing an action removes its autonomous authorisation with it — leaving
          // the flag behind would silently re-authorise it if the action came back.
          const autonomousWriteActionKeys = (grant?.autonomousWriteActionKeys ?? []).filter((k) => actionKeys.includes(k))
          update({ actionKeys, autonomousWriteActionKeys })
        }

        const toggleAutonomous = (key: string, on: boolean) => {
          const autonomousWriteActionKeys = on
            ? [...(grant?.autonomousWriteActionKeys ?? []), key]
            : (grant?.autonomousWriteActionKeys ?? []).filter((k) => k !== key)
          update({ autonomousWriteActionKeys })
        }

        const grantedActions = app.actions.filter((a) => grant?.actionKeys.includes(a.key))
        const resourceFields = [
          ...new Map(grantedActions.flatMap((a) => a.resourceFields.map((f) => [f.key, f]))).values(),
        ] as AppCatalogEntry['actions'][number]['resourceFields']

        return (
          <div key={installation.id} className="rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4" data-testid="grant-card">
            <div className="flex items-center gap-3">
              <AppLogo appKey={installation.appKey} icon={app.icon} size={40} title={app.name} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {installation.name}
                  {/* O ambiente aparece onde a ação é AUTORIZADA, e não só onde a
                      conexão é criada: é aqui que alguém decide deixar um agente
                      mandar ordem sozinho. */}
                  {installation.environment && installation.environment !== 'default' ? (
                    <span
                      className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                      style={{ background: 'var(--mango-100, #fdf0d5)', color: 'var(--mango-600, #b25e09)' }}
                      data-testid="grant-environment"
                    >
                      {installation.environment === 'paper' ? 'simulação' : installation.environment}
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-(--text-faint)">{app.name}</p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {app.actions.map((action) => {
                const on = grant?.actionKeys.includes(action.key) ?? false
                const autonomous = grant?.autonomousWriteActionKeys.includes(action.key) ?? false
                return (
                  <div key={action.key} className="rounded-lg border border-(--border-subtle) p-3">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => toggleAction(action.key, e.target.checked)}
                        data-testid={`action-${action.key}`}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm">{action.name}</span>
                        <span className="block text-xs text-(--text-muted)">{action.description}</span>
                        {/* Alto risco não pode parecer igual a "altera dados": mandar
                            uma ordem e criar um contato não são da mesma classe. */}
                        <span
                          className="mt-0.5 block text-xs"
                          style={{ color: action.risk === 'high_risk' ? 'var(--coral-600, #d92d20)' : 'var(--text-faint)' }}
                          data-testid={`risk-${action.key}`}
                        >
                          {RISK_LABEL[action.risk]}
                        </span>
                      </span>
                    </label>

                    {on && action.risk !== 'read' ? (
                      <label className="mt-2 flex items-start gap-2 border-t border-(--border-subtle) pt-2">
                        <input
                          type="checkbox"
                          checked={autonomous}
                          onChange={(e) => toggleAutonomous(action.key, e.target.checked)}
                          data-testid={`autonomous-${action.key}`}
                          className="mt-0.5"
                        />
                        <span className="text-xs text-(--text-muted)">
                          {action.risk === 'high_risk'
                            ? 'Permitir que o agente execute esta ação crítica por conta própria, sem confirmar antes. Sem isso, ele avisa que precisa de autorização em vez de agir.'
                            : 'Permitir que o agente execute esta ação por conta própria. Sem isso, ele avisa que precisa de autorização em vez de agir.'}
                        </span>
                      </label>
                    ) : null}
                  </div>
                )
              })}
            </div>

            {resourceFields.length > 0 ? (
              <div className="mt-3 space-y-2 border-t border-(--border-subtle) pt-3">
                {resourceFields.map((field) => (
                  <div key={field.key}>
                    <label className="mb-1 block text-xs text-(--text-muted)">
                      {field.label}
                      {field.required ? ' *' : ''}
                    </label>
                    <input
                      className={inputClass}
                      value={grant?.resourceConfig[field.key] ?? ''}
                      placeholder={field.placeholder ?? ''}
                      data-testid={`resource-${field.key}`}
                      // Typing edits the draft only. This used to fire a request per
                      // character.
                      onChange={(e) => update({ resourceConfig: { ...(grant?.resourceConfig ?? {}), [field.key]: e.target.value } })}
                    />
                    {field.help ? <p className="mt-1 text-xs text-(--text-faint)">{field.help}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}

      {/* --- save bar ------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-3" data-testid="grants-savebar">
        <Button size="sm" disabled={!dirty || save.kind === 'saving'} onClick={() => void submit()} data-testid="save-grants">
          {save.kind === 'saving' ? 'Salvando…' : 'Salvar permissões'}
        </Button>
        {dirty ? (
          <button type="button" onClick={discard} className="text-sm underline text-(--text-muted)" data-testid="discard-grants">
            Descartar alterações
          </button>
        ) : null}

        {dirty && save.kind !== 'saving' ? (
          <span className="text-xs text-(--text-muted)" data-testid="grants-dirty">
            Alterações não salvas
          </span>
        ) : null}
        {save.kind === 'saved' && !dirty ? (
          <span className="text-xs text-(--intent-brand)" data-testid="grants-saved">
            Permissões salvas
          </span>
        ) : null}
        {save.kind === 'error' ? (
          <span className="text-sm text-(--coral-600,#d92d20)" data-testid="grants-error">
            {save.message}
          </span>
        ) : null}
      </div>

      <p className="text-xs text-(--text-faint)">
        As credenciais ficam na conexão, em{' '}
        <Link to="/apps" className="underline">
          Apps
        </Link>
        . Aqui você escolhe apenas o que este agente pode fazer com elas.
      </p>
    </div>
  )
}
