import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Button, Icon } from '../ui'
import { API_URL } from '../lib/api'

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
}

interface AssistantState {
  aberto: boolean
  minimizado: boolean
  mensagens: Mensagem[]
  rascunho: string
  phase: AssistantPhase
  erro: string | null
  abrir: () => void
  fechar: () => void
  minimizar: () => void
  setRascunho: (t: string) => void
  enviar: () => Promise<void>
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

export function ArchitectAssistantProvider({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false)
  const [minimizado, setMinimizado] = useState(false)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [rascunho, setRascunho] = useState('')
  const [phase, setPhase] = useState<AssistantPhase>('idle')
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
    if (!texto || phase === 'answering' || phase === 'preparing_proposal') return

    const minha: Mensagem = { id: `p-${Date.now()}`, autor: 'pessoa', texto }
    setMensagens((m) => [...m, minha])
    setRascunho('')
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
        | { text?: string; question?: string | null; projectId?: string | null; phase?: AssistantPhase; message?: string }
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
        },
      ])
      setPhase(corpo?.phase ?? 'done')
    } catch (e) {
      setErro((e as Error).message)
      setPhase('failed')
    }
  }, [rascunho, phase, uiContext])

  const valor = useMemo<AssistantState>(
    () => ({
      aberto,
      minimizado,
      mensagens,
      rascunho,
      phase,
      erro,
      abrir: () => {
        setAberto(true)
        setMinimizado(false)
      },
      fechar: () => setAberto(false),
      minimizar: () => setMinimizado((v) => !v),
      setRascunho,
      enviar,
    }),
    [aberto, minimizado, mensagens, rascunho, phase, erro, enviar],
  )

  /**
   * Na página de um PROJETO, o chat global se retira.
   *
   * Ali existe a conversa do projeto — que carrega o Brief, o Blueprint e a aplicação. Duas
   * caixas de conversa na mesma tela é a pessoa escrevendo na errada e não entendendo por
   * que a outra não respondeu.
   */
  const naPaginaDeProjeto = /^\/architect\/[^/]+/.test(location.pathname)

  return (
    <Ctx.Provider value={valor}>
      {children}
      {naPaginaDeProjeto ? null : (
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

  const trabalhando = a.phase === 'answering' || a.phase === 'preparing_proposal' || a.phase === 'applying' || a.phase === 'testing'

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
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="architect-mensagens">
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
