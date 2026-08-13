# AI Building — UX / Navigation Reorganization Report

Implementation of `AI_BUILDING_UX_NAVIGATION_REORGANIZATION_PLAN.md`. All work
landed on branch `development`; no push to `main`, no deploy, no production change.

## Outcome

The pivot UX now reads as a clear hierarchy — **Prédio → Andar → módulos** — with
the URL as the single source of truth for the active floor:

- One **building dashboard** (`/dashboard`): cross-floor KPIs + per-floor cards.
  The parallel *Prédio / Escritório / Andar* destinations are gone.
- Each **floor** owns its visual office map plus its agents, sectors, automations,
  runs and artifacts, all scoped by `officeId === floorId`.
- A **grouped, floor-aware sidebar** (GERAL · ANDAR · COMUNICAÇÃO) with a building
  switcher; a mobile bottom nav of **exactly 5 items** + a "Mais" drawer.
- Everything is behind the single flag `VITE_AI_BUILDING_ENABLED`
  (`featureFlags.aiBuilding`). Off → the original flat app is byte-for-byte
  unchanged, which is also the rollback.

## What changed, by phase

| Phase | Deliverable | Key commit |
|---|---|---|
| 1 | Backend floor-scoping of agents & sectors (list/create/serialize `floorId`) | `9a99d47` |
| 2 | `BuildingProvider` global context + canonical `/floors/:id/*` routes + legacy redirects | `c75e8af` |
| 3 | App shell: grouped floor-aware sidebar + `BuildingSwitcher` popover (desktop + mobile) | `b0d0b0b` |
| 6 | Child pages read `floorId` from the URL and create on the selected floor | `4a8f326` |
| 5 | The visual office **is** the floor overview (`OfficeFloor` receives `floorId`; live overlay scoped) | `12d88ba` |
| 4 | Unified building dashboard: `GET /api/building/overview` + KPIs + floor cards | `9ef4e10` |
| — | Floor back-link points to the unified dashboard (no `/building` hop) | `8c09bb9` |
| — | `BuildingSwitcher` made rail-aware (collapse to avatar, expand on hover; drawer `expanded`) | `b0955db` |

### Backend

- `agents.ts` / `sectors.ts`: `listAgents/listSectors(ownerId, floorId?)` filter by
  `officeId` when a floor is given.
- `index.ts`: `scopedFloorId` (validates a client `floorId` via `getFloor` — ownership
  enforced) and `resolveFloorOffice` (scoped floor or the account default). `GET
  /api/agents` and `/api/sectors` honor `?floorId=`; POST creates on the resolved
  floor; both serialize `floorId`.
- `automations/metrics.ts`: `buildingOverview(ownerId)` aggregates all active floors
  into `totals` + per-floor counts in one owner-scoped call (no client N+1).
- `routes/buildingRoutes.ts`: `GET /api/building/overview`.

### Frontend

- `contexts/BuildingContext.tsx`: active floor = URL `:floorId` → saved → first active
  floor; `selectFloor` preserves the current module section.
- `pages/redirects.tsx` + `App.tsx`: canonical floor routes when V2; legacy flat paths
  `<Navigate replace>` into them (see the redirect map).
- `components/navConfig.ts`: one nav source → desktop sidebar, mobile drawer and bottom
  nav all derive from it; scopes `general | floor | communication`.
- `components/Sidebar.tsx`, `BuildingSwitcher.tsx`, `MobileNav.tsx`: grouped nav + switcher.
- `office/OfficeFloor.tsx`, `lib/useAgentStates.ts`, `pages/FloorView.tsx`: the map is
  the floor overview; the live overlay polls exactly the floor being viewed.
- `pages/Dashboard.tsx`, `lib/floors.ts`: unified building dashboard.

## QA evidence

Verified against the full stack running locally (frontend :5173, backend :4000,
worker + Redis up) with a seeded QA account (`qa-nav@local.test`) holding two floors:
**Vendas** (3 agents) and **Suporte** (2 agents).

### Automated checks

- Frontend: `tsc -b` clean · `oxlint` clean · **58/58** unit tests · production build OK.
- Backend: `tsc --noEmit` clean · **44 pass / 0 fail** (1 skipped) `node:test`.

### Live scoping (real API)

`GET /api/building/overview` → `totals: {floors:2, agents:5, ...}`, per-floor
`Vendas agents=3`, `Suporte agents=2`. `GET /api/agents?floorId=<Vendas>` returns only
the three Vendas agents — no cross-floor leakage.

### Screenshots (`docs/ux-nav/screenshots/`)

| File | Shows |
|---|---|
| `desktop-05-merged-home.png` | Floor home: **PRÉDIO** KPI strip + **ESTE ANDAR** scoped office map (the merged overview; no floor-switch buttons on the page) |
| `desktop-01b-sidebar-hover.png` | Expanded sidebar: switcher + ANDAR · VENDAS / COMUNICAÇÃO (no separate "Visão geral") |
| `desktop-02-floor-map.png` | The scoped office map + status/metrics tiles |
| `desktop-03-floor-agents.png` | Agents scoped to Vendas (3) + live status badges |
| `desktop-04-floor-automations.png` | Automations scoped to the floor |
| `mobile-01-dashboard.png` | Mobile floor home: PRÉDIO KPIs + map, bottom nav (4 items) |
| `mobile-02-drawer.png` | "Mais" drawer: full switcher + grouped nav + account footer |
| `mobile-03-floor-map.png` | Floor map on mobile |

### E2E

`frontend/e2e/nav-hierarchy.spec.ts` — hierarchy (dashboard is the overview, not the
map), URL-as-source-of-truth, per-floor agent scoping, legacy→canonical redirect.
Gated (`E2E_NAV=1` + two seeded floor ids), matching the existing guarded specs so the
default suite stays green without that infra. It is **not** marked passed while skipped.

## Constraints honored (plan §25)

Preserved intact: automation engine, chat, widget, WhatsApp, conversations, visual
simulation. Single flag for the atomic shell switch. Backend scoping fixed **before**
the shell. No parallel Prédio/Escritório/Andar destinations. Bottom nav ≤ 5. No agent
duplication. API errors are surfaced, not hidden as empty states. Mongo `offices`
collection and `officeId` field unchanged physically; no data moved or deleted. No
deploy, no production change, no push to `main`.

## Enable / rollback

`frontend/.env`: `VITE_AI_BUILDING_ENABLED=true` (already set locally), then restart
vite (flags are build-time). Rollback: set it false / unset and rebuild — the V1 app
returns unchanged. See `docs/ux-nav/redirect-map.md`.

## Post-plan change — overview merged into the floor home

Per user request, the separate *Visão geral* dashboard was merged into the floor
home: there are no longer two "overview" destinations. `/dashboard` now resolves to
the active floor; the floor home (`/floors/:id`) shows a compact **PRÉDIO** KPI strip
(building-wide totals) above the **ESTE ANDAR** section (map + floor data). Floor
switching is the sidebar building selector only — there are no floor-switch buttons on
the page. The `Visão geral` nav item was removed; the building overview component
survives only as the no-floor landing.

## Follow-ups (out of scope, noted)

- Sector **creation** floor-scoping via a `SectorForm floorId` (listing is already scoped).
- Dashboard "recent runs/artifacts" strip (endpoint aggregates counts; a feed is additive).
- Collapsed-rail group-label spacing is cosmetic (labels reveal on hover).
- QA account `qa-nav@local.test` + its seeded floors live in the dev Atlas DB; safe to
  delete whenever — isolated to its own owner, touches no other data.
