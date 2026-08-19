// O que o coordenador precisa saber para coordenar.
//
// Um setor orquestrado roda o coordenador e concede a ele o direito de chamar os
// membros. O direito estava lá; a INFORMAÇÃO, não. O coordenador recebia o próprio
// objetivo e o pedido, e mais nada: nenhuma linha dizendo que existe uma equipe, quem
// está nela, ou que a pergunta talvez seja de um especialista. Para descobrir isso ele
// teria de, por conta própria, chamar `list_available_agents` — que lista o prédio
// inteiro, não o time — e então delegar.
//
// Um modelo que recebe uma pergunta e não sabe que tem equipe faz o óbvio: responde
// sozinho. E como o coordenador em geral não tem base de conhecimento própria — quem
// tem é o especialista —, ele responde sozinho e errado, com o dado guardado ali do
// lado. É esse o buraco que este arquivo fecha: a equipe deixa de ser algo a descobrir
// e passa a estar escrita na instrução, com id e função de cada um.
//
// Puro de propósito: sem banco, sem modelo. O que entra é o que já foi carregado.

import type { ExecutionPlan } from './sectorPlanner.js'

export interface BriefingMember {
  agentId: string
  name: string
  /** Por que ele está neste setor — o texto que o dono escreveu na configuração. */
  routingDescription?: string | null
  role?: string | null
  objective?: string | null
  capabilities?: string[] | null
}

const limpar = (texto: string | null | undefined, max: number): string =>
  (texto ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Uma linha por membro: quem é, o id para chamar, e para que ele serve. */
function linhaDe(m: BriefingMember): string {
  // A descrição de roteamento é a primeira escolha porque é a única escrita PARA esta
  // decisão: "quando mandar para ele". Sem ela, a função; sem função, o objetivo.
  const oQueFaz = limpar(m.routingDescription, 200) || limpar(m.role, 200) || limpar(m.objective, 200)
  const competencias = (m.capabilities ?? []).map((c) => limpar(c, 40)).filter(Boolean).slice(0, 8)
  const partes = [`- ${limpar(m.name, 80)} (id: ${m.agentId})`]
  if (oQueFaz) partes.push(`: ${oQueFaz}`)
  if (competencias.length) partes.push(` [competências: ${competencias.join(', ')}]`)
  return partes.join('')
}

/**
 * O briefing do coordenador — vazio quando não há equipe.
 *
 * Vazio importa: um setor orquestrado com um membro só (o próprio coordenador) não tem
 * a quem delegar, e inventar uma instrução de delegação ali faria o modelo procurar
 * gente que não existe.
 */
export function coordinatorBriefing(sectorName: string, membros: BriefingMember[], plano?: ExecutionPlan | null): string {
  if (membros.length === 0) return ''
  const nomePorId = new Map(membros.map((m) => [m.agentId, m.name]))
  // O plano vira instrução: a distribuição deixa de ser um impulso no meio da resposta e
  // passa a ser uma lista de chamadas a fazer. Sem plano, a orientação geral continua
  // valendo — que é como setores antigos seguem funcionando.
  const passos =
    plano && plano.tasks.length > 0
      ? [
          '',
          'PLANO PARA ESTE PEDIDO (siga-o; ele já considerou quem tem o quê):',
          ...plano.tasks.map((t, i) => {
            const espera = t.dependsOn?.length
              ? ` — só depois de ${t.dependsOn.map((d) => `(${d})`).join(' e ')}, usando o que veio de lá`
              : ''
            return `(${t.id}) ${i + 1}. Acione ${limpar(nomePorId.get(t.agentId) ?? '', 80)} (id: ${t.agentId}): ${limpar(t.objective, 300)}${espera}`
          }),
          plano.synthesisObjective ? `Depois, junte tudo: ${limpar(plano.synthesisObjective, 300)}` : 'Depois, junte as respostas numa só.',
          'Se ao executar ficar claro que um passo não faz sentido, diga por quê em vez de inventar o resultado dele.',
        ]
      : []
  return [
    `Você COORDENA a equipe "${limpar(sectorName, 80)}". Estes são os membros que você pode acionar:`,
    ...membros.map(linhaDe),
    ...passos,
    '',
    'Como conduzir:',
    '- Use `delegate_to_agent` com o `id` da lista acima. Não precisa procurar quem existe: a equipe é esta.',
    '- O que for da área de um membro, delegue a ele. Você não tem a base de conhecimento dele, e responder de cabeça o que ele consultaria é o erro mais caro que existe aqui.',
    '- Precisa de mais de um? Delegue a cada um o pedaço dele e junte as respostas.',
    '- Responda direto só quando a pergunta for realmente sua — consolidar, decidir, redigir.',
    '- Se ninguém da equipe cobre o assunto, diga isso claramente em vez de improvisar uma resposta.',
  ].join('\n')
}
