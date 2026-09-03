// O ROTEADOR DE INTENÇÃO — quatro modos, e a fronteira entre descrever e mandar.
//
// O Arquiteto V1 tem uma entrada só: toda mensagem entra num projeto e produz desenho. Quem
// pergunta "qual o valor do dólar hoje?" recebe uma proposta de operação, e um projeto que
// ninguém pediu fica no histórico da conta para sempre.
//
// Aqui a mensagem passa antes por uma classificação. A regra que atravessa o arquivo é a
// mesma do resto do Arquiteto: **a LLM classifica e descreve; o código decide e executa.**
// Concretamente, três coisas que o parser garante e nenhum prompt garantiria:
//
//   1. o modo vem de um vocabulário fechado — o que não estiver nele vira `answer`, que é o
//      modo que não muda nada;
//   2. nenhum ObjectId sobrevive ao parser. Um id vindo do modelo é um id inventado, e um id
//      inventado que casa por acaso com o de outra conta é a diferença entre uma proposta e
//      um vazamento;
//   3. risco só SOBE na dúvida. Um pedido ambíguo entre ler e escrever é tratado como
//      escrita, e escrita exige permissão conferida na hora.

export type ArchitectMode = 'answer' | 'propose' | 'operate' | 'explain'
export const ARCHITECT_MODES: readonly ArchitectMode[] = ['answer', 'propose', 'operate', 'explain']

export type IntentFreshness = 'static' | 'current'
export type IntentChangeKind = 'create' | 'expand' | 'repair' | 'reorganize'
export type IntentRisk = 'read' | 'write' | 'high_risk'

export type ArchitectIntent =
  | { mode: 'answer'; query: string; freshness: IntentFreshness }
  | { mode: 'propose'; changeKind: IntentChangeKind; objective: string }
  | { mode: 'operate'; action: string; targetRef?: string; risk: IntentRisk }
  | { mode: 'explain'; targetRef?: string; question: string }

/** Tetos de texto. Uma intenção é um recorte, não um depósito. */
export const INTENT_LIMITS: { text: number; ref: number } = { text: 400, ref: 80 }

const CHANGE_KINDS: IntentChangeKind[] = ['create', 'expand', 'repair', 'reorganize']
const RISKS: IntentRisk[] = ['read', 'write', 'high_risk']

/** Um ObjectId de 24 hex. Ele nunca sobrevive ao parser, venha de onde vier. */
const OBJECT_ID = /\b[0-9a-f]{24}\b/gi

const texto = (v: unknown, max = INTENT_LIMITS.text): string =>
  String(v ?? '')
    .replace(OBJECT_ID, '')
    .trim()
    .slice(0, max)

/**
 * A referência a um alvo — `key` ou tipo:nome, nunca um id de banco.
 *
 * O modelo não escolhe ObjectId. Quando ele cita um alvo, cita pelo nome que a pessoa usou;
 * quem resolve nome para recurso é o código, contra o inventário da conta.
 */
const referencia = (v: unknown): string | undefined => {
  const s = texto(v, INTENT_LIMITS.ref)
  return s || undefined
}

/**
 * Lê a intenção que o modelo devolveu.
 *
 * Tudo o que não couber no formato vira `answer`: é o modo que não cria projeto, não escreve
 * nada e não aciona nada. Cair no modo mais inofensivo diante de uma resposta estranha é a
 * escolha que separa "não entendi" de "fiz algo que ninguém pediu".
 */
export function parseIntent(bruto: unknown, mensagemOriginal = ''): ArchitectIntent {
  const fallback = (): ArchitectIntent => ({ mode: 'answer', query: texto(mensagemOriginal), freshness: 'static' })
  if (!bruto || typeof bruto !== 'object') return fallback()

  const o = bruto as Record<string, unknown>
  const mode = String(o.mode ?? '') as ArchitectMode
  if (!ARCHITECT_MODES.includes(mode)) return fallback()

  if (mode === 'answer') {
    return {
      mode: 'answer',
      query: texto(o.query) || texto(mensagemOriginal),
      freshness: o.freshness === 'current' ? 'current' : 'static',
    }
  }

  if (mode === 'propose') {
    const changeKind = CHANGE_KINDS.includes(o.changeKind as IntentChangeKind) ? (o.changeKind as IntentChangeKind) : 'create'
    const objective = texto(o.objective) || texto(mensagemOriginal)
    // Uma proposta sem objetivo não é proposta: sem ela, não há o que compilar.
    if (!objective) return fallback()
    return { mode: 'propose', changeKind, objective }
  }

  if (mode === 'operate') {
    const action = texto(o.action)
    if (!action) return fallback()
    /**
     * O risco SOBE na dúvida.
     *
     * Um valor ausente ou desconhecido vira `write`, não `read`. Errar para cima custa uma
     * confirmação; errar para baixo executa uma escrita que ninguém autorizou.
     */
    const risk = RISKS.includes(o.risk as IntentRisk) ? (o.risk as IntentRisk) : 'write'
    const ref = referencia(o.targetRef)
    return { mode: 'operate', action, risk, ...(ref ? { targetRef: ref } : {}) }
  }

  const ref = referencia(o.targetRef)
  return { mode: 'explain', question: texto(o.question) || texto(mensagemOriginal), ...(ref ? { targetRef: ref } : {}) }
}

// --- as consequências do modo, decididas pelo código ----------------------------------------

export interface IntentPolicy {
  /** Este modo cria ou reabre um projeto? Só `propose`. */
  createsProject: boolean
  /** Ele pode escrever no escritório sem confirmação explícita? */
  writesWithoutConfirmation: boolean
  /** Ele exige uma prévia com impacto antes de agir? */
  requiresPreview: boolean
  /** Ele precisa de fonte com origem e instante? */
  requiresProvenance: boolean
}

/**
 * O que cada modo PODE fazer — decidido aqui, e não no prompt.
 *
 * Uma regra escrita em português dentro de um prompt é uma sugestão: o modelo a segue quase
 * sempre, e o "quase" é justamente o caso que ninguém testa. A política é código.
 */
export function policyFor(intent: ArchitectIntent): IntentPolicy {
  switch (intent.mode) {
    case 'answer':
      return {
        createsProject: false,
        writesWithoutConfirmation: false,
        requiresPreview: false,
        // Uma resposta sobre o AGORA precisa dizer de onde veio e quando. Sem isso ela é um
        // palpite com cara de fato.
        requiresProvenance: intent.freshness === 'current',
      }
    case 'explain':
      return { createsProject: false, writesWithoutConfirmation: false, requiresPreview: false, requiresProvenance: false }
    case 'propose':
      // Propor não aplica nada: o projeto nasce e a aplicação é um ato separado.
      return { createsProject: true, writesWithoutConfirmation: false, requiresPreview: true, requiresProvenance: false }
    case 'operate':
      return {
        createsProject: false,
        // Leitura já autorizada pode executar. Escrita, nunca sem confirmação.
        writesWithoutConfirmation: intent.risk === 'read',
        requiresPreview: intent.risk !== 'read',
        requiresProvenance: false,
      }
  }
}

// --- a sugestão determinística, antes de gastar uma chamada ------------------------------------

/**
 * Um palpite por FORMA da frase — sugestão, nunca decisão.
 *
 * Ele existe por dois motivos práticos: dá uma resposta quando o provedor está fora, e serve
 * de rede quando a classificação volta ilegível. O plano é explícito que heurística por regex
 * pode sugerir e não pode decidir — então ele produz apenas os modos que NÃO mudam nada:
 * `answer`, `explain`, `propose` (que só abre projeto) e `operate` de LEITURA.
 *
 * Escrita e alto risco nunca saem daqui. "Pause a fonte" e "apague o andar" parecem iguais
 * para uma expressão regular, e um dos dois é irreversível.
 */
export function suggestIntent(mensagem: string): ArchitectIntent {
  const m = String(mensagem ?? '').toLowerCase()

  const pedeMudanca = /\b(crie|criar|monte|montar|adicione|adicionar|configure|configurar|automatize|automatizar|quero que|preciso de um|preciso de uma|implemente|monta|expanda|expandir|reorganize|conserte|consertar|corrija|corrigir)\b/.test(m)
  const pedeAgora = /\b(hoje|agora|atual|no momento|neste momento|cotação|cotacao|valor do|preço do|preco do|quanto está|quanto esta)\b/.test(m)
  const pergunta = /\?|^(o que|qual|quais|quanto|como|por que|porque|quem|quando|onde)\b/.test(m.trim())

  if (pedeMudanca) {
    const expande = /\b(adicione|adicionar|expanda|expandir|também|tambem|ao meu|à minha|na minha|no meu)\b/.test(m)
    const conserta = /\b(conserte|consertar|corrija|corrigir|não está|nao esta|parou|quebrou|falha)\b/.test(m)
    const reorganiza = /\b(reorganize|reorganizar|mover|mude o|troque o|renomeie)\b/.test(m)
    return {
      mode: 'propose',
      changeKind: conserta ? 'repair' : reorganiza ? 'reorganize' : expande ? 'expand' : 'create',
      objective: texto(mensagem),
    }
  }

  /**
   * A pergunta sobre o PRÓPRIO ESCRITÓRIO é `explain`, não `answer`.
   *
   * "O que este agente faz?" e "como meu atendimento funciona?" têm resposta no inventário
   * da conta — respondê-las como `answer` mandaria a pessoa para um caminho que procura
   * fonte de dado externa e recusa por não achar nenhuma.
   */
  const sobreOEscritorio =
    /\b(meu|minha|meus|minhas|este|esta|esse|essa|deste|desta|aqui)\b/.test(m) &&
    /\b(agente|setor|andar|escritório|escritorio|atendimento|operação|operacao|fluxo|flow|monitor|fonte|automação|automacao|equipe|time)\b/.test(m)
  if (pergunta && (sobreOEscritorio || /\b(o que eu tenho|o que tem|como funciona|quem faz|quem cuida)\b/.test(m))) {
    return { mode: 'explain', question: texto(mensagem) }
  }

  /**
   * LISTAR é a única operação que a heurística produz — e ela não muda nada.
   *
   * Adivinhar uma escrita por expressão regular é o erro que este roteador existe para
   * evitar: "pause a fonte" e "apague o andar" parecem iguais para um regex, e um deles é
   * irreversível. Quando o provedor está fora, o pior que acontece é a pessoa receber uma
   * lista em vez da ação — e ela pede de novo.
   */
  if (/\b(liste|listar|mostre|mostrar|quais são|quais sao|me diga quais)\b/.test(m)) {
    return { mode: 'operate', action: texto(mensagem), risk: 'read' }
  }

  if (pergunta || pedeAgora) {
    return { mode: 'answer', query: texto(mensagem), freshness: pedeAgora ? 'current' : 'static' }
  }
  // Sem sinal nenhum, a saída é o modo que não muda nada.
  return { mode: 'answer', query: texto(mensagem), freshness: 'static' }
}

/**
 * Uma pergunta curta quando os dois caminhos são plausíveis.
 *
 * O plano pede exatamente isto: ambiguidade entre responder e modificar vira UMA pergunta,
 * não um palpite. Devolver `null` significa "não há ambiguidade".
 */
export function clarifyingQuestion(mensagem: string, intent: ArchitectIntent): string | null {
  const m = String(mensagem ?? '').toLowerCase()
  const pedeMudanca = /\b(crie|criar|monte|montar|adicione|adicionar|configure|configurar|automatize)\b/.test(m)
  const pergunta = /\?/.test(m)

  /**
   * A ambiguidade é ter os DOIS sinais na mesma frase.
   *
   * "crie um relatório?" tem verbo de mudança e ponto de interrogação: quem escreveu pode
   * estar pedindo para montar, ou perguntando se dá para montar. Escolher um dos dois é
   * exatamente o palpite que o plano proíbe — então a saída é uma pergunta de uma linha.
   */
  if (pedeMudanca && pergunta) {
    return 'Quer que eu só responda, ou que eu monte isso no seu escritório?'
  }
  // Classificado como resposta, mas com verbo de mudança: o modelo pode ter errado o lado.
  if (intent.mode === 'answer' && pedeMudanca) {
    return 'Quer que eu só responda, ou que eu monte isso no seu escritório?'
  }
  return null
}

/**
 * A PROVENIÊNCIA de uma resposta sobre o agora.
 *
 * Sem ela, "o dólar está 5,42" é um número que o modelo lembrou de algum lugar — e um número
 * lembrado com cara de cotação é pior que nenhum número.
 */
export interface AnswerProvenance {
  /** De onde veio: o nome da ferramenta, App ou fonte. Nunca a credencial dela. */
  source: string
  /** Quando foi consultado. */
  at: Date
  /** O que foi feito com o dado bruto, quando algo foi feito. */
  transformation?: string
}

export interface CurrentAnswer {
  ok: boolean
  text: string
  provenance?: AnswerProvenance
  /** Quando `ok: false`, por que não deu — em português e acionável. */
  reason?: string
}

/**
 * A recusa honesta: sem fonte atual, não há resposta atual.
 *
 * A alternativa seria o modelo responder de memória. Um valor de câmbio de três meses atrás
 * apresentado como "hoje" não é uma resposta pior — é uma resposta errada, e quem lê não tem
 * como saber.
 */
export const noCurrentSource = (assunto: string): CurrentAnswer => ({
  ok: false,
  text: '',
  reason: `não tenho uma fonte conectada para "${assunto}" agora. Conecte um App ou uma fonte de dados que traga esse número, e eu respondo com a origem e o horário.`,
})
