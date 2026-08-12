import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { AppLayout } from '../components/AppLayout'
import { cancelRun, getRunSteps, listRuns } from '../lib/automations'
import type { RunSummary } from '../lib/automations'
import { Button } from '../ui'

// Runs list + inline step timeline. Gated by featureFlags.aiAutomations.
export function Runs() {
  const { floorId } = useParams()
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [steps, setSteps] = useState<Array<{ id: string; stepId: string; stepType: string; status: string }>>([])

  async function load() {
    setLoading(true)
    try {
      setRuns((await listRuns(floorId ? { floorId } : undefined)).items)
    } catch {
      setRuns([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  async function toggle(id: string) {
    if (openId === id) {
      setOpenId(null)
      return
    }
    setOpenId(id)
    setSteps(await getRunSteps(id))
  }

  return (
    <AppLayout
      current="/automations"
      title="Execuções"
      subtitle="Runs das suas automações"
      actions={
        <Button variant="ghost" icon="refresh-cw" onClick={load}>
          Atualizar
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <p style={{ color: 'var(--text-muted)' }}>Carregando…</p>}
        {!loading && runs.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhuma execução ainda.</p>}
        {runs.map((r) => (
          <div key={r.id} style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button onClick={() => toggle(r.id)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', display: 'flex', gap: 8, alignItems: 'center' }}>
                <StatusDot status={r.status} />
                <span style={{ fontWeight: 600 }}>{r.status}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.triggerType}</span>
              </button>
              {(r.status === 'queued' || r.status === 'running') && (
                <Button variant="ghost" onClick={() => cancelRun(r.id).then(load)}>
                  Cancelar
                </Button>
              )}
            </div>
            {r.error && <p style={{ color: 'var(--intent-danger,#d92d20)', fontSize: 13, marginTop: 6 }}>{r.error.message}</p>}
            {openId === r.id && (
              <ul style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)', paddingLeft: 16 }}>
                {steps.map((s) => (
                  <li key={s.id}>
                    {s.stepId} · {s.stepType} — {s.status}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </AppLayout>
  )
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'succeeded' ? 'var(--intent-success,#17b26a)' : status === 'failed' ? 'var(--intent-danger,#d92d20)' : status === 'running' ? 'var(--intent-brand,#2e5bff)' : 'var(--text-muted,#98a2b3)'
  return <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, display: 'inline-block' }} />
}

const panel: React.CSSProperties = { padding: 14, borderRadius: 12, border: '1px solid var(--border-1,#e4e7ec)', background: 'var(--paper-0,#fff)' }
