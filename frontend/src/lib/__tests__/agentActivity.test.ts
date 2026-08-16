import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import {
  AGENT_ACTIVITY_ASSETS,
  AGENT_BUBBLE_STATES,
  bubbleAssetFor,
  bubbleLabel,
  bubbleLane,
  bubblePlacement,
  BUBBLE_CAPSULE_HEIGHT,
  BUBBLE_LANE_OFFSET,
  BUBBLE_TAIL_HEIGHT,
  DEBOUNCE_MS,
  MIN_VISIBLE_MS,
  TRANSIENT_MS,
} from '../agentActivityAssets'
import type { AgentBubbleState } from '../agentActivityAssets'
import { reconcile } from '../useAgentStates'

// The bubble layer has two jobs it can fail at silently: showing a state that does
// not exist (an asset that 404s in production), and flickering so fast nobody can
// read it. Both are pinned here.

// Every state the BACKEND can report (backend/src/agentLiveState.ts). If the backend
// gains one and the manifest does not, this list is where it shows.
const RUNTIME_STATES = [
  'queued',
  'thinking',
  'researching',
  'reading_knowledge',
  'using_tool',
  'delegating_agent',
  'delegating_sector',
  'waiting_external',
  'waiting_input',
  'responding',
  'generating_output',
  'validating_output',
  'delivering',
  'retrying',
  'completed',
  'blocked',
  'failed',
  'canceled',
]

describe('o manifesto cobre exatamente o que o runtime reporta', () => {
  it('tem uma entrada por estado, sem sobra e sem falta', () => {
    expect([...AGENT_BUBBLE_STATES].sort()).toEqual([...RUNTIME_STATES].sort())
  })

  it('cada estado aponta para um asset que existe no repositório', () => {
    for (const state of AGENT_BUBBLE_STATES) {
      const asset = AGENT_ACTIVITY_ASSETS[state]
      // Case-sensitive path check: a Linux production build is unforgiving.
      const file = new URL(`../../../public${asset.icon}`, import.meta.url)
      expect(existsSync(file), `${state}: faltou ${asset.icon}`).toBe(true)
    }
  })

  it('nenhum asset contém script, evento ou referência externa', () => {
    for (const state of AGENT_BUBBLE_STATES) {
      const svg = readFileSync(new URL(`../../../public${AGENT_ACTIVITY_ASSETS[state].icon}`, import.meta.url), 'utf-8')
      expect(svg).not.toMatch(/<script|\son[a-z]+=|href\s*=\s*"http|@import/i)
      // Proportion and geometry preserved.
      expect(svg).toContain('viewBox="0 0 24 24"')
    }
  })

  it('nenhum caminho é remoto: tudo é servido do próprio build', () => {
    for (const state of AGENT_BUBBLE_STATES) {
      expect(AGENT_ACTIVITY_ASSETS[state].icon.startsWith('/illustrations/')).toBe(true)
    }
  })

  it('cor vem de token, nunca de literal', () => {
    for (const state of AGENT_BUBBLE_STATES) {
      const { color, tint } = AGENT_ACTIVITY_ASSETS[state]
      expect(color.startsWith('var(--')).toBe(true)
      if (tint) expect(tint.startsWith('var(--')).toBe(true)
    }
  })

  it('só o desfecho é tingido, e só ele é transitório', () => {
    const transient = AGENT_BUBBLE_STATES.filter((s) => AGENT_ACTIVITY_ASSETS[s].tier === 'transient')
    expect(transient.sort()).toEqual(['canceled', 'completed', 'failed'])
    for (const state of AGENT_BUBBLE_STATES) {
      const asset = AGENT_ACTIVITY_ASSETS[state]
      expect(Boolean(asset.tint)).toBe(asset.tier === 'transient')
    }
  })

  it('esperar uma pessoa nunca parece ocupado', () => {
    for (const state of ['waiting_input', 'blocked'] as const) {
      expect(AGENT_ACTIVITY_ASSETS[state].tier).toBe('waiting')
    }
  })

  it('um estado desconhecido não desenha nada em vez de inventar um fallback', () => {
    expect(bubbleAssetFor('inventado')).toBeNull()
    expect(bubbleAssetFor('idle')).toBeNull()
  })
})

describe('o rótulo diz o TIPO de trabalho, nunca o conteúdo', () => {
  it('nomeia o agente e a atividade', () => {
    expect(bubbleLabel('Nina', 'researching')).toBe('Nina: pesquisando')
  })

  it('usa o rótulo público do App quando o backend mandou um', () => {
    expect(bubbleLabel('Nina', 'using_tool', { actionLabel: 'Criar evento' })).toBe('Nina: usando ferramenta: Criar evento')
  })

  it('delegação não revela o objetivo', () => {
    const label = bubbleLabel('Nina', 'delegating_sector', { targetType: 'sector' })
    expect(label).toBe('Nina: chamando setor')
    expect(label).not.toMatch(/objetivo|http|@/)
  })
})

// --- posicionamento ----------------------------------------------------------------

describe('balões vizinhos não caem na mesma altura', () => {
  it('colunas adjacentes usam faixas diferentes', () => {
    // O passo entre assentos lado a lado é ~1.14 tile: a paridade alterna.
    const seats = [1.729, 2.871, 4.013, 5.155]
    const lanes = seats.map(bubbleLane)
    for (let i = 1; i < lanes.length; i++) {
      expect(lanes[i], `assentos ${seats[i - 1]} e ${seats[i]} colidiriam`).not.toBe(lanes[i - 1])
    }
  })

  it('a faixa levantada sobe o suficiente para o balão de baixo aparecer INTEIRO', () => {
    const step = Math.abs(bubblePlacement(3, '100%').marginBottom - bubblePlacement(2, '100%').marginBottom)
    // Não basta passar da cápsula: a cauda da que sobe desce em direção ao personagem
    // dela e cruzaria a cápsula de baixo. O degrau cobre os dois.
    expect(step).toBeGreaterThanOrEqual(BUBBLE_CAPSULE_HEIGHT + BUBBLE_TAIL_HEIGHT)
    expect(step).toBe(BUBBLE_LANE_OFFSET)
  })

  it('a que sobe desenha por cima, para a cauda dela não ser cortada', () => {
    expect(bubblePlacement(3, '100%').zIndex).toBeGreaterThan(bubblePlacement(2, '100%').zIndex)
  })

  it('o nome no hover limpa o balão, inclusive o levantado', () => {
    for (const x of [2, 3]) {
      const p = bubblePlacement(x, '100%')
      expect(p.nameMarginBottom).toBeGreaterThan(p.marginBottom)
    }
  })

  it('a faixa é estável para o mesmo agente', () => {
    expect(bubbleLane(2.871)).toBe(bubbleLane(2.871))
  })
})

// --- anti-flicker ---------------------------------------------------------------

const row = (over: Partial<{ agentId: string; state: string; concurrent: number }> = {}) => ({
  agentId: over.agentId ?? 'a1',
  floorId: 'f1',
  rootExecutionId: 'r1',
  state: over.state ?? 'thinking',
  startedAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:00.000Z',
  expiresAt: '2026-01-01T10:02:00.000Z',
  concurrent: over.concurrent ?? 1,
})

describe('a projeção do mapa não pisca', () => {
  it('um estado novo aparece imediatamente', () => {
    const shownAt: Record<string, number> = {}
    const next = reconcile({}, [row()], shownAt, {}, 1000)
    expect(next.a1.state).toBe('thinking')
    expect(shownAt.a1).toBe(1000)
  })

  it('uma troca rápida demais não repinta: o estado antigo permanece', () => {
    const shownAt = { a1: 1000 }
    const pending: Record<string, { state: AgentBubbleState; since: number }> = {}
    const current = { a1: { state: 'thinking' as AgentBubbleState, concurrent: 1 } }
    // Proposta chega...
    let next = reconcile(current, [row({ state: 'using_tool' })], shownAt, pending, 1100)
    expect(next.a1.state).toBe('thinking')
    // ...e some antes do debounce: nada foi repintado.
    next = reconcile(next, [row({ state: 'thinking' })], shownAt, pending, 1200)
    expect(next.a1.state).toBe('thinking')
    expect(pending.a1).toBeUndefined()
  })

  it('uma troca estável repinta depois do debounce e da permanência mínima', () => {
    const shownAt = { a1: 0 }
    const pending: Record<string, { state: AgentBubbleState; since: number }> = {}
    const current = { a1: { state: 'thinking' as AgentBubbleState, concurrent: 1 } }
    const t0 = MIN_VISIBLE_MS + 1000
    let next = reconcile(current, [row({ state: 'using_tool' })], shownAt, pending, t0)
    expect(next.a1.state).toBe('thinking')
    next = reconcile(next, [row({ state: 'using_tool' })], shownAt, pending, t0 + DEBOUNCE_MS + 1)
    expect(next.a1.state).toBe('using_tool')
  })

  it('um estado ainda não lido não é substituído, mesmo com proposta estável', () => {
    const shownAt = { a1: 1000 }
    const pending = { a1: { state: 'delivering' as AgentBubbleState, since: 1000 } }
    const current = { a1: { state: 'thinking' as AgentBubbleState, concurrent: 1 } }
    // Debounce cumprido, permanência mínima NÃO.
    const next = reconcile(current, [row({ state: 'delivering' })], shownAt, pending, 1000 + DEBOUNCE_MS + 1)
    expect(next.a1.state).toBe('thinking')
  })

  it('o desfecho aparece e sai sozinho depois da janela', () => {
    const shownAt: Record<string, number> = {}
    const pending: Record<string, { state: AgentBubbleState; since: number }> = {}
    let next = reconcile({}, [row({ state: 'completed' })], shownAt, pending, 5000)
    expect(next.a1.state).toBe('completed')
    next = reconcile(next, [row({ state: 'completed' })], shownAt, pending, 5000 + TRANSIENT_MS + 1)
    expect(next.a1).toBeUndefined()
  })

  it('some do servidor = some do mapa, sem sobra', () => {
    const shownAt = { a1: 1000 }
    const pending = { a1: { state: 'thinking' as AgentBubbleState, since: 1 } }
    const next = reconcile({ a1: { state: 'thinking' as AgentBubbleState, concurrent: 1 } }, [], shownAt, pending, 2000)
    expect(next).toEqual({})
    expect(shownAt.a1).toBeUndefined()
    expect(pending.a1).toBeUndefined()
  })

  it('estado desconhecido do servidor não vira balão', () => {
    const next = reconcile({}, [row({ state: 'monitorando' })], {}, {}, 1000)
    expect(next).toEqual({})
  })

  it('execuções concorrentes chegam com a contagem, sem alternar', () => {
    const next = reconcile({}, [row({ state: 'delivering', concurrent: 3 })], {}, {}, 1000)
    expect(next.a1.concurrent).toBe(3)
  })
})

describe('cada afastamento na unidade do que ele precisa limpar', () => {
  it('limpar a cabeça é proporcional ao personagem, não px fixo', () => {
    // Porcentagem: encolhe junto com a caixa do agente. Com px fixo, o recorte do
    // setor (palco reduzido por transform) punha o balão DENTRO da cabeça.
    expect(bubblePlacement(2, '100%').bottom).toMatch(/%\)$/)
    expect(bubblePlacement(2, '100%').bottom).toContain('100%')
  })

  it('a âncora do sentado é respeitada, não substituída', () => {
    // Um agente sentado tem a cabeça mais baixa no quadro; o afastamento soma à
    // âncora dele, em vez de assumir que todo mundo está de pé.
    expect(bubblePlacement(2, '78.6%').bottom).toContain('78.6%')
  })

  it('limpar o vizinho continua em px, que acompanha o balão dentro de cada mapa', () => {
    expect(typeof bubblePlacement(3, '100%').marginBottom).toBe('number')
    expect(bubblePlacement(3, '100%').marginBottom - bubblePlacement(2, '100%').marginBottom).toBe(BUBBLE_LANE_OFFSET)
  })
})
