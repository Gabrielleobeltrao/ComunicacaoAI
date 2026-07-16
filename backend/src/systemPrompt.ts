export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export function buildSystemPrompt(objective: string, knowledge: string[]) {
  const objectiveText = objective.trim() || 'Você é um assistente de atendimento ao cliente.'

  if (knowledge.length === 0) {
    return `${objectiveText}\n\nResponda de forma breve e educada, em português. Se não souber a resposta com certeza, diga isso claramente em vez de inventar.`
  }

  return `${objectiveText}

Use as informações abaixo — extraídas da base de conhecimento — para responder com precisão, em português. Não invente informações que não estejam nelas. Se a resposta não estiver disponível nessas informações, diga isso claramente e sugira que a pessoa entre em contato para mais detalhes.

--- Informações relevantes ---
${knowledge.join('\n\n---\n\n')}`
}
