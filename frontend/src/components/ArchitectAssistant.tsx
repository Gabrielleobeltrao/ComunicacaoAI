import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Button, Field, Icon, Input } from '../ui'
import { API_URL } from '../lib/api'
import { useSession } from '../lib/auth-client'

// O ARQUITETO COMO CHAT GLOBAL — uma instância só, montada no layout.
//
// Antes, "Montar operação" morava dentro do seletor de andares: o único caminho para o
// Arquiteto estava atrás de um menu que a pessoa precisava saber abrir. E dentro do projeto
// havia um segundo chat, com sua própria conversa — duas caixas para a mesma pessoa,
// perdendo o rascunho ao navegar.
//
// Aqui existe UM provider no `AppLayout`. Ele carrega a conversa, o rascunho e o estado, e
// sobrevive à navegação porque não é remontado quando a rota muda.
//
// O contexto da tela é uma REFERÊNCIA — `floorId`, `sectorId`, `agentId` — e nunca o
// conteúdo dela. O servidor reconfirma que cada id é desta conta antes de usar; um id que
// vem do cliente é um pedido.

export type AssistantPhase =
  | 'idle'
  | 'answering'
  | 'consulting'
  | 'preparing_proposal'
  | 'awaiting_approval'
  | 'applying'
  | 'testing'
  | 'done'
  | 'failed'

/** O que a pessoa lê em cada estado. Um spinner sem palavra não diz o que está acontecendo. */
export const PHASE_LABEL: Record<AssistantPhase, string> = {
  idle: '',
  answering: 'respondendo',
  consulting: 'consultando',
  preparing_proposal: 'preparando a proposta',
  awaiting_approval: 'esperando sua aprovação',
  applying: 'aplicando',
  testing: 'testando',
  done: 'concluído',
  failed: 'falhou',
}

interface Mensagem {
  id: string
  autor: 'pessoa' | 'arquiteto'
  texto: string
  /** Uma pergunta curta do Arquiteto, quando os dois caminhos eram plausíveis. */
  pergunta?: string
  projectId?: string | null
  phase?: AssistantPhase
  /**
   * A escrita esperando confirmação.
   *
   * Sem isto, o servidor preparava a operação e a conversa não tinha como dizer "sim": a
   * escrita ficava sem saída, e a pessoa via o impacto sem nenhum botão.
   */
  pendente?: { id: string; operationHash: string; summary: string; impact: string[]; expiresAt: string; requiresName?: string } | null
  /** O desfecho depois de confirmar. Fica na própria mensagem, e não num alerta que some. */
  desfecho?: string
}

interface AssistantState {
  aberto: boolean
  minimizado: boolean
  mensagens: Mensagem[]
  rascunho: string
  phase: AssistantPhase
  /** Há uma rodada em voo? É isto que bloqueia o campo — nunca a fase. */
  enviando: boolean
  erro: string | null
  abrir: () => void
  fechar: () => void
  minimizar: () => void
  setRascunho: (t: string) => void
  enviar: () => Promise<void>
  /** Confirma a escrita que uma mensagem preparou. O texto do modelo nunca chega ao servidor. */
  confirmar: (mensagemId: string, nomeDigitado?: string) => Promise<void>
}

const Ctx = createContext<AssistantState | null>(null)

/** O acesso ao chat de qualquer tela. `null` fora do provider — e isso é proposital. */
export const useArchitectAssistant = (): AssistantState | null => useContext(Ctx)

/**
 * Os ids que o caminho carrega — `/floors/:floorId/agents/:agentId` e companhia.
 *
 * Um id só é aceito quando tem a FORMA de um ObjectId: `/floors/novo` não é um andar, e
 * mandar "novo" como id faria o servidor recusar por um motivo que não é o real.
 */
export function idsDoCaminho(pathname: string): { pathname: string; floorId?: string; sectorId?: string; agentId?: string } {
  const partes = String(pathname ?? '').split('/').filter(Boolean)
  const out: { pathname: string; floorId?: string; sectorId?: string; agentId?: string } = { pathname: String(pathname ?? '') }
  const ehId = (v: string | undefined) => Boolean(v && /^[0-9a-f]{24}$/i.test(v))

  for (let i = 0; i < partes.length - 1; i++) {
    const valor = partes[i + 1]
    if (!ehId(valor)) continue
    if (partes[i] === 'floors') out.floorId = valor
    else if (partes[i] === 'sectors') out.sectorId = valor
    else if (partes[i] === 'agents') out.agentId = valor
  }
  return out
}

/** A largura do painel no desktop, guardada por pessoa. */
const LARGURA_CHAVE = 'comunicacaoai.architect.width'
const LARGURA_MIN = 320
const LARGURA_MAX = 720

/**
 * O BLOCO DA OPERAÇÃO PENDENTE — e o nome que a torna confirmável.
 *
 * Quando o servidor devolve `requiresName`, só um botão não basta: ele manda a pessoa clicar
 * sem dizer o que falta, a chamada volta recusada, e a operação de alto risco fica sem
 * caminho pela tela. O nome digitado vive AQUI, e não numa lista global, porque cada mensagem
 * tem a sua operação e uma janela própria de validade.
 */
function ConfirmacaoPendente({ mensagemId, pendente }: { mensagemId: string; pendente: NonNullable<Mensagem['pendente']> }) {
  const a = useArchitectAssistant()
  const [nome, setNome] = useState('')
  const [enviando, setEnviando] = useState(false)
  const campoId = `architect-confirmar-nome-${mensagemId}`
  // Fora do provedor não há operação para confirmar: o bloco não se desenha pela metade.
  if (!a) return null

  /**
   * O botão espera o nome EXATO — e o servidor continua sendo quem decide.
   *
   * Isto é conveniência de tela: ela evita a ida e volta que só devolve "digite o nome
   * X". A conferência de verdade acontece no servidor, contra o que ele guardou, porque
   * um `disabled` é uma sugestão do lado de cá — some com um clique no inspetor.
   */
  const faltaNome = Boolean(pendente.requiresName) && nome.trim() !== String(pendente.requiresName).trim()

  return (
    <div style={{ margin: '8px 0 0' }} data-testid="architect-confirmar-operacao">
      <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 12.5, color: 'var(--text-muted)' }}>
        {pendente.impact.map((linha) => (
          <li key={linha}>{linha}</li>
        ))}
      </ul>
      {pendente.requiresName ? (
        <Field
          label={`Digite \u201c${pendente.requiresName}\u201d para confirmar`}
          hint="O nome é a confirmação: é o que garante que alguém leu o que está acima."
          htmlFor={campoId}
        >
          <Input
            id={campoId}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            data-testid="architect-confirmar-nome"
            autoComplete="off"
            aria-required="true"
          />
        </Field>
      ) : null}
      <Button
        variant="secondary"
        disabled={faltaNome || enviando}
        onClick={() => {
          // O clique duplo não manda duas vezes: a segunda chamada gastaria a operação de uso
          // único e a pessoa leria "não existe mais" como se tivesse falhado.
          if (enviando) return
          setEnviando(true)
          void a.confirmar(mensagemId, nome).finally(() => setEnviando(false))
        }}
        data-testid="architect-confirmar"
      >
        Confirmar
      </Button>
    </div>
  )
}

export function ArchitectAssistantProvider({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false)
  const [minimizado, setMinimizado] = useState(false)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [rascunho, setRascunho] = useState('')
  const [phase, setPhase] = useState<AssistantPhase>('idle')
  /**
   * O campo é bloqueado pela requisição EM VOO — não pela fase que o servidor devolveu.
   *
   * Bloquear por fase amarrava a tela a um valor do backend: bastava uma rodada terminar num
   * estado intermediário para o campo ficar travado para sempre, sem nada na tela dizendo
   * por quê e sem caminho de volta. A fase continua sendo mostrada; ela só não decide mais
   * se a pessoa pode escrever.
   */
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const location = useLocation()
  const navigate = useNavigate()

  /**
   * O contexto da tela, lido do CAMINHO — nunca do conteúdo dela.
   *
   * `useParams` não serve aqui: o provider vive ACIMA do `<Routes>`, e fora de uma rota
   * casada ele devolve um objeto vazio. Ler do caminho funciona em qualquer nível e é o
   * mesmo dado — os ids que a URL já carrega.
   *
   * Só isso vai para o servidor, que reconfirma cada um contra a conta antes de usar.
   */
  const uiContext = useMemo(() => idsDoCaminho(location.pathname), [location.pathname])

  const enviar = useCallback(async () => {
    const texto = rascunho.trim()
    if (!texto || enviando) return

    const minha: Mensagem = { id: `p-${Date.now()}`, autor: 'pessoa', texto }
    setMensagens((m) => [...m, minha])
    setRascunho('')
    setEnviando(true)
    setPhase('answering')
    setErro(null)

    try {
      const res = await fetch(`${API_URL}/api/architect/assistant/turn`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: texto, uiContext }),
      })
      const corpo = (await res.json().catch(() => null)) as
        | {
            text?: string
            question?: string | null
            projectId?: string | null
            phase?: AssistantPhase
            message?: string
            pendingOperation?: Mensagem['pendente']
          }
        | null
      if (!res.ok) throw new Error(corpo?.message ?? 'não consegui responder agora')

      setMensagens((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          autor: 'arquiteto',
          texto: corpo?.text ?? '',
          ...(corpo?.question ? { pergunta: corpo.question } : {}),
          projectId: corpo?.projectId ?? null,
          phase: corpo?.phase ?? 'done',
          pendente: corpo?.pendingOperation ?? null,
        },
      ])
      setPhase(corpo?.phase ?? 'done')
    } catch (e) {
      setErro((e as Error).message)
      setPhase('failed')
    } finally {
      // SEMPRE: erro de rede, resposta estranha ou sucesso soltam o campo do mesmo jeito.
      setEnviando(false)
    }
  }, [rascunho, enviando, uiContext])

  /**
   * O "sim" vai para um endpoint PRÓPRIO, com o id e o hash que o servidor montou.
   *
   * Nada do que a pessoa ou o modelo escreveram viaja aqui: só a referência de uma operação
   * que o servidor já preparou e o carimbo do que foi mostrado.
   */
  const confirmar = useCallback(async (mensagemId: string, nomeDigitado?: string) => {
    const alvo = mensagens.find((m) => m.id === mensagemId)
    if (!alvo?.pendente) return
    /**
     * O NOME é obrigatório quando o servidor pede um.
     *
     * Sem ele a chamada sai e volta recusada: a pessoa clica, não acontece nada visível, e a
     * operação de alto risco fica sem caminho pela tela.
     */
    if (alvo.pendente.requiresName && !String(nomeDigitado ?? '').trim()) {
      setMensagens((m) =>
        m.map((x) => (x.id === mensagemId ? { ...x, desfecho: `digite o nome “${alvo.pendente!.requiresName}” para confirmar` } : x)),
      )
      return
    }
    try {
      const res = await fetch(`${API_URL}/api/architect/assistant/confirm`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: alvo.pendente.id,
          operationHash: alvo.pendente.operationHash,
          ...(alvo.pendente.requiresName ? { confirmationName: nomeDigitado ?? '' } : {}),
        }),
      })
      const corpo = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; message?: string } | null
      // O desfecho fica NA MENSAGEM: um alerta que some deixaria a pessoa sem saber se
      // aconteceu — e a recusa por hash vencido é exatamente o que ela precisa ler.
      // A MENSAGEM DO SERVIDOR é preservada como veio: ela diz qual nome digitar, que o hash
      // envelheceu ou que a janela passou — trocá-la por um texto genérico tira da pessoa a
      // única informação que resolve.
      setMensagens((m) =>
        m.map((x) => (x.id === mensagemId ? { ...x, desfecho: corpo?.text ?? corpo?.message ?? 'não consegui confirmar', pendente: res.ok ? null : x.pendente } : x)),
      )
    } catch (e) {
      setMensagens((m) => m.map((x) => (x.id === mensagemId ? { ...x, desfecho: (e as Error).message } : x)))
    }
  }, [mensagens])

  const valor = useMemo<AssistantState>(
    () => ({
      aberto,
      minimizado,
      mensagens,
      rascunho,
      phase,
      enviando,
      erro,
      abrir: () => {
        setAberto(true)
        setMinimizado(false)
      },
      fechar: () => setAberto(false),
      minimizar: () => setMinimizado((v) => !v),
      setRascunho,
      enviar,
      confirmar,
    }),
    [aberto, minimizado, mensagens, rascunho, phase, enviando, erro, enviar, confirmar],
  )

  /**
   * Na página de um PROJETO, o chat global se retira.
   *
   * Ali existe a conversa do projeto — que carrega o Brief, o Blueprint e a aplicação. Duas
   * caixas de conversa na mesma tela é a pessoa escrevendo na errada e não entendendo por
   * que a outra não respondeu.
   */
  const naPaginaDeProjeto = /^\/architect\/[^/]+/.test(location.pathname)

  /**
   * E ele só existe para quem ENTROU.
   *
   * O botão é fixo na janela, acima de tudo, e não perguntava quem estava do outro lado: ele
   * aparecia na tela de login, na de cadastro e — o pior caso — dentro do widget que roda no
   * site de outra pessoa. Clicar ali abre um painel que chama rota autenticada, então a
   * resposta é um erro; e no widget é o botão de um produto aparecendo no site de um cliente.
   *
   * A sessão é a mesma que o `ProtectedRoute` lê. Enquanto ela está sendo conferida, o botão
   * não aparece: piscar e sumir é pior que aparecer um instante depois.
   */
  const { data: sessao } = useSession()

  return (
    <Ctx.Provider value={valor}>
      {children}
      {naPaginaDeProjeto || !sessao?.user ? null : (
        <>
          <ArchitectLauncher />
          <ArchitectPanel onAbrirProjeto={(id) => navigate(`/architect/${id}`)} />
        </>
      )}
    </Ctx.Provider>
  )
}

/**
 * O BOTÃO — persistente, em desktop e no celular.
 *
 * Ele desaparece enquanto o painel está aberto e não minimizado: dois alvos para a mesma
 * coisa na mesma tela é o tipo de duplicação que faz a pessoa clicar no errado.
 */
function ArchitectLauncher() {
  const a = useArchitectAssistant()
  const [temModal, setTemModal] = useState(false)

  /**
   * O botão SOME enquanto um diálogo está aberto.
   *
   * Ele é fixo no canto inferior direito — exatamente onde mora o botão primário de quase
   * todo diálogo. Num celular ele cobria o "Próximo" do wizard de contratação: a pessoa
   * clicava e abria o Arquiteto. Um modal é dono da tela enquanto está aberto.
   *
   * A escuta é por DOM porque os diálogos deste app são componentes espalhados: um contexto
   * novo exigiria tocar em todos eles para resolver um problema de posicionamento.
   */
  useEffect(() => {
    // O painel do próprio Arquiteto tem `role="dialog"` e NÃO conta: contá-lo faria o botão
    // sumir para sempre depois da primeira abertura, inclusive minimizado.
    const conferir = () => setTemModal(document.querySelector('[role="dialog"]:not([data-testid="architect-panel"])') !== null)
    conferir()
    const observador = new MutationObserver(conferir)
    observador.observe(document.body, { childList: true, subtree: true })
    return () => observador.disconnect()
  }, [])

  if (!a || (a.aberto && !a.minimizado) || temModal) return null
  return (
    <button
      type="button"
      onClick={a.abrir}
      data-testid="architect-launcher"
      aria-label="Abrir o Arquiteto"
      style={{
        position: 'fixed',
        // Acima da navegação inferior do celular, e fora da área do indicador.
        bottom: 'calc(var(--safe-bottom, 0px) + 76px)',
        right: 16,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        // 48px é o alvo mínimo de toque; abaixo disso o dedo erra.
        minHeight: 48,
        padding: '0 18px',
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        background: 'var(--intent-brand)',
        color: 'var(--paper-0)',
        fontSize: 14,
        fontWeight: 700,
        boxShadow: '0 6px 20px rgba(0,0,0,.18)',
      }}
    >
      <Icon name="sparkles" size={17} />
      Arquiteto
    </button>
  )
}

function ArchitectPanel({ onAbrirProjeto }: { onAbrirProjeto: (id: string) => void }) {
  const a = useArchitectAssistant()
  const [largura, setLargura] = useState(() => {
    try {
      return Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, Number(localStorage.getItem(LARGURA_CHAVE)) || 400))
    } catch {
      return 400
    }
  })
  const campo = useRef<HTMLTextAreaElement>(null)
  const fim = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (a?.aberto && !a.minimizado) campo.current?.focus()
  }, [a?.aberto, a?.minimizado])

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' })
  }, [a?.mensagens.length])

  // Esc fecha — o atalho que toda superfície sobreposta precisa ter.
  useEffect(() => {
    if (!a?.aberto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') a.fechar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [a])

  const arrastar = (e: React.PointerEvent) => {
    e.preventDefault()
    const mover = (ev: PointerEvent) => {
      const nova = Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, window.innerWidth - ev.clientX))
      setLargura(nova)
      try {
        localStorage.setItem(LARGURA_CHAVE, String(nova))
      } catch {
        // Sem armazenamento, o painel funciona igual — só não lembra a largura.
      }
    }
    const soltar = () => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
  }

  if (!a || !a.aberto) return null

  // O botão segue a requisição em voo, pelo mesmo motivo do campo.
  const trabalhando = a.enviando

  return (
    <aside
      role="dialog"
      aria-label="Arquiteto"
      data-testid="architect-panel"
      style={{
        position: 'fixed',
        zIndex: 61,
        right: 0,
        bottom: 0,
        top: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-card)',
        borderLeft: '1px solid var(--border-subtle)',
        boxShadow: '-8px 0 32px rgba(0,0,0,.12)',
        // No celular ocupa a tela inteira; no desktop, a largura escolhida.
        width: `min(100vw, ${largura}px)`,
        ...(a.minimizado ? { top: 'auto', height: 56 } : {}),
      }}
    >
      {/* A alça de redimensionar só existe no desktop, onde há o que redimensionar. */}
      {!a.minimizado ? (
        <div
          onPointerDown={arrastar}
          data-testid="architect-resize"
          aria-hidden
          className="hidden lg:block"
          style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'col-resize' }}
        />
      ) : null}

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: a.minimizado ? 'none' : '1px solid var(--border-subtle)',
        }}
      >
        <Icon name="sparkles" size={16} color="var(--intent-brand)" />
        <strong style={{ fontSize: 14, flex: 1 }}>Arquiteto</strong>
        {a.phase !== 'idle' && PHASE_LABEL[a.phase] ? (
          <span data-testid="architect-phase" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {PHASE_LABEL[a.phase]}
          </span>
        ) : null}
        <button
          type="button"
          onClick={a.minimizar}
          aria-label={a.minimizado ? 'Expandir o Arquiteto' : 'Minimizar o Arquiteto'}
          data-testid="architect-minimize"
          style={botaoDeIcone}
        >
          <Icon name={a.minimizado ? 'chevron-up' : 'chevron-down'} size={16} />
        </button>
        <button type="button" onClick={a.fechar} aria-label="Fechar o Arquiteto" data-testid="architect-close" style={botaoDeIcone}>
          <Icon name="x" size={16} />
        </button>
      </header>

      {a.minimizado ? null : (
        <>
          {/*
            A resposta chega SEM mudar de página.
            Sem região viva, quem usa leitor de tela não recebe aviso nenhum de que ela
            chegou: a conversa acontece em silêncio. `polite` porque ela não interrompe o
            que a pessoa está fazendo — ela entra na fila.
          */}
          <div
            aria-live="polite"
            aria-atomic="false"
            style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}
            data-testid="architect-mensagens"
          >
            {a.mensagens.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }} data-testid="architect-vazio">
                Pergunte qualquer coisa, ou peça para eu montar. Perguntar não cria nada no seu escritório.
              </p>
            ) : null}

            {a.mensagens.map((m) => (
              <div
                key={m.id}
                data-testid={m.autor === 'pessoa' ? 'architect-msg-pessoa' : 'architect-msg-arquiteto'}
                style={{
                  alignSelf: m.autor === 'pessoa' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  padding: '8px 12px',
                  borderRadius: 12,
                  fontSize: 13.5,
                  background: m.autor === 'pessoa' ? 'var(--intent-brand-soft)' : 'var(--surface-sunken)',
                  color: 'var(--text-body)',
                  overflowWrap: 'anywhere',
                }}
              >
                {m.texto ? <span>{m.texto}</span> : null}
                {m.pergunta ? (
                  <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 600 }} data-testid="architect-pergunta">
                    {m.pergunta}
                  </p>
                ) : null}
                {m.pendente ? <ConfirmacaoPendente mensagemId={m.id} pendente={m.pendente} /> : null}
                {m.desfecho ? (
                  <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="architect-desfecho">
                    {m.desfecho}
                  </p>
                ) : null}
                {m.projectId ? (
                  <p style={{ margin: '8px 0 0' }}>
                    <Button variant="secondary" onClick={() => onAbrirProjeto(m.projectId!)} data-testid="architect-abrir-projeto">
                      Abrir a proposta
                    </Button>
                  </p>
                ) : null}
              </div>
            ))}
            <div ref={fim} />
          </div>

          {a.erro ? (
            <p role="alert" data-testid="architect-erro" style={{ margin: 0, padding: '0 12px 8px', fontSize: 12.5, color: 'var(--intent-danger-text)' }}>
              {a.erro}
            </p>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void a.enviar()
            }}
            style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border-subtle)', paddingBottom: 'calc(12px + var(--safe-bottom, 0px))' }}
          >
            <label htmlFor="architect-input" className="sr-only">
              O que você quer
            </label>
            <textarea
              id="architect-input"
              ref={campo}
              value={a.rascunho}
              onChange={(e) => a.setRascunho(e.target.value)}
              onKeyDown={(e) => {
                // Enter envia; Shift+Enter quebra linha. É o que todo mundo espera de um chat.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void a.enviar()
                }
              }}
              rows={2}
              placeholder="Ex: adicione reservas pelo WhatsApp"
              data-testid="architect-input"
              style={{
                flex: 1,
                minWidth: 0,
                resize: 'none',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-strong, #d0d5dd)',
                fontSize: 13.5,
                fontFamily: 'inherit',
                background: 'var(--surface-app)',
                color: 'var(--text-body)',
              }}
            />
            <Button type="submit" disabled={!a.rascunho.trim() || trabalhando} data-testid="architect-enviar">
              {trabalhando ? '…' : 'Enviar'}
            </Button>
          </form>
        </>
      )}
    </aside>
  )
}

const botaoDeIcone: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  // Alvo mínimo de toque, mesmo para um ícone pequeno.
  minWidth: 36,
  minHeight: 36,
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: 'var(--text-muted)',
  cursor: 'pointer',
}
