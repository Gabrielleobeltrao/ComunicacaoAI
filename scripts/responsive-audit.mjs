// Reusable responsive-audit tool: opens routes at a set of viewports, flags any
// accidental horizontal page overflow (scrollWidth > clientWidth), and saves a
// screenshot of each. Used to produce baseline "before" evidence and, later, the
// "after" evidence in docs/qa/responsive/.
//
// Usage:
//   node scripts/responsive-audit.mjs --base http://localhost:5173 \
//        --routes /,/login,/register --viewports 390x844,1440x900 --out /tmp/shots
//   optional: --auth email:pass  (logs in via /login before visiting routes)
//   optional: --prefix before-   (screenshot filename prefix)
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const BASE = arg('base', 'http://localhost:5173')
const ROUTES = arg('routes', '/').split(',').map((s) => s.trim()).filter(Boolean)
const VIEWPORTS = arg('viewports', '390x844')
  .split(',')
  .map((s) => s.trim())
  .map((s) => {
    const [w, h] = s.split('x').map(Number)
    return { w, h, label: s }
  })
const OUT = arg('out', '/tmp/responsive-shots')
const PREFIX = arg('prefix', '')
const AUTH = arg('auth', '')
const NAMES = arg('names', '') // optional comma list matching ROUTES for filenames

mkdirSync(OUT, { recursive: true })
const names = NAMES ? NAMES.split(',').map((s) => s.trim()) : []
const slug = (r, i) => names[i] || (r === '/' ? 'home' : r.replace(/^\//, '').replace(/[/:]/g, '-')) || 'root'

const browser = await chromium.launch()

async function login(ctx, email, pass) {
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' }).catch(() => {})
  // best-effort: fill the first email + password inputs and submit
  await p.fill('input[type="email"], input[name="email"]', email).catch(() => {})
  await p.fill('input[type="password"], input[name="password"]', pass).catch(() => {})
  await p.click('button[type="submit"]').catch(() => {})
  await p.waitForLoadState('networkidle').catch(() => {})
  await p.waitForTimeout(600)
  await p.close()
}

const results = []
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 })
  if (AUTH) {
    const [email, pass] = AUTH.split(':')
    await login(ctx, email, pass)
  }
  for (let i = 0; i < ROUTES.length; i++) {
    const route = ROUTES[i]
    const page = await ctx.newPage()
    let err = ''
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => (err = e.message))
    await page.waitForTimeout(700)
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      path: location.pathname,
    }))
    const overflow = m.sw > m.cw + 1
    const file = `${OUT}/${PREFIX}${slug(route, i)}-${vp.label}.png`
    await page.screenshot({ path: file }).catch(() => {})
    results.push({ route, landed: m.path, vp: vp.label, scrollW: m.sw, clientW: m.cw, overflowX: overflow, err })
    await page.close()
  }
  await ctx.close()
}
await browser.close()

let bad = 0
for (const r of results) {
  const flag = r.overflowX ? 'OVERFLOW-X' : 'ok'
  if (r.overflowX) bad++
  console.log(`${r.vp.padEnd(9)} ${String(r.route).padEnd(28)} -> ${String(r.landed).padEnd(24)} sw=${r.scrollW} cw=${r.clientW} ${flag}${r.err ? ' ERR:' + r.err.slice(0, 40) : ''}`)
}
console.log(`\n${results.length} checks, ${bad} with horizontal overflow. Screenshots in ${OUT}`)
process.exit(0)
