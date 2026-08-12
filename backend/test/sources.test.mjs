// RSS parse/dedupe/window + template rendering (plan §11.4/§11.7). Pure.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { parseRssItems, dedupeItems, filterByWindow } = await import('../dist/automations/sources.js')
const { renderTemplate } = await import('../dist/automations/transform.js')

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Hello &amp; World</title><link>https://ex.com/a</link><guid>g1</guid><pubDate>Wed, 12 Aug 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>Corpo do item</p>]]></description></item>
<item><title>Duplicada</title><link>https://ex.com/b</link><guid>g1</guid><pubDate>Wed, 12 Aug 2026 07:00:00 GMT</pubDate></item>
<item><title>Antiga</title><link>https://ex.com/c</link><guid>g2</guid><pubDate>Sat, 01 Aug 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`

test('parseRssItems extracts, decodes entities and strips tags/CDATA', () => {
  const items = parseRssItems(RSS)
  assert.equal(items.length, 3)
  assert.equal(items[0].title, 'Hello & World')
  assert.equal(items[0].url, 'https://ex.com/a')
  assert.equal(items[0].guid, 'g1')
  assert.equal(items[0].snippet, 'Corpo do item')
})

test('dedupeItems collapses by guid (first wins)', () => {
  const items = dedupeItems(parseRssItems(RSS))
  assert.equal(items.length, 2) // g1 (x2) → 1, g2 → 1
  assert.equal(items[0].title, 'Hello & World')
})

test('filterByWindow keeps in-window + undated, drops known-old items', () => {
  const now = Date.parse('2026-08-12T10:00:00Z')
  const kept = filterByWindow(
    [
      { publishedAt: '2026-08-12T08:00:00Z' },
      { publishedAt: 'Sat, 01 Aug 2026 00:00:00 GMT' },
      { publishedAt: null },
    ],
    24 * 3600 * 1000,
    now,
  )
  assert.equal(kept.length, 2) // the recent one + the undated one; the Aug-01 one is dropped
})

test('renderTemplate substitutes known vars and fails on unknown ones', () => {
  assert.equal(renderTemplate('Olá {{ nome }}!', { nome: 'Ana' }), 'Olá Ana!')
  assert.throws(() => renderTemplate('{{ missing }}', {}), /Variável desconhecida/)
})
