import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AppIcon } from './AgentAppsEditor'
import { listAppCatalog, listAgentGrants, listInstallations, saveAgentGrants, RISK_LABEL } from '../lib/apps'
import type { AppCatalogEntry, AppGrant, AppInstallation } from '../lib/apps'

// What this agent may do with the Apps the account has connected.
//
// The permission is per ACTION, and a write is a second decision on top of the
// first: granting "criar evento" does not authorise the agent to create one on its
// own initiative. Credentials are never here — they live on the connection.

const inputClass =
  'w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)'

type Draft = Omit<AppGrant, 'appKey'>

export function AgentAppGrantsEditor({ agentId }: { agentId: string | null }) {
  const [catalog, setCatalog] = useState<AppCatalogEntry[]>([])
  const [installations, setInstallations] = useState<AppInstallation[]>([])
  const [grants, setGrants] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!agentId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [apps, installed, current] = await Promise.all([listAppCatalog(), listInstallations(), listAgentGrants(agentId)])
      setCatalog(apps)
      setInstallations(installed.filter((i) => i.status !== 'revoked'))
      setGrants(current.map(({ installationId, actionKeys, resourceConfig, autonomousWriteActionKeys }) => ({ installationId, actionKeys, resourceConfig, autonomousWriteActionKeys })))
    } catch {
      setError('Não foi possível carregar os Apps conectados.')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  const persist = async (next: Draft[]) => {
    if (!agentId) return
    setGrants(next)
    setSaving(true)
    setError('')
    try {
      await saveAgentGrants(agentId, next.filter((g) => g.actionKeys.length > 0))
    } catch (e) {
      setError((e as Error).message)
      // The server refused: show what is really stored, not the optimistic draft.
      await load()
    } finally {
      setSaving(false)
    }
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
        const grant = grants.find((g) => g.installationId === installation.id)

        const update = (next: Partial<Draft>) => {
          const base: Draft = grant ?? { installationId: installation.id, actionKeys: [], resourceConfig: {}, autonomousWriteActionKeys: [] }
          const merged = { ...base, ...next }
          void persist([...grants.filter((g) => g.installationId !== installation.id), merged])
        }

        const toggleAction = (key: string, on: boolean) => {
          const actionKeys = on ? [...(grant?.actionKeys ?? []), key] : (grant?.actionKeys ?? []).filter((k) => k !== key)
          // Removing an action removes its autonomous authorisation with it.
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
        const resourceFields = [...new Map(grantedActions.flatMap((a) => a.resourceFields.map((f) => [f.key, f])) as [string, AppCatalogEntry['actions'][number]['resourceFields'][number]][]).values()]

        return (
          <div key={installation.id} className="rounded-xl border border-(--border-subtle) bg-(--surface-card) p-4" data-testid="grant-card">
            <div className="flex items-center gap-3">
              <AppIcon appKey={installation.appKey} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{installation.name}</p>
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
                        <span className="mt-0.5 block text-xs text-(--text-faint)">{RISK_LABEL[action.risk]}</span>
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
                          Permitir que o agente execute esta ação por conta própria. Sem isso, ele avisa que precisa de autorização em vez
                          de agir.
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

      {error ? <p className="text-sm text-(--coral-600,#d92d20)" data-testid="grant-error">{error}</p> : null}
      {saving ? <p className="text-xs text-(--text-faint)">Salvando…</p> : null}
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
