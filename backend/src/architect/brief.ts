import type { ArchitectCapabilityManifest } from './capabilities.js'

// O ENTENDIMENTO do negócio, separado do desenho técnico.
//
// Antes, o primeiro artefato do Arquiteto era o Blueprint: ele saía inventando andar,
// agente e setor a partir de uma frase. O resultado era uma estrutura plausível sobre
// um negócio que ninguém tinha entendido — e a conversa seguinte virava conserto de
// nomes em vez de descoberta.
//
// O Brief inverte a ordem. Primeiro o que a operação PRECISA fazer: os trabalhos, os
// canais, quem aprova o quê, o que falta saber. O Blueprint é compilado depois, e só
// quando o entendimento passa pelas regras.
//
// Ele é do NEGÓCIO: nada aqui tem id técnico, preset ou modo de setor. Misturar as duas
// linguagens antes da hora é o que faz a pessoa ter de responder "qual o output schema
// do setor orquestrado" para conseguir descrever a própria empresa.

export type JobRisk = 'low' | 'medium' | 'high'
export type AssumptionStatus = 'open' | 'accepted' | 'rejected'

export interface BriefJob {
  id: string
  name: string
  /** O que faz este trabalho começar. */
  trigger: string
  input: string
  /** O julgamento que ele exige — vazio quando é puro cálculo ou pura ação. */
  decision: string
  action: string
  output: string
  frequency?: string
  risk?: JobRisk
  requiresHumanApproval?: boolean
}

export interface OperationBrief {
  version: number
  businessGoal: string
  users: { kind: string; needs: string[] }[]
  channels: string[]
  jobs: BriefJob[]
  integrations: { key?: string; need: string; connected: boolean | null }[]
  knowledgeNeeds: { scopeHint?: string; subject: string; required: boolean }[]
  liveDataNeeds: { source: string; freshness?: string; required: boolean }[]
  humanApprovals: { action: string; rule: string }[]
  successCriteria: string[]
  constraints: string[]
  knownFacts: { key: string; value: string; source: 'user' | 'system' }[]
  assumptions: { id: string; text: string; impact: string; status: AssumptionStatus }[]
  openQuestions: { id: string; question: string; why: string; impact: string; priority: number }[]
}

/** Tetos: um Brief é um entendimento, não um depósito. */
export const BRIEF_LIMITS = {
  jobs: 20,
  lista: 15,
  texto: 400,
  textoLongo: 1200,
} as const

export const emptyBrief = (businessGoal = ''): OperationBrief => ({
  version: 0,
  businessGoal,
  users: [],
  channels: [],
  jobs: [],
  integrations: [],
  knowledgeNeeds: [],
  liveDataNeeds: [],
  humanApprovals: [],
  successCriteria: [],
  constraints: [],
  knownFacts: [],
  assumptions: [],
  openQuestions: [],
})

const texto = (v: unknown, max: number = BRIEF_LIMITS.texto): string => String(v ?? '').trim().slice(0, max)
const lista = <T>(v: unknown, mapear: (item: Record<string, unknown>) => T | null, max: number = BRIEF_LIMITS.lista): T[] => {
  if (!Array.isArray(v)) return []
  const fora: T[] = []
  for (const item of v.slice(0, max)) {
    const convertido = item && typeof item === 'object' ? mapear(item as Record<string, unknown>) : null
    if (convertido) fora.push(convertido)
  }
  return fora
}
const textos = (v: unknown, max: number = BRIEF_LIMITS.lista): string[] =>
  Array.isArray(v) ? v.slice(0, max).map((x) => texto(x)).filter(Boolean) : []

const RISCOS: JobRisk[] = ['low', 'medium', 'high']
const STATUS: AssumptionStatus[] = ['open', 'accepted', 'rejected']

/**
 * Um patch do modelo aplicado ao Brief — campo a campo, e nada mais.
 *
 * Espalhar o que veio (`...patch`) deixaria qualquer campo extra entrar e seguir até o
 * banco. Aqui o que não está escrito não existe, e cada lista tem teto.
 *
 * Listas vêm por SUBSTITUIÇÃO com casamento por id quando há id: é assim que o modelo
 * consegue corrigir um trabalho sem reenviar todos, e é assim que "tire aquele
 * trabalho" continua sendo possível.
 */
export function applyBriefPatch(base: OperationBrief, patch: unknown): OperationBrief {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const p = patch as Record<string, unknown>
  const fora: OperationBrief = { ...base, version: base.version + 1 }

  if (typeof p.businessGoal === 'string' && p.businessGoal.trim()) fora.businessGoal = texto(p.businessGoal, BRIEF_LIMITS.textoLongo)

  if (p.users !== undefined) {
    fora.users = lista(p.users, (u) => {
      const kind = texto(u.kind)
      return kind ? { kind, needs: textos(u.needs) } : null
    })
  }
  if (p.channels !== undefined) fora.channels = textos(p.channels)
  if (p.successCriteria !== undefined) fora.successCriteria = textos(p.successCriteria)
  if (p.constraints !== undefined) fora.constraints = textos(p.constraints)

  if (p.jobs !== undefined) {
    const anteriores = new Map(base.jobs.map((j) => [j.id, j]))
    fora.jobs = lista(
      p.jobs,
      (j) => {
        const id = texto(j.id, 60) || texto(j.name, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-')
        if (!id) return null
        const antigo = anteriores.get(id)
        const risco = RISCOS.includes(j.risk as JobRisk) ? (j.risk as JobRisk) : antigo?.risk
        return {
          id,
          name: texto(j.name) || antigo?.name || id,
          trigger: texto(j.trigger) || antigo?.trigger || '',
          input: texto(j.input) || antigo?.input || '',
          decision: texto(j.decision) ?? antigo?.decision ?? '',
          action: texto(j.action) || antigo?.action || '',
          output: texto(j.output) || antigo?.output || '',
          ...(texto(j.frequency) || antigo?.frequency ? { frequency: texto(j.frequency) || antigo?.frequency } : {}),
          ...(risco ? { risk: risco } : {}),
          ...(typeof j.requiresHumanApproval === 'boolean'
            ? { requiresHumanApproval: j.requiresHumanApproval }
            : antigo?.requiresHumanApproval !== undefined
              ? { requiresHumanApproval: antigo.requiresHumanApproval }
              : {}),
        }
      },
      BRIEF_LIMITS.jobs,
    )
  }

  if (p.integrations !== undefined) {
    fora.integrations = lista(p.integrations, (i) => {
      const need = texto(i.need)
      if (!need) return null
      // `connected` NUNCA vem do modelo: quem sabe o que está conectado é o servidor.
      return { ...(texto(i.key, 60) ? { key: texto(i.key, 60) } : {}), need, connected: null }
    })
  }
  if (p.knowledgeNeeds !== undefined) {
    fora.knowledgeNeeds = lista(p.knowledgeNeeds, (k) => {
      const subject = texto(k.subject)
      return subject ? { ...(texto(k.scopeHint, 40) ? { scopeHint: texto(k.scopeHint, 40) } : {}), subject, required: k.required !== false } : null
    })
  }
  if (p.liveDataNeeds !== undefined) {
    fora.liveDataNeeds = lista(p.liveDataNeeds, (l) => {
      const source = texto(l.source)
      return source ? { source, ...(texto(l.freshness, 60) ? { freshness: texto(l.freshness, 60) } : {}), required: l.required !== false } : null
    })
  }
  if (p.humanApprovals !== undefined) {
    fora.humanApprovals = lista(p.humanApprovals, (h) => {
      const action = texto(h.action)
      return action ? { action, rule: texto(h.rule) } : null
    })
  }
  if (p.knownFacts !== undefined) {
    fora.knownFacts = lista(p.knownFacts, (f) => {
      const key = texto(f.key, 80)
      return key ? { key, value: texto(f.value), source: f.source === 'system' ? 'system' : 'user' } : null
    })
  }
  if (p.assumptions !== undefined) {
    fora.assumptions = lista(p.assumptions, (a) => {
      const id = texto(a.id, 60)
      const t = texto(a.text)
      return id && t ? { id, text: t, impact: texto(a.impact), status: STATUS.includes(a.status as AssumptionStatus) ? (a.status as AssumptionStatus) : 'open' } : null
    })
  }
  if (p.openQuestions !== undefined) {
    fora.openQuestions = lista(p.openQuestions, (q) => {
      const id = texto(q.id, 60)
      const question = texto(q.question)
      if (!id || !question) return null
      const prioridade = Number(q.priority)
      return { id, question, why: texto(q.why), impact: texto(q.impact), priority: Number.isFinite(prioridade) ? Math.max(0, Math.min(100, prioridade)) : 50 }
    })
  }

  return fora
}

/**
 * O que o servidor SABE, marcado como sabido.
 *
 * O modelo não decide se uma integração está conectada — ele nem tem como. Aqui o
 * manifesto responde, e a resposta vira fato do Brief. É isto que impede a entrevista
 * de perguntar "você já tem WhatsApp conectado?" para quem conectou ontem.
 */
export function resolveIntegrations(brief: OperationBrief, manifest: ArchitectCapabilityManifest | null): OperationBrief {
  if (!manifest) return brief
  const conectados = new Map(manifest.apps.map((a) => [a.key, a.connected]))
  return {
    ...brief,
    integrations: brief.integrations.map((i) => ({ ...i, connected: i.key ? (conectados.get(i.key) ?? null) : null })),
  }
}

/** O Brief em texto, para o prompt. Curto de propósito: ele é contexto, não anexo. */
export function briefForPrompt(brief: OperationBrief): string {
  if (brief.version === 0 && !brief.businessGoal) return 'Ainda não entendi nada do negócio — esta é a primeira rodada.'
  const linhas: string[] = [`Objetivo do negócio: ${brief.businessGoal || '(ainda não dito)'}`]
  if (brief.channels.length) linhas.push(`Canais: ${brief.channels.join(', ')}`)
  if (brief.jobs.length) {
    linhas.push(
      `Trabalhos mapeados:\n${brief.jobs
        .map((j) => `- ${j.name}: começa por ${j.trigger || '?'}; recebe ${j.input || '?'}; decide ${j.decision || '(nada — é execução)'}; entrega ${j.output || '?'}${j.requiresHumanApproval ? ' [exige aprovação humana]' : ''}`)
        .join('\n')}`,
    )
  }
  if (brief.integrations.length) {
    linhas.push(`Integrações: ${brief.integrations.map((i) => `${i.need}${i.connected === true ? ' (conectada)' : i.connected === false ? ' (NÃO conectada)' : ''}`).join('; ')}`)
  }
  if (brief.humanApprovals.length) linhas.push(`Aprovações humanas: ${brief.humanApprovals.map((h) => `${h.action} — ${h.rule}`).join('; ')}`)
  if (brief.knownFacts.length) linhas.push(`Fatos já sabidos (NÃO pergunte de novo): ${brief.knownFacts.map((f) => `${f.key}=${f.value}`).join('; ')}`)
  if (brief.assumptions.length) linhas.push(`Suposições em aberto: ${brief.assumptions.filter((a) => a.status === 'open').map((a) => a.text).join('; ') || 'nenhuma'}`)
  if (brief.openQuestions.length) linhas.push(`Perguntas pendentes: ${brief.openQuestions.map((q) => `[${q.priority}] ${q.question}`).join(' | ')}`)
  return linhas.join('\n')
}
