import type { ArchitectCapabilityManifest } from './capabilities.js'
import type { OperationBrief } from './brief.js'

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

/** O que a conta JÁ responde sozinha não é pergunta. */
const jaSabido = (brief: OperationBrief, chave: string): boolean =>
  brief.knownFacts.some((f) => f.key === chave) || brief.assumptions.some((a) => a.id === chave && a.status === 'accepted')

/**
 * As lacunas do Brief, em ordem de impacto.
 *
 * Cada detector responde a uma pergunta só: "sem isto, o desenho muda?". O que não muda
 * o desenho não entra — é assim que a entrevista para de parecer formulário.
 */
export function detectGaps(brief: OperationBrief, manifest: ArchitectCapabilityManifest | null): BriefGap[] {
  const lacunas: BriefGap[] = []

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
export function nextQuestions(brief: OperationBrief, manifest: ArchitectCapabilityManifest | null, limite = 2): BriefGap[] {
  const lacunas = detectGaps(brief, manifest)
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
