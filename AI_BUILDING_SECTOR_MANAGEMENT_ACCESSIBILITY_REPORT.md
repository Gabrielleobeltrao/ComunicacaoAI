# Accessible Sector Management — Delivery Report

Plan: `AI_BUILDING_SECTOR_MANAGEMENT_ACCESSIBILITY_PLAN.md` (Phases 0–9).
Branch: `development`. No deploy, no DNS/DB/auth/worker/queue/sprite changes.

## What shipped

Sector membership and floor placement are now managed **on the pages where they
belong** — the sector overview and the agent page — instead of a hidden
`/configuracao` route, and a sector can move between floors without losing its
identity, analytics or channels.

| # | Commit | Summary |
|---|--------|---------|
| 1 | `feat(sectors): manage agents from the sector overview` | Manage-agents dialog + membership plumbing (Phases 1–5) |
| 6 | `feat(sectors): assign an agent's sector from the agent page` | Agent-page sector card (Phase 6) |
| 7 | `feat(sectors): move a sector between floors` | Move preflight + commit + 3-step wizard, Checkbox a11y (Phase 7) |
| 8–9 | `test(sectors)…` | Dialog a11y, unit + e2e tests, this report (Phases 8–9) |

## Backend (authority — never trusts the URL/body floor)

- **Same-floor invariant** enforced in `resolveSectorMembers` and
  `assignAgentToSector`: a member agent must live on the sector's own floor, else
  `409 CROSS_FLOOR_ASSIGNMENT`.
- **`sectorMembership.ts`** — one place for agent↔sector association: keeps one
  sector per agent, normalizes the single default, compensates a partial failure
  so an agent is never left in two sectors.
- **Endpoints**
  - `PUT /api/agents/:id/sector` — assign/remove (`{sectorId}` or `null`).
  - `PUT /api/sectors/:id/members` — replace members (channel-impact guard).
  - `GET /api/sectors/:id/move-impact?targetFloorId=` — read-only preflight.
  - `POST /api/sectors/:id/move` — commit; re-validates the target floor and its
    members, drops the source-floor members (they **stay on the source floor**),
    updates `officeId` + `members` in one atomic document write. The sector keeps
    its `_id`, analytics and channels.
- **`officeId` is never physically migrated or renamed** — `floorId` is the
  serialized alias only. The agent overview now serializes `floorId` too.
- **Audit** (`scripts/auditSectorFloorIntegrity.ts`) is dry-run only; last run
  reported 0 issues across 13 sectors / 36 agents.

## Frontend

- **`SectorHero`** — reuses the live `SectorMapCrop` (same crop as the card) with
  name/floor/mode, a readiness badge, an `aria-label`'d image + `sr-only`
  sentence, and an actions slot.
- **`SectorAgentsDialog`** — add (same-floor, transfers out of any other sector
  with a "Sairá de X" hint) / remove (down to zero); server-refreshed, not
  optimistic; 10-member cap; pipeline note; `aria-live` status.
- **`AgentSectorAssignment`** — a "Setor" card on the agent page: floor (read-only)
  + a selector of that floor's sectors + "Sem setor" + "Abrir setor"; reports
  "Movido de X para Y".
- **`MoveSectorWizard`** — 3 steps (pick floor → review impact & staff from the
  target floor → confirm), triggered from the sector's configuration tab; handles
  the channel-impact `409` with an explicit confirmation.
- **Readiness** mirrors the backend rule so the badge and the wizard warning never
  disagree with what the API enforces.

## Accessibility & responsiveness (Phase 8)

- **`Checkbox`** now wraps a real (visually-hidden) native input → keyboard-operable
  (Space toggles) and announced by screen readers, with a focus ring on the visual
  box. Fixes **every** Checkbox in the app.
- **`Dialog`** now sets `aria-labelledby` to its title → dialogs are announced by
  name. Focus trap, `Esc`, and focus restoration were already provided by
  `useDialogA11y`.
- **Reduced motion** — the global rule (`base.css`) neutralizes animation/transition
  and `SectorMapCrop` pauses its simulation under `prefers-reduced-motion`.
- **320–768px** — hero stacks, dialogs cap at viewport width with an internal
  scroll and wrapping footer; verified **no horizontal overflow** at 320px on the
  hero, manage dialog, move wizard and agent card.

## Verification

**Automated tests**
- Backend `node --test`: **50 passed, 1 skipped** (guarded integration). New:
  `backend/test/sectors.test.mjs` locks `sectorReadiness` (adaptive/pipeline) and
  the `normalizeMembers` single-default invariant.
- Frontend `vitest`: **66 passed** (+2). New: `frontend/src/lib/sectors.test.ts`
  mirrors the readiness rule.
- E2E `frontend/e2e/sector-management.spec.ts` (guarded by `E2E_SECTORS`, seeds &
  deletes a throwaway sector): move wizard lands on the new floor; cross-floor
  member → `409 CROSS_FLOOR_ASSIGNMENT`; manage dialog opens with this-floor
  candidates; no 320px overflow. **4 passed** against the dev stack; **skipped** in
  the default suite so CI stays green without infra.

  Run: `E2E_SECTORS=1 npx playwright test sector-management` (frontend :5173 +
  backend :4000, QA account with ≥ 2 floors).

**End-to-end evidence** (`docs/sector-management/screenshots/`)
- Backend flows against Atlas: move-impact (Vendas→Suporte, agents stay / analytics
  preserved), cross-floor → 409, happy move → 200 on the new floor, same-floor →
  400 `SAME_FLOOR`, cleanup → 204.
- Agent card moved "Equipe Grande" → "QA Setor Suporte" and reverted.
- Wizard: `move-step1/2/3`, `move-done`; responsive `r320-*` at 320px.

## Constraints honored

No deploy · no DNS/DB/auth/worker/queue/sprite changes · `officeId` not migrated or
renamed · moving a sector never relocates its agents · `_id`/analytics/channels
preserved · one agent in at most one sector · backend is the floor authority · audit
is dry-run only · schema changes additive (`updatedAt`) · no secrets in the frontend.

## Not done (out of scope / deferred)

- Reordering pipeline stages or editing routing lives in the existing
  `configuracao` tab — unchanged here.
- The move wizard's per-agent "Sairá de X" hint is visual; the checkbox's
  accessible name is the agent name only (the hint is supplementary).
