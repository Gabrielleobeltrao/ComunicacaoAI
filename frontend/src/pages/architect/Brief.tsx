import { useState } from 'react'
import { Badge, Button, Card, Input, Textarea } from '../../ui'
import type { ArchitectProject, OperationBrief } from '../../lib/architect'

// O QUE EU ENTENDI — os fatos, antes do desenho.
//
// Esta é a tela que responde "de onde veio esta proposta?". Enquanto ela não existia, a
// única forma de corrigir um entendimento errado era reabrir a conversa e torcer para o
// modelo mudar de ideia — e a pessoa descobria o mal-entendido olhando um organograma,
// que é o lugar mais caro possível para descobrir isso.
//
// Corrigir aqui refaz o desenho na hora, sem inferência: ele é compilado destes fatos.

const CAMPOS: { nome: keyof Trabalho; label: string; hint: string }[] = [
  { nome: 'name', label: 'O trabalho', hint: 'o que precisa acontecer' },
  { nome: 'trigger', label: 'Quando começa', hint: 'o que dispara' },
  { nome: 'input', label: 'O que chega', hint: 'a informação de entrada' },
  { nome: 'decision', label: 'O que precisa ser decidido', hint: 'deixe vazio se não há julgamento' },
  { nome: 'action', label: 'O que é feito', hint: 'a ação' },
  { nome: 'output', label: 'O que sai', hint: 'a entrega' },
]

type Trabalho = OperationBrief['jobs'][number]

const rotulo = { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: 'var(--text-faint)' }

export function Brief({
  project,
  editavel,
  carregando,
  onCorrigir,
  onDesfazer,
}: {
  project: ArchitectProject
  editavel: boolean
  carregando: boolean
  onCorrigir: (patch: Partial<OperationBrief>) => Promise<void>
  onDesfazer: () => Promise<void>
}) {
  const [editando, setEditando] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Trabalho | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const brief = project.brief
  if (!brief || (!brief.businessGoal && brief.jobs.length === 0)) return null

  const salvar = async (patch: Partial<OperationBrief>) => {
    setSalvando(true)
    setErro(null)
    try {
      await onCorrigir(patch)
      setEditando(null)
      setRascunho(null)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const salvarTrabalho = () => {
    if (!rascunho) return
    return salvar({ jobs: brief.jobs.map((j) => (j.id === rascunho.id ? rascunho : j)) })
  }

  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="architect-brief">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 13 }}>O que eu entendi</strong>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              A proposta é montada a partir daqui. Corrigir um destes fatos refaz o desenho — sem custar uma nova conversa.
            </p>
          </div>
          {/* Desfazer devolve o entendimento anterior E o desenho que vinha dele. Uma
              correção errada não deveria custar recomeçar a entrevista. */}
          {editavel && project.canUndoBrief && (
            <Button variant="secondary" onClick={onDesfazer} disabled={carregando || salvando} data-testid="architect-brief-undo">
              Desfazer a última correção
            </Button>
          )}
        </div>

        {brief.businessGoal && (
          <div>
            <span style={rotulo}>O objetivo</span>
            <p style={{ fontSize: 13 }} data-testid="architect-brief-goal">
              {brief.businessGoal}
            </p>
          </div>
        )}

        {brief.channels.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span style={rotulo}>Por onde as pessoas falam</span>
            {brief.channels.map((c) => (
              <Badge key={c}>{c}</Badge>
            ))}
          </div>
        )}

        {brief.jobs.length > 0 && (
          <div className="flex flex-col gap-2">
            <span style={rotulo}>O que precisa acontecer</span>
            {brief.jobs.map((j) =>
              editando === j.id && rascunho ? (
                <div key={j.id} className="flex flex-col gap-2" style={{ padding: 10, borderRadius: 10, background: 'var(--surface-sunken)' }} data-testid={`architect-brief-edit-${j.id}`}>
                  {CAMPOS.map((campo) => (
                    <label key={campo.nome} className="flex flex-col gap-1" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {campo.label}
                      <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{campo.hint}</span>
                      {campo.nome === 'name' ? (
                        <Input
                          value={rascunho.name}
                          onChange={(e) => setRascunho({ ...rascunho, name: e.target.value })}
                          data-testid={`architect-brief-field-${campo.nome}`}
                        />
                      ) : (
                        <Textarea
                          rows={2}
                          value={String(rascunho[campo.nome] ?? '')}
                          onChange={(e) => setRascunho({ ...rascunho, [campo.nome]: e.target.value })}
                          data-testid={`architect-brief-field-${campo.nome}`}
                        />
                      )}
                    </label>
                  ))}
                  {erro && (
                    <p style={{ fontSize: 12.5, color: 'var(--intent-danger-text)' }} data-testid="architect-brief-error">
                      {erro}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={salvarTrabalho} disabled={salvando} data-testid="architect-brief-save">
                      Salvar e refazer a proposta
                    </Button>
                    <Button variant="secondary" onClick={() => setEditando(null)} disabled={salvando}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => {
                    if (!editavel) return
                    setErro(null)
                    setRascunho(j)
                    setEditando(j.id)
                  }}
                  disabled={!editavel || carregando}
                  data-testid={`architect-brief-job-${j.id}`}
                  className="flex flex-col gap-1"
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 10,
                    border: '1px solid var(--border-subtle)',
                    background: 'transparent',
                    cursor: editavel ? 'pointer' : 'default',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{j.name}</span>
                  {/* A frase inteira do trabalho, na ordem em que ele acontece. Campos
                      soltos com rótulo obrigam a pessoa a remontar a frase de cabeça. */}
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {[
                      j.trigger && `Quando ${j.trigger}`,
                      j.input && `recebe ${j.input}`,
                      j.decision && `decide ${j.decision}`,
                      j.action && `então ${j.action}`,
                      j.output && `e entrega ${j.output}`,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </button>
              ),
            )}
          </div>
        )}

        {brief.knowledgeNeeds.length > 0 && (
          <div className="flex flex-col gap-1">
            <span style={rotulo}>O que ele precisa saber</span>
            {brief.knowledgeNeeds.map((k) => (
              <p key={k.subject} style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {k.subject}
                {k.required && <span style={{ color: 'var(--intent-warning)' }}> — sem isto ele responde por conta própria</span>}
              </p>
            ))}
          </div>
        )}

        {brief.openQuestions.length > 0 && (
          <div className="flex flex-col gap-1">
            <span style={rotulo}>O que ainda não sei</span>
            {brief.openQuestions.map((q) => (
              <p key={q} style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {q}
              </p>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
