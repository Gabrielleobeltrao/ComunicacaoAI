import { ObjectId } from 'mongodb'
import { loadOfficeInventory } from './inventory.js'
import type { InventoryItem, OfficeInventory } from './inventory.js'

// O QUE O ASSISTENTE PODE FAZER — uma lista fechada, e nada fora dela.
//
// O modelo diz o QUE quer ("consultar a cotação de CXSE3", "listar minhas fontes"). Ele não
// escolhe id, credencial, endereço nem comando. Este arquivo é a fronteira: cada capacidade
// tem uma chave, um risco declarado e um handler registrado, e o servidor resolve o NOME que
// o modelo citou contra o inventário owner-scoped antes de chamar qualquer coisa.
//
// Três coisas que isso impede, e que um prompt não impediria:
//
//   ENDEREÇO INVENTADO. Não há caminho daqui para uma URL que o modelo escreveu: o handler
//   recebe um recurso que já existe na conta, resolvido pelo id que o inventário trouxe.
//
//   RECURSO ALHEIO. Toda resolução passa por `loadOfficeInventory(ownerId)`, e todo handler
//   reconfere a posse pelo getter canônico do domínio dele — a lista pode ter envelhecido
//   entre a montagem e o uso.
//
//   CAPACIDADE QUE NINGUÉM ESCREVEU. Uma chave que não está no registro não executa. O
//   modelo pode pedir `rm -rf`; aqui isso é uma chave desconhecida e uma recusa.

export type CapabilityRisk = 'read' | 'write' | 'high_risk'

/** O que um handler devolve. `ok: false` é uma recusa acionável, nunca um erro cru. */
export type CapabilityOutcome =
  | { ok: true; text: string; provenance?: { source: string; at: string; transformation?: string } }
  | { ok: false; reason: string }

export interface CapabilityContext {
  ownerId: string
  /** O inventário desta rodada, já owner-scoped. Resolver por ele é o que fecha a fronteira. */
  inventory: OfficeInventory
  /** O nome que o modelo citou, quando citou. Nunca um id. */
  targetRef?: string
  /** A pergunta ou ação, em português, para compor a resposta. */
  query: string
}

export interface AssistantCapability {
  key: string
  /** Uma linha em português: é o que a recusa usa para dizer o que existe. */
  title: string
  risk: CapabilityRisk
  /** Os tipos de recurso do inventário que esta capacidade sabe usar. */
  kinds: string[]
  run: (ctx: CapabilityContext) => Promise<CapabilityOutcome>
}

/**
 * Acha o recurso que o modelo citou, por NOME, dentro dos tipos que a capacidade aceita.
 *
 * O casamento é por slug porque o nome no produto é um identificador e o modelo escreve como
 * gente: comparar as strings cruas faria o assistente dizer que a fonte não existe quando ela
 * está ali. Continua conservador — sem `targetRef`, devolve o único candidato ou nada.
 */
export function resolveByName(inv: OfficeInventory, kinds: string[], targetRef?: string): { kind: string; item: InventoryItem } | null {
  const candidatos: { kind: string; item: InventoryItem }[] = []
  for (const kind of kinds) {
    for (const item of inv.sections[kind]?.items ?? []) candidatos.push({ kind, item })
  }
  if (!candidatos.length) return null

  const chave = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')

  const alvo = chave(String(targetRef ?? ''))
  if (!alvo) return candidatos.length === 1 ? candidatos[0] : null

  const exato = candidatos.find((c) => chave(c.item.label) === alvo)
  if (exato) return exato
  // Contido: "cotação CXSE3" acha a fonte "CXSE3". Só quando UM candidato casa — dois
  // significa que o pedido é ambíguo, e escolher seria adivinhar.
  const parciais = candidatos.filter((c) => chave(c.item.label).includes(alvo) || alvo.includes(chave(c.item.label)))
  return parciais.length === 1 ? parciais[0] : null
}

// --- as capacidades ---------------------------------------------------------------------------

/**
 * CONSULTAR O VALOR DE AGORA — pela fonte ao vivo que a conta tem.
 *
 * É a capacidade que faz "qual o valor do dólar hoje?" ter resposta em vez de recusa. O que
 * ela nunca faz é responder de memória: sem uma fonte ao vivo compatível, a saída é uma
 * recusa que diz o que conectar.
 */
const consultarValorAtual: AssistantCapability = {
  key: 'read_live_value',
  title: 'consultar o valor de agora de uma fonte ao vivo',
  risk: 'read',
  kinds: ['source'],
  run: async (ctx) => {
    const achado = resolveByName(ctx.inventory, ['source'], ctx.targetRef ?? ctx.query)
    if (!achado) {
      // A MESMA frase da recusa do roteador: uma voz só para "não tenho de onde tirar isso".
      const { noCurrentSource } = await import('./intent.js')
      return { ok: false, reason: noCurrentSource(ctx.query).reason ?? 'não tenho uma fonte conectada que traga esse número' }
    }
    if (!ObjectId.isValid(achado.item.id)) return { ok: false, reason: 'a fonte encontrada não é válida' }

    /**
     * A POSSE é reconferida agora, pelo getter canônico.
     *
     * O inventário foi montado no começo da rodada. Entre lá e aqui a fonte pode ter sido
     * apagada ou trocada de conta — e responder a partir da lista velha seria ler um recurso
     * que já não é desta pessoa.
     */
    const { getSource } = await import('../monitoring/service.js')
    const fonte = await getSource(ctx.ownerId, new ObjectId(achado.item.id))
    if (!fonte) return { ok: false, reason: 'a fonte que eu encontrei já não existe nesta conta' }
    if (fonte.status !== 'active') {
      return { ok: false, reason: `a fonte "${fonte.name}" existe mas está ${fonte.status === 'draft' ? 'em rascunho' : 'parada'}: ative-a para eu poder consultar` }
    }
    if (!fonte.destination.live) {
      return { ok: false, reason: `a fonte "${fonte.name}" só grava histórico: ligue o destino ao vivo para eu responder o valor de agora` }
    }

    const { liveConnectionOf } = await import('../monitoring/service.js')
    const { db } = await import('../db.js')
    // Um registro por CHAVE: o valor ao vivo é um par nome/valor com o instante em que chegou.
    const vivos = await db
      .collection('live_data')
      .find({ ownerId: ctx.ownerId, connectionId: liveConnectionOf(fonte._id) })
      .limit(6)
      .toArray()
    if (!vivos.length) return { ok: false, reason: `a fonte "${fonte.name}" está no ar mas ainda não trouxe nenhuma leitura` }

    /**
     * FRESCOR importa: um número de ontem apresentado como "agora" é uma resposta errada, e
     * quem lê não tem como saber. O limite é o que a própria fonte declarou.
     */
    const lidoEm = vivos.reduce<Date | null>((maior, r) => {
      const q = r.receivedAt instanceof Date ? r.receivedAt : new Date(String(r.receivedAt))
      return !maior || q > maior ? q : maior
    }, null)
    const segundos = lidoEm ? Math.round((Date.now() - lidoEm.getTime()) / 1000) : null
    const tetoSegundos = Math.round((fonte.freshness?.staleAfterMs ?? 900_000) / 1000)
    if (segundos !== null && segundos > tetoSegundos) {
      return {
        ok: false,
        reason: `o último valor de "${fonte.name}" é de ${Math.max(1, Math.round(segundos / 60))} min atrás, além do limite de frescor dela: não vou apresentar isso como o de agora`,
      }
    }

    const campos = vivos.filter((r) => r.value !== null && r.value !== undefined)
    if (!campos.length) return { ok: false, reason: `a leitura de "${fonte.name}" chegou vazia` }

    return {
      ok: true,
      text: campos.map((r) => `${String(r.key)}: ${String(r.value)}`).join(', '),
      provenance: { source: fonte.name, at: (lidoEm ?? new Date()).toISOString() },
    }
  },
}

/** LISTAR — a operação de leitura que não muda nada e responde de verdade. */
const listarRecursos: AssistantCapability = {
  key: 'list_resources',
  title: 'listar os recursos da conta',
  risk: 'read',
  kinds: ['source', 'monitor', 'flow', 'database', 'agent', 'sector', 'floor', 'app', 'tool', 'channel', 'delivery'],
  run: async (ctx) => {
    const pedido = `${ctx.targetRef ?? ''} ${ctx.query}`.toLowerCase()
    const NOMES: [string, RegExp, string, string][] = [
      ['source', /\bfonte/, 'fonte', 'fontes'],
      ['monitor', /\bmonitor/, 'monitor', 'monitores'],
      ['flow', /\bflow|automa/, 'Flow', 'Flows'],
      ['database', /\bdatabase|base de dado/, 'Database', 'Databases'],
      ['agent', /\bagente/, 'agente', 'agentes'],
      ['sector', /\bsetor|equipe|time\b/, 'setor', 'setores'],
      ['floor', /\bandar/, 'andar', 'andares'],
      ['app', /\bapp|integra/, 'App', 'Apps'],
      ['tool', /\bferramenta/, 'ferramenta', 'ferramentas'],
      ['channel', /\bcanal|canais/, 'canal', 'canais'],
      ['delivery', /\bentrega/, 'entrega', 'entregas'],
    ]
    const escolhido = NOMES.find(([, re]) => re.test(pedido))
    if (!escolhido) return { ok: false, reason: 'não entendi o que você quer listar — diga fontes, monitores, Flows, agentes, canais ou Databases' }

    const [kind, , singular, plural] = escolhido
    const secao = ctx.inventory.sections[kind]
    const total = secao?.total ?? 0
    if (!total) return { ok: true, text: `Você ainda não tem ${plural}.` }

    const nomes = (secao?.items ?? []).slice(0, 10).map((i) => (i.status ? `${i.label} (${i.status})` : i.label))
    const resto = total > nomes.length ? ` e mais ${total - nomes.length}` : ''
    return { ok: true, text: `${total} ${total === 1 ? singular : plural}: ${nomes.join(', ')}${resto}.` }
  },
}

/** PAUSAR uma fonte — escrita, e por isso ela nunca roda direto da conversa. */
const pausarFonte: AssistantCapability = {
  key: 'pause_source',
  title: 'pausar uma fonte de monitoramento',
  risk: 'write',
  kinds: ['source'],
  run: async (ctx) => {
    const achado = resolveByName(ctx.inventory, ['source'], ctx.targetRef ?? ctx.query)
    if (!achado || !ObjectId.isValid(achado.item.id)) return { ok: false, reason: 'não achei essa fonte nesta conta' }
    const { getSource, setSourceStatus } = await import('../monitoring/service.js')
    const fonte = await getSource(ctx.ownerId, new ObjectId(achado.item.id))
    if (!fonte) return { ok: false, reason: 'essa fonte já não existe nesta conta' }
    const depois = await setSourceStatus(ctx.ownerId, fonte._id, 'paused')
    return depois?.status === 'paused'
      ? { ok: true, text: `A fonte "${fonte.name}" foi pausada. Ela para de coletar até você reativar.` }
      : { ok: false, reason: `não consegui pausar "${fonte.name}"` }
  },
}

/** ATIVAR uma fonte — escrita, e o portão do domínio continua valendo por baixo. */
const ativarFonte: AssistantCapability = {
  key: 'activate_source',
  title: 'colocar uma fonte no ar',
  risk: 'write',
  kinds: ['source'],
  run: async (ctx) => {
    const achado = resolveByName(ctx.inventory, ['source'], ctx.targetRef ?? ctx.query)
    if (!achado || !ObjectId.isValid(achado.item.id)) return { ok: false, reason: 'não achei essa fonte nesta conta' }
    const { getSource, setSourceStatus } = await import('../monitoring/service.js')
    const fonte = await getSource(ctx.ownerId, new ObjectId(achado.item.id))
    if (!fonte) return { ok: false, reason: 'essa fonte já não existe nesta conta' }
    try {
      const depois = await setSourceStatus(ctx.ownerId, fonte._id, 'active')
      return depois?.status === 'active'
        ? { ok: true, text: `A fonte "${fonte.name}" está no ar.` }
        : { ok: false, reason: `não consegui ativar "${fonte.name}"` }
    } catch (erro) {
      // A recusa do domínio é a resposta: ele exige um teste bem-sucedido antes de ativar.
      return { ok: false, reason: String((erro as Error).message).slice(0, 200) }
    }
  },
}

/**
 * O REGISTRO. Uma chave que não está aqui não executa.
 *
 * Acrescentar capacidade é acrescentar uma entrada com risco declarado e handler escrito —
 * não é uma frase nova no prompt.
 */
export const ASSISTANT_CAPABILITIES: readonly AssistantCapability[] = [consultarValorAtual, listarRecursos, pausarFonte, ativarFonte]

export const capabilityByKey = (key: string): AssistantCapability | undefined => ASSISTANT_CAPABILITIES.find((c) => c.key === key)

/**
 * Qual capacidade atende esta intenção — escolhido pelo CÓDIGO, por forma da frase.
 *
 * O modelo não escolhe a chave: se escolhesse, bastaria ele responder `pause_source` para uma
 * pergunta e a conversa executaria uma escrita. Ele diz o que a pessoa quer; o mapeamento
 * para capacidade é aqui, e o risco declarado no registro é o que vale.
 */
export function capabilityFor(mode: 'answer' | 'operate', texto: string): AssistantCapability | null {
  const t = String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (mode === 'answer') return consultarValorAtual

  /**
   * O `\b` DEPOIS de um radical quebra a palavra flexionada.
   *
   * `/\bativ\b/` não casa com "ative", "ativar" nem "ativa": ele exige fronteira logo após
   * "ativ", e ali vem outra letra. O efeito era o pior possível — "desative a fonte" não
   * casava com nada e caía na recusa "não sei fazer isso", enquanto "pause" funcionava. Duas
   * frases equivalentes, comportamentos diferentes.
   *
   * A fronteira fica só na ENTRADA do radical; o fim é livre para a flexão. E a ordem importa:
   * "desativar" contém "ativar", então o desligar é testado primeiro.
   */
  if (/\b(pau[sz]\w*|par(a|ar|e)\b|desativ\w*|deslig\w*|suspend\w*)/.test(t)) return pausarFonte
  if (/\b(ativ\w*|lig(a|ar|ue)\w*|relig\w*|reativ\w*|colocar no ar|subir)/.test(t)) return ativarFonte
  if (/\b(list\w*|mostr\w*|quais|exib\w*|ver\b)/.test(t)) return listarRecursos
  return null
}

/** O inventário desta rodada, para quem for executar uma capacidade. */
export const inventoryFor = (ownerId: string): Promise<OfficeInventory> => loadOfficeInventory(ownerId)
