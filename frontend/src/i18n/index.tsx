import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { pt } from './pt'
import type { TranslationKey } from './pt'
import { en } from './en'

// A deliberately small i18n layer instead of a library: two locales, string
// interpolation and plurals. The one genuinely hard part — which plural form a
// language uses — is answered by Intl.PluralRules, which the platform already
// ships, so there are no rules to encode and no dependency to carry.
//
// Keys are typed from the Portuguese dictionary, so `t('nope')` does not compile
// and a locale missing a key fails the build.

export const LOCALES = ['pt', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const LOCALE_LABEL: Record<Locale, string> = { pt: 'Português', en: 'English' }

const DICTIONARIES: Record<Locale, Record<string, string>> = { pt, en }

// Full IETF tags for Intl (plurals, and anything else formatting-related).
const INTL_TAG: Record<Locale, string> = { pt: 'pt-BR', en: 'en-US' }

const STORAGE_KEY = 'comunicacaoai.locale'

const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v)

// Saved choice first, then the browser, then Portuguese. Never throws: a locked
// down browser with no localStorage must still render.
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    /* storage unavailable — fall through to detection */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : ''
  return nav.toLowerCase().startsWith('en') ? 'en' : 'pt'
}

export interface TranslateOptions {
  // Selects the `_one` / `_other` variant AND is available as {{count}}.
  count?: number
  [param: string]: string | number | undefined
}

// Exported for tests and for the rare non-React call site.
export function translate(locale: Locale, key: TranslationKey, options: TranslateOptions = {}): string {
  const dict = DICTIONARIES[locale] ?? DICTIONARIES.pt
  let lookup: string = key

  if (typeof options.count === 'number') {
    const category = new Intl.PluralRules(INTL_TAG[locale]).select(options.count)
    // 'one' and 'other' cover pt/en; any other category falls back to 'other'.
    const candidate = `${key}_${category}`
    const fallback = `${key}_other`
    lookup = dict[candidate] !== undefined ? candidate : dict[fallback] !== undefined ? fallback : key
  }

  // Portuguese is the source, so it is also the fallback for a locale that somehow
  // lacks the key at runtime. Showing the key itself is the last resort — visible,
  // never blank.
  // A plural base used without a count still resolves, to the `_other` form.
  const template = dict[lookup] ?? dict[`${lookup}_other`] ?? DICTIONARIES.pt[lookup] ?? DICTIONARIES.pt[`${lookup}_other`] ?? lookup

  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    const value = options[name]
    return value === undefined ? whole : String(value)
  })
}

interface I18nValue {
  locale: Locale
  setLocale: (next: Locale) => void
  t: (key: TranslationKey, options?: TranslateOptions) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? detectLocale())

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* a preference that cannot be persisted still applies to this session */
    }
    if (typeof document !== 'undefined') document.documentElement.lang = INTL_TAG[next]
  }, [])

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: (key, options) => translate(locale, key, options) }),
    [locale, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// Outside a provider (a stray render, a test) the hook still translates, in the
// detected locale — a missing provider must never blank the UI.
export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  const fallbackLocale = ctx ? ctx.locale : detectLocale()
  const fallback = useMemo<I18nValue>(
    () => ({ locale: fallbackLocale, setLocale: () => undefined, t: (key, options) => translate(fallbackLocale, key, options) }),
    [fallbackLocale],
  )
  return ctx ?? fallback
}

// The common case: `const t = useT()`.
export const useT = () => useI18n().t
