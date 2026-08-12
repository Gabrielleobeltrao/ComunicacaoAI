# Local development — running the AI-building pivot end to end

The automation engine (queue/worker/scheduler) needs **MongoDB + Redis**. This
guide brings them up locally so the pivot features can run and be verified. It
touches nothing in production.

## 1. Bring up the infra

```bash
docker compose -f compose.dev.yml up -d      # MongoDB :27017, Redis :6379
docker compose -f compose.dev.yml ps
```

Stop later with `down` (keeps data) or `down -v` (wipes the Mongo volume).

## 2. Point the backend at it

In `backend/.env` (copy from `.env.example`):

```
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/comunicacaoai
REDIS_URL=redis://localhost:6379
BETTER_AUTH_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
# Turn pivot features on to see them:
AI_BUILDING_ENABLED=true
```

In `frontend/.env`:

```
VITE_API_URL=http://localhost:4000
VITE_AI_BUILDING_ENABLED=true
```

## 3. Run the stack

```bash
# API (also runs the idempotent boot migration: Building/Floor backfill)
npm run dev -w backend            # or: npm run dev:api -w backend (once added)

# Worker (automation runs) — added with the queue/worker phase
# npm run dev:worker -w backend

# Frontend
npm run dev -w frontend
```

The API boot migration is idempotent — first run backfills a Building + Floor for
each owner and preserves every `officeId`. Re-running changes nothing.

## 4. Wiring status (what runs today vs. next)

- **Runs now against this infra:** Building/Floor domain + APIs, the boot
  migration/backfill, and the automation **definition/validation/versioning**
  APIs (`/api/building`, `/api/floors`, `/api/automations`).
- **Next (needs this Redis up):** the BullMQ **queue + worker process** that calls
  the linear runner, Run/StepRun/Artifact persistence, scheduler reconciliation,
  and the email/Telegram delivery adapters. The runner logic itself is already
  implemented and unit-tested (`backend/src/automations/runner.ts`).

## 5. Verify

```bash
cd backend && npm run build && npm test        # 32 passing (pure/unit)
cd frontend && npx tsc -b && npm run lint && npx vitest run   # 58 passing
```
