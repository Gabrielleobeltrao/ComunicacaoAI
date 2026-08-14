# Commands

Two npm workspaces (`frontend`, `backend`) under one root `package.json`. Run root scripts from the
repo root; run a single workspace's script with `-w frontend` / `-w backend`.

## Root

| Task | Command |
|---|---|
| Dev (both workspaces at once) | `npm run dev` |
| Build everything (frontend then backend) | `npm run build` |

## Backend (`-w backend`)

| Task | Command |
|---|---|
| Dev (API + worker) | `npm run dev -w backend` |
| Dev API only | `npm run dev:api -w backend` |
| Dev worker only | `npm run dev:worker -w backend` |
| Typecheck | `cd backend && npx tsc --noEmit` |
| Build (emits `dist/`) | `npm run build -w backend` |
| Test (node:test over `dist/`) | `npm run build -w backend && npm test -w backend` |
| Start API (prod) | `npm run start:api -w backend` |
| Start worker (prod) | `npm run start:worker -w backend` |

Backend tests are pure `node --test test/*.test.mjs` over compiled `dist/` — **build first**. They set a
dummy `MONGODB_URI` so the lazy Mongo client never connects; keep new tests IO-free (inject deps).

## Frontend (`-w frontend`)

| Task | Command |
|---|---|
| Dev | `npm run dev -w frontend` |
| Typecheck | `cd frontend && npx tsc -b --noEmit` |
| Lint (oxlint) | `npm run lint -w frontend` |
| Build (`tsc -b && vite build`) | `npm run build -w frontend` |
| Unit tests (vitest) | `npm test -w frontend` |
| E2E (Playwright, guarded) | `npm run test:e2e -w frontend` |
| Preview built app | `npm run preview -w frontend` |

E2E specs live in `frontend/e2e/` and self-skip unless their env guard is set (e.g. `E2E_PIVOT=1`,
`E2E_NAV=1`) with a running stack — so the default suite stays green without that infra.

## Full local stack (Mongo + Redis + worker)

| Task | Command |
|---|---|
| Dev stack | `docker compose -f compose.dev.yml up` |
| Production-like validation | `docker compose -f compose.production-test.yml up` |

The worker (BullMQ) is a **separate process** from the API — automations/rotinas only execute when a
worker is running.
