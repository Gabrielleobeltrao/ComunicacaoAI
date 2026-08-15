import { describe, expect, it } from 'vitest'
import { translate, detectLocale, LOCALES } from './index'
import { pt } from './pt'
import { en } from './en'

describe('translate', () => {
  it('returns the string for the active locale', () => {
    expect(translate('pt', 'common.save')).toBe('Salvar')
    expect(translate('en', 'common.save')).toBe('Save')
  })

  it('interpolates named parameters', () => {
    expect(translate('pt', 'tools.deleteConfirm', { name: 'Consultar pedido' })).toContain('“Consultar pedido”')
    expect(translate('en', 'tools.deleteConfirm', { name: 'Lookup order' })).toContain('“Lookup order”')
  })

  it('leaves an unknown placeholder visible instead of printing "undefined"', () => {
    // A missing parameter is a bug to notice, not a word to invent.
    expect(translate('pt', 'tools.deleteConfirm')).toContain('{{name}}')
  })

  it('picks the plural form from the count, in both languages', () => {
    expect(translate('pt', 'tools.usedBy', { count: 1 })).toBe('Usada por 1 agente')
    expect(translate('pt', 'tools.usedBy', { count: 3 })).toBe('Usada por 3 agentes')
    expect(translate('en', 'tools.usedBy', { count: 1 })).toBe('Used by 1 agent')
    expect(translate('en', 'tools.usedBy', { count: 3 })).toBe('Used by 3 agents')
  })

  it('count 0 uses the plural form', () => {
    expect(translate('en', 'tools.usedBy', { count: 0 })).toBe('Used by 0 agents')
  })

  it('shows the key rather than a blank when a key is missing at runtime', () => {
    // Keys are typed, so this can only happen via untyped data; it must be visible.
    expect(translate('pt', 'nao.existe' as never)).toBe('nao.existe')
  })

  it('falls back to Portuguese for a locale that is somehow incomplete', () => {
    // Simulated by asking for a key through an unknown locale tag.
    expect(translate('xx' as never, 'common.save')).toBe('Salvar')
  })
})

describe('dictionaries', () => {
  it('English covers every Portuguese key, and adds none of its own', () => {
    const ptKeys = Object.keys(pt).sort()
    const enKeys = Object.keys(en).sort()
    expect(enKeys).toEqual(ptKeys)
  })

  it('no translation is left empty', () => {
    for (const [key, value] of Object.entries({ ...pt, ...en })) {
      expect(value.trim().length, `${key} is empty`).toBeGreaterThan(0)
    }
  })

  it('plural keys come in complete _one/_other pairs in both languages', () => {
    for (const dict of [pt, en] as Record<string, string>[]) {
      for (const key of Object.keys(dict)) {
        if (!key.endsWith('_one')) continue
        expect(dict[`${key.slice(0, -4)}_other`], `${key} has no _other`).toBeDefined()
      }
    }
  })

  it('every placeholder in Portuguese also exists in English', () => {
    const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort()
    for (const key of Object.keys(pt) as (keyof typeof pt)[]) {
      expect(placeholders(en[key]), `${key} placeholders differ`).toEqual(placeholders(pt[key]))
    }
  })
})

describe('detectLocale', () => {
  it('only ever returns a supported locale', () => {
    expect(LOCALES).toContain(detectLocale())
  })
})
