import { useEffect, useState } from 'react'
import { archiveFloor, deleteFloor, FloorApiError, patchFloor, restoreFloor } from '../lib/floors'
import { FloorDeletionDialog } from './FloorDeletionDialog'
import type { Floor, Language } from '../lib/floors'
import { FloorWorkSection } from './FloorWorkSection'
import type { FloorWorkValue } from './FloorWorkSection'
import { SECTOR_COLORS } from '../lib/sectorColors'
import type { AgentSummary } from '../lib/types'
import { Button, Dialog, Field, Input, Select, Textarea } from '../ui'

// Everything about a floor in one place (name, mission, description, timezone,
// language, colour) plus its lifecycle (archive/restore, delete). Save patches
// the floor; archive and delete act immediately. Delete is guarded by the backend
// (refused while the floor still holds agents/sectors, or if it's the last floor)
// and that reason is surfaced here.
const LANGS: { value: Language; label: string }[] = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

export function FloorSettingsDialog({
  open,
  onClose,
  floor,
  agents,
  onSaved,
  onDeleted,
}: {
  open: boolean
  onClose: () => void
  floor: Floor
  agents: AgentSummary[]
  onSaved: (floor: Floor) => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(floor.name)
  const [mission, setMission] = useState(floor.mission)
  const [description, setDescription] = useState(floor.description)
  const [timezone, setTimezone] = useState(floor.timezone)
  const [language, setLanguage] = useState<Language>(floor.defaultLanguage)
  const [color, setColor] = useState<string | null>(floor.color)
  // Como o andar trabalha mora aqui agora, no mesmo estado e no mesmo Salvar.
  const [work, setWork] = useState<FloorWorkValue>({
    mode: floor.workMode,
    coordinatorId: floor.coordinatorAgentId ?? '',
    instruction: floor.instruction,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [busyLifecycle, setBusyLifecycle] = useState(false)
  /** O diálogo de impacto: ele é quem sabe o que se perde. */
  const [impactoAberto, setImpactoAberto] = useState(false)

  // Reseed from the floor whenever the dialog (re)opens.
  useEffect(() => {
    if (open) {
      setName(floor.name)
      setMission(floor.mission)
      setDescription(floor.description)
      setTimezone(floor.timezone)
      setLanguage(floor.defaultLanguage)
      setColor(floor.color)
      setWork({ mode: floor.workMode, coordinatorId: floor.coordinatorAgentId ?? '', instruction: floor.instruction })
      setError('')
    }
  }, [open, floor])

  const archived = floor.status === 'archived'

  async function save() {
    if (!name.trim()) {
      setError('O nome do andar é obrigatório.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const updated = await patchFloor(floor.id, {
        name: name.trim(),
        mission,
        description,
        timezone,
        defaultLanguage: language,
        color,
        workMode: work.mode,
        coordinatorAgentId: work.coordinatorId || null,
        instruction: work.instruction,
      })
      onSaved(updated)
      onClose()
    } catch {
      setError('Não foi possível salvar. Verifique o fuso horário e tente de novo.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleArchive() {
    setBusyLifecycle(true)
    setError('')
    try {
      onSaved(archived ? await restoreFloor(floor.id) : await archiveFloor(floor.id))
    } catch {
      setError('Não foi possível alterar o status do andar.')
    } finally {
      setBusyLifecycle(false)
    }
  }

  /**
   * Excluir passa pelo IMPACTO — "tem certeza?" não é uma pergunta.
   *
   * O andar vazio ainda usa o caminho antigo, que é direto e não tem o que mostrar. Com
   * qualquer coisa dentro, quem decide precisa ver o que fica, o que sai e o que bloqueia.
   */
  async function remove() {
    setBusyLifecycle(true)
    setError('')
    try {
      await deleteFloor(floor.id)
      onDeleted()
    } catch (e) {
      // `409` com andar ocupado é o servidor mandando para a análise, e não uma falha.
      if (e instanceof FloorApiError && /agente|setor/i.test(e.message)) {
        setImpactoAberto(true)
        return
      }
      setError(e instanceof FloorApiError ? e.message : 'Não foi possível excluir o andar.')
    } finally {
      setBusyLifecycle(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Configurações do andar"
      subtitle={floor.name}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button icon="check" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '70dvh', overflowY: 'auto' }}>
        {error ? <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--coral-600,#d92d20)' }}>{error}</p> : null}

        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex: Vendas" />
        </Field>
        <Field label="Missão" hint="Aparece como subtítulo do andar.">
          <Input value={mission} onChange={(e) => setMission(e.target.value)} maxLength={2000} placeholder="O que este andar faz" />
        </Field>
        <Field label="Descrição">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} />
        </Field>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Field label="Fuso horário" hint="IANA, ex: America/Sao_Paulo">
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Sao_Paulo" />
          </Field>
          <Field label="Idioma">
            <Select value={language} onChange={(e) => setLanguage(e.target.value as Language)} options={LANGS} />
          </Field>
        </div>
        <Field label="Cor">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SECTOR_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-label={c.name}
                aria-pressed={color === c.value}
                onClick={() => setColor(c.value)}
                style={{ width: 32, height: 32, borderRadius: 8, background: c.value, cursor: 'pointer', border: color === c.value ? '2px solid var(--text-heading)' : '2px solid transparent', outline: color === c.value ? '2px solid var(--surface-card)' : 'none', outlineOffset: -4 }}
              />
            ))}
            <button
              type="button"
              aria-label="Sem cor"
              aria-pressed={!color}
              onClick={() => setColor(null)}
              style={{ minWidth: 32, height: 32, padding: '0 10px', borderRadius: 8, fontSize: 12, background: 'var(--surface-card)', cursor: 'pointer', border: !color ? '2px solid var(--text-heading)' : '1px solid var(--border-strong,#d0d5dd)', color: 'var(--text-muted)' }}
            >
              Nenhuma
            </button>
          </div>
        </Field>

        <div style={{ marginTop: 4, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
          <FloorWorkSection floor={floor} agents={agents} value={work} onChange={setWork} />
        </div>

        <section style={{ marginTop: 4, paddingTop: 14, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Zona de perigo</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <Button variant="secondary" icon={archived ? 'archive-restore' : 'archive'} onClick={toggleArchive} disabled={busyLifecycle}>
              {archived ? 'Restaurar andar' : 'Arquivar andar'}
            </Button>
            <Button variant="danger" icon="trash-2" onClick={remove} disabled={busyLifecycle} data-testid="floor-excluir">
              Excluir andar
            </Button>
            <Button variant="ghost" onClick={() => setImpactoAberto(true)} disabled={busyLifecycle} data-testid="floor-ver-impacto">
              Ver o que será afetado
            </Button>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }}>
            Arquivar é reversível e preserva tudo. Excluir mostra antes o que será arquivado, excluído, desvinculado e
            mantido — e o que impede a exclusão.
          </p>
        </section>
      </div>

      {impactoAberto ? (
        <FloorDeletionDialog
          open
          floorId={floor.id}
          onClose={() => setImpactoAberto(false)}
          onPurged={() => {
            setImpactoAberto(false)
            onDeleted()
          }}
        />
      ) : null}
    </Dialog>
  )
}
