export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export function buildSystemPrompt(
  objective: string,
  knowledge: string[],
  memory: string,
  identityInstruction = '',
) {
  const objectiveText = objective.trim() || 'Você é um assistente de atendimento ao cliente.'
  const parts = [objectiveText]

  if (memory.trim()) {
    parts.push(`--- O que você já sabe sobre esta conversa ---\n${memory.trim()}`)
  }

  if (identityInstruction.trim()) {
    parts.push(identityInstruction.trim())
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

export const STRUCTURED_MEMORY_UPDATE_SYSTEM_PROMPT = `Você mantém uma memória estruturada e atualizada sobre uma conversa de atendimento ao cliente, no formato de pares chave:valor (ex: "Serviço preferido": "Corte degradê").

Você recebe a memória atual (JSON) e a troca mais recente (visitante + agente). Devolva a memória ATUALIZADA como um objeto JSON válido.

Regras:
- No máximo 10 chaves.
- Se um valor novo substitui ou contradiz um antigo (ex: o cliente mudou de ideia), atualize o valor da mesma chave em vez de criar uma nova.
- Só guarde informações objetivas e úteis para atender esse cliente no futuro.
- Se não houver nada novo relevante, devolva a memória atual sem alterações.
- Responda APENAS com o objeto JSON, sem comentários, sem markdown, sem texto adicional.`

export function buildStructuredMemoryUpdatePrompt(
  currentMemory: Record<string, string>,
  visitorMessage: string,
  agentReply: string,
) {
  const currentJson = Object.keys(currentMemory).length > 0 ? JSON.stringify(currentMemory) : '{}'
  return `Memória atual:\n${currentJson}\n\nNova troca:\nVisitante: ${visitorMessage}\nAgente: ${agentReply}\n\nMemória atualizada (JSON):`
}

export function buildIdentityCaptureInstruction(fields: string[]): string {
  if (fields.length === 0) return ''
  return `Você ainda não sabe as seguintes informações deste visitante: ${fields.join(', ')}. Pergunte essas informações de forma natural durante a conversa, sem parecer um formulário — por exemplo, ao cumprimentar ou perto do fim da sua resposta. Não repita a pergunta se o visitante já tiver respondido antes nesta conversa. Continue ajudando normalmente mesmo antes de ter essas informações.`
}

export const IDENTITY_EXTRACTION_SYSTEM_PROMPT = `Você extrai dados de identificação de um visitante a partir do histórico de uma conversa de atendimento.

Você recebe uma lista de campos pedidos (ex: Nome, Email) e as mensagens recentes da conversa. Devolva os valores desses campos SE E SOMENTE SE todos os campos pedidos já tiverem sido claramente informados pelo visitante em algum momento da conversa.

Responda APENAS com um objeto JSON válido, sem comentários, sem markdown:
- Se TODOS os campos pedidos já foram informados: {"Campo1": "valor", "Campo2": "valor"}
- Se algum campo ainda estiver faltando: {}`

export function buildIdentityExtractionPrompt(fields: string[], recentMessages: ChatTurn[]) {
  const transcript = recentMessages
    .map((turn) => `${turn.role === 'user' ? 'Visitante' : 'Agente'}: ${turn.content}`)
    .join('\n')
  return `Campos pedidos: ${fields.join(', ')}\n\nConversa:\n${transcript}\n\nValores extraídos (JSON):`
}

export function formatStructuredMemory(structured: Record<string, string>): string {
  const entries = Object.entries(structured)
  if (entries.length === 0) return ''
  return entries.map(([key, value]) => `${key}: ${value}`).join('\n')
}

// Models sometimes wrap JSON in a markdown code fence despite instructions
// not to — strip that before parsing, and fall back gracefully otherwise.
export function parseJsonObject(text: string): Record<string, string> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()

  try {
    const parsed: unknown = JSON.parse(cleaned)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>
    }
    return {}
  } catch {
    return {}
  }
}
