# Responsive QA Report — ComunicacaoAI frontend

Mobile responsiveness audit, fixes and evidence. Scope: frontend only (no deploy,
no backend/API/DB change, no push/merge). Evidence images live in
[`docs/qa/responsive/`](docs/qa/responsive/).

## Baseline (Fase 0)

| Item | Value |
| --- | --- |
| Branch | `development` |
| HEAD at start | `6292e51` (Office Visual Simulation V2 — 13 local commits) |
| Audited base | `ee66325` |
| Local vs `origin/development` | ahead by 13, behind 0 (V2 work is **local, not pushed**) |
| Prior office work | preserved intact (working tree clean before this task) |

### Tooling
- Playwright `1.62.1` with chromium + webkit browsers already installed.
- Vitest for unit tests; oxlint for lint; `tsc -b` for typecheck.

### Baseline checks (green before this task)
- `npx tsc -b` — clean.
- `npm run lint -w frontend` (oxlint) — clean.
- `npx vitest run` — 8 files, 53 tests passing.
- `npm run build` (frontend + backend) — success.

### `index.html`
- `meta viewport` present and correct: `width=device-width, initial-scale=1.0` (does not disable user zoom). ✔

## Architecture (Fase 0 inventory)

Stack: React 19 + react-router v7 + **Tailwind v4** (config-less, CSS-first) + heavy
inline styles + CSS custom-property tokens (`src/styles/tokens/`) + better-auth.
Only **one** `@media` in the whole tree (`prefers-reduced-motion`); **no** `dvh/svh`,
**no** `env(safe-area-inset-*)`, fixed `--gutter-screen: 28px`, and `--hit-min: 44px`
is defined but never used.

Local QA account created via better-auth `/register` (`qa-responsive@local.test`).

### Routes

| Path | Component | Access |
| --- | --- | --- |
| `/` | Home | public |
| `/login`, `/register` | Login/Register (AuthScaffold — already responsive) | public |
| `/widget/:publicKey` | public embeddable chat | public |
| `/dashboard` | Dashboard (+ OfficeFloor map) | protected |
| `/agents`, `/agents/:id/:section` | Agents / AgentDetail | protected |
| `/setores`, `/setores/:id/:section` | Setores / SectorDetail | protected |
| `/widgets` | Canais (Widget/WhatsApp managers) | protected |
| `/chats` | Conversations (master-detail) | protected |
| `/settings` | Settings | protected |
| redirects | `/whatsapp→/widgets`, `/teams→/setores`; `*→/dashboard` | — |

### Top mobile blockers (baseline)

1. **`Sidebar.tsx`** — hover-only 72px rail, **no mobile nav at all** (icons only, labels
   never appear on touch). `AppLayout.tsx` is `flex h-screen overflow-hidden` with no
   small-screen branch. **#1 issue.**
2. **Topbar** (inline `<header>` in `AppLayout`) — title/subtitle/actions don't wrap
   correctly on phones; they stack and overlap the content (confirmed on the 390×844
   dashboard "before" shot).
3. **`AgentDetail.tsx`** — hard `minmax(0,300px) minmax(0,1fr)` two-column, no breakpoint.
4. **`ConversationsPanel.tsx`** — detail pane fixed `h-120` (30rem), doesn't track viewport.
5. **`Agents.tsx`** `minmax(300px,1fr)` + **`WidgetManager.tsx`** fixed `grid-cols-2` overflow
   on narrow phones; Dashboard search `Input` hard `width:220`.
6. **Cross-cutting** — no `dvh/svh`, no safe-area, fixed 28px gutter; `h-screen` on the shell
   and the public widget; two dialog impls with no focus-trap/scroll-lock.

### Baseline page-overflow audit (`scripts/responsive-audit.mjs`)

At 390×844 and 320×568, page-level `scrollWidth` mostly equals `clientWidth` — because the
shell is `overflow-hidden` (inner content scrolls, so page overflow is hidden, **not** a sign
of health). The one real page overflow: **`/` at 320px (sw 328 > cw 320)**. The real damage is
usability (nav + cramped/rigid layouts), visible in the "before" screenshots. Fixes below are
therefore verified by screenshots + structure, not by the page-overflow metric alone.

## Viewport matrix

Phones: 320×568, 360×800, 375×667, 390×844, 393×852, 412×915, 430×932, landscape 844×390.
Tablets: 768×1024, 820×1180, 1024×768 (landscape).
Desktop regression: 1280×720, 1440×900, 1920×1080.

## Findings and fixes (by area)

- **Foundation (Fase 1):** `viewport-fit=cover` (so iOS safe-area insets resolve);
  responsive `--gutter-screen` 16→20→28; `--safe-*` and `--bottom-nav-height`
  tokens; `img/video{max-width:100%}`; `body{overflow-wrap:break-word}`. This alone
  removed the one real page overflow (`/` at 320px).
- **App shell + mobile nav (Fase 2):** the hover-only 72px rail is hidden below `lg`
  and replaced by `MobileNav` — a fixed bottom bar (5 destinations, safe-area, 44px
  targets, `aria-current`) + a hamburger drawer (account, all destinations,
  Configurações, Sair) with scroll-lock, Escape/backdrop/nav close, `aria-modal`.
  `AppLayout` moved to `100dvh`, safe-area header padding, title/subtitle truncation
  (no more overlap), and bottom-nav clearance.
- **Shared dialogs + controls (Fase 8):** `ui/Dialog` and `components/Modal` share
  `useDialogA11y` (scroll-lock, Escape, focus-trap + restore, `role=dialog`/
  `aria-modal`); both are flex columns with a fixed header/footer + scrollable body,
  `90dvh`, safe-area padding, near-full-width on phones. Form controls forced to
  ≥16px on touch (no iOS focus-zoom). `Button`/`IconButton` carry `.ds-hit` → 44px
  min hit target on coarse pointers without changing desktop density.
- **Dashboard + office map (Fase 3):** topbar no longer overflows (search hidden
  <sm, hire button collapses to its icon); the map height is `clamp(340px,60dvh,
  560px)` and its layout aspect tracks the measured width AND height (rotation
  re-fits, no teleport); the map controls hit 44px on touch.
- **Listings + detail (Fase 4/5):** Agents grid `minmax(min(100%,300px),1fr)` +
  wrapping toolbar; AgentDetail's rigid two-column stacks below `lg` (profile above
  content); WidgetManager's fixed 2-col stacks below `sm`.
- **Conversations + public widget (Fase 6):** real master-detail on phones (list
  hides on select, back button; two columns on md+); detail pane `70dvh`; public
  widget uses `100dvh` with safe-area header/composer so the keyboard/address bar
  never hides the input.
- **Home / auth / settings (Fase 7):** already responsive (AuthScaffold is the good
  reference); the foundation removed the only overflow — no code change needed.
- **Touch/a11y/perf (Fase 9/10):** 44px targets via `.ds-hit`; icon-only buttons
  keep `aria-label`; nav uses `aria-current`; dialogs keyboard-trap + restore focus;
  `prefers-reduced-motion` preserved; no new resize listeners (existing
  `ResizeObserver` only), no duplicated mobile/desktop trees, no timer/observer leaks.

## Verification

- `npx tsc -b` — clean. `npm run lint -w frontend` (oxlint) — clean.
- `npx vitest run` — 8 files, **53 tests** pass (office suite unaffected).
- `npm run build` (frontend + backend) — success.
- `npm run test:e2e` (Playwright) — **10/10** pass: no horizontal overflow on public
  + protected routes @ 320/390/768/1440; mobile nav open→navigate→close + active
  state; office-map controls ≥44px on a touch context.

## Evidence

`docs/qa/responsive/` (390×844 unless noted; QA account uses a fake local e-mail —
no real data/keys/tokens): `home`, `login`, `public-widget`, `dashboard`,
`office-map`, `mobile-navigation` (drawer), `agents`, `agent-detail`, `sectors`,
`sector-detail`, `channels`, `conversations-list`, `settings`, plus
`dashboard-tablet-768x1024` and `dashboard-desktop-1440x900`. After the authorized
push these render inline on GitHub from this report's links.

## Limitations

- **`conversation-open` screenshot** not captured: it needs a live conversation with
  agent-generated messages, and the local QA agent has no model credentials to reply.
  The master-detail *behaviour* (open/back, `70dvh`) is covered by code + the panel
  structure; only that one populated screenshot is missing.
- Data-heavy subsections were audited structurally against a freshly-seeded QA
  account (one agent, one sector, one widget); some deep form subsections have no
  live data to populate on every tab.
- **Clean Linux `npm ci`:** everything passes on darwin; the lockfile records
  darwin-arm64 native binaries (esbuild / @tailwindcss/oxide / @oxlint), so a Linux
  CI would need those `linux-x64-gnu` variants generated on Linux (same caveat noted
  in the office plan). `@playwright/test` was added to the lockfile for the E2E suite.
- Pinch-to-zoom on the map was intentionally left out (buttons + Ctrl/Cmd-wheel
  remain); single-finger pan works. Fullscreen falls back to the in-app expanded map
  where the Fullscreen API is unavailable (iOS).
