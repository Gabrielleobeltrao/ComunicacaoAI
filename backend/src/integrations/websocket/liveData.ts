import { db } from '../../db.js'
import { WS_LIMITS } from '../../apps/official/websocket/config.js'

/**
 * O LIVE DATA STORE: o último valor de cada chave, e nada mais.
 *
 * Existe porque um WebSocket de mercado manda três cotações por segundo e ninguém
 * quer — nem pode pagar — um agente por cotação. O que um cálculo precisa é do valor
 * de AGORA; o que um histórico precisa é de outra coisa, e essa outra coisa não é
 * "todos os tiques para sempre".
 *
 * Três decisões carregam o módulo:
 *
 * MONGO, E NÃO MEMÓRIA. O socket vive no worker e o agente pode rodar na API — em
 * instalações com `EMBEDDED_WORKER=false` são processos diferentes. Um cache em memória
 * responderia num e ficaria vazio no outro, e o sintoma seria "o agente não vê o preço",
 * intermitente e impossível de reproduzir.
 *
 * UPSERT POR CHAVE, E NÃO INSERT POR TIQUE. `AAPL` é um documento, atualizado; não uma
 * linha por cotação. A coleção fica do tamanho do número de chaves, não do tempo.
 *
 * COALESCÊNCIA NA MEMÓRIA DO PRODUTOR. Mesmo com upsert, três escritas por segundo por
 * chave é ritmo de banco que ninguém pediu. O valor mais recente fica num buffer e é
 * gravado no máximo a cada `WS_LIVE_FLUSH_MS`; leitura sempre vê o buffer primeiro, no
 * processo que produz. É por isso que quem produz nunca lê desatualizado.
 */

export interface LiveDataRecord {
  /** `ownerId:connectionId:key` — a identidade, e o que torna o upsert idempotente. */
  _id: string
  ownerId: string
  connectionId: string
  key: string
  value: unknown
  /** Quantas atualizações desde que a chave apareceu. Diz se o dado está andando. */
  updates: number
  receivedAt: Date
  expiresAt: Date
}

const live = db.collection<LiveDataRecord>('live_data')

/**
 * A ESCRITA, atrás de um ponto injetável.
 *
 * Existe para o teste poder CONTAR escritas em vez de contar documentos — contar
 * documentos não prova coalescência nenhuma: dez tiques da mesma chave produzem um
 * documento com ou sem ela.
 */
type Escritor = (id: string, registro: LiveDataRecord) => Promise<void>
let escrever: Escritor = async (id, registro) => {
  await live.updateOne({ _id: id }, { $set: registro }, { upsert: true })
}

/** Troca o escritor. Só os testes chamam; devolve o anterior para restaurar. */
/**
 * A LEITURA da hidratação, atrás de um ponto injetável.
 *
 * Mesmo motivo do escritor: sem ela não há como provar que uma falha de banco na
 * hidratação permite tentar de novo — e "permite tentar de novo" é justamente o que
 * separa um erro momentâneo de um processo que nunca mais confere limite nenhum.
 */
type Leitor = (ownerId: string, agora: Date) => Promise<{ key: string; connectionId: string; updates?: number; expiresAt: Date }[]>
let carregarChaves: Leitor = async (ownerId, agora) =>
  live
    .find({ ownerId, expiresAt: { $gt: agora } }, { projection: { key: 1, connectionId: 1, updates: 1, expiresAt: 1 } })
    .limit(WS_LIMITS.maxLiveKeysPerOwner + 1)
    .toArray()

export function setLiveHydrator(fn: Leitor | null): Leitor {
  const anterior = carregarChaves
  carregarChaves = fn ?? (async (ownerId, agora) =>
    live
      .find({ ownerId, expiresAt: { $gt: agora } }, { projection: { key: 1, connectionId: 1, updates: 1, expiresAt: 1 } })
      .limit(WS_LIMITS.maxLiveKeysPerOwner + 1)
      .toArray())
  return anterior
}

export function setLiveWriter(fn: Escritor | null): Escritor {
  const anterior = escrever
  escrever = fn ?? (async (id, registro) => {
    await live.updateOne({ _id: id }, { $set: registro }, { upsert: true })
  })
  return anterior
}

/** Quanto tempo o valor mais recente pode ficar só no buffer antes de ir ao banco. */
const FLUSH_MS = Number(process.env.WS_LIVE_FLUSH_MS ?? 1_000)

export async function ensureLiveDataIndexes(): Promise<void> {
  await live.createIndex({ ownerId: 1, connectionId: 1, key: 1 })
  await live.createIndex({ ownerId: 1, connectionId: 1, receivedAt: -1 })
  // O TTL é do Mongo, não nosso: nada aqui precisa varrer a coleção para expirar, e um
  // processo parado não deixa dado velho respondendo como se fosse de agora.
  await live.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

const idDe = (ownerId: string, connectionId: string, key: string): string => `${ownerId}:${connectionId}:${key}`

interface Pendente {
  registro: LiveDataRecord
  gravando: boolean
  /** Quando a última gravação saiu — o que decide se a próxima espera ou vai agora. */
  ultimaEm: number
  /** A ordem de chegada deste valor. Ver `sequencias`. */
  seq: number
  /** O relógio do fim da janela, quando há um armado. */
  timer: ReturnType<typeof setTimeout> | null
  /**
   * A gravação EM VOO, para quem precisa esperar por ela.
   *
   * `gravando: boolean` dizia que havia uma, e não dava como aguardá-la: o encerramento
   * via a marca, desistia, e o processo saía com a escrita pela metade.
   */
  emVoo: Promise<void> | null
}

const buffer = new Map<string, Pendente>()

/**
 * A ORDEM de chegada, por chave — tomada antes de qualquer espera.
 *
 * O relógio não serve para isto: dois tiques da mesma chave no mesmo milissegundo têm o
 * mesmo `receivedAt`, e aí "o mais novo ganha" não decide nada. Um contador tomado de
 * forma síncrona, antes do primeiro `await`, dá uma ordem estrita — e é ela que impede
 * uma cotação velha de sobrescrever a nova quando a consulta de limite demora.
 */
const sequencias = new Map<string, number>()

/**
 * Quantas atualizações a chave JÁ tinha antes deste processo vê-la.
 *
 * Sem isto, um reinício zerava o contador de atualizações — e um número que volta a
 * zero sozinho não serve para responder "este dado está andando?", que é a única
 * pergunta que ele existe para responder.
 */
const bases = new Map<string, number>()

/**
 * A maior ordem JÁ APLICADA por chave — independente de o registro ainda estar no buffer.
 *
 * Comparar com o que está no buffer não bastava: assim que a gravação sai, o registro é
 * removido, e um tique atrasado que resumia depois disso não encontrava nada, se
 * achava o primeiro e sobrescrevia o valor mais novo com um mais velho. Aqui a ordem
 * sobrevive ao ciclo de vida do buffer.
 */
const aplicados = new Map<string, number>()

function proximaSequencia(id: string): number {
  const seq = (sequencias.get(id) ?? 0) + 1
  sequencias.set(id, seq)
  // Limitado como o resto: o mapa não pode crescer com o tempo.
  if (sequencias.size > 10_000) {
    for (const k of [...sequencias.keys()].slice(0, 5_000)) {
      if (buffer.has(k)) continue
      // A base acompanha a sequência: descartar uma sem a outra faria o contador
      // recomeçar do zero na próxima mensagem daquela chave.
      bases.set(k, (bases.get(k) ?? 0) + (sequencias.get(k) ?? 0))
      sequencias.delete(k)
      aplicados.delete(k)
    }
  }
  return seq
}

/**
 * Guarda o valor de uma chave.
 *
 * Devolve `false` quando a conexão já tem chaves demais: uma mensagem com um campo
 * inesperado no lugar do símbolo criaria uma chave nova por tique, e em uma hora a
 * coleção teria mais chaves do que o mercado tem papéis.
 */
export async function putLiveValue(
  ownerId: string,
  connectionId: string,
  key: string,
  value: unknown,
  ttlSeconds: number,
  agora = new Date(),
): Promise<boolean> {
  const chave = String(key ?? '').trim().slice(0, 120)
  if (!chave) return false

  const id = idDe(ownerId, connectionId, chave)
  // A ordem é tomada AGORA, antes de qualquer espera: é o que dá uma sequência estrita
  // mesmo entre dois tiques do mesmo milissegundo.
  const seq = proximaSequencia(id)

  const expiraEm = agora.getTime() + Math.max(5, ttlSeconds) * 1000
  if (!buffer.has(id) && !(await cabeMaisUma(ownerId, connectionId, id, chave, expiraEm, agora.getTime()))) return false

  /**
   * O buffer é lido DEPOIS do await, e não antes.
   *
   * `cabeMaisUma` consulta o banco, e nesse intervalo outro tique da mesma chave pode
   * ter chegado e passado na frente. Lendo antes, os dois calculavam `updates` a partir
   * do mesmo estado e o mais LENTO gravava por último — uma cotação velha sobrescrevendo
   * a nova, que é o pior defeito possível num dado que existe para ser o valor de agora.
   */
  if ((aplicados.get(id) ?? 0) > seq) {
    // Já chegou algo mais novo enquanto esta chamada esperava. Não há o que fazer.
    return true
  }
  aplicados.set(id, seq)
  const anterior = buffer.get(id)

  const registro: LiveDataRecord = {
    _id: id,
    ownerId,
    connectionId,
    key: chave,
    value,
    /**
     * O contador sai da SEQUÊNCIA, não do que estava no buffer.
     *
     * Duas chamadas concorrentes liam o mesmo estado e escreviam o mesmo número: a
     * segunda cotação chegava com `updates: 1`, como se fosse a primeira. A sequência já
     * é estritamente crescente por chave, então ela é o contador certo — somada ao que a
     * chave já tinha antes deste processo.
     */
    updates: (bases.get(id) ?? 0) + seq,
    receivedAt: agora,
    expiresAt: new Date(expiraEm),
  }
  // O objeto do buffer é REAPROVEITADO quando existe: `gravar` guarda a referência dele
  // e mexe nela no fim: trocar por um objeto novo deixava a gravação em andamento
  // marcando `gravando: false` no lugar errado, e a chave nunca mais era gravada.
  if (anterior) {
    anterior.registro = registro
    anterior.seq = seq
    agendarGravacao(id, anterior, agora.getTime())
    avisarHistorico(ownerId, connectionId, chave, value, agora)
    return true
  }
  const pendente: Pendente = { registro, gravando: false, ultimaEm: 0, seq, timer: null, emVoo: null }
  buffer.set(id, pendente)
  agendarGravacao(id, pendente, agora.getTime())
  avisarHistorico(ownerId, connectionId, chave, value, agora)
  return true
}

/**
 * O histórico fica sabendo — SEM virar histórico.
 *
 * O Live Data continua sendo só o valor de agora, com TTL: nada aqui grava série. O que
 * este aviso faz é entregar o fato a quem tem regra para ele, que é o que evita o
 * polling do plano — quem quer "gravar quando mudar" é acordado pela mudança, em vez de
 * ficar perguntando de segundo em segundo se mudou.
 *
 * Sem esperar e sem propagar: uma regra de histórico com defeito não pode atrasar nem
 * derrubar a atualização do valor ao vivo, que é o caminho quente.
 */
function avisarHistorico(ownerId: string, connectionId: string, chave: string, valor: unknown, agora: Date): void {
  void import('../../dataHistory/engine.js')
    .then(({ ingestFact }) =>
      ingestFact(
        {
          ownerId,
          sourceKey: `live_data:${connectionId}`,
          entityKey: chave,
          occurredAt: agora,
          value: (valor && typeof valor === 'object' ? (valor as Record<string, unknown>) : { value: valor }),
        },
        agora,
      ),
    )
    .catch(() => undefined)
}

/**
 * Grava agora, se a janela já passou; senão, marca para o fim dela.
 *
 * O ponto que faltava era o `else`: sem ele, os tiques dentro da janela ficavam no
 * buffer esperando um PRÓXIMO tique para levá-los ao banco — e num serviço que manda
 * uma rajada e cala, o último valor nunca era persistido. Quem lê no mesmo processo via
 * o valor certo (o buffer responde primeiro) e quem lia no outro via o de antes.
 *
 * O relógio é armado UMA vez por janela: cada tique dentro dela só atualiza o valor que
 * será gravado, e não cria outro agendamento.
 */
function agendarGravacao(id: string, pendente: Pendente, agora: number): void {
  if (pendente.gravando || pendente.timer) return
  const falta = pendente.ultimaEm + FLUSH_MS - agora
  if (falta <= 0) {
    void gravar(id)
    return
  }
  const t = setTimeout(() => {
    pendente.timer = null
    void gravar(id)
  }, falta)
  t.unref?.()
  pendente.timer = t
}

/**
 * As chaves que ESTE processo já sabe que existem.
 *
 * A contagem no banco é uma leitura seguida de uma escrita, e entre as duas cabem
 * outros tiques: com dez chaves novas chegando juntas, todas leem o mesmo total e todas
 * passam. Reservar a vaga na memória, de forma síncrona, é o que fecha essa janela —
 * o banco continua sendo a verdade, e isto é o freio de quem está produzindo.
 */
/**
 * A reserva guarda ATÉ QUANDO ela vale.
 *
 * Antes era um `Set` de chaves, e uma vaga ficava ocupada até o processo reiniciar: a
 * chave vencia, o Mongo a removia por TTL — e a memória continuava contando com ela. Uma
 * conexão que gira símbolos ao longo do dia batia no teto sem ter nada vivo dentro dele.
 *
 * Guardando a validade, a limpeza é trivial e acontece na hora de conferir o limite:
 * quem venceu sai antes da conta.
 */
const conhecidas = new Map<string, Map<string, number>>()
const doDono = new Map<string, Map<string, number>>()

const mapaDe = (mapa: Map<string, Map<string, number>>, chave: string): Map<string, number> => {
  const atual = mapa.get(chave)
  if (atual) return atual
  const novo = new Map<string, number>()
  mapa.set(chave, novo)
  return novo
}

/** Tira o que já venceu e devolve quantas reservas VIVAS restaram. */
function vivasEm(reservas: Map<string, number>, agora: number): number {
  for (const [chave, ate] of reservas) if (ate <= agora) reservas.delete(chave)
  return reservas.size
}

/**
 * A hidratação EM ANDAMENTO de cada dono.
 *
 * Guardar a promessa, e não um booleano: marcar "hidratado" antes de a consulta voltar
 * fazia as chamadas concorrentes pularem a espera e conferirem o limite contra uma
 * memória ainda vazia — exatamente na rajada em que o limite importa. Agora todas
 * aguardam a MESMA consulta.
 *
 * A promessa sai do mapa quando FALHA, para a próxima tentar de novo em vez de herdar
 * um estado pela metade para sempre.
 */
const hidratacoes = new Map<string, Promise<void>>()

/**
 * Traz do banco o que este processo ainda não sabe sobre as chaves do dono.
 *
 * Sem isto, o teto só valia enquanto o processo vivesse: depois de um restart a memória
 * começava vazia, e uma conta que já tinha as duas mil chaves ganhava mais duas mil.
 *
 * Só as NÃO VENCIDAS entram: o TTL do Mongo remove em até um minuto, e uma chave morta
 * ocupando vaga faria o teto apertar sozinho com o tempo.
 */
function hidratar(ownerId: string): Promise<void> {
  const emAndamento = hidratacoes.get(ownerId)
  if (emAndamento) return emAndamento
  const promessa = hidratarAgora(ownerId).catch((erro) => {
    // Falhou: nada de estado pela metade e nada de "hidratado" mentiroso. A próxima
    // chamada tenta de novo.
    hidratacoes.delete(ownerId)
    conhecidas.forEach((_, k) => {
      if (k.startsWith(`${ownerId}:`)) conhecidas.delete(k)
    })
    doDono.delete(ownerId)
    throw erro
  })
  hidratacoes.set(ownerId, promessa)
  return promessa
}

async function hidratarAgora(ownerId: string): Promise<void> {
  const agora = new Date()
  // `updates` vem junto: a hidratação passa na frente da leitura por chave, e sem ele o
  // contador recomeçava do 1 depois de um restart — que é justamente o caso que
  // "continua de onde parou" existe para cobrir.
  const docs = await carregarChaves(ownerId, agora)
  const doOwner = mapaDe(doDono, ownerId)
  for (const doc of docs) {
    const id = idDe(ownerId, doc.connectionId, doc.key)
    const ate = doc.expiresAt.getTime()
    mapaDe(conhecidas, `${ownerId}:${doc.connectionId}`).set(doc.key, ate)
    doOwner.set(id, ate)
    if (!bases.has(id)) bases.set(id, doc.updates ?? 0)
  }
}

/**
 * Já existe? Então não é chave nova e o teto não se aplica — e o contador dela continua
 * de onde parou, em vez de recomeçar.
 *
 * Dois tetos: por conexão, para um campo inesperado no lugar do símbolo não criar uma
 * chave por tique; e por DONO, porque dez conexões abaixo do teto individual somam dez
 * vezes o teto na conta de quem paga.
 *
 * A reserva é feita na MEMÓRIA e de forma síncrona porque contar no banco é uma leitura
 * seguida de uma escrita, e uma rajada de chaves novas atravessa a janela entre as
 * duas. Isso pressupõe UM produtor por conexão — e é o que a arquitetura garante: o
 * socket vive num processo só, e o `resourceMap` de streams impede dois. Se um dia
 * houver dois produtores para a mesma conexão, esta reserva vira um `findOneAndUpdate`
 * num documento de contagem.
 */
async function cabeMaisUma(ownerId: string, connectionId: string, id: string, chave: string, ate: number, agora: number): Promise<boolean> {
  await hidratar(ownerId)
  const daConexao = mapaDe(conhecidas, `${ownerId}:${connectionId}`)
  const doOwner = mapaDe(doDono, ownerId)

  // Renovar uma chave que já é minha sempre passa — e estende a validade da reserva.
  const reservaAtual = daConexao.get(chave)
  if (reservaAtual !== undefined && reservaAtual > agora) {
    daConexao.set(chave, ate)
    doOwner.set(id, ate)
    return true
  }

  const existente = await live.findOne({ _id: id }, { projection: { updates: 1, expiresAt: 1 } })
  if (existente && existente.expiresAt.getTime() > agora) {
    if (!bases.has(id)) bases.set(id, existente.updates ?? 0)
    daConexao.set(chave, ate)
    doOwner.set(id, ate)
    return true
  }

  // O VENCIDO SAI ANTES DA CONTA. Sem isto, a vaga de uma chave que já morreu contava
  // contra o teto até o processo reiniciar.
  if (vivasEm(daConexao, agora) >= WS_LIMITS.maxLiveKeysPerConnection) return false
  if (vivasEm(doOwner, agora) >= WS_LIMITS.maxLiveKeysPerOwner) return false

  // A vaga é reservada AGORA, antes de qualquer espera: é o que impede a rajada de
  // chaves novas passar toda pela mesma leitura.
  daConexao.set(chave, ate)
  doOwner.set(id, ate)
  return true
}

/** Devolve a vaga. Chamado quando a primeira gravação falha e quando a chave some. */
function liberarVaga(ownerId: string, connectionId: string, chave: string): void {
  conhecidas.get(`${ownerId}:${connectionId}`)?.delete(chave)
  doDono.get(ownerId)?.delete(idDe(ownerId, connectionId, chave))
}

function gravar(id: string): Promise<void> {
  const pendente = buffer.get(id)
  if (!pendente) return Promise.resolve()
  if (pendente.gravando) return pendente.emVoo ?? Promise.resolve()
  if (pendente.timer) {
    clearTimeout(pendente.timer)
    pendente.timer = null
  }
  pendente.gravando = true
  const promessa = gravarAgora(id, pendente)
  pendente.emVoo = promessa
  return promessa
}

async function gravarAgora(id: string, pendente: Pendente): Promise<void> {
  const registro = pendente.registro
  try {
    await escrever(id, registro)
    pendente.ultimaEm = Date.now()
  } catch {
    // Perder um tique não é notícia: o próximo chega em instantes e traz o valor novo.
    // Derrubar a conexão por causa de uma escrita seria trocar o dado inteiro por um.
    //
    // Mas se a chave NUNCA chegou ao banco, a vaga reservada para ela fica ocupada por
    // um registro que não existe — e o teto aperta por uma escrita que falhou.
    if (registro.updates === (bases.get(id) ?? 0) + 1) liberarVaga(registro.ownerId, registro.connectionId, registro.key)
  } finally {
    pendente.gravando = false
    pendente.emVoo = null
    // Só sai do buffer quando o que está nele é o que já foi gravado: se um tique novo
    // chegou durante a escrita, ele fica esperando a próxima janela — e precisa de um
    // relógio, senão espera para sempre.
    if (pendente.registro === registro) buffer.delete(id)
    else agendarGravacao(id, pendente, Date.now())
  }
}

/**
 * Descarrega o que está pendente. Chamado no encerramento, antes de o processo sair.
 *
 * Sem isto, tudo que estava dentro da janela no momento do SIGTERM se perdia — e é
 * justamente o valor mais recente de cada chave que ficava para trás.
 */
export async function flushLiveData(): Promise<void> {
  for (const p of buffer.values()) {
    if (!p.timer) continue
    clearTimeout(p.timer)
    p.timer = null
  }
  // Duas voltas: a primeira espera o que já estava em voo, a segunda leva o que chegou
  // durante ele. Sem a segunda, um tique que entrou no meio da escrita ficava para trás
  // — e é sempre o mais recente.
  await Promise.allSettled([...buffer.keys()].map((id) => gravar(id)))
  await Promise.allSettled([...buffer.keys()].map((id) => gravar(id)))
}

/** Só para os testes: zera o buffer entre casos. */
export const resetLiveBuffer = (): void => {
  for (const p of buffer.values()) if (p.timer) clearTimeout(p.timer)
  buffer.clear()
  sequencias.clear()
  bases.clear()
  aplicados.clear()
  conhecidas.clear()
  doDono.clear()
  hidratacoes.clear()
}

const vivo = (r: LiveDataRecord | null, agora: Date): LiveDataRecord | null =>
  // O TTL do Mongo remove em ATÉ um minuto, não no instante. Conferir na leitura é o
  // que impede um valor vencido de responder como se fosse de agora.
  r && r.expiresAt.getTime() > agora.getTime() ? r : null

export async function getLiveValue(ownerId: string, connectionId: string, key: string, agora = new Date()): Promise<LiveDataRecord | null> {
  const id = idDe(ownerId, connectionId, key)
  const noBuffer = buffer.get(id)?.registro
  if (noBuffer) return vivo(noBuffer, agora)
  return vivo(await live.findOne({ _id: id, ownerId }), agora)
}

/** As chaves mais recentes desta conexão. É a foto do que está chegando agora. */
export async function latestLiveValues(ownerId: string, connectionId: string, limit = 50, agora = new Date()): Promise<LiveDataRecord[]> {
  const doBanco = await live
    .find({ ownerId, connectionId })
    .sort({ receivedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .toArray()
  return juntarComBuffer(doBanco, ownerId, connectionId, agora).slice(0, limit)
}

export async function listLiveValues(ownerId: string, connectionId: string, prefixo = '', limit = 100, agora = new Date()): Promise<LiveDataRecord[]> {
  const filtro: Record<string, unknown> = { ownerId, connectionId }
  // O prefixo é ESCAPADO: um filtro digitado nunca vira expressão regular.
  if (prefixo.trim()) filtro.key = { $regex: `^${prefixo.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` }
  const doBanco = await live
    .find(filtro)
    .sort({ key: 1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .toArray()
  const juntos = juntarComBuffer(doBanco, ownerId, connectionId, agora).filter((r) => !prefixo.trim() || r.key.startsWith(prefixo.trim()))
  return juntos.sort((a, b) => a.key.localeCompare(b.key)).slice(0, limit)
}

/** O buffer tem o valor mais novo; o banco tem o resto. O mais novo ganha. */
function juntarComBuffer(doBanco: LiveDataRecord[], ownerId: string, connectionId: string, agora: Date): LiveDataRecord[] {
  const porId = new Map(doBanco.map((r) => [r._id, r]))
  for (const p of buffer.values()) {
    if (p.registro.ownerId !== ownerId || p.registro.connectionId !== connectionId) continue
    porId.set(p.registro._id, p.registro)
  }
  return [...porId.values()].filter((r): r is LiveDataRecord => vivo(r, agora) !== null).sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
}

/** Quantas chaves esta conexão tem — para a tela e para o teto. */
export const countLiveKeys = (ownerId: string, connectionId: string): Promise<number> => live.countDocuments({ ownerId, connectionId })

/** Remover tudo de uma conexão. Chamado quando ela é apagada. */
export async function deleteLiveDataFor(ownerId: string, connectionId: string): Promise<void> {
  // Tudo o que esta conexão deixou na memória sai junto: registro pendente, relógio da
  // janela, ordem, base do contador e a VAGA. Apagar só os documentos deixaria as vagas
  // ocupadas por chaves que não existem mais — e o teto apertando sozinho.
  for (const [id, p] of buffer) {
    if (p.registro.ownerId !== ownerId || p.registro.connectionId !== connectionId) continue
    if (p.timer) clearTimeout(p.timer)
    buffer.delete(id)
  }
  const daConexao = conhecidas.get(`${ownerId}:${connectionId}`)
  const doOwner = doDono.get(ownerId)
  for (const chave of daConexao?.keys() ?? []) {
    const id = idDe(ownerId, connectionId, chave)
    doOwner?.delete(id)
    sequencias.delete(id)
    bases.delete(id)
    aplicados.delete(id)
  }
  conhecidas.delete(`${ownerId}:${connectionId}`)
  await live.deleteMany({ ownerId, connectionId })
}

// --- espera declarativa ----------------------------------------------------------------

export type LiveCondition = {
  /** Caminho dentro do valor guardado. Vazio = o valor inteiro. */
  path?: string
  operator: 'exists' | 'equals' | 'not_equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'changed'
  value?: unknown
}

export const LIVE_OPERATORS: LiveCondition['operator'][] = ['exists', 'equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'contains', 'changed']

/**
 * A condição, avaliada por COMPARAÇÃO — nunca por expressão.
 *
 * `waitFor` é a função mais tentadora do módulo para aceitar "um predicado": seria uma
 * linha. E seria uma linha que executa código escrito na configuração de um agente. Os
 * operadores abaixo cobrem o que uma regra de mercado precisa perguntar; o que eles não
 * cobrem, o código do agente pergunta depois de receber o valor.
 */
export function matchesCondition(valor: unknown, cond: LiveCondition, anterior?: unknown): boolean {
  const alvo = cond.path ? lerCaminho(valor, cond.path) : valor
  switch (cond.operator) {
    case 'exists':
      return alvo !== undefined && alvo !== null
    case 'changed':
      return JSON.stringify(alvo) !== JSON.stringify(cond.path ? lerCaminho(anterior, cond.path) : anterior)
    case 'equals':
      return alvo === cond.value
    case 'not_equals':
      return alvo !== cond.value
    case 'contains':
      return String(alvo ?? '').includes(String(cond.value ?? ''))
    default: {
      const a = Number(alvo)
      const b = Number(cond.value)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false
      return cond.operator === 'gt' ? a > b : cond.operator === 'gte' ? a >= b : cond.operator === 'lt' ? a < b : a <= b
    }
  }
}

/** A mesma leitura de caminho do resto do produto — sem `__proto__`, sem expressão. */
function lerCaminho(valor: unknown, caminho: string): unknown {
  let atual: unknown = valor
  for (const parte of caminho.split('.')) {
    if (parte === '__proto__' || parte === 'constructor' || parte === 'prototype') return undefined
    if (atual === null || typeof atual !== 'object') return undefined
    atual = (atual as Record<string, unknown>)[parte]
  }
  return atual
}

/**
 * O teto da espera, abaixo do teto de dez segundos que a plataforma dá a qualquer função
 * registrada: o handler precisa terminar ANTES de o executor desistir, senão a resposta
 * vira "falhou" onde o certo é "não aconteceu no prazo".
 */
export const LIVE_WAIT_MAX_MS = Number(process.env.WS_LIVE_WAIT_MAX_MS ?? 8_000)

/**
 * Espera a chave satisfazer a condição, ou desiste no prazo.
 *
 * Sondagem, e não assinatura: o socket está em outro processo, e um canal de eventos só
 * para isto seria uma segunda infraestrutura de tempo real dentro da que já existe. O
 * intervalo é curto o bastante para uma regra de risco e o teto é obrigatório — uma
 * espera sem prazo é uma execução que não termina.
 */
export async function waitForLiveValue(
  ownerId: string,
  connectionId: string,
  key: string,
  cond: LiveCondition,
  timeoutMs: number,
  deps: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<{ matched: boolean; record: LiveDataRecord | null }> {
  const dormir = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.()))
  const agora = deps.now ?? (() => Date.now())
  const prazo = agora() + Math.min(Math.max(timeoutMs, 100), LIVE_WAIT_MAX_MS)
  const intervalo = 200

  const inicial = await getLiveValue(ownerId, connectionId, key)
  let anterior = inicial?.value
  if (inicial && cond.operator !== 'changed' && matchesCondition(inicial.value, cond)) return { matched: true, record: inicial }

  while (agora() < prazo) {
    await dormir(intervalo)
    const atual = await getLiveValue(ownerId, connectionId, key)
    if (atual && matchesCondition(atual.value, cond, anterior)) return { matched: true, record: atual }
    anterior = atual?.value ?? anterior
  }
  return { matched: false, record: await getLiveValue(ownerId, connectionId, key) }
}
