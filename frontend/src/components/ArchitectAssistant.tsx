import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Button, Field, Icon, Input } from '../ui'
import { API_URL } from '../lib/api'
import * as arq from '../lib/architect'
import type { ArchitectMessage, ArchitectProject, ArchitectQuestion } from '../lib/architect'
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
  /**
   * `aviso` é o `system_notice` da linha gravada — não é o Arquiteto falando, é o SISTEMA.
   *
   * Ele carrega coisas como "removi o que parecia uma credencial da sua mensagem" e a
   * falha de uma aplicação. Desenhá-lo como fala do Arquiteto apagaria a diferença entre
   * o que o modelo disse e o que o servidor fez.
   */
  autor: 'pessoa' | 'arquiteto' | 'aviso'
  /**
   * O aviso de falha que uma rodada POSTERIOR resolveu.
   *
   * Fica no histórico mas sai do alarme: apagá-lo esconderia que houve um problema, e
   * deixá-lo em vermelho faria a pessoa procurar um defeito que já não existe.
   */
  resolvido?: boolean
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
  mensagens: Mensagem[]
  rascunho: string
  phase: AssistantPhase
  /** Há uma rodada em voo? É isto que bloqueia o campo — nunca a fase. */
  enviando: boolean
  erro: string | null
  abrir: () => void
  fechar: () => void
  setRascunho: (t: string) => void
  enviar: () => Promise<void>
  /** Confirma a escrita que uma mensagem preparou. O texto do modelo nunca chega ao servidor. */
  confirmar: (mensagemId: string, nomeDigitado?: string) => Promise<void>
  /**
   * O projeto que esta conversa abriu, se abriu algum.
   *
   * DERIVADO das mensagens, e não guardado à parte: um segundo lugar para "qual é o projeto
   * atual" diverge do primeiro assim que alguém fecha o painel, e aí o botão levaria para o
   * projeto errado.
   */
  projetoAtual: string | null
  /**
   * O PROJETO em andamento, inteiro.
   *
   * Guardado porque a decisão que importa depende dele: "Abrir a proposta" só aparece
   * quando existe proposta (`hasBlueprint`). Antes o botão aparecia junto com a criação do
   * projeto — mandando a pessoa para uma sala vazia e deixando a conversa para trás.
   */
  projeto: ArchitectProject | null
  /** A pergunta aberta da rodada do projeto, com as opções que a respondem em um toque. */
  pergunta: ArchitectQuestion | null
  /** Responder a pergunta é mandar a resposta como mensagem — o mesmo caminho de sempre. */
  responder: (texto: string) => Promise<void>
  /** Pede a primeira proposta sem esperar todas as respostas. */
  gerarProposta: () => Promise<void>
  /**
   * Solta a conversa atual e começa outra — SEM apagar nada.
   *
   * O painel passou a retomar sozinho o projeto em andamento, o que resolve o "ele não
   * lembra de nada" e não deixava saída: abrir o balão trazia sempre a mesma conversa, e
   * para falar de outra coisa era preciso descobrir a tela `/architect` e apagar o projeto.
   * Começar de novo não é destruir: o projeto continua na lista.
   */
  novaConversa: () => void
  /**
   * O último erro COM O CÓDIGO.
   *
   * `erro` é a frase que o painel mostra; isto é o que permite a tela oferecer a saída
   * certa — "no_provider_key" leva a Configurações, e uma mensagem sem código deixaria a
   * pessoa lendo o problema sem nada para clicar.
   */
  ultimoErro: { code: string; message: string } | null
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
  /**
   * A CONVERSA PASSA A SER A DO PROJETO assim que existe um.
   *
   * Antes eram duas: a daqui, que vivia só no `useState` e sumia ao recarregar, e a da
   * página do projeto, gravada no servidor. A pessoa dizia metade das coisas de um lado e
   * metade do outro, e a metade daqui não sobrevivia a um F5. Com um projeto aberto, este
   * painel deixa de falar com `assistant/turn` e passa a ler e escrever na linha gravada
   * — a mesma que a página da proposta mostra.
   */
  const [projeto, setProjeto] = useState<ArchitectProject | null>(null)
  const [pergunta, setPergunta] = useState<ArchitectQuestion | null>(null)
  const [ultimoErro, setUltimoErro] = useState<{ code: string; message: string } | null>(null)

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

  /** Uma mensagem gravada, no formato que este painel desenha. */
  const daLinha = (m: ArchitectMessage): Mensagem => ({
    id: m.id,
    autor: m.role === 'user' ? 'pessoa' : m.role === 'system_notice' ? 'aviso' : 'arquiteto',
    texto: m.content,
    ...(m.role === 'system_notice' && m.failure === true && m.resolved === true ? { resolvido: true } : {}),
  })

  /** Passa a mostrar a conversa gravada de um projeto — a partir daqui é ela que vale. */
  const entrarNoProjeto = useCallback(async (id: string) => {
    const [p, linhas] = await Promise.all([arq.getProject(id), arq.listMessages(id)])
    // Sem `id` não é projeto. Adotar o que voltou sem conferir trocava um projeto bom por
    // um objeto vazio, e o botão de continuar a montagem perdia para onde ir.
    if (!p?.id) throw new Error('projeto não encontrado')
    setProjeto(p)
    // `getProject` não devolve `question` — quem tem pergunta aberta é `pendingQuestion`,
    // gravada no projeto. É a mesma leitura que a página do projeto faz ao abrir.
    /**
     * As OPÇÕES sobrevivem ao recarregamento.
     *
     * Antes, reabrir a página no meio de uma pergunta de escolha fechada devolvia o texto
     * sem os botões — e "agente ou função?" virava um campo aberto onde qualquer frase
     * responde, inclusive uma que o servidor vai ignorar. `allowUnknown` só continua
     * valendo quando não há opções: numa escolha entre duas formas, "não sei ainda" não é
     * resposta, é a proposta parada.
     */
    setPergunta(
      p.pendingQuestion
        ? { ...p.pendingQuestion, why: '', choices: p.pendingQuestion.choices ?? [], allowUnknown: !p.pendingQuestion.choices?.length }
        : null,
    )
    setMensagens(linhas.map(daLinha))
    return p
  }, [])

  const enviar = useCallback(async () => {
    const texto = rascunho.trim()
    if (!texto || enviando) return

    const minha: Mensagem = { id: `p-${Date.now()}`, autor: 'pessoa', texto }
    setMensagens((m) => [...m, minha])
    setRascunho('')
    setEnviando(true)
    setPhase('answering')
    setErro(null)

    /**
     * COM PROJETO ABERTO, a rodada é a do projeto.
     *
     * `assistant/turn` classifica intenção — é a porta de entrada. Depois que a montagem
     * começou, quem conduz é a rodada do projeto, que carrega o entendimento, o desenho e
     * a aplicação. Continuar mandando para a porta de entrada faria o Arquiteto reclassificar
     * do zero cada frase, e abrir um projeto novo a cada pedido de ajuste.
     */
    if (projeto) {
      try {
        const r = await arq.sendMessage(projeto.id, texto)
        setProjeto(r)
        setPergunta(r.question)
        setMensagens((await arq.listMessages(projeto.id)).map(daLinha))
        setPhase(r.hasBlueprint ? 'done' : 'preparing_proposal')
      } catch (e) {
        setErro((e as Error).message)
        setUltimoErro({ code: (e as arq.ArchitectError).code ?? 'error', message: (e as Error).message })
        setPhase('failed')
        // A linha gravada é a verdade: recarregá-la desfaz o eco otimista que não virou nada.
        await arq
          .listMessages(projeto.id)
          .then((linhas) => setMensagens(linhas.map(daLinha)))
          .catch(() => undefined)
      } finally {
        setEnviando(false)
      }
      return
    }

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
      /**
       * Criou projeto? A conversa CONTINUA AQUI, agora na linha gravada.
       *
       * Este é o ponto que a pessoa reclamou: antes o turno terminava oferecendo "Abrir a
       * proposta" para uma proposta que ainda não existia, e o que tinha sido dito no
       * painel ficava para trás. Agora o painel entra no projeto e segue a mesma conversa.
       */
      if (corpo?.projectId) await entrarNoProjeto(corpo.projectId).catch(() => undefined)
    } catch (e) {
      setErro((e as Error).message)
      setPhase('failed')
    } finally {
      // SEMPRE: erro de rede, resposta estranha ou sucesso soltam o campo do mesmo jeito.
      setEnviando(false)
    }
  }, [rascunho, enviando, uiContext, projeto, entrarNoProjeto])

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

  /**
   * NA PÁGINA DE UM PROJETO, o painel É o chat daquele projeto.
   *
   * Antes ele se retirava e a página desenhava a própria caixa de conversa — duas
   * conversas, dois backends, e o que foi dito num lugar invisível no outro. Agora existe
   * uma só: ao entrar na página, o painel carrega a linha daquele projeto e se abre, que é
   * o que a caixa da página fazia.
   */
  const idNaUrl = useMemo(() => {
    const m = location.pathname.match(/^\/architect\/([^/]+)/)
    // `/architect/new` é redirecionamento antigo, e não um id.
    return m && m[1] !== 'new' ? m[1] : null
  }, [location.pathname])

  useEffect(() => {
    if (!idNaUrl || projeto?.id === idNaUrl) return
    entrarNoProjeto(idNaUrl)
      .then((p) => {
        /**
         * SEM PROPOSTA, a conversa é o trabalho — e abre sozinha.
         * COM proposta, ela começa recolhida.
         *
         * O painel é uma gaveta encostada à direita: aberto, ele cobre a faixa onde ficam
         * "Aplicar", "Desfazer a última correção" e os itens da proposta. Quem chega numa
         * proposta pronta veio ler e decidir, não conversar; o lançador fica ali para
         * quando quiser pedir a mudança. É a mesma regra que esta tela já seguia — "sem
         * proposta, ela é a tela; com proposta, ela sai da frente".
         */
        if (!p.hasBlueprint) setAberto(true)
        return p
      })
      /**
       * A PRIMEIRA RODADA sai sozinha.
       *
       * A descrição que abriu o projeto já é a primeira mensagem; sem esta rodada a tela
       * abria com o que a pessoa escreveu e um silêncio, e ela teria que reenviar para
       * começar. Isto vivia na página — mas a página não desenha mais a conversa, e a
       * pergunta que a rodada devolve precisa chegar a quem a mostra.
       */
      .then(async (p) => {
        if (!p || p.status !== 'discovery' || p.hasBlueprint || p.pendingQuestion) return
        if (jaIniciou.current === p.id) return
        const linhas = await arq.listMessages(p.id).catch(() => [])
        if (linhas.length !== 1) return
        jaIniciou.current = p.id
        setEnviando(true)
        setPhase('answering')
        try {
          const r = await arq.advanceTurn(p.id)
          setProjeto(r)
          setPergunta(r.question)
          setMensagens((await arq.listMessages(p.id)).map(daLinha))
          setPhase(r.hasBlueprint ? 'done' : 'preparing_proposal')
        } catch (e) {
          setErro((e as Error).message)
          setUltimoErro({ code: (e as arq.ArchitectError).code ?? 'error', message: (e as Error).message })
          setPhase('failed')
        } finally {
          setEnviando(false)
        }
      })
      .catch(() => undefined)
  }, [idNaUrl, projeto?.id, entrarNoProjeto])

  /**
   * AO ABRIR, o painel retoma o projeto em andamento.
   *
   * Sem isto a conversa recomeçava do zero a cada visita — e como o projeto continuava lá,
   * a pessoa acabava com dois: pedia a mesma coisa de novo porque o painel não lembrava
   * de nada. Uma vez por sessão, e só quando não há nada em tela para atrapalhar.
   */
  /** Um projeto só recebe a rodada de partida uma vez. */
  const jaIniciou = useRef<string | null>(null)
  const jaRetomou = useRef(false)
  useEffect(() => {
    if (!aberto || jaRetomou.current || projeto || mensagens.length > 0) return
    jaRetomou.current = true
    arq
      .listProjects()
      .then((lista) => {
        // "Aberto" é o que ainda se monta. Aplicado e arquivado são histórico, e retomar
        // um histórico como se fosse o trabalho de agora é pior que começar do zero.
        const emAndamento = lista.find((p) => p.status === 'discovery' || p.status === 'draft' || p.status === 'ready')
        if (emAndamento) return entrarNoProjeto(emAndamento.id)
        return undefined
      })
      .catch(() => undefined)
  }, [aberto, projeto, mensagens.length, entrarNoProjeto])

  /**
   * Responder a pergunta aberta.
   *
   * Passa pelo MESMO `enviar`: uma opção clicada é uma resposta escrita, e ter um segundo
   * caminho de envio significaria duas chances de divergir do primeiro.
   */
  const responder = useCallback(
    async (texto: string) => {
      if (!projeto || enviando) return
      setEnviando(true)
      setPhase('answering')
      setErro(null)
      setUltimoErro(null)
      setMensagens((m) => [...m, { id: `p-${Date.now()}`, autor: 'pessoa', texto }])
      try {
        const r = await arq.sendMessage(projeto.id, texto)
        setProjeto(r)
        setPergunta(r.question)
        setMensagens((await arq.listMessages(projeto.id)).map(daLinha))
        setPhase(r.hasBlueprint ? 'done' : 'preparing_proposal')
      } catch (e) {
        setErro((e as Error).message)
        setUltimoErro({ code: (e as arq.ArchitectError).code ?? 'error', message: (e as Error).message })
        setPhase('failed')
      } finally {
        setEnviando(false)
      }
    },
    [projeto, enviando],
  )

  const novaConversa = useCallback(() => {
    setProjeto(null)
    setPergunta(null)
    setMensagens([])
    setRascunho('')
    setErro(null)
    setUltimoErro(null)
    setPhase('idle')
    /**
     * A retomada NÃO volta a disparar sozinha, e isso não é sorte: `jaRetomou` é marcado
     * no primeiro `abrir`, antes mesmo de a busca terminar. Cheguei a repetir a marcação
     * aqui "por segurança" e o dente mostrou que era código morto — o caso passava com e
     * sem a linha. Linha morta com comentário dizendo que sustenta alguma coisa é pior que
     * linha nenhuma: ela é a que ninguém remove depois.
     */
  }, [])

  /**
   * A primeira proposta, agora.
   *
   * Nem toda conversa quer responder a tudo antes de ver alguma coisa — e ver o rascunho é,
   * muitas vezes, o que faz a pessoa saber o que responder.
   */
  const gerarProposta = useCallback(async () => {
    if (!projeto || enviando) return
    setEnviando(true)
    setPhase('preparing_proposal')
    setErro(null)
    try {
      const r = await arq.generateProposal(projeto.id)
      setProjeto(r)
      setPergunta(r.question)
      setMensagens((await arq.listMessages(projeto.id)).map(daLinha))
      setPhase('done')
    } catch (e) {
      setErro((e as Error).message)
      setUltimoErro({ code: (e as arq.ArchitectError).code ?? 'error', message: (e as Error).message })
      setPhase('failed')
    } finally {
      setEnviando(false)
    }
  }, [projeto, enviando])

  /** O último projeto que esta conversa abriu. Derivado, nunca guardado em paralelo. */
  const projetoAtual = useMemo(() => {
    if (projeto?.id) return projeto.id
    // A mensagem que criou o projeto continua sendo a fonte de reserva: se carregar a
    // linha gravada falhar, ainda se sabe qual projeto foi aberto.
    for (let i = mensagens.length - 1; i >= 0; i -= 1) if (mensagens[i].projectId) return mensagens[i].projectId!
    return null
  }, [mensagens, projeto])


  const valor = useMemo<AssistantState>(
    () => ({
      aberto,
      mensagens,
      rascunho,
      phase,
      enviando,
      erro,
      abrir: () => setAberto(true),
      fechar: () => setAberto(false),
      setRascunho,
      enviar,
      confirmar,
      projetoAtual,
      projeto,
      pergunta,
      responder,
      gerarProposta,
      novaConversa,
      ultimoErro,
    }),
    [aberto, mensagens, rascunho, phase, enviando, erro, enviar, confirmar, projetoAtual, projeto, pergunta, responder, gerarProposta, novaConversa, ultimoErro],
  )


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
      {!sessao?.user ? null : (
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
 * Ele desaparece enquanto o painel está aberto: dois alvos para a mesma
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
    // sumir para sempre depois da primeira abertura.
    const conferir = () => setTemModal(document.querySelector('[role="dialog"]:not([data-testid="architect-panel"])') !== null)
    conferir()
    const observador = new MutationObserver(conferir)
    observador.observe(document.body, { childList: true, subtree: true })
    return () => observador.disconnect()
  }, [])

  if (!a || a.aberto || temModal) return null
  return (
    <button
      type="button"
      onClick={a.abrir}
      data-testid="architect-launcher"
      aria-label="Abrir o Arquiteto"
      style={{
        position: 'fixed',
        /**
         * No canto, com a folga que ainda existe de verdade.
         *
         * Ele estava 76 px acima da base para escapar de uma barra de navegação inferior no
         * celular — que não existe mais: o menu virou gaveta, e o que sobrou embaixo é a área
         * do indicador do aparelho. A folga antiga virou um botão flutuando no meio do nada,
         * longe do canto onde a mão o procura.
         *
         * `--safe-bottom` continua somando: no iPhone ele é a diferença entre encostar no
         * indicador e ficar logo acima dele.
         */
        bottom: 'calc(var(--safe-bottom, 0px) + 16px)',
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

/** Estamos DENTRO de um projeto? Um teste só, usado pelo provider e pelo painel. */
const ehPaginaDeProjeto = (pathname: string) => /^\/architect\/[^/]+/.test(pathname)

function ArchitectPanel({ onAbrirProjeto }: { onAbrirProjeto: (id: string) => void }) {
  const a = useArchitectAssistant()
  /** Quanto tempo esta rodada já leva. Zera a cada rodada nova. */
  const [segundos, setSegundos] = useState(0)
  const emVoo = a?.enviando ?? false
  useEffect(() => {
    if (!emVoo) return setSegundos(0)
    const inicio = Date.now()
    const t = setInterval(() => setSegundos(Math.round((Date.now() - inicio) / 1000)), 1000)
    return () => clearInterval(t)
  }, [emVoo])
  // Dentro do projeto a proposta já está na tela: um botão para abri-la seria um clique
  // para chegar onde a pessoa já está.
  const naPaginaDeProjeto = ehPaginaDeProjeto(useLocation().pathname)
  /**
   * Existe CANTO nesta tela?
   *
   * Um cartão de canto pressupõe sobra ao redor. Num telefone não há sobra: o painel é a
   * tela, e tratá-lo como cartão o empurrava para fora dela.
   */
  const [cabeNoCanto, setCabeNoCanto] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia('(min-width: 1024px)').matches))
  useEffect(() => {
    const consulta = window.matchMedia('(min-width: 1024px)')
    const ver = () => setCabeNoCanto(consulta.matches)
    ver()
    consulta.addEventListener('change', ver)
    return () => consulta.removeEventListener('change', ver)
  }, [])
  const [largura, setLargura] = useState(() => {
    try {
      return Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, Number(localStorage.getItem(LARGURA_CHAVE)) || 400))
    } catch {
      return 400
    }
  })

  /**
   * A LARGURA QUE O PAINEL OCUPA, publicada para quem precisa abrir espaço.
   *
   * Ele é uma gaveta de altura cheia encostada à direita. Enquanto era um chat que se
   * abria por cima de qualquer tela, cobrir o conteúdo era o combinado. Agora ele é o chat
   * DA PÁGINA DO PROJETO — e cobrir a proposta significa cobrir o botão "Aplicar", que
   * fica exatamente ali. Quem precisa de espaço lê `--arquiteto-largura`; no celular ela é
   * zero, porque lá o painel é a tela inteira e não há o que reservar.
   */
  const larguraAberta = a?.aberto
  useEffect(() => {
    const raiz = document.documentElement
    const aplicar = () => {
      const cabe = window.matchMedia('(min-width: 1024px)').matches
      raiz.style.setProperty('--arquiteto-largura', larguraAberta && cabe ? `${largura}px` : '0px')
    }
    aplicar()
    window.addEventListener('resize', aplicar)
    return () => {
      window.removeEventListener('resize', aplicar)
      raiz.style.setProperty('--arquiteto-largura', '0px')
    }
  }, [larguraAberta, largura])

  const campo = useRef<HTMLTextAreaElement>(null)
  const fim = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (a?.aberto) campo.current?.focus()
  }, [a?.aberto])

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
        /**
         * DENTRO DO PROJETO ele é um CARTÃO DE CANTO, e não uma gaveta de altura cheia.
         *
         * A gaveta encosta na direita e cobre 400 px da tela — ali embaixo dela fica o
         * botão de aplicar. Esta tela já tinha resolvido isso antes: a conversa flutua no
         * canto justamente para não comer largura da proposta, do fluxo nem da checklist.
         * Fora do projeto ela continua gaveta, que é o certo para um painel que se abre
         * por cima de qualquer tela.
         */
        /**
         * O CARTÃO DE CANTO é coisa de DESKTOP.
         *
         * Dentro do projeto, numa tela larga, a conversa flutua no canto para não comer
         * largura da proposta — essa decisão continua. No celular ela não cabe em canto
         * nenhum: com `right: 24` e `width: min(100vw, …)` o painel começava fora da tela
         * pela esquerda e terminava 24 px antes da borda direita. Aqui ele é a tela, como
         * em qualquer outra rota.
         */
        ...(naPaginaDeProjeto && cabeNoCanto
          ? { right: 24, bottom: 24, maxHeight: 'min(70dvh, 640px)', borderRadius: 'var(--radius-panel)', overflow: 'hidden' }
          : { right: 0, bottom: 0, top: 0 }),
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-card)',
        borderLeft: '1px solid var(--border-subtle)',
        boxShadow: '-8px 0 32px rgba(0,0,0,.12)',
        // No celular ocupa a tela inteira; no desktop, a largura escolhida.
        width: `min(100vw, ${largura}px)`,
      }}
    >
      {/* A alça de redimensionar só existe no desktop, onde há o que redimensionar. */}
      {(
        <div
          onPointerDown={arrastar}
          data-testid="architect-resize"
          aria-hidden
          className="hidden lg:block"
          style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'col-resize' }}
        />
      )}

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <Icon name="sparkles" size={16} color="var(--intent-brand)" />
        <strong style={{ fontSize: 14, flex: 1 }}>Arquiteto</strong>
        {a.phase !== 'idle' && PHASE_LABEL[a.phase] ? (
          <span data-testid="architect-phase" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {PHASE_LABEL[a.phase]}
          </span>
        ) : null}
        {/* SÓ APARECE quando há conversa para soltar — e fora da página do projeto, onde a
            conversa é a daquele projeto e sair dela seria sair da tela sem dizer. */}
        {!naPaginaDeProjeto && (a.mensagens.length > 0 || a.projeto) ? (
          <button
            type="button"
            onClick={a.novaConversa}
            aria-label="Começar uma conversa nova"
            title="Começar uma conversa nova (não apaga o que já existe)"
            data-testid="architect-nova-conversa"
            style={botaoDeIcone}
          >
            <Icon name="plus" size={16} />
          </button>
        ) : null}
        <button type="button" onClick={a.fechar} aria-label="Fechar o Arquiteto" data-testid="architect-close" style={botaoDeIcone}>
          <Icon name="x" size={16} />
        </button>
      </header>

      {(
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
            data-testid="architect-conversation"
          >
            {a.mensagens.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }} data-testid="architect-vazio">
                Pergunte qualquer coisa, ou peça para eu montar. Perguntar não cria nada no seu escritório.
              </p>
            ) : null}

            {a.mensagens.map((m) => (
              <div
                key={m.id}
                /* O marcador usa o vocabulário dos DADOS — `user`, `assistant`,
                   `system_notice` — e não o da tela. Havia dois nomes para a mesma coisa
                   porque havia duas conversas; com uma só, sobra um nome. */
                data-testid={`architect-message-${m.autor === 'pessoa' ? 'user' : m.autor === 'aviso' ? 'system_notice' : 'assistant'}`}
                data-resolved={m.resolvido ? 'sim' : undefined}
                style={{
                  alignSelf: m.autor === 'pessoa' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  padding: '8px 12px',
                  borderRadius: 12,
                  fontSize: 13.5,
                  background: m.autor === 'pessoa' ? 'var(--intent-brand-soft)' : m.autor === 'aviso' ? 'var(--intent-warning-soft)' : 'var(--surface-sunken)',
                  color: 'var(--text-body)',
                  overflowWrap: 'anywhere',
                }}
              >
                {m.texto ? <span>{m.texto}</span> : null}
                {m.resolvido ? <span style={{ fontSize: 11.5 }}> — já resolvido; a rodada seguinte funcionou.</span> : null}
                {m.pergunta ? (
                  <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 600 }} data-testid="architect-question">
                    {m.pergunta}
                  </p>
                ) : null}
                {m.pendente ? <ConfirmacaoPendente mensagemId={m.id} pendente={m.pendente} /> : null}
                {m.desfecho ? (
                  <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }} data-testid="architect-desfecho">
                    {m.desfecho}
                  </p>
                ) : null}

              </div>
            ))}
            {/* "PENSANDO… Ns", com o relógio andando.
                Veio junto com a conversa: um "Pensando…" parado por trinta segundos é
                indistinguível de uma tela travada, e a pessoa recarrega no meio da rodada
                — que é justamente o que faz o trabalho parecer perdido. `role="status"`
                porque quem usa leitor de tela precisa saber que ainda está processando. */}
            {a.enviando ? (
              <p role="status" data-testid="architect-thinking" style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
                Pensando… {segundos}s
              </p>
            ) : null}
            {/* A PORTA PARA A PROPOSTA fica DENTRO da conversa, e rola com ela.
                Fixa no rodapé ela ocupava uma faixa permanente da tela e ficava ali
                pedindo clique muito depois de a pessoa ter seguido para outro assunto.
                Aqui ela é o que é: o desfecho da rodada que montou a proposta. */}
            {a.projeto?.hasBlueprint && !naPaginaDeProjeto ? (
              <p style={{ margin: '2px 0 0', alignSelf: 'flex-start' }}>
                <Button variant="secondary" onClick={() => onAbrirProjeto(a.projeto!.id)} data-testid="architect-abrir-projeto">
                  Abrir a proposta
                </Button>
              </p>
            ) : null}
            <div ref={fim} />
          </div>

          {/* A PERGUNTA ABERTA, com as opções que a respondem num toque. Era isto que só
              existia na página do projeto: quem conversava pelo painel tinha que adivinhar
              o formato da resposta e digitar por extenso. */}
          {a.pergunta && !a.enviando ? (
            <div className="flex flex-col gap-2" style={{ padding: '0 12px 8px' }} data-testid="architect-question">
              {/* O PORQUÊ da pergunta. Sem ele a pessoa escolhe no escuro: "web ou
                  whatsapp?" não diz o que muda na operação, e "O canal decide quem recebe
                  a conversa" diz. */}
              {a.pergunta.why ? <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{a.pergunta.why}</p> : null}
              <div className="flex flex-wrap gap-2">
              {(a.pergunta.choices ?? []).map((c) => (
                <Button key={c.value} variant="secondary" size="sm" onClick={() => void a.responder(c.label)} data-testid={`architect-choice-${c.value}`}>
                  {c.label}
                </Button>
              ))}
              {a.pergunta.allowUnknown ? (
                <Button variant="ghost" size="sm" onClick={() => void a.responder('Não sei ainda')} data-testid="architect-unknown">
                  Não sei ainda
                </Button>
              ) : null}
              </div>
            </div>
          ) : null}

          {/* FORÇAR a primeira proposta. Existe porque nem toda conversa quer responder a
              todas as perguntas antes de ver alguma coisa — e ver o rascunho é, muitas
              vezes, o que faz a pessoa saber o que responder. */}
          {a.projeto && !a.projeto.hasBlueprint && !a.enviando ? (
            <p style={{ margin: 0, padding: '0 12px 8px' }}>
              <Button variant="ghost" size="sm" onClick={() => void a.gerarProposta()} data-testid="architect-generate">
                Gerar uma primeira proposta agora
              </Button>
            </p>
          ) : null}


          {a.erro ? (
            <p role="alert" data-testid="architect-erro" style={{ margin: 0, padding: '0 12px 8px', fontSize: 12.5, color: 'var(--intent-danger-text)' }}>
              {a.erro}
            </p>
          ) : null}

          {/* "Montar operação" saiu daqui.
              Ele existia de quando a conversa do painel e a da página eram duas coisas
              diferentes e era preciso atravessar de uma para a outra. Com uma conversa só,
              ele levava para onde a pessoa já estava — e, com projeto aberto, dizia
              "Continuar a montagem" ao lado da montagem em andamento. A porta para a
              proposta é "Abrir a proposta", e ela só aparece quando existe proposta. */}

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
              aria-label="Sua resposta"
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
