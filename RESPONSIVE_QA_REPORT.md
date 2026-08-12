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

## Findings and fixes

_Per-phase findings, fixes and evidence are appended as each phase completes._

## Verification

_Final commands + results recorded here at the end._

## Limitations

_Recorded at the end._
