# AI Building — Mobile Visual Parity Report

Implementation of `AI_BUILDING_MOBILE_VISUAL_PARITY_PLAN.md`. All work landed on
branch `development`; **no deploy**, no DNS/DB/auth/worker/queue changes, no secrets
added.

- Baseline commit: `2cb1e48` (audited by the plan).
- Final commit: `4ba8f83`.
- Work branch: `development` (== `origin/main` at start; the user's established flow).

## Outcome

On a phone the hierarchy now reads **Prédio → Andar → módulos**, and the action that
defines the whole product — switching floors — is **one tap from the topbar** on any
floor route, instead of buried two levels deep in a drawer popover. Critically, the
production Docker build now inlines the nav-V2 feature flags, so the deployed mobile
app stops showing the old flat UI on current code.

## Commits

| Commit | What |
|---|---|
| `c6a3c9f` | Canonical floor routes (`lib/floorRoutes.ts` + `switchFloorPath`, unit-tested) + `useActiveFloorId()`; every card/detail/tab/post-delete nav stays on the URL floor; `BuildingContext` guards invalid floor URLs; Runs reloads on floor change and shows real errors. |
| `0c14b8b` | One-tap floor switcher: `MobileFloorTrigger` (topbar) + `MobileFloorPicker` (bottom sheet with states, focus trap, safe-area); drawer's desktop popover replaced by an "Andar atual" block + "Trocar de andar" button; only one overlay interactive at a time. |
| `0dc45d6` | Stable 5-slot bottom nav (Andar · Agentes · Setores · Automações · Mais), URL-driven active state, `shortLabel`, fits 320px. |
| `34071cd` | Dockerfile passes the six public AI flags as build ARG/ENV (defaults match the validated UX); `.env.production.example` documents them. |
| `4ba8f83` | Hire button collapses to icon-only on narrow topbars so the floor context + title never collide. |

## Navigation model (mobile)

```
Prédio / conta
└── Andar ativo            ← topbar trigger "● <Andar> ▾"  →  bottom sheet
    ├── Visão do andar (mapa)
    ├── Agentes
    ├── Setores
    ├── Automações
    └── Execuções
Áreas globais: Canais · Conversas · Configurações   (drawer)
Bottom nav: Andar · Agentes · Setores · Automações · Mais
```

## Route/scoping fixes (Phase 1)

- `lib/floorRoutes.ts`: `floorHome/Agents/Agent/Sectors/Sector/Automations/Automation/Runs` + `parseFloorPath` + `switchFloorPath` (keep the module, drop detail ids, land globals on the floor home). Unit-tested (`floorRoutes.test.ts`).
- Replaced hand-written route strings in `Automations`, `AutomationEditor`, `Runs`, `AgentDetail` (colleagues, tabs, delete), `SectorDetail` (members, delete), `AgentCard`, `SectorManager`.
- `BuildingContext`: `selectFloor` derives from `switchFloorPath`; an invalid/foreign/archived floor URL is replaced (`replace`) with the active floor, keeping the module.
- `Runs`: reloads when the URL floor changes; a load failure is an error state with retry, never a false empty.

## Build parity (Phase 6) — the deploy fix

`frontend/Dockerfile` now declares `VITE_AI_BUILDING_ENABLED` (+ FLOORS/AUTOMATIONS/
SCHEDULER/DELIVERIES/OFFICE_LIVE_STATUS) as `ARG` → `ENV` in the build stage, defaults
matching the validated app (V2 on; FLOORS off, as locally). **Set these as BUILD
variables in Coolify** (not runtime — Vite inlines `VITE_*` at build time; a runtime
env cannot change an already-built bundle). None is a secret.

Verified with a production build supplying the flags only via `process.env` (no `.env`):
the `VITE_AI_BUILDING_ENABLED` identifier is **absent** from the bundle (replaced), a
flag-off build inlines no `true`, `VITE_API_URL=` yields relative `/api` — the same
mechanism `VITE_API_URL` already uses — and deep floor routes serve the SPA (no 404).

## QA evidence

Verified against the running dev stack with a QA account (two floors: Vendas / Suporte,
distinct agents).

- Automated: `tsc -b` clean · `oxlint` clean · **64/64** unit tests (incl. 6 new `floorRoutes`) · production build OK.
- Floor switch (iPhone 13 emulation): topbar trigger visible → sheet opens → picking Suporte from **Vendas/Agentes** lands on **Suporte/Agentes** (URL changes, module preserved).
- 320px floor home: no horizontal overflow; 5-slot bottom nav; floor name + module title fully visible.
- Screenshots in `docs/mobile-parity/screenshots/` (`mobile-parity-floor-picker`, `-drawer`, `-floor-view`, `-agents`, `-320-topbar`, `-320-bottomnav`) and baseline in `docs/mobile-parity/baseline/`.
- E2E: `frontend/e2e/mobile-parity.spec.ts` (login→floor, one-tap switch, per-floor agent scoping, 320px overflow), guarded by `E2E_MOBILE=1` + two seeded floor ids, matching the existing specs so the default suite stays green.

## Acceptance criteria status (§15)

Met: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15 (map native pan/zoom/pause/labels
from commit `2cb1e48`), 19, 20 (URL governs; `useFloors` remains only a legacy-flat
fallback), 21, 22, 23 (mechanically verified), 24, 25, 26.

## Responsive audit (§9)

Every screen was swept at **320px** (automations, runs, agent detail, sector detail,
channels, conversations, settings) — **zero horizontal overflow on all of them**
(measured `scrollWidth − clientWidth === 0`); screenshots in `docs/mobile-parity/audit/`.
Fixes applied from the sweep:

- Detail badges (sector mode / agent count) that were in `titleExtra` and hidden by
  the topbar's `sm:hidden` now show **below the title on phones** (§9.7).
- Automation editor fields are full-width (`width:100%`); the automations create row
  (name + Criar) wraps/stacks on very narrow widths (§9.5).
- Hire button is icon-only on narrow topbars (§8.2).

## Remaining (honest status)

Core goals (§4, §19) and the responsive constraint (no overflow) are delivered. Still
open, all minor:

- Polish only: a tab-scroll continuity fade on detail tabs (§9.7) and the conversation
  composer verified with seeded data (§9.9) — the empty states are clean at 320px.
- §14.3 full Playwright matrix (17 scenarios × 6 viewports): a core mobile spec is in
  place (`mobile-parity.spec.ts`); the exhaustive matrix is not fully scripted.
- `useFloors()` in `Automations` stays a V1-flat fallback (V2 is governed by the URL
  floor); a full migration is a follow-up if V1 is retired.

## Rollback

Revert this range (`2cb1e48..4ba8f83`), or disable `VITE_AI_BUILDING_ENABLED` and
**rebuild** the frontend (a runtime flag change is not an effective Vite rollback).

**No deploy was performed.**
