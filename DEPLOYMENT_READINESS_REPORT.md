# Deployment Readiness Report — ComunicacaoAI

Preparation for a future VPS/Coolify deploy: containerize and separate frontend
and backend so each is independently installable/buildable. **No** deploy, DNS,
domain, SSL, remote-repo creation, push or merge is performed here. All prior work
(Office Visual Simulation V2 + mobile responsiveness) is preserved.

> **Correction (worker/Redis gap — resolved).** Earlier phases describe production
> as two services, then briefly as four. The history matters because it cost real
> behaviour: the backend image defaulted to the API only, so a deploy that created
> just the backend served HTTP while the automation worker never existed — the
> database showed 3 active scheduled routines and **zero runs ever**.
>
> The fix was not more resources but fewer moving parts. BullMQ and Redis were
> removed: the `automation_runs` collection IS the queue (claimed with one atomic
> `findOneAndUpdate`), each automation carries its own `nextRunAt`, and the engine
> runs inside the API process. Production is **two** resources again — frontend and
> backend — and a deployment whose routines never fire is no longer expressible.
> See `COOLIFY_DEPLOYMENT.md`.

## Fase 0 — Local audit (baseline)

| Item | Value |
| --- | --- |
| Branch | `development` |
| HEAD at start | `86e96a9` |
| Local vs `origin/development` | ahead by 23, behind 0 (office V2 + responsive are **local, not pushed**) |
| Working tree at start | clean except the untracked plan file — prior work preserved |
| Node / npm | v22.17.1 / 10.9.2 (no `engines` pinned; images fix Node 22) |
| Workspaces | root npm workspaces: `frontend`, `backend` |
| Lockfiles | was single root `package-lock.json`; per-service locks added in Fase 3 |
| Dockerfiles/compose | none at start; added here |

### Build/run commands
- **frontend:** `dev` = `vite`; `build` = `tsc -b && vite build` → `dist/`; static SPA. `lint` = `oxlint`; `test` = `vitest run`; `test:e2e` = `playwright test`.
- **backend:** `dev` = `tsx watch src/index.ts`; `build` = `tsc` → `dist/`; `start` = `node dist/index.js`; `test` = `node --test test/*.test.mjs` (added here).

### Environment constraint
- **Docker/Podman unavailable** in this environment (no daemon). Image builds and
  the production-like compose are authored and documented but **not executed
  here**; all non-Docker verification is run (see Fase 15).

## Fase 1 — Architecture & dependency inventory

| Attribute | Frontend | Backend |
| --- | --- | --- |
| Runtime | Static SPA (built with Vite/React 19/TS) | Node 22 + Express 5 (ESM, NodeNext) |
| Internal port | 8080 (nginx-unprivileged) | 4000 (`PORT`) |
| Build command | `npm ci && npm run build` (`tsc -b && vite build`) | `npm ci && npm run build` (`tsc`) |
| Production command | nginx serves `dist/` | `node dist/index.js` |
| Liveness | `GET /healthz` (nginx) | `GET /api/health` |
| Readiness | n/a (static) | `GET /api/ready` (Mongo ping) |
| External deps | none at runtime (calls backend via `VITE_API_URL`) | MongoDB (Atlas), Anthropic/OpenAI/Voyage, Google OAuth (opt.), WhatsApp/Meta/Twilio providers (per-channel) |
| Persistent data | none | MongoDB only (stateless process — see Fase 10) |
| Required vars (prod) | `VITE_API_URL` (build-time) | `NODE_ENV`, `MONGODB_URI`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `CLIENT_URL`, `BETTER_AUTH_URL`, `PUBLIC_URL` |
| Optional vars | — | `PORT`, provider keys/models, `GOOGLE_*` |
| Public URL (definitive) | `https://comunicacaoai.oneplataforma.com` | `https://api.comunicacaoai.oneplataforma.com` |
| Callback integrations | — | Google OAuth redirect; WhatsApp inbound webhook (built from `PUBLIC_URL`) |

### Explicit audit (Fase 1 checklist)

- **MongoDB / database selection:** single shared `MongoClient(uri)` in
  `backend/src/db.ts`; `mongoClient.db()` with **no name argument**, so the DB
  name comes from the URI path. One client reused everywhere.
- **Better Auth, cookies, trusted origins:** `backend/src/auth.ts` — Mongo
  adapter; `baseURL` now set explicitly from `BETTER_AUTH_URL`; `trustedOrigins`
  is the `CLIENT_URL` allowlist; `cookiePrefix: comunicacaoai`. In production the
  cookie attributes are `SameSite=None; Secure` (cross-origin); dev keeps Better
  Auth defaults. Auth routes mounted **before** `express.json` (required).
- **CORS (HTTP):** single middleware. Private routes → exact allowlist
  (`config.clientOrigins`) with `credentials: true`. Public widget routes
  (`/api/public/*`) → reflect any origin, `credentials: false`.
- **Socket.IO / WebSocket CORS:** same allowlist as the private API, credentials
  on. `join-owner` authenticates via the session cookie in the handshake.
- **`credentials: include` (frontend):** the app calls the private API with
  cookies; served cross-origin from the backend in production.
- **Widget loader / third-party embedding:** `frontend/public/widget-loader.js`
  is served with a short cache; the SPA sets **no** `X-Frame-Options`/framing CSP
  so the widget stays embeddable on customer sites.
- **WhatsApp webhook URLs:** built as `${PUBLIC_URL}/api/whatsapp/<provider>/webhook/<channelId>` (index.ts). Requires a correct public backend origin.
- **Google OAuth redirect:** `GOOGLE_REDIRECT_URI` or, if unset,
  `${BETTER_AUTH_URL}/api/integrations/google/callback` (now via central config).
- **Uploads:** multer **memory** storage — documents ≤15 MB, avatars ≤2 MB
  (image MIME allowlist). Stored in MongoDB as base64; nothing hits disk.
- **Encrypted keys at rest:** `ENCRYPTION_KEY` (AES via `crypto.ts`) encrypts
  user-provided provider keys and integration tokens stored in MongoDB.
- **Automatic migrations on boot:** `runMigrations()` is awaited before
  `listen()`; idempotent (sector renames + office backfill). Atlas Vector Search
  index creation is fire-and-forget.
- **Graceful shutdown:** added — SIGTERM/SIGINT close HTTP + Socket.IO + Mongo
  with a 10s forced-exit backstop.
- **Payload/upload limits:** multer limits above; `express.json` default limit
  kept; raw body preserved for Meta signature verification.
- **External calls:** Anthropic, OpenAI, Voyage (RAG/embeddings), Google
  (Calendar), WhatsApp/Meta/Twilio (channel providers). All optional at startup.

## Fase 2 / 7 — URL contract & typed config

New `backend/src/config.ts` centralizes runtime config. The **definitive**
production origins (ASCII, no trailing slash) are now set:
- Frontend `https://comunicacaoai.oneplataforma.com`; backend
  `https://api.comunicacaoai.oneplataforma.com`. `VITE_API_URL` → backend origin;
  `CLIENT_URL` → frontend origin; `BETTER_AUTH_URL`/`PUBLIC_URL` → backend origin.
- URLs normalized (trailing slash stripped) in one place.
- **Fail-fast in production only**: `validateConfig()` requires `MONGODB_URI`,
  `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `CLIENT_URL`, `BETTER_AUTH_URL`,
  `PUBLIC_URL`, validates URL format + **https**. Error messages name the missing
  variable and **never** print its value.
- **No silent localhost fallback in production**; dev/test keep localhost
  defaults so `npm run dev` works with no `.env`.
- `CLIENT_URL` accepts a comma-separated allowlist (e.g. prod + localhost).

## Fase 8 — CORS, cookies & Better Auth (separate origins)

- Private CORS = exact allowlist with credentials; public widget CORS limited to
  `/api/public/*` without credentials; wildcard is never combined with
  credentials.
- Socket.IO uses the same allowlist; authenticated channels reject unknown
  origins.
- Better Auth `baseURL` + `trustedOrigins` wired to the config.

### Cookie decision — resolved by the definitive URLs

The final origins are `https://comunicacaoai.oneplataforma.com` (frontend) and
`https://api.comunicacaoai.oneplataforma.com` (backend). Both share the registrable
domain `oneplataforma.com`, so requests between them are **same-site** (the backend
host is even a subdomain of the frontend host).

- **Current setting works as-is:** in production Better Auth issues cookies with
  `SameSite=None; Secure`, which are sent on both same-site and cross-site
  requests over HTTPS — so login works with no further change once TLS is live.
- **Cookies are host-only** (no `Domain` attribute) on
  `api.comunicacaoai.oneplataforma.com`; every private API/Socket.IO call targets
  that host, so the cookie is always sent. The frontend never needs to read it
  (HttpOnly).
- **Optional tightening (post-deploy):** because the two are same-site, the
  cookie could be narrowed to `SameSite=Lax` (still sent on the same-site XHR).
  Not required; `None; Secure` is kept for robustness and future flexibility. No
  fictitious cookie `Domain` is set.
- Two-origin login/session/logout still needs a live check against the real URLs
  (and can be exercised now in the compose harness on localhost).

## Fase 9 — Health, readiness & graceful shutdown

- **Liveness** `GET /api/health` → `{status:"ok"}` (process up).
- **Readiness** `GET /api/ready` → Mongo `ping`; `200 {status:"ready"}` or
  `503 {status:"unavailable"}`. Leaks no URI/DB/credentials/stack trace.
- **Shutdown**: SIGTERM/SIGINT → `io.close()` → `httpServer.close()` →
  `mongoClient.close()`, 10s forced-exit backstop; startup wrapped in `.catch`.
- **Single-replica caveat:** `runMigrations()` runs at boot; it is idempotent but
  not concurrency-guarded. **Deploy the first release with a single backend
  replica** to avoid concurrent migrations; revisit a lock before scaling out.

## Fase 10 — Persistence & data classification

| Write point | Classification |
| --- | --- |
| Application data (users, conversations, widgets, agents, offices) | **MongoDB** (external/Atlas) |
| Document uploads (RAG, ≤15 MB) | In-memory (multer) → stored **in MongoDB** |
| Avatars (≤2 MB) | In-memory → base64 **in MongoDB** |
| Encrypted provider keys / integration tokens | **MongoDB** (encrypted with `ENCRYPTION_KEY`) |
| Sessions | Better Auth → **MongoDB** |
| Model/response cache, temp files, logs | none on disk — **stateless**, logs to stdout |

**Conclusion:** the backend writes nothing to the local filesystem, so the
container is **stateless**. **No volume is created.** All durable state is in
MongoDB (managed externally). If disk persistence is ever introduced, define
volume + ownership + backup/restore before deploying.

## Fase 11 / 12 — Compose & environment matrix

- `compose.production-test.yml` (+ `compose.production-test.env.example`): builds
  each service from its **own folder** as Docker context, runs them on an internal
  network with health/readiness gating, backend against **external** MongoDB (no
  local Mongo added). Env comes from a git-ignored local file. Local validation
  only — Coolify manages the resources separately later.
  **Two services**: `frontend` and `backend`. No broker: the automation engine
  polls MongoDB from inside the backend process, and `stop_grace_period` gives
  in-flight runs room to drain on SIGTERM.
- `DEPLOYMENT_ENVIRONMENT_MATRIX.md`: every consumed variable with
  service/required/build-vs-runtime/sensitivity/`.invalid` example/source/rotation/
  consequence. `VITE_API_URL` explicitly marked build-time & public;
  `BETTER_AUTH_SECRET` vs `ENCRYPTION_KEY` distinguished; no invented variables
  (WhatsApp/Meta/Twilio creds live per-channel in Mongo, not env).

## Fase 13 / 14 — Repo split & container security

- `REPOSITORY_SPLIT_GUIDE.md`: target repo layouts, root-file disposition,
  clean-start vs history-preserving split (`git subtree split` / `git filter-repo`,
  shown not executed), secret-history scan, branch/Coolify wiring, cross-repo
  contract/versioning/rollback, and the out-of-monorepo independence check.
- Security: non-root images; official pinned base images; multi-stage (no
  TypeScript/dev deps/source in the backend runtime layer); no secrets in ARG or
  layers (only the public `VITE_API_URL` build arg); no DB port exposed; per-service
  `.dockerignore` (no whole-repo copy); `NODE_ENV=production`; `trust proxy = 1`
  in production for Coolify's proxy; body/upload limits preserved; readiness leaks
  nothing.

## Fase 15 — Tests (non-Docker executed; Docker pending)

**Executed here (green):**
- Isolated `npm ci` + `npm run build` for **backend** (168 pkgs) and **frontend**
  (193 pkgs) from copies **outside** the monorepo — proves independence + the new
  per-service locks.
- Frontend build with `VITE_API_URL=https://api.comunicacaoai.oneplataforma.com` →
  bundle contains that public URL, no `localhost:4000`, `widget-loader.js`, SPA
  `index.html` present. Secret scan: only the string identifier
  `BETTER_AUTH_SECRET` from the Better Auth isomorphic client's env-getter (no
  value; returns undefined in the browser) — **no secret value leaks**.
- Regression: `vitest run` → **53/53** pass (office + responsive + existing);
  `oxlint` clean.
- Backend config unit tests (`node --test`, new `backend/test/config.test.mjs`):
  **5/5** — prod fail-fast names the missing var without printing values, rejects
  non-https, strips trailing slash, splits CSV origins; dev falls back to
  localhost.

**Pending a Docker daemon (documented, not executed):**
- `docker build` of both images (no-cache), image-size + `docker history` secret
  inspection, container liveness/readiness toggling with/without Mongo, SIGTERM in
  a container, two-origin login/session/logout, CORS preflight accept/reject
  across running origins, Socket.IO origin accept/reject, upload within limit,
  webhook URL generation, and the full `compose.production-test.yml` bring-up
  (Fase 16). Exact commands are in the Delivery section.

## Acceptance criteria (Fase 24)

Met now: local state recorded; prior work preserved; no deploy/DNS/push/remote-repo;
each service independently installable/buildable **and verified out of the
monorepo**; per-service locks; multi-stage Dockerfiles; per-folder Docker context;
SPA fallback + cache; non-root backend prod process; images exclude `.env`/secrets
by `.dockerignore`; prod fail-fast; no silent localhost in prod; exact private CORS
allowlist; public CORS limited to widget routes; Socket.IO allowlist; Better
Auth/cookies audited for separate origins; cookie decision documented; liveness vs
readiness split; readiness pings Mongo without leaking; SIGTERM closes
HTTP/Socket.IO/Mongo; persistence classified, no needless volume; env documented
with no real values; `VITE_API_URL` marked build-time/public; split guide complete;
isolated builds tested outside the monorepo; existing/responsive tests + lint +
typecheck + builds pass.

Deferred to the Docker run (env has no daemon): containers-together bring-up and
the two-origin/Socket.IO/upload/webhook behaviors that need running containers.

## Final URLs (resolved)

The definitive ASCII origins are set (no trailing slash, no Punycode):

```
VITE_API_URL=https://api.comunicacaoai.oneplataforma.com          # frontend build-time
CLIENT_URL=https://comunicacaoai.oneplataforma.com                # backend runtime
BETTER_AUTH_URL=https://api.comunicacaoai.oneplataforma.com       # backend runtime
PUBLIC_URL=https://api.comunicacaoai.oneplataforma.com            # backend runtime
GOOGLE_REDIRECT_URI=https://api.comunicacaoai.oneplataforma.com/api/integrations/google/callback
```

`CLIENT_URLS` is **not** implemented — the allowlist is carried by `CLIENT_URL`.
Nothing remains blocked on URLs. Still deploy-time only (not set here): real
secrets, TLS, DNS/VPS/Coolify, and the live two-origin auth check.
