import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { ingestFact } from './engine.js'
import { listarRegistros, onRecordWritten } from './store.js'
import type { DataHistoryRecord, DataRecorderDefinition } from './types.js'

// O INDICADOR DERIVADO — a conta que acontece quando o dado chega, e não quando alguém pergunta.
//
// "Me avise quando o RSI ficar abaixo de 30" tem um buraco no meio que é fácil não ver: a
// fonte entrega FECHAMENTOS, e o monitor compara RSI. Alguém precisa fazer a conta, e as três
// respostas erradas para "quem" são conhecidas:
//
//   O MODELO. Ele devolve um número plausível, com a confiança de sempre, e erra em silêncio.
//   Duas perguntas iguais dão médias diferentes, e aí não dá para concluir nada da diferença.
//
//   A FONTE. Pedir `rsi` pronto à API transfere a conta para fora e faz o teste medir o
//   provedor. Também amarra a vigilância a quem publica o indicador — e a maioria não publica.
//
//   UMA SEGUNDA ENGINE. Um laço próprio lendo a série de tempos em tempos chegaria atrasado,
//   leria o mesmo registro várias vezes e teria a própria noção de "já processei".
//
// Aqui a conta entra pelo caminho que já existe: o histórico avisa quem escuta no instante da
// GRAVAÇÃO, e a série calculada é gravada como qualquer outra série — pelo mesmo motor, com a
// mesma dedupe, e observável pelos mesmos monitores. O que este arquivo acrescenta é o meio.

const recorders = db.collection<DataRecorderDefinition>('data_recorders')

/**
 * Quantos elos de derivação são percorridos.
 *
 * Uma série calculada pode alimentar outra — média do RSI, por exemplo. O que não pode é um
 * ciclo: A alimenta B que alimenta A gravaria para sempre, e o teto é o que garante que isso
 * pare mesmo que alguém configure a volta.
 */
const PROFUNDIDADE_MAXIMA = 3

export type DerivedOutcome =
  | { kind: 'gravado'; recorderId: string; value: Record<string, unknown> }
  | { kind: 'insuficiente'; recorderId: string; faltam: number }
  | { kind: 'falhou'; recorderId: string; message: string }

/**
 * A referência que este recorder derivado usa para receber o resultado.
 *
 * Ela é montada da ORIGEM e do campo de saída, e não do id do próprio recorder: assim ela é
 * conhecida antes de ele existir, e criar o recorder não vira um passo em dois tempos.
 */
export const refDerivada = (origemId: ObjectId | string, campo: string): string => `derived:${origemId.toString()}:${campo}`

/**
 * A série de entrada, do mais ANTIGO para o mais recente.
 *
 * A ordem não é detalhe: o RSI de Wilder é sequencial, e a série invertida produz um número
 * plausível e errado. Ela é lida do banco em ordem decrescente (que é o índice que existe) e
 * invertida aqui, uma vez.
 */
async function serieDeEntrada(
  ownerId: string,
  origem: ObjectId,
  entityKey: string | null,
  campo: string,
  quantos: number,
): Promise<number[]> {
  const registros = await listarRegistros(ownerId, {
    recorderId: origem,
    ...(entityKey !== null ? { entityKey } : {}),
    limit: quantos,
    order: 'desc',
  })
  return registros
    .map((r) => Number((r.value as Record<string, unknown>)[campo]))
    .reverse()
}

/**
 * Calcula o que depende deste registro e grava o resultado.
 *
 * Exportado, e não só registrado como ouvinte, porque quem quer PROVAR a cadeia precisa de um
 * ponto determinístico: o ouvinte é disparado sem espera (o histórico não pode ficar preso a
 * quem escuta), e um teste que dependesse dele estaria medindo o relógio.
 */
export async function calcularDerivados(record: DataHistoryRecord, profundidade = 0): Promise<DerivedOutcome[]> {
  if (profundidade >= PROFUNDIDADE_MAXIMA) return []

  const alvos = await recorders
    .find({ ownerId: record.ownerId, enabled: true, 'derivedFrom.recorderId': record.recorderId })
    .toArray()

  const saidas: DerivedOutcome[] = []
  for (const alvo of alvos) {
    const d = alvo.derivedFrom
    // Uma série que deriva de si mesma se realimenta a cada gravação.
    if (!d || alvo._id.equals(record.recorderId)) continue

    const serie = await serieDeEntrada(record.ownerId, d.recorderId, record.entityKey, d.inputField, d.lookback)

    /**
     * DADO INSUFICIENTE é estado degradado, nunca estimativa.
     *
     * O RSI de 14 períodos precisa de 15 fechamentos. Calcular sobre 8 dá um número errado com
     * cara de certo, e ninguém percebe — é o pior resultado possível. A falta fica gravada na
     * própria definição, que é onde quem configurou vai olhar, e nada é gravado na série.
     */
    if (serie.length < d.lookback || serie.some((v) => !Number.isFinite(v))) {
      const faltam = Math.max(0, d.lookback - serie.length)
      await recorders.updateOne(
        { _id: alvo._id },
        {
          $set: {
            lastError: {
              message: faltam
                ? `faltam ${faltam} leituras de "${d.inputField}" para calcular ${d.functionName}`
                : `a série de "${d.inputField}" tem valor que não é número`,
              at: record.recordedAt,
            },
            updatedAt: record.recordedAt,
          },
        },
      )
      saidas.push({ kind: 'insuficiente', recorderId: alvo._id.toString(), faltam })
      continue
    }

    /**
     * A EXECUÇÃO passa pelo executor canônico, com a versão fixada.
     *
     * Chamar `calculateRsi` direto pularia a validação de entrada e de saída, o teto de tempo
     * e o registro — e faria esta série ser calculada por um caminho que nenhuma outra parte
     * do produto usa. A versão vem da configuração: uma função atualizada não muda o
     * comportamento de uma vigilância sem alguém decidir isso.
     */
    const { executeRegisteredFunction } = await import('../executors/functionExecutor.js')
    const r = await executeRegisteredFunction(
      { kind: 'function', functionName: d.functionName, version: d.version },
      { [d.inputArg]: serie, ...d.params },
    )

    const chaveDaConta = `indicador:${alvo._id.toString()}:${record.dedupeKey}`
    const { manualExecutionKey, openRunningRoot, finishExecutionRoot } = await import('../executionRoots.js')
    const executionKey = manualExecutionKey(chaveDaConta)
    /**
     * A conta aparece na Activity — a que deu certo e, principalmente, a que falhou.
     *
     * Uma função que para de calcular deixa o monitor observando uma série que parou de
     * crescer: ele não dispara, e "não disparou" é indistinguível de "não aconteceu". A raiz é
     * idempotente pela chave, então recalcular o mesmo registro não abre uma segunda linha.
     */
    await openRunningRoot({ executionKey, ownerId: record.ownerId, source: 'manual' })

    if (!r.ok) {
      await finishExecutionRoot(executionKey, { status: 'failed', errorKind: r.error?.kind ?? 'tool', finishedAt: record.recordedAt })
      await recorders.updateOne(
        { _id: alvo._id },
        { $set: { lastError: { message: String(r.error?.message ?? 'a função falhou').slice(0, 300), at: record.recordedAt }, updatedAt: record.recordedAt } },
      )
      saidas.push({ kind: 'falhou', recorderId: alvo._id.toString(), message: r.error?.message ?? 'a função falhou' })
      continue
    }

    /**
     * O resultado, com PROVENIÊNCIA.
     *
     * A saída inteira da função é gravada — no caso do RSI, o número, o período, quantos
     * pontos entraram e o método —, mais o nome e a versão de quem calculou. Sem isso, uma
     * linha da série é um número solto: não dá para reproduzir a conta nem saber se ela mudou
     * de definição no meio do caminho.
     */
    const saida = (r.structured?.data ?? {}) as Record<string, unknown>
    const valor = { ...saida, calculatedBy: `${d.functionName}@${d.version}` }
    await ingestFact({
      ownerId: record.ownerId,
      sourceKey: `manual:${alvo.source.ref}`,
      entityKey: record.entityKey,
      // O instante do FATO é o do dado que originou a conta, e não o de quando ela rodou.
      occurredAt: record.occurredAt,
      value: valor,
      // A identidade do registro de origem: recalcular não grava duas vezes.
      factId: record.dedupeKey,
    })
    await finishExecutionRoot(executionKey, { status: 'succeeded', finishedAt: record.recordedAt })
    await recorders.updateOne({ _id: alvo._id }, { $set: { lastError: null, updatedAt: record.recordedAt } })
    saidas.push({ kind: 'gravado', recorderId: alvo._id.toString(), value: valor })
  }
  return saidas
}

/** Liga a ponte. Chamado uma vez, no arranque do motor — como o resto dos handlers. */
export function registerDerivedIndicators(onError: (where: string, e: unknown) => void = () => undefined): void {
  onRecordWritten(async (record) => {
    try {
      await calcularDerivados(record)
    } catch (erro) {
      onError(`indicador derivado do registro ${record.dedupeKey}`, erro)
    }
  })
}
