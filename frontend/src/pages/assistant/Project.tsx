import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { AppLayout } from '../../components/AppLayout'
import { useAssistant } from '../../components/Assistant'
import { Badge, Button, Card, Icon } from '../../ui'
import * as api from '../../lib/assistant'
import type { ApplyResponse, ApplyStep, AssistantPreview, AssistantProject, BlueprintLink } from '../../lib/assistant'
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
const EDITAVEL: api.AssistantStatus[] = ['discovery', 'draft', 'ready']

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

export function AssistantProject() {
  const { projectId = '' } = useParams()
  const [projeto, setProjeto] = useState<AssistantProject | null>(null)
  const [previa, setPrevia] = useState<AssistantPreview | null>(null)
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
  // A rodada automática vale UMA vez por projeto. O efeito pode ser remontado, e cada
  // remontagem seria outra chamada ao modelo — cobrada.
  const [passos, setPassos] = useState<ApplyStep[]>([])
  const [resultadoDesfazer, setResultadoDesfazer] = useState<{ removed: string[]; kept: { key: string; reason: string }[] } | null>(null)

  const recarregarPrevia = useCallback(
    async (p: AssistantProject) => {
      if (!p.hasBlueprint) return setPrevia(null)
      try {
        setPrevia(await api.previewProject(p.id))
      } catch {
        setPrevia(null)
      }
    },
    [],
  )

  /**
   * A PÁGINA ANDA JUNTO COM A CONVERSA.
   *
   * A rodada acontece no painel do Assistente, e é ela que monta e revisa a proposta que
   * está DESTA tela. Sem este acompanhamento, a pessoa pedia a mudança, o painel respondia
   * "pronto", e a proposta ao lado continuava sendo a de antes até alguém recarregar.
   */
  const assistente = useAssistant()
  const doAssistente = assistente?.projeto
  /**
   * A CARGA INICIAL PERDE PARA A CONVERSA.
   *
   * As duas correm: a página pede `getProject` ao montar, e o painel pode terminar uma
   * rodada antes dessa resposta chegar. Quando isso acontecia, a resposta atrasada —
   * tirada de ANTES da rodada — sobrescrevia a proposta recém-montada, e a tela voltava a
   * dizer que não havia proposta nenhuma. Quem veio da conversa é mais novo por
   * construção; a carga inicial só vale enquanto ninguém trouxe nada melhor.
   */
  const veioDaConversa = useRef(false)
  useEffect(() => {
    if (!doAssistente || doAssistente.id !== projectId) return
    veioDaConversa.current = true
    // SEM comparar `updatedAt`: o objeto do painel só muda quando uma rodada terminou, e
    // comparar carimbos fazia a página ignorar uma proposta recém-montada sempre que o
    // servidor devolvia o mesmo instante. Quem acabou de rodar é mais novo por construção.
    setProjeto(doAssistente)
    // Os links vêm no mesmo objeto: sem isto, recarregar um projeto APLICADO perdia os
    // caminhos para o que foi criado — a carga inicial que os trazia cede a vez à conversa.
    setLinks(doAssistente.links ?? [])
    void recarregarPrevia(doAssistente)
  }, [doAssistente, projectId])

  /**
   * A FALHA DA CONVERSA continua chegando à página.
   *
   * A rodada mudou de lugar, mas a saída não pode mudar de lugar com ela: é este cartão
   * que oferece "Abrir Configurações" quando falta chave de provedor. Sem isto a pessoa
   * leria o problema no painel e não teria nada para clicar.
   */
  const erroDoAssistente = assistente?.ultimoErro
  useEffect(() => {
    if (erroDoAssistente) setErro(erroDoAssistente)
  }, [erroDoAssistente])

  useEffect(() => {
    if (!projectId) return
    api
      .getProject(projectId)
      .then(async (p) => {
        if (veioDaConversa.current) return
        setProjeto(p)
        // Os links vêm do servidor, e não da memória desta aba: recarregar a página de
        // um projeto aplicado precisa reconstruir os caminhos para o que foi criado.
        setLinks(p.links ?? [])
        await recarregarPrevia(p)

        // A rodada de partida é do PAINEL agora: é ele que desenha a conversa, e a
        // pergunta que ela devolve precisa chegar a quem a mostra.
      })
      .catch((e: Error) => setErro({ code: 'load', message: e.message }))
    // `registrar` depende do estado da conversa e não deve reagendar esta carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, recarregarPrevia])


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
      setErro({ code: (e as api.AssistantError).code ?? 'layer', message: (e as Error).message })
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
      setErro({ code: (e as api.AssistantError).code ?? 'brief', message: (e as Error).message })
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
      setErro({ code: (e as api.AssistantError).code ?? 'apply', message: (e as Error).message })
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
      setErro({ code: (e as api.AssistantError).code ?? 'error', message: (e as Error).message })
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
      <AppLayout current="/assistant" title="Assistente · Montar operação">
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{erro ? erro.message : 'Carregando…'}</p>
      </AppLayout>
    )
  }

  const aplicado = projeto.status === 'applied'
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
      current="/assistant"
      title={projeto.title}
      titleExtra={<Badge tone={statusTone(projeto.status)} data-testid="assistant-status">{STATUS_LABEL[projeto.status]}</Badge>}
      subtitle={projeto.objective}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {erro && (
          <Card>
            <div className="flex flex-col gap-2" data-testid="assistant-error">
              <p role="alert" style={{ fontSize: 13, color: 'var(--intent-danger-text)' }}>
                {erro.message}
              </p>
              {/* Cada recusa leva a um lugar diferente. Uma mensagem só deixaria a
                  pessoa sem saber o que fazer a seguir. */}
              {erro.code === 'no_provider_key' && (
                <a href="/settings" style={{ fontSize: 13, color: 'var(--intent-brand)' }} data-testid="assistant-settings-link">
                  Abrir Configurações
                </a>
              )}
              {projeto.status === 'failed' && (
                <div>
                  <Button onClick={() => comResultado(() => api.resumeProject(projectId))} data-testid="assistant-resume">
                    Retomar de onde parou
                  </Button>
                </div>
              )}
            </div>
          </Card>
        )}

        {projeto.status === 'applying' && (
          <Card>
            <div className="flex flex-col gap-2" data-testid="assistant-applying">
              <p style={{ fontSize: 13 }}>Esta aplicação está em andamento. Se ela tiver parado, dá para retomar de onde parou.</p>
              <div>
                <Button onClick={() => comResultado(() => api.resumeProject(projectId))} disabled={pendente} data-testid="assistant-resume">
                  Retomar de onde parou
                </Button>
              </div>
            </div>
          </Card>
        )}

        {resultadoDesfazer && (
          <Card>
            <div className="flex flex-col gap-1" data-testid="assistant-rollback-result">
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
            <div className="flex flex-col gap-2" data-testid="assistant-failed">
              <p style={{ fontSize: 13 }}>
                A aplicação parou no meio. O que já foi criado continua de pé{passos.length > 0 ? `: ${passos.filter((s) => s.status === 'created').length} recursos.` : '.'}
              </p>
              {projeto.applyState?.error && (
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="assistant-failure-reason">
                  {projeto.applyState.error}
                </p>
              )}
              <div>
                <Button onClick={() => comResultado(() => api.resumeProject(projectId))} data-testid="assistant-resume">
                  Retomar de onde parou
                </Button>
              </div>
            </div>
          </Card>
        )}

        {aplicado && links.length > 0 && (
          <Card>
            <div className="flex flex-wrap items-center gap-2" data-testid="assistant-links">
              <Icon name="check" size={16} color="var(--intent-success)" />
              <span style={{ fontSize: 13 }}>Pronto. O que foi criado:</span>
              {links.map((l) => (
                <a key={`${l.kind}-${l.key}`} href={l.path} style={{ fontSize: 13, color: 'var(--intent-brand)' }} data-testid={`assistant-link-${l.kind}`}>
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
          <nav className="flex flex-wrap gap-2" role="tablist" aria-label="Áreas da operação" data-testid="assistant-tabs">
            {TELAS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tela === t.key}
                aria-current={tela === t.key ? 'page' : undefined}
                data-testid={`assistant-tab-${t.key}`}
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
        <div className="flex w-full min-w-0 flex-col" data-testid="assistant-workspace">
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

        {/* A CONVERSA NÃO MORA MAIS AQUI.
            Ela é o painel do Assistente, que nesta página se abre sozinho preso a este
            projeto. Eram duas caixas contra dois backends: o que a pessoa dizia no painel
            flutuante não existia para a página, e o que ela dizia aqui sumia ao sair. Uma
            conversa só, gravada, e as duas telas são janelas para ela. */}

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
