import type { ArchitectCapabilityManifest } from './capabilities.js'
import type { OperationBrief } from './brief.js'
import { classifyJob, formaPedida, haDuvidaDeForma } from './classify.js'
import type { OfficeInventory } from './inventory.js'

// QUAL pergunta fazer agora — decidido pelo servidor, não pelo modelo.
//
// Deixar o modelo escolher a pergunta produz duas patologias que apareceram nos testes
// reais: ele pergunta o que já foi respondido, e pergunta o que ele mesmo deveria
// deduzir ("qual o output schema do setor?"). As duas custam a mesma coisa — a pessoa
// perde a confiança de que o sistema está entendendo.
//
// Aqui as lacunas são detectadas por regra, ordenadas por IMPACTO, e o modelo recebe
// no máximo duas: ele redige em linguagem de negócio, mas não inventa o assunto.
//
// O impacto não é preferência de estilo: é quanto a resposta muda a arquitetura. Sem
// saber o objetivo, tudo muda; sem saber a cor do botão, nada muda — e por isso a cor
// do botão não é pergunta do Arquiteto.

export interface BriefGap {
  id: string
  /** O assunto, em linguagem de negócio. O modelo pode reescrever a frase. */
  question: string
  why: string
  impact: string
  /** 0–100. Quanto maior, mais a resposta muda o desenho. */
  priority: number
  /** Opções úteis quando existem — nunca inventadas. */
  choices?: { value: string; label: string }[]
}

const temTexto = (v: string | undefined | null): boolean => Boolean(v && v.trim())

/**
 * As ÁREAS que o texto nomeia — a mesma família de palavras do compilador.
 *
 * Duplicada aqui de propósito: `compileV2` puxa o inventário e o catálogo no import, e este
 * módulo é lido pela rodada antes de qualquer um dos dois existir. O que se repete são seis
 * expressões regulares; o que se evitaria repetindo-as é um ciclo de import.
 */
const AREAS_CITADAS = /\b(atend|suporte|sac|recep|cliente|vend|comercial|prospec|financ|cobran|faturam|pagament|log[íi]st|entreg|expedi|estoque|marketing|conte[úu]do|campanha|opera[çc])/i
function areasCitadas(brief: OperationBrief): string[] {
  const texto = `${brief.businessGoal} ${brief.jobs.map((j) => j.name).join(' ')}`
  return AREAS_CITADAS.test(texto) ? ['area'] : []
}

/** A chave estável de um assunto, para a resposta não se perder entre rodadas. */
const slugDeAssunto = (texto: string) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

/**
 * O conjunto da conta que parece servir a esta necessidade.
 *
 * Casa por TERMO DISTINTIVO — o mesmo critério que o compilador usa para decidir reuso.
 * Aqui ele não decide nada: só encontra o candidato de que a pergunta precisa.
 */
function conjuntoQueServe(inventory: OfficeInventory | null, texto: string): { label: string; campos: string } | null {
  const termos = termosDoAssunto(texto)
  if (!termos.length) return null
  const conjuntos = inventory?.sections.dataset?.items ?? []
  const fontes = inventory?.sections.source?.items ?? []
  for (const item of [...conjuntos, ...fontes]) {
    if (termosDoAssunto(item.label).some((t) => termos.includes(t))) {
      return { label: item.label, campos: String(item.meta?.fields ?? '') }
    }
  }
  return null
}

/** Palavras que identificam UMA coisa — ver `termosDistintivos` no compilador. */
const GENERICOS = new Set([
  'cotacao','cotacoes','preco','precos','valor','valores','dado','dados','fonte','fontes','base','bases','database',
  'atualizando','atualiza','cada','segundos','minutos','historico','serie','diario','diaria','nova','novo','conta',
])
function termosDoAssunto(texto: string): string[] {
  return [
    ...new Set(
      String(texto ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4 && !GENERICOS.has(t)),
    ),
  ]
}

/** Como cada forma se chama, e por que ela é a recomendada. */
const NOME_DA_FORMA: Record<string, string> = {
  agent: 'um agente',
  function: 'uma função',
  tool: 'uma ferramenta',
  routine: 'uma rotina',
  sector: 'um setor',
}
const PORQUE_DA_FORMA: Record<string, string> = {
  agent: 'Eu recomendo um agente: o trabalho exige interpretar e decidir, e isso não cabe numa regra fixa.',
  function: 'Eu recomendo uma função: o resultado é o mesmo toda vez, e sai determinístico, barato e sem risco de o modelo errar a conta.',
  tool: 'Eu recomendo uma ferramenta: é uma chamada a um sistema com contrato definido, usada por quem já conversa — e não um cargo à parte.',
  routine: 'Eu recomendo uma rotina: quem dispara é o horário ou a condição, não uma pessoa falando.',
  sector: 'Eu recomendo um setor: é trabalho de mais de um agente coordenado.',
}

/** O que a conta JÁ responde sozinha não é pergunta. */
const jaSabido = (brief: OperationBrief, chave: string): boolean =>
  brief.knownFacts.some((f) => f.key === chave) || brief.assumptions.some((a) => a.id === chave && a.status === 'accepted')

/**
 * As lacunas do Brief, em ordem de impacto.
 *
 * Cada detector responde a uma pergunta só: "sem isto, o desenho muda?". O que não muda
 * o desenho não entra — é assim que a entrevista para de parecer formulário.
 */
export function detectGaps(
  brief: OperationBrief,
  manifest: ArchitectCapabilityManifest | null,
  /** O que a conta tem. Sem ele, "você já tem uma base que serve" não é uma pergunta possível. */
  inventory: OfficeInventory | null = null,
): BriefGap[] {
  const lacunas: BriefGap[] = []

  /**
   * ANTES DE CRIAR, PROCURA — E PERGUNTA SE ACHOU.
   *
   * O compilador já procurava, e amarrava calado. Procurar em silêncio tem os dois
   * defeitos: quando acerta, a pessoa não fica sabendo que houve reuso; quando erra, ela
   * descobre depois de aplicar. E o que ela pediu foi exatamente o meio-termo — "ele
   * pergunta se eu tenho essa database de bitcoin, e vê o que tem lá dentro".
   *
   * A pergunta cita o que foi achado E os campos que existem: é o que permite responder
   * sabendo, em vez de confiar.
   */
  /**
   * EM QUAL ANDAR ISTO MORA — perguntado, e não escolhido.
   *
   * O trabalho do bitcoin nasceu no "Salão", que é o andar do restaurante, só por ser o
   * primeiro da lista. Virar pendência foi melhor que o silêncio, mas pendência é um aviso
   * que se lê DEPOIS de a proposta estar montada. A escolha entre andares é fechada e
   * curta — são os que existem —, que é exatamente a forma de uma pergunta com opções.
   *
   * Quem NOMEIA uma área já respondeu: "montar o atendimento" diz onde mora.
   */
  const andares = inventory?.sections.floor?.items ?? []
  if (andares.length > 1 && brief.jobs.length > 0 && !jaSabido(brief, 'andar') && areasCitadas(brief).length === 0) {
    lacunas.push({
      id: 'andar',
      question: 'Em qual andar este trabalho mora?',
      why: `A conta tem ${andares.length} andares. Sem a resposta eu monto em "${andares[0].label}", que é só o primeiro da lista.`,
      impact: 'Decide onde a operação inteira é criada.',
      priority: 90,
      choices: andares.slice(0, 6).map((f) => ({ value: slugDeAssunto(f.label), label: f.label })),
    })
  }

  for (const [i, need] of (brief.liveDataNeeds ?? []).entries()) {
    if (!need.source?.trim()) continue
    const chave = `origem:${slugDeAssunto(need.source)}` || `origem:${i}`
    if (jaSabido(brief, chave)) continue
    const achado = conjuntoQueServe(inventory, need.source)
    if (!achado) continue
    lacunas.push({
      id: chave,
      question: `Você já tem "${achado.label}" nesta conta. É de lá que eu leio "${need.source.slice(0, 60)}"?`,
      why: achado.campos ? `"${achado.label}" tem os campos: ${achado.campos}.` : `"${achado.label}" já recebe dado nesta conta.`,
      impact: 'Decide se a operação lê o que já existe ou abre uma coleta nova.',
      priority: 92,
      choices: [
        { value: 'usar', label: `Sim, ler de "${achado.label}"` },
        { value: 'criar', label: 'Não, é outra origem' },
      ],
    })
  }

  /**
   * QUANDO O SERVIDOR DISCORDA DE QUEM PEDIU, ele PERGUNTA.
   *
   * A regra de classificação é boa e continua valendo: cálculo sem julgamento é função,
   * ação em sistema é ferramenta, agente é o mais caro e só entra quando há julgamento. O
   * que faltava era o degrau final — a pessoa escreve "quero um AGENTE que guarde a máxima
   * do dia", a regra devolve FUNÇÃO, e a troca acontecia em silêncio. O que sai não é o que
   * foi pedido, e ninguém foi avisado.
   *
   * Prioridade alta, mas abaixo do objetivo: sem saber o que a operação resolve, escolher a
   * forma do trabalho é escolher a forma de um trabalho que ainda não existe.
   */
  for (const job of brief.jobs) {
    const pedida = formaPedida(job)
    if (!pedida) continue
    const decisao = classifyJob(job, manifest)
    const decidida = decisao.kind
    if (decidida === pedida) continue
    if (jaSabido(brief, `forma:${job.id}`)) continue
    // E só quando a decisão é DE FATO apertada — ver `haDuvidaDeForma`.
    if (!haDuvidaDeForma(job, decisao, pedida)) continue
    lacunas.push({
      id: `forma:${job.id}`,
      question: `Para "${job.name.slice(0, 60)}": ${NOME_DA_FORMA[decidida]} ou ${NOME_DA_FORMA[pedida]}?`,
      // A recomendação e o custo dela, em uma frase — é o que permite escolher com
      // informação em vez de escolher o que soa melhor.
      why: `${PORQUE_DA_FORMA[decidida]} Você pediu ${NOME_DA_FORMA[pedida]}; a escolha é sua e eu monto do jeito que você decidir.`,
      impact: 'Muda o que é criado para este trabalho.',
      priority: 88,
      // A recomendação vem PRIMEIRO — a ordem é a do conselho, não a do pedido.
      choices: [
        { value: decidida, label: `${NOME_DA_FORMA[decidida]} (recomendado)` },
        { value: pedida, label: NOME_DA_FORMA[pedida] },
      ],
    })
  }

  if (!temTexto(brief.businessGoal)) {
    lacunas.push({
      id: 'objetivo',
      question: 'O que essa operação precisa resolver no dia a dia?',
      why: 'Sem o resultado esperado, qualquer desenho é chute.',
      impact: 'Define a operação inteira.',
      priority: 100,
    })
  }

  if (brief.jobs.length === 0 && temTexto(brief.businessGoal)) {
    lacunas.push({
      id: 'trabalhos',
      question: 'Quando alguém procura vocês, o que precisa acontecer até o assunto ficar resolvido?',
      why: 'São esses passos que viram agentes, funções ou ferramentas.',
      impact: 'Define quantos agentes existem e o que cada um faz.',
      priority: 95,
    })
  }

  // O canal é a porta de entrada: sem ele a operação não tem por onde ser acionada.
  if (brief.channels.length === 0 && !jaSabido(brief, 'canal')) {
    const conectados = (manifest?.channels ?? []).filter((c) => c.connected)
    lacunas.push({
      id: 'canal',
      question: 'Por onde as pessoas falam com vocês hoje?',
      why: 'O canal decide quem recebe a conversa e o que precisa ser conectado.',
      impact: 'Define a porta de entrada e as pendências de conexão.',
      priority: 85,
      // As opções são as REAIS: oferecer um canal que a conta não tem seria prometer
      // uma integração que não existe.
      ...(conectados.length ? { choices: conectados.map((c) => ({ value: c.key, label: c.key })) } : {}),
    })
  }

  /**
   * Ação com consequência sem regra de aprovação.
   *
   * É a lacuna que mais cara sai: uma operação que cancela pedido ou mexe em dinheiro
   * sem dizer quem aprova nasce com um risco que ninguém escolheu correr.
   */
  const arriscados = brief.jobs.filter((j) => (j.risk === 'high' || j.requiresHumanApproval) && !brief.humanApprovals.some((h) => h.action.includes(j.name)))
  for (const job of arriscados.slice(0, 2)) {
    lacunas.push({
      id: `aprovacao:${job.id}`,
      question: `Em "${job.name}", o sistema pode concluir sozinho ou alguém precisa aprovar antes?`,
      why: 'Ação com consequência sem regra de aprovação nasce com um risco que ninguém escolheu.',
      impact: 'Define permissão, guardrail e o que a simulação vai exigir.',
      priority: 80,
      choices: [
        { value: 'sozinho', label: 'Pode concluir sozinho' },
        { value: 'aprovacao', label: 'Alguém aprova antes' },
      ],
    })
  }

  // Integração citada sem sistema: "conectar ao meu sistema" não dá para conectar.
  const semSistema = brief.integrations.filter((i) => !i.key)
  for (const integracao of semSistema.slice(0, 1)) {
    lacunas.push({
      id: `integracao:${integracao.need.slice(0, 30)}`,
      question: `Para "${integracao.need}", qual sistema vocês usam hoje?`,
      why: 'Só dá para conectar o que tem nome — e só o que já existe no catálogo.',
      impact: 'Define se isso é ferramenta pronta, pendência de conexão ou trabalho manual.',
      priority: 70,
    })
  }

  // Conhecimento obrigatório sem origem: sem ele o agente responde do nada.
  const semOrigem = brief.knowledgeNeeds.filter((k) => k.required)
  for (const need of semOrigem.slice(0, 1)) {
    lacunas.push({
      id: `conhecimento:${need.subject.slice(0, 30)}`,
      question: `Sobre "${need.subject}": vocês já têm isso escrito em algum lugar?`,
      why: 'Sem a fonte, o agente responde por conta própria — e é aí que ele inventa.',
      impact: 'Define se vira base de conhecimento, pendência ou pergunta ao cliente.',
      priority: 60,
      choices: [
        { value: 'tenho', label: 'Temos, posso enviar' },
        { value: 'nao-tenho', label: 'Ainda não temos' },
      ],
    })
  }

  const jaPerguntadas = new Set(brief.openQuestions.map((q) => q.id))
  return lacunas
    .filter((l) => !jaPerguntadas.has(l.id) || l.priority >= 95)
    .sort((a, b) => b.priority - a.priority)
}

/**
 * As lacunas que o modelo pode perguntar AGORA — no máximo duas.
 *
 * Duas e não cinco porque uma entrevista de cinco perguntas por turno é um formulário
 * com outro nome, e porque a segunda resposta costuma mudar a terceira pergunta.
 */
export function nextQuestions(brief: OperationBrief, manifest: ArchitectCapabilityManifest | null, limite = 2, inventory: OfficeInventory | null = null): BriefGap[] {
  const lacunas = detectGaps(brief, manifest, inventory)
  if (lacunas.length === 0) return []
  /**
   * Quando a primeira lacuna é FUNDACIONAL, ela vai sozinha.
   *
   * Sem saber o objetivo, a segunda pergunta é sobre um negócio que ainda não foi
   * descrito — e a resposta dela provavelmente muda depois que o objetivo aparecer.
   * Perguntar as duas juntas parece eficiente e produz retrabalho.
   */
  if (lacunas[0].priority >= 95) return [lacunas[0]]
  return lacunas.slice(0, Math.max(1, Math.min(limite, 2)))
}

/** As lacunas em texto, para o prompt: o modelo redige, mas não escolhe o assunto. */
export function gapsForPrompt(gaps: BriefGap[]): string {
  if (gaps.length === 0) return 'Não há lacuna de alto impacto: já dá para propor. Não invente pergunta nova.'
  return `PERGUNTE SOBRE ISTO — e só isto, no máximo ${gaps.length === 1 ? 'uma pergunta' : 'duas perguntas'}:
${gaps
  .map(
    (g) =>
      `- (${g.id}) ${g.question}\n  Por que importa: ${g.why}${g.choices ? `\n  Opções reais: ${g.choices.map((c) => c.label).join(' | ')}` : ''}`,
  )
  .join('\n')}
Reescreva a pergunta em linguagem de negócio se ficar melhor, mas não mude o assunto e não acrescente outra.`
}
