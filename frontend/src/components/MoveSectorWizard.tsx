import { useEffect, useState } from 'react'
import { SectorApiError, getSectorMoveImpact, moveSector } from '../lib/sectors'
import type { SectorMoveImpact } from '../lib/sectors'
import type { SectorMemberSummary, SectorSummary } from '../lib/types'
import { Button, Checkbox, Dialog, Icon, Select } from '../ui'

// Move a sector to another floor in 3 steps (plan §10): pick a floor → review what
// changes and staff the sector from the target floor → confirm. The backend is the
// authority: it drops the source-floor members (they stay on the source floor) and
// re-validates everything. Analytics and linked channels are preserved (keyed by
// sector id), so the sector keeps its history and its channels keep working.
const MAX = 10

export function MoveSectorWizard({
  open,
  onClose,
  sector,
  floors,
  onMoved,
}: {
  open: boolean
  onClose: () => void
  sector: SectorSummary
  floors: { id: string; name: string }[]
  onMoved: (targetFloorId: string) => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [targetFloorId, setTargetFloorId] = useState('')
  const [impact, setImpact] = useState<SectorMoveImpact | null>(null)
  const [loadingImpact, setLoadingImpact] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [channelWarning, setChannelWarning] = useState('')
  const [confirmChannel, setConfirmChannel] = useState(false)

  // Reset whenever the dialog (re)opens.
  useEffect(() => {
    if (open) {
      setStep(1)
      setTargetFloorId('')
      setImpact(null)
      setSelected(new Set())
      setError('')
      setChannelWarning('')
      setConfirmChannel(false)
    }
  }, [open])

  const otherFloors = floors.filter((f) => f.id !== sector.floorId)
  const isPipeline = sector.mode === 'pipeline'

  async function goToReview() {
    if (!targetFloorId) return
    setLoadingImpact(true)
    setError('')
    try {
      const data = await getSectorMoveImpact(sector._id, targetFloorId)
      setImpact(data)
      setSelected(new Set())
      setStep(2)
    } catch (e) {
      setError(e instanceof SectorApiError ? e.message : 'Não foi possível calcular o impacto da mudança.')
    } finally {
      setLoadingImpact(false)
    }
  }

  function toggle(agentId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else if (next.size < MAX) next.add(agentId)
      return next
    })
  }

  async function commit() {
    if (!impact) return
    setBusy(true)
    setError('')
    // Preserve target-agent order; the first selected becomes the default.
    const chosen = impact.targetAgents.filter((a) => selected.has(a.id))
    const members: SectorMemberSummary[] = chosen.map((a, i) => ({
      agentId: a.id,
      sector: '',
      routingDescription: '',
      advanceWhen: '',
      transitions: [],
      isDefault: i === 0,
    }))
    try {
      await moveSector(sector._id, { targetFloorId, members, confirmChannelImpact: confirmChannel })
      onMoved(targetFloorId)
    } catch (e) {
      if (e instanceof SectorApiError && e.code === 'CHANNEL_IMPACT_CONFIRMATION_REQUIRED') {
        setChannelWarning(e.message)
        setConfirmChannel(false)
      } else {
        setError(e instanceof SectorApiError ? e.message : 'Não foi possível mover o setor.')
      }
    } finally {
      setBusy(false)
    }
  }

  const targetName = otherFloors.find((f) => f.id === targetFloorId)?.name ?? ''
  const readyCount = selected.size
  const willBeIncomplete = isPipeline ? readyCount < 2 : readyCount < 1

  const footer =
    step === 1 ? (
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button icon="arrow-right" disabled={!targetFloorId || loadingImpact} onClick={goToReview}>
          {loadingImpact ? 'Calculando…' : 'Avançar'}
        </Button>
      </>
    ) : step === 2 ? (
      <>
        <Button variant="ghost" onClick={() => setStep(1)}>Voltar</Button>
        <Button icon="arrow-right" onClick={() => setStep(3)}>Avançar</Button>
      </>
    ) : (
      <>
        <Button variant="ghost" onClick={() => setStep(2)} disabled={busy}>Voltar</Button>
        <Button icon="arrow-right-left" disabled={busy || (channelWarning !== '' && !confirmChannel)} onClick={commit}>
          {busy ? 'Movendo…' : 'Mover setor'}
        </Button>
      </>
    )

  return (
    <Dialog open={open} onClose={onClose} title="Mover de andar" subtitle={sector.name} width={560} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '68dvh', overflowY: 'auto' }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>Passo {step} de 3</p>
        {error ? (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--coral-600,#d92d20)' }}>{error}</p>
        ) : null}

        {step === 1 && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
            Andar de destino
            {otherFloors.length === 0 ? (
              <p style={muted}>Não há outro andar para onde mover.</p>
            ) : (
              <Select
                value={targetFloorId}
                aria-label="Andar de destino"
                onChange={(e) => setTargetFloorId(e.target.value)}
                options={[{ value: '', label: 'Selecione um andar…' }, ...otherFloors.map((f) => ({ value: f.id, label: f.name }))]}
              />
            )}
            <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
              O histórico e os canais do setor são preservados. Os agentes atuais permanecem no andar de origem.
            </span>
          </label>
        )}

        {step === 2 && impact && (
          <>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-body)' }}>
              Mover <b>{impact.sector.name}</b> de <b>{impact.sourceFloor.name}</b> para <b>{impact.targetFloor.name}</b>.
            </p>

            <section>
              <h4 style={sectionTitle}>Sai do setor ({impact.currentMembers.length})</h4>
              {impact.currentMembers.length === 0 ? (
                <p style={muted}>O setor não tem agentes hoje.</p>
              ) : (
                <p style={muted}>
                  {impact.currentMembers.map((m) => m.name).join(', ')} — continuam em {impact.sourceFloor.name}, apenas fora deste setor.
                </p>
              )}
            </section>

            {impact.linkedChannels.length > 0 && (
              <section>
                <h4 style={sectionTitle}>Canais vinculados ({impact.linkedChannels.length})</h4>
                <p style={muted}>{impact.linkedChannels.map((c) => c.name).join(', ')} — continuam funcionando após a mudança.</p>
              </section>
            )}

            <section>
              <h4 style={sectionTitle}>Equipe em {impact.targetFloor.name} ({readyCount}/{MAX})</h4>
              {impact.targetAgents.length === 0 ? (
                <p style={muted}>Este andar ainda não tem agentes. O setor chegará sem equipe — você pode staffar depois.</p>
              ) : (
                <ul style={listStyle}>
                  {impact.targetAgents.map((a) => {
                    const on = selected.has(a.id)
                    return (
                      <li key={a.id} style={row}>
                        <Checkbox checked={on} disabled={!on && readyCount >= MAX} onChange={() => toggle(a.id)} label={a.name} />
                        {a.currentSector ? <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--mango-700,#b54708)' }}>Sairá de {a.currentSector}</span> : null}
                      </li>
                    )
                  })}
                </ul>
              )}
              {willBeIncomplete && (
                <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--mango-700,#b54708)', display: 'flex', gap: 6 }}>
                  <Icon name="info" size={14} />
                  {isPipeline ? 'Um fluxo precisa de ao menos 2 agentes para ficar pronto.' : 'Selecione ao menos 1 agente para o setor ficar pronto.'}
                </p>
              )}
            </section>
          </>
        )}

        {step === 3 && impact && (
          <>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-body)' }}>
              Confirmar a mudança de <b>{impact.sector.name}</b> para <b>{targetName}</b> com <b>{readyCount}</b> {readyCount === 1 ? 'agente' : 'agentes'}.
            </p>
            <ul style={{ ...listStyle, fontSize: 13, color: 'var(--text-muted)' }}>
              <li style={summaryItem}><Icon name="check" size={14} /> Histórico e analytics preservados</li>
              <li style={summaryItem}><Icon name="check" size={14} /> {impact.linkedChannels.length} {impact.linkedChannels.length === 1 ? 'canal continua' : 'canais continuam'} vinculado{impact.linkedChannels.length === 1 ? '' : 's'}</li>
              <li style={summaryItem}><Icon name="check" size={14} /> Agentes de origem permanecem em {impact.sourceFloor.name}</li>
            </ul>
            {channelWarning && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 10, border: '1px solid var(--mango-300,#fdb022)', background: 'var(--mango-100,#fef3e6)' }}>
                <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--mango-700,#b54708)' }}>{channelWarning}</p>
                <Checkbox checked={confirmChannel} onChange={setConfirmChannel} label="Entendo e quero mover mesmo assim" />
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

const sectionTitle: React.CSSProperties = { margin: '0 0 6px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }
const listStyle: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '4px 10px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }
const summaryItem: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--emerald-700,#067647)' }
const muted: React.CSSProperties = { margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }
