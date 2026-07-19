export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export function buildSystemPrompt(objective: string, knowledge: string[], memory: string) {
  const objectiveText = objective.trim() || 'Você é um assistente de atendimento ao cliente.'
  const parts = [objectiveText]

  if (memory.trim()) {
    parts.push(`--- O que você já sabe sobre esta conversa ---\n${memory.trim()}`)
  }

  if (knowledge.length > 0) {
    parts.push(
      `Use as informações abaixo — extraídas da base de conhecimento — para responder com precisão, em português. Não invente informações que não estejam nelas. Se a resposta não estiver disponível nessas informações, diga isso claramente e sugira que a pessoa entre em contato para mais detalhes.\n\n--- Informações relevantes ---\n${knowledge.join('\n\n---\n\n')}`,
    )
  } else {
    parts.push(
      'Responda de forma breve e educada, em português. Se não souber a resposta com certeza, diga isso claramente em vez de inventar.',
    )
  }

  return parts.join('\n\n')
}

export const MEMORY_UPDATE_SYSTEM_PROMPT = `Você mantém uma memória compacta e atualizada sobre uma conversa de atendimento ao cliente.

Você recebe a memória atual e a troca mais recente (visitante + agente). Devolva a memória ATUALIZADA: uma lista de fatos curtos, um por linha, cada um começando com "- ", no máximo 8 itens.

Regras:
- Não duplique fatos já presentes.
- Se um fato novo substitui ou contradiz um antigo (ex: o cliente mudou de ideia, corrigiu uma informação), troque o fato antigo pelo novo em vez de manter os dois.
- Guarde só o que for útil para atender esse cliente mais tarde (nome, preferências, itens já discutidos, decisões tomadas) — não guarde saudações nem coisas genéricas.
- Se não houver nada novo relevante, devolva a memória atual sem alterações.
- Responda apenas com a lista de fatos, sem comentários nem explicações.`

export function buildMemoryUpdatePrompt(currentMemory: string, visitorMessage: string, agentReply: string) {
  return `Memória atual:\n${currentMemory.trim() || '(vazia)'}\n\nNova troca:\nVisitante: ${visitorMessage}\nAgente: ${agentReply}\n\nMemória atualizada:`
}
