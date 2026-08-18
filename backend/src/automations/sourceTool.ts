// "Dá uma olhada na fonte agora" — a verificação sob demanda, dentro da conversa.
//
// O monitoramento já existia, mas só por relógio: a rotina consulta o feed/página na
// frequência configurada, ou alguém clica em "Verificar agora". Faltava o caso em que a
// pergunta chega no meio de uma conversa — no chat, no canal, no Playground ou dentro de
// um setor — e a resposta depende do que está na fonte NESTE instante.
//
// Duas decisões que valem estar escritas:
//
// 1. É uma ESPIADA. O checkpoint da rotina não é tocado. Se esta ferramenta consumisse os
//    itens novos, a rotina das 9h acharia que não houve novidade e o alerta que o dono
//    configurou nunca sairia — a conversa teria roubado a notificação.
//
// 2. Só as fontes JÁ CONFIGURADAS nas rotinas deste agente. Não é um buscador de URL
//    arbitrária: o endereço que o modelo alcança é o que uma pessoa escolheu e salvou.
//
// A busca em si não gasta token nenhum (é HTTP e comparação de texto). O que custa é a
// conversa em volta — por isso o resultado vem curto e com teto.
import { ObjectId } from 'mongodb'
import type { ResolvedTool } from '../agentTools.js'
import { getCheckpoint } from './sourceCheckpoint.js'
import { chaveDoItem, contentHashOf, detectHttpChange } from './sourceChange.js'
import { previewSource } from './sourcePreview.js'
import { getAgentById } from '../agents.js'
import { listRoutines, readSourceFromDefinition, STEP_SOURCE } from './routine.js'
import type { RoutineSource } from './routine.js'

export const SOURCE_TOOL_NAME = 'verificar_fonte'

// Tetos: o que volta daqui entra no prompt, e o prompt é o que se paga.
const MAX_ITENS = 8
// Quantos itens são EXAMINADOS para contar as novidades — bem mais do que os exibidos.
const MAX_ANALISADOS = 50
const MAX_TITULO = 160
const ORCAMENTO_CHARS = 2400

const j = (v: unknown): string => JSON.stringify(v)

const normalizar = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

interface FonteDoAgente {
  /** A rotina dona do checkpoint, quando a fonte vem de uma. Ausente na fonte do agente. */
  automationId: ObjectId | null
  nome: string
  source: Extract<RoutineSource, { kind: 'rss' | 'http' }>
  /** De onde ela veio — a tela e a resposta dizem isso, e as duas se comportam diferente. */
  origem: 'agente' | 'rotina'
}

/**
 * Tudo que este agente pode consultar.
 *
 * Duas procedências, e a diferença importa. A da ROTINA tem horário e checkpoint: dá
 * para dizer "3 itens novos desde a última verificação". A do AGENTE não tem nem uma
 * coisa nem outra — ela existe justamente para ser olhada quando alguém pergunta, e
 * então o que se responde é o que está lá agora.
 */
export async function fontesDoAgente(ownerId: string, agentId: ObjectId): Promise<FonteDoAgente[]> {
  const saida: FonteDoAgente[] = []

  const agente = await getAgentById(ownerId, agentId)
  for (const site of agente?.watchedSources ?? []) {
    saida.push({
      automationId: null,
      nome: site.name,
      source: site.kind === 'rss' ? { kind: 'rss', url: site.url, initialWindow: '7d' } : { kind: 'http', url: site.url },
      origem: 'agente',
    })
  }

  const rotinas = await listRoutines(ownerId, agentId)
  for (const rotina of rotinas) {
    // A definição de rascunho é a que o editor mostra e a que o dono acabou de salvar.
    const source = readSourceFromDefinition(rotina.draftDefinition)
    if (source.kind === 'fixed') continue
    saida.push({ automationId: rotina._id, nome: rotina.name, source, origem: 'rotina' })
  }
  return saida
}

export function sourceCheckTool(ownerId: string, agentId: ObjectId): ResolvedTool {
  return {
    name: SOURCE_TOOL_NAME,
    description:
      'Consulta AGORA uma fonte monitorada por este agente (feed RSS ou página) e devolve o que há de novo desde a última verificação da rotina. Não altera nada e não marca os itens como vistos. Sem o parâmetro `fonte`, lista as fontes disponíveis.',
    // Leitura: não escreve, não envia, não avança checkpoint. É o que permite usá-la
    // no Playground, onde as ferramentas de escrita são bloqueadas.
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        fonte: {
          type: 'string',
          description: 'Nome (ou parte do nome) da rotina cuja fonte deve ser consultada. Vazio lista as disponíveis.',
        },
      },
    },
    run: async (args: Record<string, unknown>) => {
      const fontes = await fontesDoAgente(ownerId, agentId)
      if (fontes.length === 0) {
        return {
          ok: true,
          result: j({ status: 'sem_fonte', nota: 'Este agente não monitora nenhum feed ou página. Configure uma fonte numa rotina.' }),
        }
      }

      const pedida = typeof args.fonte === 'string' ? normalizar(args.fonte) : ''
      if (!pedida) {
        return {
          ok: true,
          result: j({
            status: 'ok',
            fontes: fontes.map((f) => ({ nome: f.nome, tipo: f.source.kind === 'rss' ? 'feed' : 'página', origem: f.origem })),
          }),
        }
      }

      const alvo = fontes.find((f) => normalizar(f.nome) === pedida) ?? fontes.find((f) => normalizar(f.nome).includes(pedida))
      if (!alvo) {
        return {
          ok: true,
          result: j({ status: 'nao_encontrada', disponiveis: fontes.map((f) => f.nome) }),
        }
      }

      const preview = await previewSource(alvo.source.kind, alvo.source.url, {
        initialWindow: alvo.source.kind === 'rss' ? alvo.source.initialWindow : undefined,
        // Ver mais do que se mostra: "3 novos" precisa ser contado no feed inteiro, e
        // não dentro da amostra que a tela usaria.
        amostra: MAX_ANALISADOS,
      })
      if (!preview.ok) {
        // Não conseguir consultar NÃO é "não há nada": quem responde precisa saber a
        // diferença para não afirmar ausência de um dado que talvez exista.
        return { ok: true, result: j({ status: 'indisponivel', fonte: alvo.nome, motivo: preview.message }) }
      }

      // O que a rotina já conhece — lido, nunca escrito. A fonte do agente não tem
      // checkpoint: ela não é vigiada, é consultada.
      const checkpoint = alvo.automationId ? await getCheckpoint(ownerId, alvo.automationId, STEP_SOURCE) : null
      const conhecidas = new Set(checkpoint?.seenKeys ?? [])

      if (alvo.source.kind === 'rss') {
        const itens = preview.items ?? []
        const novos = checkpoint?.initialized
          ? itens.filter(
              // A MESMA chave que o checkpoint guarda — com o guid, que é o que
              // identifica o item. Recalculá-la pelo link acharia novidade em item
              // que a rotina já conhece.
              (i) => !conhecidas.has(chaveDoItem({ title: i.title, url: i.url, publishedAt: i.publishedAt, author: null, snippet: '', guid: i.guid ?? '' })),
            )
          : itens
        let usados = 0
        const recorte = novos.slice(0, MAX_ITENS).filter((i) => {
          const custo = Math.min(i.title.length, MAX_TITULO) + (i.url?.length ?? 0)
          if (usados + custo > ORCAMENTO_CHARS) return false
          usados += custo
          return true
        })
        return {
          ok: true,
          result: j({
            status: novos.length ? 'novidade' : 'sem_novidade',
            fonte: alvo.nome,
            tipo: 'feed',
            novos: novos.length,
            // Truncado: o teto existe para uma conversa não custar uma página inteira.
            itens: recorte.map((i) => ({ titulo: i.title.slice(0, MAX_TITULO), link: i.url, publicado: i.publishedAt })),
            ...(novos.length > recorte.length ? { nota: `mostrando ${recorte.length} de ${novos.length}` } : {}),
            // Dito em voz alta para o modelo não concluir que "já tratei disto".
            observacao:
              alvo.origem === 'rotina'
                ? 'consulta somente leitura: estes itens continuam pendentes para a rotina'
                : 'consultado agora, sob demanda',
          }),
        }
      }

      const trecho = (preview.excerpt ?? '').slice(0, ORCAMENTO_CHARS)
      const mudou = checkpoint?.contentHash ? contentHashOf(detectHttpChange(trecho, 'text/plain', null, false).conteudo) !== checkpoint.contentHash : null
      return {
        ok: true,
        result: j({
          status: mudou === null ? 'lido' : mudou ? 'novidade' : 'sem_novidade',
          fonte: alvo.nome,
          tipo: 'página',
          trecho,
          observacao: 'consulta somente leitura: o checkpoint da rotina não foi alterado',
        }),
      }
    },
  }
}
