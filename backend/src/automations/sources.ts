// RSS/Atom parsing, normalization and deduplication for the source.rss step.
// Defensive, dependency-free bounded-regex extraction — not a full XML parser,
// but it never throws on malformed input (it just yields fewer items), which is
// the right posture for untrusted external feeds (plan §11.4).

export interface RssItem {
  title: string
  url: string
  publishedAt: string | null
  author: string | null
  snippet: string
  guid: string
}

const stripCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
const stripTags = (s: string) => s.replace(/<[^>]*>/g, '')
const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))

function clean(raw: string | null): string {
  if (!raw) return ''
  return decodeEntities(stripTags(stripCdata(raw))).trim()
}

function pick(block: string, tags: string[]): string | null {
  for (const tag of tags) {
    const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
    if (m) return m[1]
  }
  return null
}

// Atom links are <link href="..."/>; RSS links are <link>text</link>.
function pickLink(block: string): string {
  const atom = block.match(/<link[^>]*\shref=["']([^"']+)["'][^>]*\/?>/i)
  if (atom) return decodeEntities(atom[1]).trim()
  return clean(pick(block, ['link']))
}

export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = []
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? []
  for (const block of blocks) {
    const url = pickLink(block)
    const guidRaw = clean(pick(block, ['guid', 'id']))
    const title = clean(pick(block, ['title']))
    const snippet = clean(pick(block, ['description', 'summary', 'content'])).slice(0, 500)
    const author = clean(pick(block, ['dc:creator', 'author', 'name'])) || null
    const publishedAt = clean(pick(block, ['pubDate', 'published', 'updated', 'dc:date'])) || null
    const guid = guidRaw || url || `${title}|${publishedAt ?? ''}`
    if (!title && !url) continue // nothing usable
    items.push({ title, url, publishedAt, author, snippet, guid })
  }
  return items
}

// First occurrence wins, keyed by guid (falls back to url).
export function dedupeItems(items: RssItem[]): RssItem[] {
  const seen = new Set<string>()
  const out: RssItem[] = []
  for (const it of items) {
    const key = it.guid || it.url
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}

// Keep items published within the window. Items without a parseable date are
// kept (lenient) so feeds that omit dates aren't silently emptied; callers that
// need strictness can filter on publishedAt themselves.
export function filterByWindow(items: RssItem[], windowMs: number, now: number): RssItem[] {
  const threshold = now - windowMs
  return items.filter((it) => {
    if (!it.publishedAt) return true
    const t = Date.parse(it.publishedAt)
    return Number.isNaN(t) ? true : t >= threshold
  })
}
