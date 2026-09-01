import { askAuxWithUsage } from '../llm.js'
import { getMonthlyTokenCap, getProviderApiKey } from '../userSettings.js'
import { getMonthlyTokens, recordReplyUsageOnce } from '../tokenUsage.js'
import { extractJson } from './turn.js'
import { normalizeLlmFindings } from './critic.js'
import type { CriticFinding } from './critic.js'
import type { OfficeBlueprintV1 } from './types.js'

// A SEGUNDA LEITURA — a que procura o que regra nenhuma pega.
//
// O crítico determinístico já cobra gerente sem equipe, operador sem ferramenta e
// cálculo entregue a um modelo de linguagem. Ele não vê sobreposição sutil, nome que
// não diz o que o agente faz, nem "isto aqui daria um agente só". Um modelo vê.
//
// Três limites, e os três são o que tornam esta camada segura:
//
// 1. Ela roda DEPOIS da compilação e da validação. O que ela lê é a proposta que já
//    passou pelas regras — não o rascunho, não a conversa.
// 2. Ela produz FINDING, nunca patch, e nunca erro. Um crítico que edita o desenho é um
//    segundo arquiteto, e aí ninguém sabe quem propôs o que está sendo aprovado; um
//    crítico que bloqueia dá a um palpite de modelo a palavra final sobre aplicar.
// 3. Falha e demora não quebram nada. Sem chave, sem orçamento, sem resposta ou fora do
//    prazo, o resultado é "não houve leitura" — e a proposta segue pelo caminho normal.
//
// É cacheada por HASH: uma revisão, uma leitura. Sem isso, cada abertura da prévia
// gastaria uma inferência para dizer a mesma coisa.

/** O prazo. Passou disto, a proposta segue sem a leitura — ela é auxiliar. */
export const LLM_CRITIQUE_TIMEOUT_MS = 20_000

export interface LlmCritique {
  /** De QUAL revisão é esta leitura. Hash diferente = leitura obsoleta, descartada. */
  hash: string
  findings: CriticFinding[]
  status: 'ok' | 'failed'
  createdAt: Date
}

/** A proposta em texto corrido — é o que o modelo lê. Sem JSON, sem chave interna. */
export function describeForCritique(bp: OfficeBlueprintV1): string {
  const nomeDe = (k?: string | null) => (bp.agents ?? []).find((a) => a.key === k)?.name ?? k ?? '—'
  const linhas: string[] = [`OPERAÇÃO: ${bp.title} — ${bp.objective}`, '', 'AGENTES:']
  for (const a of bp.agents ?? []) {
    const apps = (bp.appRequirements ?? []).filter((r) => (r.agentKeys ?? []).includes(a.key)).map((r) => r.appKey)
    linhas.push(
      `- [${a.key}] ${a.name} · perfil ${a.preset ?? 'custom'} · executor ${a.executorKind ?? 'llm'}`,
      `  entrega: ${a.objective ?? '(não declarado)'}`,
      `  aciona quando: ${a.role ?? '(não declarado)'}`,
      `  recebe: ${a.inputContract ?? '(não declarado)'} → devolve: ${a.outputContract ?? '(não declarado)'}`,
      `  não faz: ${a.constraints ?? '(não declarado)'}`,
      `  ferramentas: ${apps.length ? apps.join(', ') : 'nenhuma'} · delegação: ${a.delegationPolicy ?? 'none'}`,
    )
  }
  if (bp.sectors?.length) {
    linhas.push('', 'SETORES:')
    for (const s of bp.sectors) {
      linhas.push(`- ${s.name} (${s.mode}) · coordenador: ${nomeDe(s.coordinatorAgentKey)} · membros: ${(s.memberAgentKeys ?? []).map(nomeDe).join(', ')}`)
    }
  }
  if (bp.routines?.length) {
    linhas.push('', 'ROTINAS:')
    for (const r of bp.routines) linhas.push(`- ${r.name} · dono: ${nomeDe(r.ownerAgentKey)} · ${r.triggerType ?? 'manual'} ${r.cron ?? ''}`.trim())
  }
  if (bp.knowledgeRequirements?.length) {
    linhas.push('', 'CONHECIMENTO PENDENTE:')
    for (const k of bp.knowledgeRequirements) linhas.push(`- ${k.title} (${k.state})`)
  }
  return linhas.join('\n')
}

/** A marca que o prompt do crítico carrega — é por ela que o dublê o reconhece. */
export const CRITIQUE_MARKER = '[[ARQUITETO_CRITICA_V1]]'

export function buildCritiquePrompt(bp: OfficeBlueprintV1): string {
  return `${CRITIQUE_MARKER}
Você revisa o desenho de uma operação de agentes. Ela JÁ passou pelas regras
estruturais: não repita o que uma regra pegaria (gerente sem equipe, operador sem
ferramenta, referência quebrada).

Procure o que só se vê lendo:
- dois agentes que na prática fazem a mesma coisa;
- responsabilidade vaga demais para alguém saber quando acionar;
- um agente que poderia ser dispensado sem perda;
- nome ou objetivo que não descreve o trabalho de verdade;
- caminho que deixa a pessoa sem resposta.

${describeForCritique(bp)}

Responda SOMENTE com este objeto JSON:
{"findings":[{"code":"palavra_curta","agentKey":"a chave entre colchetes, ou omita","message":"o problema, em português, para o dono da operação","fix":"o que fazer","evidence":["o trecho do desenho que sustenta isto"]}]}

Regras da resposta: no máximo 6 achados; só o que você consegue sustentar com o texto
acima; nada de reescrever a proposta; nenhum achado inventado para preencher. Se o
desenho está bom, devolva {"findings":[]}.`
}

interface CritiqueInput {
  ownerId: string
  provider: 'anthropic' | 'openai'
  model: string | null
  chargeKey: string
  blueprint: OfficeBlueprintV1
  hash: string
  timeoutMs?: number
  /**
   * A chamada ao provedor, injetável.
   *
   * Existe por um motivo só: sem ela não há como provar que o PRAZO funciona. Uma
   * garantia de "demora não quebra a proposta" que ninguém consegue exercitar é uma
   * frase, não uma garantia.
   */
  ask?: typeof askAuxWithUsage
}

/**
 * A leitura do modelo — e o contrato de que ela nunca derruba a proposta.
 *
 * Nada aqui lança. Sem chave, sem orçamento, erro do provedor, resposta ilegível ou
 * demora demais produzem todos o mesmo resultado honesto: `status: 'failed'`, nenhum
 * achado. A tela diz que a leitura não aconteceu; ela não finge que aconteceu e não
 * some com a proposta.
 */
export async function runLlmCritique(input: CritiqueInput): Promise<LlmCritique> {
  const vazio = (status: LlmCritique['status']): LlmCritique => ({ hash: input.hash, findings: [], status, createdAt: new Date() })
  try {
    const apiKey = await getProviderApiKey(input.ownerId, input.provider)
    if (!apiKey) return vazio('failed')
    const teto = await getMonthlyTokenCap(input.ownerId)
    if (teto > 0 && (await getMonthlyTokens(input.ownerId)) >= teto) return vazio('failed')

    /**
     * A cobrança é registrada quando a chamada VOLTA — mesmo que o prazo já tenha
     * estourado e ninguém esteja mais esperando. O provedor cobrou de qualquer jeito;
     * não registrar aqui seria consumo invisível na conta de quem pagou.
     */
    const chamada = (input.ask ?? askAuxWithUsage)(input.provider, buildCritiquePrompt(input.blueprint), input.model, apiKey, 1500)
      .then(async (r) => {
        await recordReplyUsageOnce(input.ownerId, r.usage, `${input.chargeKey}:critique`)
        return r
      })
      .catch((error: unknown) => {
        console.error('[architect] crítico auxiliar falhou:', (error as Error)?.message)
        return null
      })

    let expirou: NodeJS.Timeout | undefined
    const prazo = new Promise<null>((resolve) => {
      expirou = setTimeout(() => resolve(null), input.timeoutMs ?? LLM_CRITIQUE_TIMEOUT_MS)
      // O prazo não segura o processo aberto — ele é um limite, não uma tarefa.
      expirou.unref?.()
    })
    const resposta = await Promise.race([chamada, prazo])
    if (expirou) clearTimeout(expirou)
    if (!resposta) return vazio('failed')

    const bruto = extractJson(resposta.text) as { findings?: unknown } | null
    if (!bruto) return vazio('failed')
    return { hash: input.hash, findings: normalizeLlmFindings(bruto.findings, input.blueprint), status: 'ok', createdAt: new Date() }
  } catch (error) {
    console.error('[architect] crítico auxiliar falhou:', (error as Error)?.message)
    return vazio('failed')
  }
}
