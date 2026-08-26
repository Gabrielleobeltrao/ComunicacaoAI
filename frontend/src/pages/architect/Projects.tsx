import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { AppLayout } from '../../components/AppLayout'
import { Badge, Button, Card, Dialog, EmptyState, Icon, IconButton, Textarea } from '../../ui'
import { createProject, deleteProject, listProjects } from '../../lib/architect'
import type { ArchitectProject } from '../../lib/architect'
import { STATUS_LABEL, statusTone } from './shared'

const EXEMPLOS = [
  'Quero automatizar o atendimento do meu restaurante',
  'Quero qualificar os contatos que chegam pelo site',
  'Quero acompanhar os pedidos e avisar o cliente sozinho',
]

export function ArchitectProjects() {
  const navigate = useNavigate()
  const [projetos, setProjetos] = useState<ArchitectProject[] | null>(null)
  const [objetivo, setObjetivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)
  /** A conversa que está prestes a sumir. Apagar sem perguntar não é opção. */
  const [aApagar, setAApagar] = useState<ArchitectProject | null>(null)
  const [apagando, setApagando] = useState(false)

  useEffect(() => {
    listProjects()
      .then(setProjetos)
      .catch((e: Error) => {
        setProjetos([])
        setErro(e.message)
      })
  }, [])

  async function criar() {
    const texto = objetivo.trim()
    if (!texto || criando) return
    setCriando(true)
    setErro(null)
    try {
      const projeto = await createProject(texto)
      navigate(`/architect/${projeto.id}`)
    } catch (e) {
      setErro((e as Error).message)
      setCriando(false)
    }
  }

  async function apagar() {
    if (!aApagar) return
    setApagando(true)
    setErro(null)
    try {
      await deleteProject(aApagar.id)
      // A lista vem do servidor de novo: uma remoção só no estado local mente se a
      // chamada tiver falhado no meio.
      setProjetos(await listProjects())
      setAApagar(null)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setApagando(false)
    }
  }

  return (
    <AppLayout current="/architect" title="Montar operação" subtitle="Descreva o resultado que você quer. O sistema faz as perguntas e propõe a estrutura.">
      <div className="flex flex-col gap-4" data-testid="architect-projects">
        <Card>
          <div className="flex flex-col gap-3">
            <label htmlFor="architect-objetivo" style={{ fontSize: 13, fontWeight: 600 }}>
              O que você quer que aconteça?
            </label>
            <Textarea
              id="architect-objetivo"
              data-testid="architect-objective"
              rows={3}
              value={objetivo}
              placeholder="Ex.: Quero automatizar o atendimento do meu restaurante"
              onChange={(e) => setObjetivo(e.target.value)}
            />
            {/* Exemplos clicáveis: a primeira tela não pode ser uma folha em branco. */}
            <div className="flex flex-wrap gap-2">
              {EXEMPLOS.map((exemplo) => (
                <button
                  key={exemplo}
                  type="button"
                  data-testid="architect-example"
                  onClick={() => setObjetivo(exemplo)}
                  style={{
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--surface-sunken)',
                    color: 'var(--text-muted)',
                    borderRadius: 999,
                    padding: '6px 12px',
                    fontSize: 12,
                    minHeight: 32,
                  }}
                >
                  {exemplo}
                </button>
              ))}
            </div>
            {erro && (
              <p role="alert" style={{ color: 'var(--intent-danger)', fontSize: 13 }} data-testid="architect-error">
                {erro}
              </p>
            )}
            <div>
              <Button onClick={criar} disabled={!objetivo.trim() || criando} data-testid="architect-start">
                {criando ? 'Começando…' : 'Começar'}
              </Button>
            </div>
          </div>
        </Card>

        {projetos === null ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Carregando…</p>
        ) : projetos.length === 0 ? (
          <EmptyState icon="sparkles" title="Nenhuma operação montada ainda" body="Descreva acima o que você quer e o Arquiteto começa a perguntar." />
        ) : (
          <div className="flex flex-col gap-2" data-testid="architect-list">
            {projetos.map((p) => (
              /* Abrir e apagar são dois controles: um botão dentro de outro não é
                 clicável de forma previsível — nem pelo mouse, nem pelo teclado. */
              <div
                key={p.id}
                className="flex items-start gap-2"
                style={{ border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--surface-card)', padding: 14 }}
              >
                <button
                  type="button"
                  data-testid={`architect-project-${p.id}`}
                  onClick={() => navigate(`/architect/${p.id}`)}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'transparent', padding: 0, minHeight: 44, cursor: 'pointer' }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span style={{ fontWeight: 600 }}>{p.title}</span>
                    <Badge tone={statusTone(p.status)}>{STATUS_LABEL[p.status]}</Badge>
                    {p.readiness.requiredTotal > 0 && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {p.readiness.requiredDone}/{p.readiness.requiredTotal} obrigatórios
                      </span>
                    )}
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>{p.objective}</p>
                </button>
                {/* Enquanto aplica, não: a operação em andamento escreve no escritório,
                    e sumir com o registro dela deixaria trabalho sem quem retomasse. */}
                <IconButton
                  icon="trash-2"
                  label={`Apagar “${p.title}”`}
                  disabled={p.status === 'applying'}
                  onClick={() => setAApagar(p)}
                  data-testid={`architect-delete-${p.id}`}
                />
              </div>
            ))}
          </div>
        )}

        <p style={{ color: 'var(--text-muted)', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="info" size={14} />
          Nada é criado antes de você revisar e confirmar.
        </p>

        {/* O que a conversa CRIOU não vai junto — e a tela diz isso antes, não depois. */}
        <Dialog
          open={aApagar !== null}
          title="Apagar esta conversa?"
          subtitle={aApagar?.title}
          onClose={() => (apagando ? undefined : setAApagar(null))}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setAApagar(null)} disabled={apagando}>
                Cancelar
              </Button>
              <Button onClick={() => void apagar()} disabled={apagando} data-testid="architect-delete-confirm">
                {apagando ? 'Apagando…' : 'Apagar conversa'}
              </Button>
            </div>
          }
        >
          <p style={{ fontSize: 13.5, margin: 0 }}>
            A conversa e as mensagens somem. <strong>O que ela já criou continua de pé</strong> — andar, agentes e setores
            seguem funcionando e podem ser editados pelas telas de sempre.
          </p>
          {erro && (
            <p role="alert" style={{ color: 'var(--intent-danger)', fontSize: 13 }} data-testid="architect-delete-error">
              {erro}
            </p>
          )}
        </Dialog>
      </div>
    </AppLayout>
  )
}
