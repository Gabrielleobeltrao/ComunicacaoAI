// Os sites que entram no contexto SOZINHOS, quando o agente é chamado.
//
// A ferramenta `verificar_fonte` cobre o caso "o agente decide olhar". Aqui estão os
// outros dois, que o dono escolhe por endereço:
//
//   always    — o conteúdo entra em toda chamada. Previsível e caro: paga tokens mesmo
//               quando a pergunta não tem nada a ver com o site.
//   on_change — consulta em toda chamada, mas só injeta quando MUDOU desde a última vez.
//               Zero na maioria dos turnos; o conteúdo aparece quando importa.
//
// A consulta em si não custa token nenhum nos dois casos — é HTTP e comparação de texto.
// O que se paga é o texto que entra no prompt, e é por isso que ele tem teto.
//
// O estado do `on_change` mora no MESMO lugar dos checkpoints de rotina, com a chave
// derivada do agente e do endereço. É o mesmo conceito — "o que eu já tinha visto" — e
// uma segunda coleção para dizer a mesma coisa envelheceria em separado.
import type { Agent } from '../agents.js'
import { sourceSettingsOf } from '../agents.js'
import { contentHashOf, sourceFingerprint } from './sourceChange.js'
import { advanceCheckpoint, beginCheck } from './sourceCheckpoint.js'
import { previewSource } from './sourcePreview.js'

export interface LivePassage {
  /** O texto que entra no contexto, já dentro do orçamento. */
  content: string
  /** O nome que o dono deu ao endereço — é a procedência que aparece na citação. */
  title: string
}

const STEP = (sourceId: string): string => `agent-source:${sourceId}`

/**
 * O que os endereços `always`/`on_change` deste agente têm a dizer AGORA.
 *
 * Nunca lança: um site fora do ar não pode derrubar o atendimento. O que ele não
 * conseguiu ler simplesmente não entra — e o agente responde sem aquilo, como responderia
 * se o endereço não existisse.
 */
export async function livePassagesFor(ownerId: string, agent: Pick<Agent, '_id' | 'watchedSources' | 'sourceSettings'>): Promise<LivePassage[]> {
  const sites = (agent.watchedSources ?? []).filter((s) => s.when === 'always' || s.when === 'on_change')
  if (sites.length === 0) return []

  const cfg = sourceSettingsOf(agent)
  const passagens: LivePassage[] = []
  let usado = 0

  for (const site of sites) {
    if (usado >= cfg.charBudget) break
    try {
      const preview = await previewSource(site.kind, site.url, {
        initialWindow: site.kind === 'rss' ? site.initialWindow : undefined,
        amostra: cfg.maxItems,
      })
      if (!preview.ok) continue

      // O texto candidato, já no formato que o modelo lê.
      const texto =
        site.kind === 'rss'
          ? (preview.items ?? [])
              .slice(0, cfg.maxItems)
              .map((i) => `- ${i.title}${i.publishedAt ? ` (${i.publishedAt})` : ''}${i.url ? ` — ${i.url}` : ''}`)
              .join('\n')
          : (preview.excerpt ?? '')
      if (!texto.trim()) continue

      if (site.when === 'on_change') {
        // O mesmo mecanismo da rotina: o que já foi visto não volta a entrar. É isto
        // que faz o modo custar zero na maioria dos turnos.
        const fingerprint = sourceFingerprint(site.kind, site.url, site.id)
        const agora = new Date()
        const estado = await beginCheck(ownerId, agent._id, STEP(site.id), fingerprint, agora)
        const hash = contentHashOf(texto)
        if (estado.initialized && estado.contentHash === hash) continue
        await advanceCheckpoint(ownerId, agent._id, STEP(site.id), fingerprint, { contentHash: hash }, agora)
      }

      const cabe = Math.max(0, cfg.charBudget - usado)
      const recorte = texto.slice(0, cabe)
      if (!recorte.trim()) continue
      usado += recorte.length
      passagens.push({ content: recorte, title: site.name })
    } catch {
      // Site fora do ar não derruba a conversa: o agente segue sem aquilo.
      continue
    }
  }
  return passagens
}

/** Só a leitura barata: este agente tem algum endereço automático? */
export const hasLiveSources = (agent: Pick<Agent, 'watchedSources'>): boolean =>
  (agent.watchedSources ?? []).some((s) => s.when === 'always' || s.when === 'on_change')

export const liveStepIdFor = (sourceId: string): string => STEP(sourceId)
