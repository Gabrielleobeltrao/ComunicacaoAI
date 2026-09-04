import { describe, expect, it } from 'vitest'
import { isNavActive, navGroupsFor, navItemsFor } from './navConfig'

// Regression guard for the pivot: "Automação" is not a product surface — there is no
// Automações builder and no AUTOMAÇÃO group. What DOES exist is "Execuções": an
// observability surface over the work the agents already do. Creating still happens
// inside the agent (Fluxos); this item only shows and controls.
describe('navConfig has no automation builder', () => {
  it('exposes no automations/runs items', () => {
    for (const floorId of [null, 'floor-1']) {
      const keys = navItemsFor(floorId).map((i) => i.key)
      expect(keys).not.toContain('automations')
      expect(keys).not.toContain('runs')
    }
  })

  it('produces no AUTOMAÇÃO group', () => {
    const labels = navGroupsFor('floor-1', 'Térreo').map((g) => g.label)
    expect(labels.some((l) => /AUTOMA/i.test(l))).toBe(false)
  })
})

describe('the CONTROLE group', () => {
  it('carries Execuções, on every floor and with none selected', () => {
    for (const floorId of [null, 'floor-1']) {
      const executions = navItemsFor(floorId).find((i) => i.key === 'executions')
      expect(executions).toBeDefined()
      expect(executions?.label).toBe('Execuções')
      // Building-wide: the path never depends on the active floor.
      expect(executions?.path(floorId)).toBe('/executions')
    }
  })

  it('is its own group, after the existing ones', () => {
    const groups = navGroupsFor('floor-1', 'Térreo')
    // Canais and Conversas became pages of the Chat Web / WhatsApp Apps, so the
    // static communication group is gone: those entries are built at runtime from
    // the account's active Apps and the user's pins.
    //
    // RECURSOS entrou entre os dois: "o que o escritório possui" é uma pergunta
    // diferente de "o que aconteceu", e elas estavam no mesmo grupo.
    // COMUNIDADE entrou por último quando o Marketplace passou a existir: ela é a única
    // camada que traz coisa de terceiro para dentro, e a distância na lista é a mesma
    // distância que a cabeça de quem usa faz.
    expect(groups.map((g) => g.group)).toEqual(['operation', 'resources', 'control', 'community'])
    expect(groups.find((g) => g.group === 'control')?.label).toBe('OPERAÇÕES')
    expect(groups.find((g) => g.group === 'resources')?.label).toBe('RECURSOS')
  })

  it('COMUNIDADE aparece porque a tela existe — e aponta para ela', () => {
    // A regra não mudou: um item de menu que leva a uma tela inexistente promete e não
    // entrega. O que mudou é que a tela existe, e a rota é conferida aqui.
    const grupos = navGroupsFor('floor-1', 'Térreo')
    const comunidade = grupos.find((g) => g.group === 'community')
    expect(comunidade?.label).toBe('COMUNIDADE')
    expect(comunidade?.items.map((i) => i.path(null))).toEqual(['/community'])
  })

  it('carries Apps, the account-wide catalogue', () => {
    const apps = navItemsFor(null).find((i) => i.key === 'apps')
    expect(apps?.path(null)).toBe('/apps')
    expect(apps?.scope).not.toBe('floor')
  })

  it('no longer hard-codes the channel surfaces', () => {
    const keys = navItemsFor('floor-1').map((i) => i.key)
    expect(keys).not.toContain('channels')
    expect(keys).not.toContain('conversations')
  })

  it('is not floor-scoped, so it never renders disabled without a floor', () => {
    const executions = navItemsFor(null).find((i) => i.key === 'executions')
    expect(executions?.scope).not.toBe('floor')
  })

  it('stays lit on its own page', () => {
    const executions = navItemsFor(null).find((i) => i.key === 'executions')!
    expect(isNavActive(executions, null, '/executions')).toBe(true)
    expect(isNavActive(executions, null, '/agents')).toBe(false)
  })
})

// Desktop rail, mobile drawer and the bottom bar all read THIS module — a
// destination that exists on one surface and not the others is the bug this guards.
describe('one configuration feeds every surface', () => {
  it('the same item set is produced whatever the caller', () => {
    const grouped = navGroupsFor('floor-1', 'Térreo').flatMap((g) => g.items.map((i) => i.key))
    expect(grouped).toEqual(navItemsFor('floor-1').map((i) => i.key))
  })

  it('Execuções is reachable on a phone', () => {
    const executions = navItemsFor(null).find((i) => i.key === 'executions')
    expect(executions?.mobilePrimary).toBe(true)
  })
})
