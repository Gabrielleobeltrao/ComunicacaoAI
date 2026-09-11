// A BASE como a coisa principal, e a pasta como organização.
//
// "E por que temos pasta e conjunto?" Na conta do dono era 1:1 — duas pastas, uma tabela em
// cada, e o nome da pasta era a descrição da tabela lá dentro. A segunda camada tem motivo
// real (permissão e agrupamento), mas ela só se paga quando a pasta tem várias tabelas, e nem
// a tela nem o Assistente produziam esse caso.
//
// NADA MUDA DE LUGAR NO BANCO. A pasta continua sendo o `data_store` e a base o
// `dataset_definition` — o que muda é quem é a coisa principal na tela, e uma marca: a pasta
// só aparece COMO pasta quando alguém decidiu criá-la. As que o sistema inventou por dentro
// somem, e as bases delas aparecem soltas. É assim que a conta achata sem nenhum registro se
// mover, e sem nada ficar impossível de desfazer.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { DataStoreError, createDataset, createDataStore, getDataStore, listDataStores } from './store.js'
import { ensureDefaultStore } from './migration.js'
import type { DataSetDefinition, DataStore, DataStoreAdapterKind } from './types.js'

const stores = db.collection<DataStore>('data_stores')
const datasets = db.collection<DataSetDefinition>('dataset_definitions')

/** Uma pasta só é pasta quando alguém decidiu que era. Ver `DataStore.explicit`. */
export const ehPasta = (store: Pick<DataStore, 'explicit'>): boolean => store.explicit === true

export interface BaseResumo {
  id: string
  key: string
  name: string
  adapterKind: DataStoreAdapterKind
  mutability: DataSetDefinition['mutability']
  fields: string[]
  /** A pasta, quando ela é uma pasta de verdade. `null` é base solta. */
  folder: { id: string; name: string } | null
  /** Onde ela mora de fato — a rota antiga continua sendo por aqui. */
  dataStoreId: string
  createdAt: Date
}

export async function listarBases(ownerId: string): Promise<BaseResumo[]> {
  const [pastas, todas] = await Promise.all([listDataStores(ownerId), datasets.find({ ownerId }).sort({ createdAt: 1 }).toArray()])
  const porId = new Map(pastas.map((p) => [p._id.toString(), p]))
  return todas.map((d) => {
    const pasta = porId.get(d.dataStoreId.toString())
    return {
      id: d._id.toString(),
      key: d.key,
      name: d.name,
      adapterKind: d.adapterKind ?? pasta?.adapterKind ?? 'data_history',
      mutability: d.mutability,
      fields: Object.keys(((d.schema as { properties?: Record<string, unknown> })?.properties ?? {}) as Record<string, unknown>),
      folder: pasta && ehPasta(pasta) ? { id: pasta._id.toString(), name: pasta.name } : null,
      dataStoreId: d.dataStoreId.toString(),
      createdAt: d.createdAt,
    }
  })
}

/** Só letras minúsculas, números e `_`: é a chave que a consulta usa. */
const chaveDe = (nome: string): string =>
  String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)

export interface NovaBaseInput {
  name: string
  /** `nome:tipo` por campo. É o que a tela coleta, e o que vira o schema. */
  fields: { name: string; type: 'string' | 'number' | 'boolean' }[]
  /** A pasta, quando a pessoa escolheu uma. Sem ela a base nasce solta. */
  folderId?: string | null
}

/**
 * A base em UM passo.
 *
 * Antes eram dois: criar a pasta e, dentro dela, criar o conjunto. Quem criava a pasta e
 * parava ali ficava com uma caixa vazia e nada dizendo qual era o próximo passo — e a
 * procedência, que mora na base, não tinha onde aparecer.
 *
 * Só histórico interno. Mercado e App externo leem a configuração da PASTA (qual símbolo,
 * qual App, qual ação), então para eles a pasta ainda é onde a decisão mora — e criar a base
 * solta seria criar uma que não sabe de onde ler.
 */
export async function criarBase(ownerId: string, input: NovaBaseInput): Promise<BaseResumo> {
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 120) throw new DataStoreError('o nome precisa ter de 1 a 120 caracteres')

  const campos = (input.fields ?? []).filter((c) => c?.name?.trim())
  if (campos.length === 0) throw new DataStoreError('declare ao menos um campo: sem campos, esta base não pode ser consultada', 'no_schema')

  const properties: Record<string, { type: string }> = {}
  for (const c of campos) properties[chaveDe(c.name)] = { type: ['string', 'number', 'boolean'].includes(c.type) ? c.type : 'string' }

  const pasta = input.folderId ? await getDataStore(ownerId, new ObjectId(input.folderId)) : await ensureDefaultStore(ownerId)
  if (!pasta) throw new DataStoreError('pasta não encontrada', 'not_found')

  const key = chaveDe(name) || `base_${Date.now()}`
  const d = await createDataset(ownerId, pasta._id, {
    key,
    name,
    schema: { type: 'object', properties },
    adapterKind: 'data_history',
  })
  return {
    id: d._id.toString(),
    key: d.key,
    name: d.name,
    adapterKind: 'data_history',
    mutability: d.mutability,
    fields: Object.keys(properties),
    folder: ehPasta(pasta) ? { id: pasta._id.toString(), name: pasta.name } : null,
    dataStoreId: pasta._id.toString(),
    createdAt: d.createdAt,
  }
}

/** Uma pasta de verdade: feita de propósito, e é por isso que ela aparece. */
export async function criarPasta(ownerId: string, name: string): Promise<{ id: string; name: string }> {
  const store = await createDataStore(ownerId, { name, adapterKind: 'data_history' })
  await stores.updateOne({ _id: store._id, ownerId }, { $set: { explicit: true, updatedAt: new Date() } })
  return { id: store._id.toString(), name: store.name }
}

/**
 * Mover uma base de pasta — e NENHUM registro se move junto.
 *
 * As linhas ficam penduradas na série, não na pasta, então mover é trocar um campo. O que
 * muda de verdade é PERMISSÃO: um grant vive na pasta, e uma base que sai dela deixa de ser
 * alcançada por ele. Quem move precisa saber disso, e por isso a resposta diz.
 */
export async function moverBase(ownerId: string, baseId: ObjectId, folderId: string | null): Promise<{ folder: { id: string; name: string } | null; perdeuGrants: number }> {
  const base = await datasets.findOne({ _id: baseId, ownerId })
  if (!base) throw new DataStoreError('base não encontrada', 'not_found')

  const destino = folderId ? await getDataStore(ownerId, new ObjectId(folderId)) : await ensureDefaultStore(ownerId)
  if (!destino) throw new DataStoreError('pasta não encontrada', 'not_found')
  if (destino._id.equals(base.dataStoreId)) return { folder: ehPasta(destino) ? { id: destino._id.toString(), name: destino.name } : null, perdeuGrants: 0 }

  /**
   * A CHAVE é única dentro da pasta, e duas bases com a mesma chave no mesmo lugar fariam a
   * segunda sumir atrás da primeira em toda consulta.
   */
  if (await datasets.findOne({ ownerId, dataStoreId: destino._id, key: base.key })) {
    throw new DataStoreError(`a pasta "${destino.name}" já tem uma base com a chave "${base.key}"`, 'duplicate')
  }

  const grants = await db
    .collection('data_store_grants')
    .countDocuments({ ownerId, dataStoreId: base.dataStoreId, $or: [{ datasetKeys: { $size: 0 } }, { datasetKeys: base.key }] })

  await datasets.updateOne(
    { _id: base._id, ownerId },
    {
      $set: {
        dataStoreId: destino._id,
        // O tipo desce para a base ANTES de ela sair da pasta: sem isso, uma base que herdava
        // o adaptador da pasta passaria a herdar o da pasta nova, e leria de outro lugar sem
        // ninguém ter pedido.
        adapterKind: base.adapterKind ?? (await getDataStore(ownerId, base.dataStoreId))?.adapterKind ?? 'data_history',
        updatedAt: new Date(),
      },
    },
  )
  return { folder: ehPasta(destino) ? { id: destino._id.toString(), name: destino.name } : null, perdeuGrants: grants }
}
