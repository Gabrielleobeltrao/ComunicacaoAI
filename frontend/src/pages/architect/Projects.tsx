import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { AppLayout } from '../../components/AppLayout'
import { Badge, Button, Card, EmptyState, Icon, Textarea } from '../../ui'
import { createProject, listProjects } from '../../lib/architect'
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
              <button
                key={p.id}
                type="button"
                data-testid={`architect-project-${p.id}`}
                onClick={() => navigate(`/architect/${p.id}`)}
                style={{
                  textAlign: 'left',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 12,
                  background: 'var(--surface-card)',
                  padding: 14,
                  minHeight: 44,
                }}
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
            ))}
          </div>
        )}

        <p style={{ color: 'var(--text-muted)', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="info" size={14} />
          Nada é criado antes de você revisar e confirmar.
        </p>
      </div>
    </AppLayout>
  )
}
