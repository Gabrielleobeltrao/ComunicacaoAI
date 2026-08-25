import type { ArchitectStatus } from './types.js'

// A máquina de estados do projeto, escrita como tabela.
//
// Ela existe para uma pergunta ter uma resposta só: "dá para aplicar agora?". Espalhada
// por `if`s nas rotas, a resposta mudaria de rota para rota — e a que esquecesse de
// conferir `applying` deixaria duas aplicações correrem juntas.

const TRANSICOES: Record<ArchitectStatus, ArchitectStatus[]> = {
  // Enquanto pergunta, pode virar proposta ou ser arquivado.
  discovery: ['draft', 'archived'],
  // Proposta na mesa: pode ser revisada (volta para discovery), validada ou arquivada.
  draft: ['discovery', 'draft', 'ready', 'archived'],
  // Validada. Daqui sai a aplicação — e só daqui.
  ready: ['discovery', 'draft', 'applying', 'archived'],
  // Aplicando: só termina, falha, ou (retomada) continua aplicando.
  applying: ['applied', 'failed', 'applying'],
  // Aplicado é final para a estrutura; a checklist continua evoluindo.
  applied: ['archived'],
  // Falhou no meio: retomar volta para applying; revisar volta para draft.
  failed: ['applying', 'draft', 'archived'],
  archived: [],
}

export const canTransition = (de: ArchitectStatus, para: ArchitectStatus): boolean => (TRANSICOES[de] ?? []).includes(para)

/** Os estados a partir dos quais `apply` pode começar. Retomar entra por `applying`. */
export const APPLY_FROM: ArchitectStatus[] = ['ready']
/** Retomar só faz sentido no que ficou pelo caminho. */
export const RESUME_FROM: ArchitectStatus[] = ['applying', 'failed']

/** Estados em que a conversa ainda muda a proposta. Depois de aplicado, não muda mais. */
export const EDITABLE: ArchitectStatus[] = ['discovery', 'draft', 'ready', 'failed']

export const isEditable = (status: ArchitectStatus): boolean => EDITABLE.includes(status)
