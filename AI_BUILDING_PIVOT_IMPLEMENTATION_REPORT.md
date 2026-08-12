# AI Building Pivot — Implementation Report

Execution report for `AI_BUILDING_PIVOT_IMPLEMENTATION_PLAN.md`.

## 1. Git state

- **Base commit:** `6d4f809d1c3bfc5bc49e0ed725c13f68b0f2e10f` (matches the plan header; `origin/main` == base at start).
- **Final feature commit:** `c94807d` on branch **`development`** (not pushed; docs commits follow).
- **Branch deviation:** the plan suggested a dedicated branch; per the user's standing workflow ("keep work on `development`, push to `main` only on request") all pivot work is committed on `development`. Nothing was pushed, deployed, or run against production.

### Commits added (small, semantic)
| Commit | Scope |
| --- | --- |
| `909fa60` | chore(pivot): baseline + feature flags |
| `709201f` | feat(building): building/floor domain, backfill migration, scoped APIs |
| `a812040` | feat(floors): floor client, active-floor hook, accessible elevator |
| `d44bc8a` | feat(floors): building overview, floor route, elevator navigation |
| `6b7f689` | feat(runtime): generic agent execution layer (executeAgentTask) |
| `4e6504f` | feat(automations): definition domain, immutable versions, scoped APIs |
| `1c48e9b` | docs(pivot): plan + phase report |
| `4a23a01` | feat(sources): SSRF-safe http, RSS parsing, template steps |
| `703ae01` | feat(runner): linear runner (retry/timeout/cancel/continueOnError) |
| `7cc3dc3` | chore(dev): local Mongo+Redis compose, REDIS_URL config, runbook |
| `065b3a6` | feat(runs): durable queue, worker process, run persistence + APIs |
| `8e878e7` | feat(scheduler): recurrence→cron + BullMQ reconciler (tz/DST) |
| `e6a746b` | feat(connections): encrypted connections + email/Telegram delivery |
| `0a40d1c` | feat(automations-ui): automations list, editor and runs pages (gated) |
| `c94807d` | feat(webhook): signed webhook trigger endpoint (completes 3 triggers) |

## 2. Scope executed

Per the user's decision (this environment has **no running MongoDB, no Redis, no browser**), work proceeded through the phases that are verifiable by **build + typecheck + lint + pure unit tests**, stopping at the first hard infra blocker (Phase 4 / Redis). Everything is **additive and behind OFF-by-default flags** — chat, widget, WhatsApp, `officeId`, the office map and every existing route are untouched.

| Phase | Status | Notes |
| --- | --- | --- |
| 0 — Baseline + flags | ✅ Done | Baseline captured; 6 pivot flags added (OFF) |
| 1 — Building + Floors | ✅ Code complete | Backend domain + idempotent backfill + APIs; frontend data-layer + Elevator + Térreo/floor routes (gated). Runtime gate (two floors end-to-end) pending Mongo/browser. Map-per-floor scoping deferred to the live-status phase. |
| 2 — Generic runtime | ✅ Done | `executeAgentTask` additive over the existing provider dispatch; conversation path untouched |
| 3 — Automation domain | ✅ Backend done | Definition/version domain, per-type validators, immutable versioning, CRUD APIs. **Wizard UI deferred** (large, needs browser) |
| 4 — Queue + worker | ✅ Code done | Linear runner + **BullMQ queue** (idempotent enqueue by jobId) + separate **worker process** (`start:worker`) that executes runs with real adapters and persists Run/StepRun/Artifact; run APIs; graceful shutdown. Build-verified; a **guarded integration test** runs the idempotency check against Mongo+Redis when present. **Runtime verification pending your infra** (`compose.dev.yml`). |
| 5 — Sources + steps | 🟡 Core done | SSRF-safe http (per-hop redirect revalidation, byte/content-type caps), RSS parse/dedupe/time-window, transform.template — unit-tested and wired into the runner/worker; `delivery.send` currently records intent (real email/Telegram send is Phase 7) |
| 6 — Scheduler | ✅ Code done | Pure recurrence→cron (unit-tested) + BullMQ Job-Scheduler reconciler (add/remove diff, stable id, BullMQ owns cron+tz/DST); worker reconciles on startup + every 60s and creates one run per fire (idempotent by automationId+timestamp). Runtime needs Redis. |
| 7 — Connections + deliveries | ✅ Code done | Encrypted Connections domain (AES via existing crypto, API never returns secrets) + email (nodemailer) & Telegram adapters (injectable IO, pure mask/chunk unit-tested) + idempotent Delivery persistence wired into the worker's delivery.send. Live SMTP/Telegram send needs credentials to verify. |
| 3 — Automation UI | ✅ Code done | Automations list + structured linear editor (trigger, per-type steps, result format; save/validate/publish/activate/run surfacing backend issues) + Runs list with step timeline + cancel. Gated by `aiAutomations`, build/lint verified. Browser verification pending. |
| 8 — Dashboard / live map | 🟡 Partial | Runs UI done; operational dashboard tiles + live-map overlay pending (browser). |
| 9 — Channels reframe | 🟡 Light | "Canais" nav grouping already present; the deeper agent conversation-settings reorg is deferred (touches the live agent UI, needs browser). |
| 10 — Hardening + docs | 🟡 Partial | Architecture doc (`docs/architecture/automation-pivot.md`) + local-dev runbook + rollback notes done; full E2E + prod-copy migration rehearsal pending infra. |

## 3. Files created / changed

**Backend (new):** `src/building.ts`, `src/floors.ts`, `src/agentRuntime.ts`, `src/net/safeHttp.ts`, `src/routes/{http,buildingRoutes,floorRoutes,automationRoutes}.ts`, `src/automations/{types,validate,repository,service,sources,transform,runner}.ts`, `test/{floors,agentRuntime,automations,safeHttp,sources,runner}.test.mjs`.

**Backend (edited):** `src/config.ts` (feature flags), `src/migrate.ts` (idempotent building/floor backfill + indexes), `src/index.ts` (mount `/api/building`, `/api/floors`, `/api/automations`), `.env.example` (flags).

**Frontend (new):** `src/featureFlags.ts`, `src/lib/floors.ts`, `src/lib/useFloors.ts`, `src/components/Elevator.tsx`, `src/pages/Building.tsx`, `src/pages/FloorView.tsx`, `src/lib/__tests__/floors.test.ts`.

**Frontend (edited):** `src/components/navItems.ts` (gated Prédio entry), `src/App.tsx` (gated routes), `.env.example` (public flags).

Domain code follows the plan's separation rule (rule 14): distinct type/repository/service/route modules — nothing added to a monolith.

## 4. Migrations

An idempotent boot backfill was added to `runMigrations()`:
- `ensureDefaultBuilding(ownerId)` per owner (unique index on `ownerId`);
- evolves each `offices` document into a Floor-shaped one (`buildingId`, `mission`, `description`, `timezone`, `defaultLanguage`, `color`, `icon`, `order`, `status`, `updatedAt`) — **every field guarded by `$exists:false`, so a re-run makes zero changes**;
- preserves `_id`, so existing agents/sectors (which reference `officeId`) keep working with **no physical `offices → floors` migration** (deliberate, per plan §7);
- creates indexes for buildings, floors, automations, and the unique `automation_versions(automationId, version)`.

**Not executed:** no MongoDB is available here, so the migration was **not run** and the dry-run/inventory + before/after count validation (plan §18) are **pending a test database**. The code is idempotent and additive by construction.

## 5. Tests & results (exact)

Run with `npm run build` first (suites consume `dist`).

- **Backend:** `node --test` → **44 passed / 0 failed / 1 skipped** — config (5), floors/timezone (2), generic runtime (7), automation validation + hashing (6), SSRF guard (3), RSS/template (4), linear runner (5), recurrence→cron (4), delivery adapters (5), webhook HMAC (3). The skipped one is the **run-idempotency integration test**, which runs only when `MONGODB_URI` + `REDIS_URL` are set (against `compose.dev.yml`).
- **Frontend:** `vitest run` → **58 passed / 0 failed** (9 files) — baseline 55 (office 51 + others) + `resolveActiveFloor` (3).
- **Lint:** `oxlint` clean. **Typecheck:** `tsc -b` clean (frontend + backend).

**Pending infra (documented, not skipped):** DB integration (backfill idempotency, CRUD, cross-owner isolation, publish/version against Mongo), the two-floor end-to-end gate, worker/queue, scheduler, E2E, and browser/responsive verification of the new screens. These need Mongo + Redis + a browser.

## 6. Feature flags (all OFF)

| Flag (backend `AI_*` / frontend `VITE_AI_*`) | Gates |
| --- | --- |
| `BUILDING_ENABLED` | Prédio nav entry + `/building` and `/floors/:id` routes |
| `FLOORS_ENABLED` | reserved for floor-scoped listings |
| `AUTOMATIONS_ENABLED` | reserved for automation UI |
| `SCHEDULER_ENABLED` | reserved (Phase 6) |
| `DELIVERIES_ENABLED` | reserved (Phase 7) |
| `OFFICE_LIVE_STATUS_ENABLED` | reserved (Phase 8) |

Backend APIs are mounted unconditionally (auth + ownership enforced); the flags gate only the frontend presentation, so nothing incomplete is user-visible until a flag is turned on.

## 7. Key decisions & deviations

- **Additive generic runtime.** `executeAgentTask` reuses `llm.generateAgentReply` (shared provider loop/caching/token accounting) with all attendance instructions empty, instead of refactoring `generateAgentReply` to delegate. This preserves the working chat with no runtime way to verify equivalence here; the deeper refactor is deferred.
- **Floors alias the `offices` collection** (`floorId === officeId`); no destructive rename now (plan §7).
- **Worked on `development`** (user workflow), not a dedicated branch.
- **Wizard UI + map-per-floor scoping deferred** — both need browser verification and touch live UI; the data layer + elevator + gated pages are in place.
- **JSON Schema validation** of structured output is limited to `JSON.parse` (+ typed validation error); full schema enforcement is a later addition.

## 8. Known limitations / risks

- No runtime proof of any gate in this environment (no Mongo/Redis/browser). Rule 8 respected: nothing is claimed as runtime-verified that was not executed.
- `maxToolIterations` is not injected into the provider loop; the provider's internal tool-call cap applies (documented for Phase 4).
- The migration must be run + validated (dry-run + counts + rollback rehearsal) against a **copy** of production data before any real deploy.

## 9. Pending deploy steps (not performed)

- Add a **Redis** resource (private) and a **worker** process (same backend image, worker command) — Phase 4.
- Add `REDIS_URL`, concurrency/timeout/limit envs, and the pivot flags to the Coolify apps; secrets stay runtime-only; no credential in a frontend build arg.
- Distinct healthchecks for API vs worker.
- Nothing here was pushed to `main` or deployed.

## 10. Global acceptance checklist (progress)

- [x] Building/Floor exist as real scopes (backend) with gated UI.
- [x] Legacy owner keeps data (backfill is additive, `_id` preserved) — **pending execution against Mongo**.
- [x] No destructive `officeId` swap.
- [x] Generic runtime carries no attendance language (unit-tested).
- [x] Chat/widget/WhatsApp untouched (additive only).
- [x] Automation has draft, validation, publish and immutable version (backend + unit tests).
- [x] Run occurs on a separate worker (BullMQ), does not block HTTP, graceful shutdown — **code done**; restart-survival verification pending your Redis.
- [x] Manual run with idempotency (unique `ownerId+idempotencyKey` + jobId dedup) — code done + guarded integration test. Schedule/webhook triggers — Phase 6/backend hooks pending.
- [x] RSS/HTTP with SSRF, per-hop redirect revalidation, byte/content-type limits, untrusted-content handling — logic done + unit-tested (execution via worker pending).
- [ ] Artifacts persistence, email/Telegram, retry idempotency — Phase 5–7 (runner retry logic done; delivery adapters + Mongo persistence pending).
- [ ] Operational vs conversational dashboard split — Phase 8.
- [x] All queries apply ownership (building → floor → automation) in the code paths added.
- [x] No secret in any response/log/bundle/report added.
- [x] Migrations idempotent + additive (dry-run/backfill code present; execution pending).
- [ ] 320px→desktop verification of new screens — needs browser.
- [x] Builds, lint, unit tests pass; integration/E2E pending infra.
- [ ] Docker/deploy docs cover API + worker + Redis — pending Phase 4.
- [ ] README repositioned — pending later phase.

## 11. How to verify locally

```bash
# Backend
cd backend && npm run build && npm test        # 20 passing
# Frontend
cd frontend && npx tsc -b && npm run lint && npx vitest run   # 58 passing
```

To exercise the new domain end-to-end, provide a MongoDB (set `MONGODB_URI`), start the API, enable `AI_BUILDING_ENABLED`/`VITE_AI_BUILDING_ENABLED`, and the boot migration will backfill Building/Floor on first run.
