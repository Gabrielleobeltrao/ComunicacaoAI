// O que a rotina de monitoramento JÁ VIU, e quem está olhando a fonte agora.
//
// Sem isto, uma rotina que verifica um feed a cada 15 minutos reprocessaria os
// mesmos itens para sempre — gastando tokens e reentregando a mesma coisa. O
// checkpoint é o que faz a diferença entre "verificar" e "verificar o que mudou".
//
// Três regras que valem para tudo aqui:
//
//   1. o checkpoint só avança DEPOIS que a execução terminou bem. Se a LLM falhar,
//      se a entrega falhar, se o processo cair no meio — o próximo ciclo reprocessa
//      o mesmo conteúdo. É melhor entregar duas vezes que perder uma;
//   2. ele mora no banco, por automação e por etapa. Reinício, redeploy e troca de
//      instância não reapresentam o que já passou;
//   3. ele pertence a uma FONTE, não a uma rotina. Trocar a URL é começar a
//      monitorar outra coisa, e o que foi visto na anterior não vale mais.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { contentHashOf } from './sourceChange.js'

export interface SourceCheckpoint {
  _id: ObjectId
  ownerId: string
  automationId: ObjectId
  stepId: string
  // Qual fonte este checkpoint descreve. Muda quando a URL ou o tipo mudam, e é o
  // que dispara o recomeço.
  sourceFingerprint: string
  /**
   * A fonte já teve uma primeira leitura completa e bem-sucedida.
   *
   * Campo próprio, e não `seenKeys.length === 0`: um feed legitimamente vazio tem
   * zero chaves e ESTÁ inicializado — sem esta distinção ele reaplicaria a janela
   * inicial para sempre, e o primeiro item a aparecer poderia cair fora dela.
   */
  initialized: boolean
  // RSS: as chaves dos itens já conhecidos. HTTP: vazio.
  seenKeys: string[]
  // HTTP: o hash do conteúdo útil da última leitura. RSS: null.
  contentHash: string | null
  // Quando a fonte foi consultada pela última vez — mude ou não.
  lastCheckedAt: Date | null
  // Quando ela mudou pela última vez, que é outra coisa: uma rotina saudável pode
  // passar dias sendo verificada sem nada novo.
  lastChangedAt: Date | null
  updatedAt: Date
}

// Quem está processando esta fonte agora. Documento separado do checkpoint porque
// tem outro ciclo de vida: nasce e morre dentro de uma execução.
export interface SourceLease {
  _id: ObjectId
  ownerId: string
  automationId: ObjectId
  stepId: string
  sourceFingerprint: string
  holder: string
  expiresAt: Date
}

const checkpoints = db.collection<SourceCheckpoint>('source_checkpoints')
const leases = db.collection<SourceLease>('source_leases')

// Quantas chaves guardar por fonte. Um feed devolve dezenas de itens por vez; a
// janela precisa cobrir várias voltas para um item que reaparece no meio da lista
// não ser tratado como novo, e precisa ter fim para o documento não crescer sem
// limite.
export const MAX_SEEN_KEYS = 500

/**
 * Por quanto tempo um lease vale.
 *
 * É o teto de quanto uma verificação pode demorar antes de ser considerada morta.
 * Curto demais, duas execuções processam o mesmo conteúdo; longo demais, um crash
 * trava a fonte até expirar. Quinze minutos cobrem com folga uma busca (30s) mais
 * uma inferência e uma entrega.
 */
export const LEASE_MS = 15 * 60_000

export async function ensureSourceCheckpointIndexes(): Promise<void> {
  await checkpoints.createIndex({ ownerId: 1, automationId: 1, stepId: 1 }, { unique: true })
  // A unicidade é o que torna a tomada do lease atômica: quem perde a corrida
  // recebe erro de chave duplicada em vez de um segundo lease.
  await leases.createIndex({ ownerId: 1, automationId: 1, stepId: 1, sourceFingerprint: 1 }, { unique: true })
  // Faxina do que ficou para trás. A expiração que decide de verdade é checada na
  // tomada — ela não espera este índice rodar.
  await leases.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 3600 })
}

// Reexportado por conveniência de quem já usa o checkpoint; a definição vive no
// módulo da decisão.
export { contentHashOf }

export async function getCheckpoint(ownerId: string, automationId: ObjectId, stepId: string): Promise<SourceCheckpoint | null> {
  return checkpoints.findOne({ ownerId, automationId, stepId })
}

export interface SourceStateRead {
  seenKeys: string[]
  contentHash: string | null
  initialized: boolean
}

/**
 * Abre uma verificação: registra que a fonte foi consultada e devolve o que ela já
 * viu — recomeçando do zero se a fonte não for mais a mesma.
 *
 * Marcar a consulta acontece TODA volta, inclusive quando nada muda: é isso que faz
 * a lista de rotinas dizer "verificado há 3 min, sem novidade" em vez de parecer
 * parada.
 *
 * O recomeço por troca de fonte é uma escrita condicionada ao fingerprint antigo,
 * então duas execuções que descubram a troca ao mesmo tempo não zeram o checkpoint
 * duas vezes — e uma execução da fonte ANTERIOR que ainda esteja em andamento não
 * consegue gravar nele depois (ver `advanceCheckpoint`).
 */
export async function beginCheck(
  ownerId: string,
  automationId: ObjectId,
  stepId: string,
  sourceFingerprint: string,
  quando: Date,
): Promise<SourceStateRead> {
  const chave = { ownerId, automationId, stepId }

  await checkpoints.updateOne(
    chave,
    {
      $set: { lastCheckedAt: quando, updatedAt: quando },
      $setOnInsert: { sourceFingerprint, initialized: false, seenKeys: [], contentHash: null, lastChangedAt: null },
    },
    { upsert: true },
  )

  // Fonte trocada: o que foi visto na anterior não diz nada sobre esta.
  await checkpoints.updateOne(
    { ...chave, sourceFingerprint: { $ne: sourceFingerprint } },
    { $set: { sourceFingerprint, initialized: false, seenKeys: [], contentHash: null, lastChangedAt: null, updatedAt: quando } },
  )

  const cp = await checkpoints.findOne(chave)
  return { seenKeys: cp?.seenKeys ?? [], contentHash: cp?.contentHash ?? null, initialized: cp?.initialized === true }
}

/**
 * Avança o checkpoint.
 *
 * As chaves novas entram no fim e a lista é cortada pelo começo: o que sai é o mais
 * antigo, que é justamente o que tem menos chance de reaparecer no feed. É uma
 * operação só, sem ler antes de escrever, então duas verificações simultâneas não
 * perdem as chaves uma da outra.
 *
 * O `sourceFingerprint` no FILTRO é o que protege contra uma execução antiga: se a
 * fonte foi trocada enquanto ela rodava, o filtro não casa, nada é gravado, e o
 * conteúdo da fonte velha não contamina a nova.
 */
export async function advanceCheckpoint(
  ownerId: string,
  automationId: ObjectId,
  stepId: string,
  sourceFingerprint: string,
  avanco: { novasChaves?: string[]; contentHash?: string | null; baseline?: boolean },
  quando: Date,
): Promise<void> {
  await checkpoints.updateOne(
    { ownerId, automationId, stepId, sourceFingerprint },
    {
      $set: {
        ...(avanco.contentHash !== undefined ? { contentHash: avanco.contentHash } : {}),
        // A partir daqui a fonte tem linha de base: a janela inicial não vale mais.
        initialized: true,
        // `baseline` é o avanço que só registra o que EXISTIA na estreia, sem nada
        // ter sido entregue. Ele não pode mexer em `lastChangedAt`, senão a lista
        // diria "última novidade agora" para uma rotina que não achou nada.
        ...(avanco.baseline ? {} : { lastChangedAt: quando }),
        lastCheckedAt: quando,
        updatedAt: quando,
      },
      // `$each: []` cobre a fonte HTTP, que não empurra chave nenhuma.
      $push: { seenKeys: { $each: avanco.novasChaves ?? [], $slice: -MAX_SEEN_KEYS } },
    },
  )
}

const ehChaveDuplicada = (erro: unknown): boolean => (erro as { code?: number })?.code === 11000

/**
 * Toma a fonte para si, ou desiste.
 *
 * O problema: o agendador dispara às 10h00 e o dono clica em "Verificar agora" no
 * mesmo segundo. As duas execuções leem o mesmo checkpoint, veem o mesmo item novo
 * e chamam a LLM — dois custos e duas entregas do mesmo conteúdo. O `$push` atômico
 * do checkpoint não resolve isso: ele protege a escrita, não o processamento.
 *
 * A tomada é uma escrita só. O filtro exige um lease vencido; se houver um vivo,
 * ele não casa, o upsert tenta inserir e o índice único recusa. Perder a corrida é
 * um erro de chave duplicada — não uma leitura que pode envelhecer entre o "tem
 * alguém aqui?" e o "então sou eu".
 *
 * A expiração é o que devolve a fonte depois de um crash: um processo que morre no
 * meio não libera nada, e sem prazo a rotina ficaria travada para sempre.
 */
export async function acquireSourceLease(
  ownerId: string,
  automationId: ObjectId,
  stepId: string,
  sourceFingerprint: string,
  holder: string,
  quando: Date,
): Promise<boolean> {
  try {
    await leases.updateOne(
      { ownerId, automationId, stepId, sourceFingerprint, expiresAt: { $lte: quando } },
      { $set: { holder, expiresAt: new Date(quando.getTime() + LEASE_MS) } },
      { upsert: true },
    )
    return true
  } catch (erro) {
    if (ehChaveDuplicada(erro)) return false
    throw erro
  }
}

// Devolve a fonte. Chamado no sucesso, na falha e no cancelamento — se ficasse só
// no sucesso, uma falha travaria a rotina até o lease expirar. O `holder` no filtro
// impede que uma execução libere o lease de outra.
export async function releaseSourceLease(
  ownerId: string,
  automationId: ObjectId,
  stepId: string,
  sourceFingerprint: string,
  holder: string,
): Promise<void> {
  await leases.deleteOne({ ownerId, automationId, stepId, sourceFingerprint, holder })
}

/**
 * Dá identidade aos checkpoints gravados antes de a fonte ter fingerprint.
 *
 * Sem isto, o primeiro `beginCheck` veria "fingerprint diferente" (ausente ≠ o
 * atual), zeraria o checkpoint e reentregaria o que já tinha sido entregue. A
 * migração não apaga nada: ela só carimba a identidade da fonte que a rotina já
 * está monitorando e declara o que é evidente — quem tem checkpoint já foi
 * inicializado.
 *
 * Roda uma vez: o filtro exige o campo ausente, então na segunda vez não casa nada.
 */
export async function backfillSourceFingerprints(
  identificar: (ownerId: string, automationId: ObjectId, stepId: string) => Promise<string | null>,
): Promise<number> {
  const pendentes = await checkpoints.find({ sourceFingerprint: { $exists: false } }).toArray()
  let carimbados = 0
  for (const cp of pendentes) {
    const fingerprint = await identificar(cp.ownerId, cp.automationId, cp.stepId)
    // Sem conseguir identificar a fonte, é melhor deixar como está: o recomeço
    // custa uma reentrega, um fingerprint errado custa silêncio.
    if (!fingerprint) continue
    await checkpoints.updateOne({ _id: cp._id }, { $set: { sourceFingerprint: fingerprint, initialized: true } })
    carimbados++
  }
  return carimbados
}
