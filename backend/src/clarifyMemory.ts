// O que já foi esclarecido, para não perguntar duas vezes.
//
// Sem isto o sistema é amnésico: você explica hoje que "a proposta" é a que enviamos, e
// amanhã perguntam de novo. A segunda pergunta é pior que a primeira — a primeira era
// cuidado, a segunda é a prova de que ninguém prestou atenção.
//
// A gravação é DETERMINÍSTICA e acontece fora do modelo: quando o turno anterior foi uma
// pergunta de esclarecimento e o visitante respondeu, o par pergunta→resposta é guardado.
// Nenhum agente ganha direito de escrever memória por isso — o caminho de escrita continua
// sendo só este, estreito, com uma chave derivada da própria pergunta.
//
// A leitura é a de sempre (`buscar_memoria`, determinística e sem token), mais uma injeção
// curta no contexto: quem responde não deveria precisar lembrar de procurar.
import { ObjectId } from 'mongodb'
import { createHash } from 'node:crypto'
import { scopeKeyOf, searchMemory, writeMemory } from './memory/records.js'

const PREFIXO = 'esclarecimento'
/** Quantos esclarecimentos anteriores entram no contexto. Poucos: isto é dica, não base. */
const MAX_LEMBRADOS = 3

/** A chave é derivada da PERGUNTA: perguntar o mesmo de novo cai no mesmo registro. */
export const clarificationKey = (pergunta: string): string =>
  `${PREFIXO}:${createHash('sha256').update(pergunta.trim().toLowerCase()).digest('hex').slice(0, 16)}`

export interface ClarifyMemoryTarget {
  ownerId: string
  agentId: ObjectId
  /** Quando a conversa aconteceu dentro de um setor, o time inteiro aprende junto. */
  sectorId?: ObjectId | null
}

/**
 * Guarda "quando perguntam X, a resposta é Y".
 *
 * `upsert`: a mesma dúvida esclarecida de novo ATUALIZA a resposta em vez de empilhar —
 * quem mudou de ideia mudou de ideia, e a última é a que vale.
 */
export async function rememberClarification(
  alvo: ClarifyMemoryTarget,
  pergunta: string,
  resposta: string,
): Promise<void> {
  const limpa = resposta.trim().slice(0, 500)
  if (!pergunta.trim() || !limpa) return
  await writeMemory({
    tenantId: alvo.ownerId,
    target: alvo.sectorId ? { scope: 'sector', sectorId: alvo.sectorId } : { scope: 'agent', agentId: alvo.agentId },
    key: clarificationKey(pergunta),
    payload: { pergunta: pergunta.trim().slice(0, 300), resposta: limpa },
    strategy: 'upsert',
    sourceType: 'clarification',
  })
}

/**
 * Os esclarecimentos que este agente (ou o time dele) já recebeu.
 *
 * Entram no contexto como dica curta. Não são base de conhecimento e não substituem
 * perguntar de novo quando a dúvida é OUTRA — só evitam repetir a mesma.
 */
export async function recallClarifications(alvo: ClarifyMemoryTarget): Promise<string | null> {
  const escopos = [scopeKeyOf({ scope: 'agent', agentId: alvo.agentId })]
  if (alvo.sectorId) escopos.push(scopeKeyOf({ scope: 'sector', sectorId: alvo.sectorId }))

  // Pela ORIGEM, e não pela chave: a chave é um hash da pergunta, e procurar por prefixo
  // dela devolveria nada.
  const achado = await searchMemory({
    tenantId: alvo.ownerId,
    scopeKeys: escopos,
    sourceType: 'clarification',
    limit: MAX_LEMBRADOS,
  }).catch(() => null)
  const registros = (achado?.items ?? []) as { payload?: { pergunta?: string; resposta?: string } }[]
  const linhas = registros
    .map((r) => (r.payload?.pergunta && r.payload?.resposta ? `- "${r.payload.pergunta}" → ${r.payload.resposta}` : null))
    .filter((l): l is string => Boolean(l))
  if (linhas.length === 0) return null
  return (
    'Já esclarecido antes com esta pessoa (não pergunte de novo o que está aqui):\n' +
    linhas.join('\n')
  )
}
