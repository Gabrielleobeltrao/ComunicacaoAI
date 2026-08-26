// A MARCA DE ORIGEM que o Arquiteto deixa no que ele cria.
//
// Mora fora de `architect/` de propósito: quem escreve a marca são os módulos de
// domínio (andar, agente, setor, rotina), e um tipo importado de dentro do Arquiteto
// faria o domínio depender dele. Aqui não há import nenhum, então não há ciclo.
//
// Ela existe por uma razão só, e é a mais difícil de cobrir de outro jeito: entre
// criar o recurso e registrar o passo há uma janela. Uma queda ali deixa o recurso de
// pé e a operação sem saber disso — e a retomada criaria o segundo. Com a marca, a
// retomada PROCURA antes de criar, e encontra.
export interface ArchitectStamp {
  /** O projeto que originou o recurso. */
  projectId: string
  /** A aplicação específica. É por ela que o desfazer sabe o que é dele. */
  operationId: string
  /** A `key` do item no blueprint. Estável entre aplicações do mesmo projeto. */
  blueprintKey: string
}
