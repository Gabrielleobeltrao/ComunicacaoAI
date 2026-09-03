import { useCallback, useEffect, useState } from 'react'
import { Button, Dialog, Field, Input } from '../ui'
import { floorDeletionImpact, purgeFloor, FloorApiError } from '../lib/floors'
import type { FloorDeletionImpact, ImpactDisposition, ImpactEntry, PurgeResult } from '../lib/floors'

// EXCLUIR UM ANDAR — dizendo o que se perde, antes do clique.
//
// "Tem certeza?" não é uma pergunta: quem clicou já tinha certeza do que ACHAVA que ia
// acontecer. O que muda a decisão é saber que o Database da empresa fica, que os agentes são
// arquivados e podem voltar, e que um setor de outro andar está usando gente daqui.
//
// O diálogo separa visualmente as cinco consequências, porque elas são cinco decisões
// diferentes — e pede o nome digitado, que é a única confirmação que exige ler antes.

const TITULO: Record<ImpactDisposition, string> = {
  archive: 'Será arquivado',
  delete: 'Será excluído',
  unlink: 'Será desvinculado',
  keep: 'Continuará existindo',
  blocks: 'Impede a exclusão',
}

const TOM: Record<ImpactDisposition, string> = {
  archive: 'var(--intent-warning)',
  delete: 'var(--intent-danger-text)',
  unlink: 'var(--text-muted)',
  keep: 'var(--intent-success)',
  blocks: 'var(--intent-danger-text)',
}

const NOME_DO_TIPO: Record<string, string> = {
  agent: 'agente',
  sector: 'setor',
  flow: 'Flow',
  source: 'fonte',
  monitor: 'monitor',
  database: 'Database',
  databaseGrant: 'acesso a Database',
  app: 'App',
  knowledge: 'conhecimento',
  history: 'histórico',
}

/** "3 setores, 8 agentes e 4 Flows" — a frase que o plano pede, montada do impacto real. */
function resumo(impacto: FloorDeletionImpact): string {
  const partes = Object.entries(impacto.byKind)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${NOME_DO_TIPO[kind] ?? kind}${n > 1 ? 's' : ''}`)
  if (!partes.length) return 'Este andar está vazio.'
  const ultimo = partes.pop()
  return `Excluir “${impacto.floor.name}” afetará ${partes.length ? `${partes.join(', ')} e ${ultimo}` : ultimo}.`
}

function Grupo({ titulo, cor, itens }: { titulo: string; cor: string; itens: ImpactEntry[] }) {
  if (!itens.length) return null
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid={`impacto-grupo-${titulo}`}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: cor }}>
        {titulo} ({itens.length})
      </span>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {itens.slice(0, 12).map((i) => (
          <li key={`${i.kind}:${i.id}`} style={{ fontSize: 12.5, color: 'var(--text-body)' }} data-testid="impacto-item">
            <strong>{i.name}</strong> <span style={{ color: 'var(--text-muted)' }}>({NOME_DO_TIPO[i.kind] ?? i.kind}) — {i.reason}</span>
          </li>
        ))}
        {itens.length > 12 ? (
          <li style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>e mais {itens.length - 12}…</li>
        ) : null}
      </ul>
    </section>
  )
}

export function FloorDeletionDialog({
  open,
  floorId,
  onClose,
  onPurged,
}: {
  open: boolean
  floorId: string
  onClose: () => void
  onPurged: () => void
}) {
  const [impacto, setImpacto] = useState<FloorDeletionImpact | null>(null)
  const [erro, setErro] = useState('')
  const [nome, setNome] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [excluirExclusivos, setExcluirExclusivos] = useState(false)
  const [removerConexoes, setRemoverConexoes] = useState(false)
  const [resultado, setResultado] = useState<PurgeResult | null>(null)

  const carregar = useCallback(async () => {
    setErro('')
    try {
      setImpacto(await floorDeletionImpact(floorId, { deleteExclusiveResources: excluirExclusivos, removeDedicatedConnections: removerConexoes }))
    } catch (e) {
      setErro(e instanceof FloorApiError ? e.message : 'Não foi possível calcular o impacto.')
    }
  }, [floorId, excluirExclusivos, removerConexoes])

  useEffect(() => {
    if (open) void carregar()
  }, [open, carregar])

  const confirmar = async () => {
    if (!impacto) return
    setOcupado(true)
    setErro('')
    try {
      setResultado(await purgeFloor(floorId, { impactHash: impacto.impactHash, confirmationName: nome, choices: { deleteExclusiveResources: excluirExclusivos, removeDedicatedConnections: removerConexoes } }))
    } catch (e) {
      /**
       * O escritório mudou entre a análise e o clique.
       *
       * O servidor devolve conflito com o retrato novo. Recarregar aqui é o que impede a
       * pessoa de confirmar de novo sobre uma foto velha.
       */
      const mensagem = e instanceof FloorApiError ? e.message : 'Não foi possível excluir o andar.'
      // O retrato é recarregado ANTES de anunciar: `carregar()` limpa o erro, e anunciar
      // primeiro faria a mensagem sumir junto com a foto velha.
      if (e instanceof FloorApiError && e.code === 'impact_changed') await carregar()
      setErro(mensagem)
    } finally {
      setOcupado(false)
    }
  }

  const por = (d: ImpactDisposition) => impacto?.entries.filter((e) => e.disposition === d) ?? []
  const bloqueado = (impacto?.blockers.length ?? 0) > 0
  const podeConfirmar = Boolean(impacto) && !bloqueado && nome.trim() === impacto?.floor.name && !ocupado

  if (resultado) {
    return (
      <Dialog open={open} onClose={onPurged} title="Andar excluído" width={520} footer={<Button onClick={onPurged}>Fechar</Button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="purge-resultado">
          <p style={{ margin: 0, fontSize: 13 }}>
            {resultado.removed.length} removido(s), {resultado.unlinked.length} desvinculado(s), {resultado.kept.length} mantido(s).
          </p>
          <Grupo titulo="Removidos" cor={TOM.delete} itens={resultado.removed} />
          <Grupo titulo="Desvinculados" cor={TOM.unlink} itens={resultado.unlinked} />
          <Grupo titulo="Mantidos" cor={TOM.keep} itens={resultado.kept} />
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Excluir andar"
      subtitle={impacto?.floor.name}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={ocupado}>
            Cancelar
          </Button>
          <Button variant="danger" icon="trash-2" onClick={() => void confirmar()} disabled={!podeConfirmar} data-testid="purge-confirmar">
            {ocupado ? 'Excluindo…' : 'Excluir para sempre'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '70dvh', overflowY: 'auto' }}>
        {erro ? (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--intent-danger-text)' }} data-testid="purge-erro">
            {erro}
          </p>
        ) : null}

        {!impacto ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Calculando o impacto…</p>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }} data-testid="impacto-resumo">
              {resumo(impacto)}
            </p>

            {bloqueado ? (
              <div style={{ padding: 10, borderRadius: 8, background: 'var(--intent-danger-soft)' }} data-testid="impacto-bloqueios">
                <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--intent-danger-text)' }}>
                  Não dá para excluir agora:
                </p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {impacto.blockers.map((b) => (
                    <li key={b} style={{ fontSize: 12.5 }}>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Grupo titulo={TITULO.archive} cor={TOM.archive} itens={por('archive')} />
            <Grupo titulo={TITULO.delete} cor={TOM.delete} itens={por('delete')} />
            <Grupo titulo={TITULO.unlink} cor={TOM.unlink} itens={por('unlink')} />
            <Grupo titulo={TITULO.keep} cor={TOM.keep} itens={por('keep')} />
            <Grupo titulo={TITULO.blocks} cor={TOM.blocks} itens={por('blocks')} />

            <section style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={excluirExclusivos}
                  onChange={(e) => setExcluirExclusivos(e.target.checked)}
                  data-testid="purge-excluir-exclusivos"
                />
                <span>
                  Excluir também os recursos exclusivos deste andar, em vez de arquivá-los.
                  <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12 }}>
                    Arquivado pode voltar; excluído, não.
                  </span>
                </span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={removerConexoes}
                  onChange={(e) => setRemoverConexoes(e.target.checked)}
                  data-testid="purge-remover-conexoes"
                />
                <span>
                  Remover conexões dedicadas a este andar.
                  <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12 }}>
                    As conexões da empresa continuam, mesmo que os agentes daqui as usem.
                  </span>
                </span>
              </label>
            </section>

            <Field
              label={`Digite “${impacto.floor.name}” para confirmar`}
              hint="O nome é a confirmação: é o que garante que alguém leu o que está acima."
            >
              <Input value={nome} onChange={(e) => setNome(e.target.value)} data-testid="purge-nome" autoComplete="off" />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  )
}
