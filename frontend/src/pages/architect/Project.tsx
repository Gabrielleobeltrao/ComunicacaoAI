import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { AppLayout } from '../../components/AppLayout'
import { Badge, Button, Card, Icon } from '../../ui'
import * as api from '../../lib/architect'
import type { ApplyResponse, ApplyStep, ArchitectMessage, ArchitectPreview, ArchitectProject, ArchitectQuestion, BlueprintLink } from '../../lib/architect'
import { Conversation } from './Conversation'
import { Proposal } from './Proposal'
import { Brief } from './Brief'
import { Checklist } from './Checklist'
import { ApplyDialog } from './ApplyDialog'
import { Advanced } from './Advanced'
import { Flow } from './Flow'
import { OfficePreview } from './OfficePreview'
import { ResourceLinks } from './ResourceLinks'
import { STATUS_LABEL, statusTone } from './shared'

/** Onde ainda dá para mexer na proposta. Aplicada ou arquivada, o servidor recusa. */
const EDITAVEL: api.ArchitectStatus[] = ['discovery', 'draft', 'ready']

/**
 * A área de trabalho tem QUATRO telas, e mostra uma por vez.
 *
 * Antes eram painéis lado a lado disputando a mesma largura: a proposta espremida numa
 * coluna, a conversa em outra, e o resto empilhado embaixo. Cada uma destas responde a
 * uma pergunta diferente — o que vai ser feito, como vai funcionar, como vai ficar, e o
 * que falta — e nenhuma delas cabe em meia tela.
 */
type Tela = 'proposta' | 'fluxo' | 'escritorio' | 'checklist'
const TELAS: { key: Tela; label: string }[] = [
  { key: 'proposta', label: 'Proposta' },
  { key: 'fluxo', label: 'Fluxo' },
  { key: 'escritorio', label: 'Escritório' },
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
  // Por onde uma entrega pode sair. Carregado junto com a prévia: sem a lista, o diálogo
  // ofereceria uma escolha vazia.
  const [conexoes, setConexoes] = useState<{ id: string; name: string; provider: string }[]>([])
  const [aplicando, setAplicando] = useState(false)
  const [tela, setTela] = useState<Tela>('proposta')
  // A conversa fechada vira um botão flutuante. Estado da aba, não do servidor: é
  // preferência de quem está olhando agora.
  const [chatAberto, setChatAberto] = useState(true)
  // A rodada automática vale UMA vez por projeto. O efeito pode ser remontado, e cada
  // remontagem seria outra chamada ao modelo — cobrada.
  const jaIniciou = useRef<string | null>(null)
  const [passos, setPassos] = useState<ApplyStep[]>([])
  const [resultadoDesfazer, setResultadoDesfazer] = useState<{ removed: string[]; kept: { key: string; reason: string }[] } | null>(null)

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
        // Os links vêm do servidor, e não da memória desta aba: recarregar a página de
        // um projeto aplicado precisa reconstruir os caminhos para o que foi criado.
        setLinks(p.links ?? [])
        if (p.pendingQuestion) setPergunta({ ...p.pendingQuestion, why: '', allowUnknown: true })
        await recarregarPrevia(p)

        // A descrição já é a primeira mensagem. Sem esta rodada, a tela abria com o que
        // a pessoa escreveu e um silêncio — ela teria que reenviar para começar.
        if (p.status === 'discovery' && !p.hasBlueprint && !p.pendingQuestion && m.length === 1 && jaIniciou.current !== projectId) {
          jaIniciou.current = projectId
          await registrar(() => api.advanceTurn(projectId))
        }
      })
      .catch((e: Error) => setErro({ code: 'load', message: e.message }))
    // `registrar` depende do estado da conversa e não deve reagendar esta carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      /**
       * Uma revisão NÃO troca a tela.
       *
       * Quem pediu "muda o nome da Marina" está olhando o desenho ou a lista, e é ali
       * que a mudança precisa aparecer — arrastar a pessoa para a Proposta a cada
       * resposta faria a conversa disputar o lugar com o que ela mesma alterou. A tela
       * só muda por clique na aba, ou quando a aplicação termina (aí vai para a
       * checklist, que é o que sobra a fazer).
       */
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

  /**
   * Uma correção à mão na proposta. Não chama o modelo — e por isso o erro sobe: quem
   * mostra a recusa é o próprio item, ao lado do campo que a pessoa acabou de mexer.
   */
  async function editarProposta(edits: api.BlueprintEdit[]) {
    const p = await api.editBlueprint(projectId, edits)
    setProjeto(p)
    await recarregarPrevia(p)
  }

  /**
   * Trocar a camada é uma REVISÃO, não um filtro: muda o que vai ser criado, então
   * derruba para rascunho e invalida o hash confirmado. A tela recarrega a prévia
   * porque o crítico e o ensaio são refeitos para o recorte novo.
   */
  async function trocarCamada(layer: api.BlueprintLayer) {
    setPendente(true)
    setErro(null)
    try {
      const p = await api.setLayer(projectId, layer)
      setProjeto(p)
      await recarregarPrevia(p)
    } catch (e) {
      setErro({ code: (e as api.ArchitectError).code ?? 'layer', message: (e as Error).message })
    } finally {
      setPendente(false)
    }
  }

  /** Corrigir o entendimento refaz o desenho — sem passar pelo modelo. */
  async function corrigirBrief(patch: Partial<api.OperationBrief>) {
    const p = await api.editBrief(projectId, patch)
    setProjeto(p)
    await recarregarPrevia(p)
  }

  async function desfazerBrief() {
    setPendente(true)
    setErro(null)
    try {
      const p = await api.undoBrief(projectId)
      setProjeto(p)
      await recarregarPrevia(p)
    } catch (e) {
      setErro({ code: (e as api.ArchitectError).code ?? 'brief', message: (e as Error).message })
    } finally {
      setPendente(false)
    }
  }

  async function revisar() {
    setErro(null)
    try {
      await api.validateProject(projectId)
      const p = await api.getProject(projectId)
      setProjeto(p)
      await recarregarPrevia(p)
      // A REGRA, dita nos dois lugares em que ela vale: revisar e aplicar são cliques na
      // Proposta, e mostram a Proposta — o resultado da validação aparece onde o botão
      // estava. Uma revisão vinda da CONVERSA não mexe na tela: quem pediu a mudança
      // está olhando o desenho ou a lista, e é ali que ela precisa aparecer.
      setTela('proposta')
    } catch (e) {
      setErro({ code: 'validate', message: (e as Error).message })
    }
  }

  async function abrirAplicacao() {
    await revisar()
    // Falhar aqui não pode impedir de aplicar: sem conexões, a entrega vira pendência, que
    // é exatamente o que ela já seria.
    await api
      .listTargets()
      .then((t) => setConexoes(t.connections ?? []))
      .catch(() => setConexoes([]))
    setDialogo(true)
  }

  async function aplicar(aprovado: { approvedAppKeys: string[]; approvedUpdateKeys: string[]; approvedActivationKeys: string[] }) {
    if (!previa) return
    setAplicando(true)
    setErro(null)
    try {
      const r = await api.applyProject(projectId, {
        blueprintHash: previa.blueprintHash,
        idempotencyKey: api.idempotencyKeyFor(projectId, previa.blueprintHash),
        ...aprovado,
      })
      setProjeto(r)
      setLinks(r.links)
      setPassos(r.operation?.steps ?? [])
      setDialogo(false)
      setTela('checklist')
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
      if (r.operation?.steps) setPassos(r.operation.steps)
    } catch (e) {
      setErro({ code: (e as api.ArchitectError).code ?? 'error', message: (e as Error).message })
    } finally {
      setPendente(false)
    }
  }

  async function salvarLigacoes(links: BlueprintLink[]) {
    setPendente(true)
    setErro(null)
    try {
      const p = await api.setLinks(projectId, links)
      setProjeto(p)
      await recarregarPrevia(p)
    } catch (e) {
      setErro({ code: 'links', message: (e as Error).message })
    } finally {
      setPendente(false)
    }
  }

  async function trocarProvedor(patch: { provider?: 'anthropic' | 'openai'; model?: string | null }) {
    try {
      setProjeto(await api.patchProject(projectId, patch))
    } catch (e) {
      setErro({ code: 'provider', message: (e as Error).message })
    }
  }

  async function arquivar() {
    try {
      setProjeto(await api.archiveProject(projectId))
    } catch (e) {
      setErro({ code: 'archive', message: (e as Error).message })
    }
  }

  async function desfazer() {
    setPendente(true)
    setErro(null)
    try {
      const r = await api.rollbackProject(projectId)
      setProjeto(r)
      setLinks([])
      setResultadoDesfazer({ removed: r.removed, kept: r.kept })
    } catch (e) {
      setErro({ code: 'rollback', message: (e as Error).message })
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
      <AppLayout current="/architect" title="Arquiteto · Montar operação">
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
      // A conversa não fecha ao aplicar: é por ela que se pede o ajuste seguinte, e a
      // rodada nova vem apoiada no que já foi criado. Só o arquivado silencia.
      disabled={projeto.status === 'archived'}
      onSend={enviar}
      onGenerate={() => registrar(() => api.generateProposal(projectId))}
    />
  )
  const proposta = (
    <div className="flex flex-col gap-3">
      {/* O ENTENDIMENTO antes do desenho: é dele que a proposta é compilada, e é onde
          um mal-entendido custa menos para corrigir. */}
      <Brief project={projeto} editavel={EDITAVEL.includes(projeto.status)} carregando={pendente} onCorrigir={corrigirBrief} onDesfazer={desfazerBrief} />
      {EDITAVEL.includes(projeto.status) && projeto.hasBlueprint && <ResourceLinks project={projeto} onSalvar={salvarLigacoes} carregando={pendente} />}
      <Proposal
        project={projeto}
        preview={previa}
        carregando={pendente}
        editavel={EDITAVEL.includes(projeto.status)}
        onEditar={editarProposta}
        onRevisar={revisar}
        onAplicar={abrirAplicacao}
        onTrocarCamada={trocarCamada}
      />
      <Advanced project={projeto} steps={passos} onTrocarProvedor={trocarProvedor} onArquivar={arquivar} onDesfazer={desfazer} carregando={pendente} />
    </div>
  )
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
              <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger-text)' }}>
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

        {projeto.status === 'applying' && (
          <Card>
            <div className="flex flex-col gap-2" data-testid="architect-applying">
              <p style={{ fontSize: 13 }}>Esta aplicação está em andamento. Se ela tiver parado, dá para retomar de onde parou.</p>
              <div>
                <Button onClick={() => comResultado(() => api.resumeProject(projectId))} disabled={pendente} data-testid="architect-resume">
                  Retomar de onde parou
                </Button>
              </div>
            </div>
          </Card>
        )}

        {resultadoDesfazer && (
          <Card>
            <div className="flex flex-col gap-1" data-testid="architect-rollback-result">
              <strong style={{ fontSize: 13 }}>Desfeito</strong>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{resultadoDesfazer.removed.length} removidos.</p>
              {resultadoDesfazer.kept.map((k) => (
                <p key={k.key} style={{ fontSize: 12.5 }}>
                  {k.key} ficou: {k.reason}
                </p>
              ))}
            </div>
          </Card>
        )}

        {projeto.status === 'failed' && !erro && (
          <Card>
            <div className="flex flex-col gap-2" data-testid="architect-failed">
              <p style={{ fontSize: 13 }}>
                A aplicação parou no meio. O que já foi criado continua de pé{passos.length > 0 ? `: ${passos.filter((s) => s.status === 'created').length} recursos.` : '.'}
              </p>
              {projeto.applyState?.error && (
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="architect-failure-reason">
                  {projeto.applyState.error}
                </p>
              )}
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

        {/* A navegação entre as quatro telas. Uma por vez, e a mesma no celular e no
            desktop: duas navegações diferentes para o mesmo conteúdo é o que fazia a
            versão de telefone e a de computador divergirem a cada mudança. */}
        {projeto.hasBlueprint && (
          <nav className="flex flex-wrap gap-2" role="tablist" aria-label="Áreas da operação" data-testid="architect-tabs">
            {TELAS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tela === t.key}
                aria-current={tela === t.key ? 'page' : undefined}
                data-testid={`architect-tab-${t.key}`}
                onClick={() => setTela(t.key)}
                style={{
                  minHeight: 40,
                  padding: '0 16px',
                  borderRadius: 999,
                  border: '1px solid var(--border-subtle)',
                  background: tela === t.key ? 'var(--intent-brand)' : 'var(--surface-card)',
                  color: tela === t.key ? '#fff' : 'var(--text-muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}

        {/* A tela escolhida, no meio e com largura de trabalho. O chat NÃO entra neste
            fluxo: ele flutua, justamente para não roubar largura de nada aqui. */}
        <div className="flex w-full min-w-0 flex-col" data-testid="architect-workspace">
          {!projeto.hasBlueprint ? null : tela === 'proposta' ? (
            proposta
          ) : tela === 'fluxo' ? (
            <Flow blueprint={projeto.blueprint} />
          ) : tela === 'escritorio' ? (
            <OfficePreview blueprint={projeto.blueprint} />
          ) : (
            checklist
          )}
        </div>

        {/* A CONVERSA — uma instância só, sempre no mesmo lugar da árvore.
            Montar uma para o desktop e outra para o celular duplicaria o estado: o que
            você digitou numa não estaria na outra. Quem muda é a posição:

            * sem proposta, ela é a tela (centrada, no fluxo da página);
            * com proposta, ela vira janela flutuante no canto — fixa, então não tira
              largura da proposta, do fluxo, do escritório nem da checklist;
            * no celular, nunca sobrepõe: fica abaixo do conteúdo, na coluna. */}
        <aside
          aria-label="Conversa com o Arquiteto"
          data-testid="architect-chat-panel"
          className={
            projeto.hasBlueprint
              ? `mt-4 flex min-w-0 flex-col lg:fixed lg:bottom-6 lg:right-6 lg:z-30 lg:mt-0 lg:w-[420px] ${chatAberto ? 'lg:flex' : 'lg:hidden'}`
              : 'mx-auto flex min-h-0 w-full min-w-0 flex-col lg:max-w-3xl'
          }
          style={
            projeto.hasBlueprint
              ? {
                  borderRadius: 'var(--radius-card)',
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                  boxShadow: 'var(--shadow-raised)',
                  maxHeight: 'min(70dvh, 640px)',
                }
              : undefined
          }
        >
          {projeto.hasBlueprint && (
            <div className="hidden lg:flex" style={{ alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 0' }}>
              <strong style={{ fontSize: 13 }}>Arquiteto</strong>
              <button
                type="button"
                onClick={() => setChatAberto(false)}
                data-testid="architect-chat-collapse"
                aria-label="Fechar a conversa"
                style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', fontSize: 12.5, minHeight: 32, cursor: 'pointer' }}
              >
                Fechar
              </button>
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col" style={projeto.hasBlueprint ? { padding: '0 14px 12px' } : undefined}>
            {conversa}
          </div>
        </aside>

        {/* Fechada, ela não some: viraria a perda do único caminho para pedir mudança. */}
        {projeto.hasBlueprint && !chatAberto && (
          <button
            type="button"
            onClick={() => setChatAberto(true)}
            data-testid="architect-chat-open"
            className="hidden lg:flex"
            style={{
              position: 'fixed',
              right: 24,
              bottom: 24,
              zIndex: 30,
              alignItems: 'center',
              gap: 8,
              padding: '12px 18px',
              borderRadius: 999,
              border: '1px solid var(--border-subtle)',
              background: 'var(--intent-brand)',
              color: '#fff',
              fontSize: 13.5,
              minHeight: 44,
              boxShadow: 'var(--shadow-raised)',
              cursor: 'pointer',
            }}
          >
            <Icon name="message-circle" size={16} /> Abrir Arquiteto
          </button>
        )}
      </div>

      {previa && (
        <ApplyDialog
          preview={previa}
          conexoes={conexoes}
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
