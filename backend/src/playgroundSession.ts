// A conversa de teste, que deixa de sumir.
//
// O Playground era deliberadamente sem memória — e a frase "nada é salvo" descrevia
// duas coisas diferentes como se fossem uma só. Uma é a MEMÓRIA DO AGENTE: ele não deve
// lembrar de uma conversa de teste ao atender um visitante de verdade, e isso continua
// exatamente igual. A outra é a TELA: trocar de aba apagava tudo, e quem estava
// ajustando um objetivo tinha de repetir as mesmas cinco perguntas a cada volta —
// pagando de novo, em tokens, por respostas que já existiam.
//
// Aqui fica só a segunda. O que se guarda é o que a tela mostra, para poder mostrar de
// novo: os turnos, com o que cada resposta custou. O agente continua recebendo apenas o
// histórico que o cliente envia, como antes.
import { ObjectId } from 'mongodb'
import { db } from './db.js'

/** O teto da própria rota do Playground: guardar mais do que se pode reenviar é lixo. */
const MAX_TURNOS = 40
/** Uma resposta muito longa é cortada para caber; o teste não é o lugar de arquivar. */
const MAX_CARACTERES = 20_000
/** Conversa de teste velha não interessa a ninguém, e o Mongo apaga sozinho. */
const DIAS = 30

export interface PlaygroundTurn {
  role: 'user' | 'assistant'
  content: string
  handoff?: boolean
  clarification?: boolean
  clarificationOptions?: string[]
  toolCalls?: unknown[]
  diagnostics?: Record<string, unknown>
  at: Date
}

export interface PlaygroundSession {
  _id: ObjectId
  ownerId: string
  /** O agente OU o setor a que esta conversa pertence. */
  scopeType: 'agent' | 'sector'
  scopeId: ObjectId
  turns: PlaygroundTurn[]
  updatedAt: Date
}

const sessions = db.collection<PlaygroundSession>('playground_sessions')

export async function ensurePlaygroundSessionIndexes(): Promise<void> {
  // Uma conversa por dono e por agente: o teste é um lugar só, não uma lista de threads.
  await sessions.createIndex({ ownerId: 1, scopeType: 1, scopeId: 1 }, { unique: true })
  await sessions.createIndex({ updatedAt: 1 }, { expireAfterSeconds: DIAS * 24 * 3600 })
}

const cortar = (turno: PlaygroundTurn): PlaygroundTurn => ({
  ...turno,
  content: turno.content.slice(0, MAX_CARACTERES),
})

/**
 * Acrescenta os turnos deste envio e devolve a conversa como ela ficou.
 *
 * Grava o que ACONTECEU, e por isso acrescenta em vez de substituir: dois envios quase
 * simultâneos na mesma tela não podem apagar um ao outro. O corte pelos últimos
 * `MAX_TURNOS` acontece na escrita, então a coleção não cresce sem limite.
 */
export async function appendPlaygroundTurns(
  ownerId: string,
  scopeType: 'agent' | 'sector',
  scopeId: ObjectId,
  novos: PlaygroundTurn[],
): Promise<void> {
  if (novos.length === 0) return
  await sessions.updateOne(
    { ownerId, scopeType, scopeId },
    {
      $push: { turns: { $each: novos.map(cortar), $slice: -MAX_TURNOS } },
      $set: { updatedAt: new Date() },
    },
    { upsert: true },
  )
}

export async function loadPlaygroundTurns(
  ownerId: string,
  scopeType: 'agent' | 'sector',
  scopeId: ObjectId,
): Promise<PlaygroundTurn[]> {
  const doc = await sessions.findOne({ ownerId, scopeType, scopeId })
  return doc?.turns ?? []
}

/** Recomeçar do zero — é o que "limpar" quer dizer, e é a única forma de apagar. */
export async function clearPlaygroundTurns(ownerId: string, scopeType: 'agent' | 'sector', scopeId: ObjectId): Promise<void> {
  await sessions.deleteOne({ ownerId, scopeType, scopeId })
}
