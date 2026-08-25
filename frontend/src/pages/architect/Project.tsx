import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { AppLayout } from '../../components/AppLayout'
import { Badge, Button, Card, Icon } from '../../ui'
import * as api from '../../lib/architect'
import type { ApplyResponse, ArchitectMessage, ArchitectPreview, ArchitectProject, ArchitectQuestion } from '../../lib/architect'
import { Conversation } from './Conversation'
import { Proposal } from './Proposal'
import { Checklist } from './Checklist'
import { ApplyDialog } from './ApplyDialog'
import { STATUS_LABEL, statusTone } from './shared'

type Aba = 'conversa' | 'proposta' | 'checklist'
const ABAS: { key: Aba; label: string }[] = [
  { key: 'conversa', label: 'Conversa' },
  { key: 'proposta', label: 'Proposta' },
  { key: 'checklist', label: 'Checklist' },
]

export function ArchitectProject() {
  const { projectId = '' } = useParams()
  const [projeto, setProjeto] = useState<ArchitectProject | null>(null)
  const [mensagens, setMensagens] = useState<ArchitectMessage[]>([])
  const [pergunta, setPergunta] = useState<ArchitectQuestion | null>(null)
  const [previa, setPrevia] = useState<ArchitectPreview | null>(null)
  const [links, setLinks] = useState<ApplyResponse['links']>([])
  const [pendente, setPendente] = useState(false)
  const [erro, setErro] = useState<{ code: string; message: string } | null>(null)
  const [dialogo, setDialogo] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [aba, setAba] = useState<Aba>('conversa')

  const recarregarPrevia = useCallback(
    async (p: ArchitectProject) => {
      if (!p.hasBlueprint) return setPrevia(null)
      try {
        setPrevia(await api.previewProject(p.id))
      } catch {
        setPrevia(null)
      }
    },
    [],
  )

  useEffect(() => {
    if (!projectId) return
    Promise.all([api.getProject(projectId), api.listMessages(projectId)])
      .then(async ([p, m]) => {
        setProjeto(p)
        setMensagens(m)
        if (p.pendingQuestion) setPergunta({ ...p.pendingQuestion, why: '', allowUnknown: true })
        await recarregarPrevia(p)
      })
      .catch((e: Error) => setErro({ code: 'load', message: e.message }))
  }, [projectId, recarregarPrevia])

  const registrar = async (fn: () => Promise<api.TurnResponse>) => {
    setPendente(true)
    setErro(null)
    try {
      const r = await fn()
      setProjeto(r)
      setPergunta(r.question)
      setMensagens(await api.listMessages(projectId))
      await recarregarPrevia(r)
      if (r.hasBlueprint) setAba((atual) => (atual === 'conversa' ? atual : 'proposta'))
    } catch (e) {
      const err = e as api.ArchitectError
      setErro({ code: err.code ?? 'error', message: err.message })
      setMensagens(await api.listMessages(projectId).catch(() => mensagens))
    } finally {
      setPendente(false)
    }
  }

  const enviar = (texto: string) => {
    setMensagens((atual) => [...atual, { id: `local-${Date.now()}`, role: 'user', content: texto, createdAt: new Date().toISOString() }])
    return registrar(() => api.sendMessage(projectId, texto))
  }

  async function revisar() {
    setErro(null)
    try {
      await api.validateProject(projectId)
      const p = await api.getProject(projectId)
      setProjeto(p)
      await recarregarPrevia(p)
      setAba('proposta')
    } catch (e) {
      setErro({ code: 'validate', message: (e as Error).message })
    }
  }

  async function abrirAplicacao() {
    await revisar()
    setDialogo(true)
  }

  async function aplicar(approvedAppKeys: string[]) {
    if (!previa) return
    setAplicando(true)
    setErro(null)
    try {
      const r = await api.applyProject(projectId, {
        blueprintHash: previa.blueprintHash,
        idempotencyKey: api.idempotencyKeyFor(projectId, previa.blueprintHash),
        approvedAppKeys,
      })
      setProjeto(r)
      setLinks(r.links)
      setDialogo(false)
      setAba('checklist')
    } catch (e) {
      setErro({ code: (e as api.ArchitectError).code ?? 'apply', message: (e as Error).message })
    } finally {
      setAplicando(false)
    }
  }

  const comResultado = async (fn: () => Promise<ApplyResponse>) => {
    setPendente(true)
    setErro(null)
    try {
      const r = await fn()
      setProjeto(r)
      setLinks(r.links ?? [])
    } catch (e) {
      setErro({ code: (e as api.ArchitectError).code ?? 'error', message: (e as Error).message })
    } finally {
      setPendente(false)
    }
  }

  async function marcar(itemId: string, done: boolean) {
    try {
      setProjeto(await api.markChecklistItem(projectId, itemId, done))
    } catch (e) {
      setErro({ code: 'checklist', message: (e as Error).message })
    }
  }

  if (!projeto) {
    return (
      <AppLayout current="/architect" title="Montar operação">
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{erro ? erro.message : 'Carregando…'}</p>
      </AppLayout>
    )
  }

  const aplicado = projeto.status === 'applied'
  const conversa = (
    <Conversation
      messages={mensagens}
      question={pergunta}
      pending={pendente}
      disabled={aplicado || projeto.status === 'archived'}
      onSend={enviar}
      onGenerate={() => registrar(() => api.generateProposal(projectId))}
    />
  )
  const proposta = <Proposal project={projeto} preview={previa} carregando={pendente} onRevisar={revisar} onAplicar={abrirAplicacao} />
  const checklist = <Checklist project={projeto} links={links} onMarcar={marcar} onReconferir={() => comResultado(() => api.recheckProject(projectId))} carregando={pendente} />

  return (
    <AppLayout
      current="/architect"
      title={projeto.title}
      titleExtra={<Badge tone={statusTone(projeto.status)} data-testid="architect-status">{STATUS_LABEL[projeto.status]}</Badge>}
      subtitle={projeto.objective}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {erro && (
          <Card>
            <div className="flex flex-col gap-2" data-testid="architect-error">
              <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger)' }}>
                {erro.message}
              </p>
              {/* Cada recusa leva a um lugar diferente. Uma mensagem só deixaria a
                  pessoa sem saber o que fazer a seguir. */}
              {erro.code === 'no_provider_key' && (
                <a href="/settings" style={{ fontSize: 13, color: 'var(--intent-brand)' }} data-testid="architect-settings-link">
                  Abrir Configurações
                </a>
              )}
              {projeto.status === 'failed' && (
                <div>
                  <Button onClick={() => comResultado(() => api.resumeProject(projectId))} data-testid="architect-resume">
                    Retomar de onde parou
                  </Button>
                </div>
              )}
            </div>
          </Card>
        )}

        {projeto.status === 'failed' && !erro && (
          <Card>
            <div className="flex flex-col gap-2" data-testid="architect-failed">
              <p style={{ fontSize: 13 }}>A aplicação parou no meio. O que já foi criado continua de pé.</p>
              <div>
                <Button onClick={() => comResultado(() => api.resumeProject(projectId))} data-testid="architect-resume">
                  Retomar de onde parou
                </Button>
              </div>
            </div>
          </Card>
        )}

        {aplicado && links.length > 0 && (
          <Card>
            <div className="flex flex-wrap items-center gap-2" data-testid="architect-links">
              <Icon name="check" size={16} color="var(--intent-success)" />
              <span style={{ fontSize: 13 }}>Pronto. O que foi criado:</span>
              {links.map((l) => (
                <a key={`${l.kind}-${l.key}`} href={l.path} style={{ fontSize: 13, color: 'var(--intent-brand)' }} data-testid={`architect-link-${l.kind}`}>
                  {l.key}
                </a>
              ))}
            </div>
          </Card>
        )}

        {/* Celular: uma coluna e três abas. Desktop: conversa à esquerda, painel à
            direita — as abas somem porque as duas colunas cabem ao mesmo tempo. */}
        <nav className="flex gap-2 lg:hidden" data-testid="architect-tabs">
          {ABAS.map((a) => (
            <button
              key={a.key}
              type="button"
              data-testid={`architect-tab-${a.key}`}
              aria-current={aba === a.key ? 'page' : undefined}
              onClick={() => setAba(a.key)}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 40,
                borderRadius: 999,
                border: '1px solid var(--border-subtle)',
                background: aba === a.key ? 'var(--intent-brand)' : 'var(--surface-card)',
                color: aba === a.key ? '#fff' : 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              {a.label}
            </button>
          ))}
        </nav>

        {/* Cada painel é montado UMA vez; quem esconde é o CSS. Montar duas vezes
            (uma para o desktop, outra para o celular) duplicaria o estado e faria a
            mesma tela responder a dois cliques diferentes. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <div className={`min-w-0 flex-col lg:flex lg:flex-1 ${aba === 'conversa' ? 'flex' : 'hidden'}`}>{conversa}</div>
          <div className={`min-w-0 flex-col gap-3 overflow-y-auto lg:flex lg:w-[380px] lg:shrink-0 ${aba === 'conversa' ? 'hidden' : 'flex'}`}>
            <div className={`flex-col lg:flex ${aba === 'proposta' ? 'flex' : 'hidden'}`}>{proposta}</div>
            <div className={`flex-col lg:flex ${aba === 'checklist' ? 'flex' : 'hidden'}`}>{checklist}</div>
          </div>
        </div>
      </div>

      {previa && (
        <ApplyDialog
          preview={previa}
          aberto={dialogo}
          aplicando={aplicando}
          erro={erro && dialogo ? erro.message : null}
          onFechar={() => setDialogo(false)}
          onConfirmar={aplicar}
        />
      )}
    </AppLayout>
  )
}
