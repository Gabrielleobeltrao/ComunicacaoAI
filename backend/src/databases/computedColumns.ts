// A COLUNA CALCULADA — a conta que o conjunto passa a guardar.
//
// O dono olhou a lista de funções do agente e perguntou: "não são essas funções? quero o
// mesmo no database". Ele tinha razão em achar estranho: as trinta e poucas funções do
// registro só existiam para o agente e para o Flow. Um conjunto com preço mínimo e máximo a
// cada dez minutos não tinha como ganhar uma terceira coluna com a variação — a conta que
// ele queria estava pronta e não alcançava o dado.
//
// NADA DE MOTOR NOVO. `derivedFrom` já faz isto: no instante da gravação, lê os últimos N
// pontos de um campo, chama a função pelo executor canônico (com a versão fixada), grava o
// resultado com proveniência e registra na Activity — inclusive a falha. Aqui só se
// acrescenta o que faltava:
//
//   1. Um jeito de CRIAR uma sem passar pelo Assistente.
//   2. A junção que faz a série derivada aparecer como COLUNA da tabela de origem.
//   3. O preenchimento do que já existe: sem ele a coluna nasceria vazia em cima de um
//      histórico cheio, e vazio é indistinguível de quebrado.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { getDataStore, getDataset } from './store.js'
import { AdapterError, recorderDoConjunto } from './adapters.js'
import { criarRecorder } from '../dataHistory/recorders.js'
import { ValidationError } from '../building.js'
import { refDerivada, calcularDerivados } from '../dataHistory/derived.js'
import { listarRegistros } from '../dataHistory/store.js'
import { findFunction } from '../executors/functionRegistry.js'
import type { ComputedColumnBinding, DataSetDefinition } from './types.js'
import type { DataHistoryRecord } from '../dataHistory/types.js'

const datasets = db.collection<DataSetDefinition>('dataset_definitions')
const recorders = db.collection('data_recorders')

/** Quantas linhas antigas são recalculadas ao criar a coluna. */
const BACKFILL_MAX = 500

/** O que a tabela mostra: o nome da coluna, e de onde o valor dela vem. */
export type ComputedColumn = ComputedColumnBinding

export interface NovaColunaInput {
  name: string
  functionName: string
  version?: string
  /** O campo do conjunto que a função lê. */
  inputField: string
  /** O argumento da função que recebe a série. */
  inputArg: string
  lookback: number
  outputField: string
  params?: Record<string, unknown>
}

const NOME_DE_COLUNA = /^[a-z][a-z0-9_]{0,39}$/

/** Os campos que o conjunto declara — é contra eles que a entrada da função é conferida. */
export const camposDoConjunto = (dataset: DataSetDefinition): string[] =>
  Object.keys(((dataset.schema as { properties?: Record<string, unknown> })?.properties ?? {}) as Record<string, unknown>)

export async function criarColunaCalculada(ownerId: string, dataStoreId: ObjectId, datasetKey: string, entrada: NovaColunaInput): Promise<ComputedColumn> {
  const store = await getDataStore(ownerId, dataStoreId)
  if (!store) throw new AdapterError('database não encontrado', 'not_found')
  if (store.adapterKind !== 'data_history') throw new AdapterError('só um conjunto de histórico ganha coluna calculada', 'read_only')
  const dataset = await getDataset(ownerId, dataStoreId, datasetKey)
  if (!dataset) throw new AdapterError('conjunto não encontrado', 'not_found')

  const name = String(entrada.name ?? '').trim().toLowerCase()
  if (!NOME_DE_COLUNA.test(name)) {
    throw new ValidationError('nome da coluna: comece com letra e use só letras minúsculas, números e "_".')
  }

  /**
   * O NOME NÃO PODE COLIDIR — nem com um campo do conjunto, nem com outra coluna.
   *
   * Colidir com um campo real faria a coluna calculada SOBRESCREVER o dado gravado na hora de
   * montar a linha. O valor da fonte sumiria da tela sem nada avisar, e ninguém iria procurar
   * a causa numa coluna que "só acrescenta".
   */
  if (camposDoConjunto(dataset).includes(name)) throw new ValidationError(`"${name}" já é um campo deste conjunto — escolha outro nome.`)
  const existentes = dataset.computedColumns ?? []
  if (existentes.some((c) => c.name === name)) throw new ValidationError(`já existe uma coluna calculada chamada "${name}".`)

  /**
   * A FUNÇÃO TEM DE ESTAR REGISTRADA, e o campo lido tem de existir.
   *
   * As duas recusas são o mesmo princípio: o que executa é código deste servidor, e o que ele
   * lê é campo declarado. Uma função inventada não roda; um campo inventado roda e devolve
   * `NaN` a cada linha, para sempre, sem erro nenhum.
   */
  const fn = findFunction(entrada.functionName)
  if (!fn) throw new ValidationError(`a função "${entrada.functionName}" não está registrada nesta instalação.`)
  const campos = camposDoConjunto(dataset)
  if (campos.length && !campos.includes(entrada.inputField)) {
    throw new ValidationError(`"${entrada.inputField}" não é um campo deste conjunto — os campos são: ${campos.join(', ')}.`)
  }
  /**
   * O ARGUMENTO E A SAÍDA são conferidos contra os SCHEMAS da função — não contra o que a
   * tela mandou.
   *
   * A tela deriva os dois lendo os schemas, e está certa em derivar. Mas quem decide continua
   * sendo o servidor: um argumento que a função não tem faz a série chegar em lugar nenhum e
   * a conta rodar sobre `undefined`; um campo de saída que ela não produz deixa a coluna
   * vazia para sempre — as duas falhas caladas, e as duas conferíveis aqui.
   */
  const propsDaEntrada = Object.keys(((fn.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {}) as Record<string, unknown>)
  if (propsDaEntrada.length && !propsDaEntrada.includes(entrada.inputArg)) {
    throw new ValidationError(`"${entrada.inputArg}" não é um argumento de ${entrada.functionName} — os argumentos são: ${propsDaEntrada.join(', ')}.`)
  }
  const outputField = String(entrada.outputField ?? '').trim()
  if (!outputField) throw new ValidationError('escolha qual número da saída da função vira o valor da coluna.')
  const propsDaSaida = Object.keys(((fn.outputSchema as { properties?: Record<string, unknown> })?.properties ?? {}) as Record<string, unknown>)
  if (propsDaSaida.length && !propsDaSaida.includes(outputField)) {
    throw new ValidationError(`${entrada.functionName} não devolve "${outputField}" — devolve: ${propsDaSaida.join(', ')}.`)
  }

  const origem = recorderDoConjunto(store, dataset)
  const version = String(entrada.version ?? fn.version)

  const derivado = await criarRecorder(ownerId, {
    name: `${dataset.name} · ${name}`,
    source: { kind: 'manual', ref: refDerivada(origem, name) },
    // Uma linha calculada por linha de origem: é o que faz as duas séries ficarem alinhadas,
    // e é esse alinhamento que permite mostrar uma como coluna da outra.
    mode: 'every_event',
    derivedFrom: { recorderId: origem, functionName: entrada.functionName, version, inputField: entrada.inputField, inputArg: entrada.inputArg, lookback: entrada.lookback, params: entrada.params ?? {} },
  })

  const coluna: ComputedColumn = { name, recorderId: derivado._id, outputField, functionName: entrada.functionName, version }
  await datasets.updateOne({ _id: dataset._id, ownerId }, { $set: { computedColumns: [...existentes, coluna], updatedAt: new Date() } })

  await preencherHistorico(ownerId, origem)
  return coluna
}

/**
 * O HISTÓRICO QUE JÁ EXISTE também recebe a conta.
 *
 * O motor calcula na gravação, e só na gravação. Sem este passo, criar a coluna sobre um
 * conjunto com quarenta e sete linhas produzia quarenta e sete células vazias e uma promessa
 * de que a próxima linha viria preenchida — daqui a dez minutos. Vazio, na tela, não se
 * distingue de quebrado.
 *
 * Reproduzir é seguro: `calcularDerivados` grava pelo `factId` do registro de origem, então
 * passar o mesmo registro duas vezes não cria a segunda linha.
 */
async function preencherHistorico(ownerId: string, origem: ObjectId): Promise<number> {
  const antigos = await listarRegistros(ownerId, { recorderId: origem, limit: BACKFILL_MAX, order: 'desc' })
  // Do mais ANTIGO para o mais novo: a janela de `lookback` de cada ponto olha para trás, e
  // ao contrário os primeiros recalculados seriam justamente os que têm passado suficiente.
  let feitos = 0
  for (const registro of [...antigos].reverse()) {
    const saidas = await calcularDerivados(registro as DataHistoryRecord)
    if (saidas.some((s) => s.kind === 'gravado')) feitos += 1
  }
  return feitos
}

export async function removerColunaCalculada(ownerId: string, dataStoreId: ObjectId, datasetKey: string, name: string): Promise<boolean> {
  const dataset = await getDataset(ownerId, dataStoreId, datasetKey)
  if (!dataset) throw new AdapterError('conjunto não encontrado', 'not_found')
  const coluna = (dataset.computedColumns ?? []).find((c) => c.name === name)
  if (!coluna) return false
  await datasets.updateOne(
    { _id: dataset._id, ownerId },
    { $set: { computedColumns: (dataset.computedColumns ?? []).filter((c) => c.name !== name), updatedAt: new Date() } },
  )
  /**
   * A SÉRIE CALCULADA para de crescer, e o que ela já gravou FICA.
   *
   * Apagar os registros junto seria destruir dado por causa de uma mudança de tela. Quem
   * tirou a coluna quis parar de ver a conta, não perder o que ela já apurou.
   */
  await recorders.updateOne({ _id: coluna.recorderId, ownerId }, { $set: { enabled: false, updatedAt: new Date() } })
  return true
}
